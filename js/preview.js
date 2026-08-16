import { EventBus } from './main.js';
import { downloadLutAsCube } from './color-transfer/cube-writer.js';
import { setPixels, getDisplayDimensions, getCurrentPixels } from './canvas-workspace.js';
import {
  cancelCandidateGeneration,
  cancelFullRender,
  generateCandidates,
  renderFullCandidate,
  resizePixelData
} from './core/candidate-pipeline.js';

let currentResultPixels = null;
let currentResultDimensions = { width: 0, height: 0 };
let currentLut = null;
let currentReferenceRecipe = null;
let recipeDisabledLayerIds = [];
let selectedEngineId = null;
let lastIntensity = 1;
let lastRefData = null;
let lastRefId = null;
let sourceReady = false;
let candidateSet = [];
let analysisReport = null;
let generationRequest = 0;
let renderRequest = 0;
let autoGenerationTimer = null;

let isShowingResult = false;
let originalPixels = null;

export function initPreview() {
  EventBus.on('reference-selection-started', () => {
    EventBus.emit('color-analysis-reset');
    lastRefData = null;
    lastRefId = null;
    candidateSet = [];
    analysisReport = null;
    selectedEngineId = null;
    currentReferenceRecipe = null;
    recipeDisabledLayerIds = [];
    invalidateResult();
    emitInputState();
    updateStatus('正在读取参考图…');
  });
  EventBus.on('reference-selected', handleReferenceSelected);
  EventBus.on('candidate-generation-requested', () => generateCandidateSet({ preserveSelection: true }));
  EventBus.on('candidate-selection-requested', ({ engineId }) => {
    applyCandidate(engineId, { showPreview: true, useSuggestedIntensity: true });
  });
  EventBus.on('reference-recipe-options-changed', ({ disabledLayerIds = [] } = {}) => {
    recipeDisabledLayerIds = [...new Set(disabledLayerIds.filter(Boolean))];
    if (selectedEngineId === 'histogram' && lastRefData && sourceReady) {
      applyCandidate(selectedEngineId, { showPreview: false, useSuggestedIntensity: false });
    }
  });

  EventBus.on('intensity-changed', intensity => {
    lastIntensity = intensity;
    if (selectedEngineId && lastRefData && sourceReady) {
      EventBus.emit('candidate-active', {
        engineId: selectedEngineId,
        rendering: true,
        currentIntensity: lastIntensity,
        suggestedIntensity: candidateSet.find(item => item.engineId === selectedEngineId)?.suggestedIntensity
      });
      applyCandidate(selectedEngineId, { showPreview: false, useSuggestedIntensity: false });
    }
  });

  EventBus.on('canvas-ready', () => {
    EventBus.emit('color-analysis-reset');
    const current = getCurrentPixels();
    originalPixels = current ? new Uint8ClampedArray(current.data) : null;
    sourceReady = !!current;
    candidateSet = [];
    analysisReport = null;
    selectedEngineId = null;
    currentReferenceRecipe = null;
    recipeDisabledLayerIds = [];
    invalidateResult();
    emitInputState();
    scheduleAutomaticGeneration();
  });

  emitInputState();
}

async function handleReferenceSelected({ id, refData }) {
  if (!refData?.pixels?.length || !refData.width || !refData.height) {
    console.warn('[preview] No reference pixel data available');
    updateStatus('参考图数据无效');
    return;
  }

  lastRefData = {
    data: new Uint8ClampedArray(refData.pixels),
    width: refData.width,
    height: refData.height
  };
  lastRefId = id;
  candidateSet = [];
  analysisReport = null;
  selectedEngineId = null;
  currentReferenceRecipe = null;
  recipeDisabledLayerIds = [];
  invalidateResult();

  const intensitySlider = document.getElementById('intensity-slider');
  lastIntensity = intensitySlider ? parseInt(intensitySlider.value, 10) / 100 : 1;
  emitInputState();
  scheduleAutomaticGeneration();
  emitColorAnalysisState(getSourcePixels());
}

function emitColorAnalysisState(source, result = null, referenceRecipe = currentReferenceRecipe) {
  if (!source?.data?.length || !lastRefData?.data?.length) return;
  try {
    const maxSide = 520;
    EventBus.emit('color-analysis-state', {
      source: resizePixelData(source, maxSide),
      reference: resizePixelData(lastRefData, maxSide),
      result: result?.data?.length ? resizePixelData(result, maxSide) : null,
      engineId: selectedEngineId,
      intensity: lastIntensity,
      referenceRecipe: selectedEngineId === 'histogram' ? referenceRecipe : null
    });
  } catch (error) {
    console.warn('[preview] Color Anatomy analysis skipped:', error);
  }
}

