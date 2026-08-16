import { ENGINE_DEFINITIONS, runEngine } from './engine-registry.js';
import { assessQuality } from '../analysis/quality-metrics.js';
import { analyzeScene } from '../analysis/scene-profile.js';
import {
  DEFAULT_STRENGTH_GRID,
  buildRecommendation,
  rankCandidates,
  selectBestStrength
} from '../analysis/recommendation-policy.js';

const workerUrl = new URL('../workers/candidate-worker.js', import.meta.url);
let generationSerial = 0;
let activeCandidateWorkers = [];
let activeRenderJob = null;

function cancelJobs(jobs) {
  jobs.splice(0).forEach(job => job.cancel());
}

export function cancelCandidateGeneration() {
  generationSerial++;
  cancelJobs(activeCandidateWorkers);
}

export function cancelFullRender() {
  if (activeRenderJob) activeRenderJob.cancel();
  activeRenderJob = null;
}

export function resizePixelData(image, maxSide = 720) {
  const { data, width, height } = image;
  if (!data?.length || !width || !height) throw new Error('图片数据无效');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale === 1) {
    return { data: new Uint8ClampedArray(data), width, height };
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCanvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(data), width, height),
    0,
    0
  );

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const context = targetCanvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  return {
    data: context.getImageData(0, 0, targetWidth, targetHeight).data,
    width: targetWidth,
    height: targetHeight
  };
}

function runSynchronously({
  engineId,
  source,
  reference,
  intensity,
  intensities,
  includeLut,
  calculateMetrics,
  sceneProfile
}) {
  return new Promise(resolve => {
    setTimeout(() => {
      try {
        if (intensities?.length) {
          const variants = intensities.map(variantIntensity => {
            const { resultPixels } = runEngine({
              engineId,
              sourcePixels: source.data,
              referencePixels: reference.data,
              intensity: variantIntensity,
              includeLut: false
            });
            return {
              intensity: variantIntensity,
              resultPixels,
              assessment: assessQuality(source.data, resultPixels, reference.data, {
                width: source.width,
                height: source.height,
                sceneProfile
              })
            };
          });
          resolve({ engineId, variants });
          return;
        }

        const { resultPixels, lut } = runEngine({
          engineId,
          sourcePixels: source.data,
          referencePixels: reference.data,
          intensity,
          includeLut
        });
        resolve({
          engineId,
          resultPixels,
          lut,
          assessment: calculateMetrics
            ? assessQuality(source.data, resultPixels, reference.data, {
              width: source.width,
              height: source.height,
              sceneProfile
            })
            : null
        });
      } catch (error) {
        resolve({ engineId, error: error?.message || String(error) });
      }
    }, 0);
  });
}