function emitInputState() {
  EventBus.emit('candidate-input-state', {
    ready: sourceReady && !!lastRefData,
    sourceReady,
    referenceReady: !!lastRefData
  });
}

function scheduleAutomaticGeneration() {
  if (autoGenerationTimer) clearTimeout(autoGenerationTimer);
  if (!sourceReady || !lastRefData) return;
  autoGenerationTimer = setTimeout(() => {
    generateCandidateSet({ preserveSelection: false });
  }, 120);
}

async function generateCandidateSet({ preserveSelection = false } = {}) {
  const source = getSourcePixels();
  if (!source || !lastRefData) {
    updateStatus(source ? '请先选择参考图' : '请先上传图片');
    emitInputState();
    return;
  }

  if (autoGenerationTimer) clearTimeout(autoGenerationTimer);
  const requestId = ++generationRequest;
  const previousEngineId = preserveSelection ? selectedEngineId : null;
  renderRequest++;
  cancelFullRender();
  showSpinner();
  updateStatus('正在生成智能方案…');
  EventBus.emit('candidate-generation-started');

  try {
    const report = await generateCandidates({
      source,
      reference: lastRefData,
      maxSide: 720,
      onProgress: progress => {
        if (requestId === generationRequest) EventBus.emit('candidate-generation-progress', progress);
      }
    });
    if (requestId !== generationRequest) return;

    analysisReport = report;
    candidateSet = report.candidates;
    EventBus.emit('candidates-ready', report);
    const selectedCandidate = report.candidates.find(item => item.engineId === previousEngineId)
      || report.candidates.find(item => item.engineId === report.recommendation?.engineId)
      || report.candidates[0];
    await applyCandidate(selectedCandidate.engineId, {
      showPreview: true,
      useSuggestedIntensity: true
    });
  } catch (error) {
    if (requestId !== generationRequest || error?.name === 'AbortError') return;
    console.error('[preview] Candidate generation failed:', error);
    hideSpinner();
    const message = `方案生成失败: ${error.message || error}`;
    updateStatus(message);
    EventBus.emit('candidate-generation-error', { message });
  }
}

async function applyCandidate(engineId, {
  showPreview = true,
  useSuggestedIntensity = false
} = {}) {
  if (!lastRefData) return;
  const source = getSourcePixels();
  if (!source) return;

  const candidate = candidateSet.find(item => item.engineId === engineId);
  if (useSuggestedIntensity && candidate?.suggestedIntensity) {
    lastIntensity = candidate.suggestedIntensity;
    updateIntensityControl(lastIntensity);
  }
  selectedEngineId = engineId;
  currentLut = null;
  currentReferenceRecipe = null;
  currentResultPixels = null;
  currentResultDimensions = { width: 0, height: 0 };
  isShowingResult = false;
  EventBus.emit('result-invalidated');
  EventBus.emit('candidate-active', {
    engineId,
    rendering: true,
    currentIntensity: lastIntensity,
    suggestedIntensity: candidate?.suggestedIntensity
  });

  if (showPreview && candidate) {
    setPixels(candidate.pixels, candidate.width, candidate.height);
    isShowingResult = true;
  }

  const requestId = ++renderRequest;
  showSpinner();
  updateStatus(`正在应用「${candidate?.label || '智能方案'}」…`);

  try {
    const result = await renderFullCandidate({
      engineId,
      source,
      reference: lastRefData,
      intensity: lastIntensity,
      recipeOptions: engineId === 'histogram'
        ? { disabledLayerIds: recipeDisabledLayerIds }
        : null
    });
    if (requestId !== renderRequest || engineId !== selectedEngineId) return;

    currentResultPixels = result.resultPixels;
    currentResultDimensions = { width: source.width, height: source.height };
    currentLut = result.lut;
    currentReferenceRecipe = result.recipe || null;
    setPixels(currentResultPixels, source.width, source.height);
    isShowingResult = true;
    hideSpinner();
    updateStatus(`已采用「${candidate?.label || '智能方案'}」${lastRefId ? ` · ${lastRefId}` : ''}`);
    EventBus.emit('candidate-active', {
      engineId,
      rendering: false,
      currentIntensity: lastIntensity,
      suggestedIntensity: candidate?.suggestedIntensity
    });
    EventBus.emit('transfer-complete', {
      resultPixels: currentResultPixels,
      width: source.width,
      height: source.height,
      engineId,
      hasOriginal: !!originalPixels,
      originalPixels,
      referenceRecipe: currentReferenceRecipe
    });
    emitColorAnalysisState(source, {
      data: currentResultPixels,
      width: source.width,
      height: source.height
    }, currentReferenceRecipe);
  } catch (error) {
    if (requestId !== renderRequest) return;
    console.error('[preview] Full-resolution render failed:', error);
    hideSpinner();
    updateStatus(`应用失败: ${error.message || error}`);
    EventBus.emit('candidate-render-error', { engineId, message: error.message || String(error) });
  }
}

function invalidateResult() {
  generationRequest++;
  renderRequest++;
  cancelCandidateGeneration();
  cancelFullRender();
  currentResultPixels = null;
  currentResultDimensions = { width: 0, height: 0 };
  currentLut = null;
  currentReferenceRecipe = null;
  isShowingResult = false;
  hideSpinner();
  EventBus.emit('result-invalidated');
}

function getSourcePixels() {
  if (window.canvasWorkspace?.getOriginalImageData) {
    const data = window.canvasWorkspace.getOriginalImageData();
    if (data?.data?.length) return { data: data.data, width: data.width, height: data.height };
  }
  if (window.canvasWorkspace?.getCanvasData) {
    const data = window.canvasWorkspace.getCanvasData();
    if (data?.data?.length) return { data: data.data, width: data.width, height: data.height };
  }
  return null;
}

let spinnerEl = null;
function getSpinner() {
  if (!spinnerEl) spinnerEl = document.getElementById('processing-spinner');
  return spinnerEl;
}

function showSpinner() {
  getSpinner()?.classList.remove('hidden');
}

function hideSpinner() {
  getSpinner()?.classList.add('hidden');
}

function updateStatus(text) {
  const element = document.getElementById('status-text');
  if (element) element.textContent = text;
}

function updateIntensityControl(intensity) {
  const value = Math.round(intensity * 100);
  const slider = document.getElementById('intensity-slider');
  const label = document.getElementById('intensity-value');
  if (slider) slider.value = String(value);
  if (label) label.textContent = `${value}%`;
}

export function toggleDisplay() {
  if (!currentResultPixels || !currentResultDimensions.width) return false;
  isShowingResult = !isShowingResult;
  if (isShowingResult) {
    setPixels(currentResultPixels, currentResultDimensions.width, currentResultDimensions.height);
  } else if (originalPixels) {
    const dimensions = getDisplayDimensions();
    setPixels(originalPixels, dimensions.width, dimensions.height);
  }
  EventBus.emit('display-toggled', { isShowingResult });
  return isShowingResult;
}

export function showOriginal() {
  if (!isShowingResult || !originalPixels) return;
  isShowingResult = false;
  const dimensions = getDisplayDimensions();
  setPixels(originalPixels, dimensions.width, dimensions.height);
  EventBus.emit('display-toggled', { isShowingResult });
}

export function showResult() {
  if (!currentResultPixels || isShowingResult) return;
  isShowingResult = true;
  setPixels(currentResultPixels, currentResultDimensions.width, currentResultDimensions.height);
  EventBus.emit('display-toggled', { isShowingResult });
}

export function getResultPixels() {
  return currentResultPixels;
}

export function getResultDimensions() {
  return currentResultDimensions;
}

export function getLastReferencePixels() {
  return lastRefData?.data || null;
}

export function getLastReferenceData() {
  return lastRefData ? {
    data: lastRefData.data,
    width: lastRefData.width,
    height: lastRefData.height
  } : null;
}

export function getLastIntensity() {
  return lastIntensity;
}

export function getSelectedEngineId() {
  return selectedEngineId;
}

export function downloadCurrentLut() {
  if (!currentLut) {
    window.showToast?.('当前方案不包含可导出的 LUT');
    return;
  }
  downloadLutAsCube(currentLut, 33, `color-muse-${lastRefId || 'custom'}.cube`);
}

export function getCurrentLut() {
  return currentLut;
}

export function getCurrentReferenceRecipe() {
  return currentReferenceRecipe;
}

export function getAnalysisReport() {
  if (!analysisReport) return null;
  return {
    ...analysisReport,
    selection: {
      engineId: selectedEngineId,
      intensity: lastIntensity,
      referenceId: lastRefId
    }
  };
}

export function isResultShowing() {
  return isShowingResult;
}