function runWorkerJob({
  engineId,
  source,
  reference,
  intensity,
  intensities,
  includeLut,
  calculateMetrics,
  sceneProfile,
  timeoutMs = 20000,
  pool
}) {
  if (typeof Worker === 'undefined') {
    return runSynchronously({
      engineId,
      source,
      reference,
      intensity,
      intensities,
      includeLut,
      calculateMetrics,
      sceneProfile
    });
  }

  return new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(workerUrl, { type: 'module' });
    } catch (error) {
      resolve(runSynchronously({
        engineId,
        source,
        reference,
        intensity,
        intensities,
        includeLut,
        calculateMetrics,
        sceneProfile
      }));
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      finish({ engineId, error: '处理超时，请降低图片尺寸后重试' });
    }, timeoutMs);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      const index = pool.indexOf(job);
      if (index >= 0) pool.splice(index, 1);
      resolve(result);
    };
    const job = {
      worker,
      cancel() {
        finish({ engineId, error: '处理已取消', cancelled: true });
      }
    };
    pool.push(job);
    const jobId = `${engineId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sourceCopy = new Uint8ClampedArray(source.data);
    const referenceCopy = new Uint8ClampedArray(reference.data);

    worker.onmessage = event => {
      const message = event.data;
      if (message.error) {
        finish({ engineId, error: message.error });
        return;
      }
      finish({
        engineId,
        resultPixels: message.resultBuffer ? new Uint8ClampedArray(message.resultBuffer) : null,
        lut: message.lutBuffer ? new Float64Array(message.lutBuffer) : null,
        assessment: message.assessment,
        variants: message.variants?.map(variant => ({
          intensity: variant.intensity,
          resultPixels: new Uint8ClampedArray(variant.resultBuffer),
          assessment: variant.assessment
        })) || null
      });
    };
    worker.onerror = error => {
      finish({ engineId, error: error.message || 'Worker 处理失败' });
    };
    worker.postMessage({
      jobId,
      engineId,
      sourceBuffer: sourceCopy.buffer,
      referenceBuffer: referenceCopy.buffer,
      sourceWidth: source.width,
      sourceHeight: source.height,
      intensity,
      intensities,
      includeLut,
      calculateMetrics,
      sceneProfile
    }, [sourceCopy.buffer, referenceCopy.buffer]);
  });
}

export async function generateCandidates({
  source,
  reference,
  strengthGrid = DEFAULT_STRENGTH_GRID,
  maxSide = 720,
  onProgress
}) {
  cancelCandidateGeneration();
  const generationId = generationSerial;
  const startedAt = performance.now();
  const previewSource = resizePixelData(source, maxSide);
  const previewReference = resizePixelData(reference, maxSide);
  const sceneProfile = analyzeScene(previewSource.data);
  const intensities = [...new Set(strengthGrid.map(value => Math.max(0, Math.min(1, Number(value)))))]
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!intensities.length) throw new Error('没有可评估的强度档位');

  let completed = 0;
  const jobs = ENGINE_DEFINITIONS.map((engine, engineOrder) => runWorkerJob({
    engineId: engine.id,
    source: previewSource,
    reference: previewReference,
    intensities,
    includeLut: false,
    calculateMetrics: true,
    sceneProfile,
    pool: activeCandidateWorkers
  }).then(result => {
    completed++;
    let candidate = null;
    if (!result.error && result.variants?.length) {
      const best = selectBestStrength(result.variants);
      candidate = {
        id: `${generationId}-${result.engineId}`,
        engineId: result.engineId,
        engineOrder,
        label: engine.label,
        detail: engine.detail,
        exportable: engine.exportable,
        suggestedIntensity: best.intensity,
        pixels: best.resultPixels,
        width: previewSource.width,
        height: previewSource.height,
        rank: 0,
        ...best.assessment
      };
    }
    if (generationId === generationSerial && typeof onProgress === 'function') {
      onProgress({
        completed,
        total: ENGINE_DEFINITIONS.length,
        candidate,
        failure: result.error ? { engineId: result.engineId, message: result.error } : null
      });
    }
    return { result, candidate };
  }));
  const completedJobs = await Promise.all(jobs);
  const results = completedJobs.map(job => job.result);

  if (generationId !== generationSerial) {
    throw new DOMException('候选方案生成已取消', 'AbortError');
  }

  const failures = results
    .filter(result => result.error || !result.variants?.length)
    .map(result => ({ engineId: result.engineId, message: result.error || '没有生成可用强度' }));
  const candidates = completedJobs.map(job => job.candidate).filter(Boolean);

  if (!candidates.length) {
    const reasons = results.map(result => result.error).filter(Boolean).join('；');
    throw new Error(reasons || '没有生成可用方案');
  }
  const rankedCandidates = rankCandidates(candidates);
  return {
    sceneProfile,
    candidates: rankedCandidates,
    recommendation: buildRecommendation(rankedCandidates),
    failures,
    timings: {
      totalMs: Math.round(performance.now() - startedAt),
      previewWidth: previewSource.width,
      previewHeight: previewSource.height
    }
  };
}

export async function renderFullCandidate({ engineId, source, reference, intensity = 1 }) {
  cancelFullRender();
  const renderPool = [];
  const resultPromise = runWorkerJob({
    engineId,
    source,
    reference,
    intensity,
    includeLut: true,
    calculateMetrics: false,
    timeoutMs: 90000,
    pool: renderPool
  });
  activeRenderJob = renderPool[0] || null;
  const renderJob = activeRenderJob;
  const result = await resultPromise;
  if (activeRenderJob === renderJob) activeRenderJob = null;
  if (result.error) throw new Error(result.error);
  return result;
}
