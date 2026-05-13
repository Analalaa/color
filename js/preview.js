import { EventBus } from './main.js';
import { transferColor } from './color-transfer/histogram-transfer.js';
import { generateLut } from './color-transfer/lut-generator.js';
import { applyLut } from './color-transfer/lut-applier.js';
import { downloadLutAsCube } from './color-transfer/cube-writer.js';

let currentResultPixels = null;
let currentResultDimensions = { width: 0, height: 0 };
let lastIntensity = 1.0;
let currentLut = null;
let currentAlgo = 'histogram';
let lastRefPixels = null;
let lastRefId = null;

export function initPreview() {
  EventBus.on('reference-selected', handleReferenceSelected);

  EventBus.on('intensity-changed', (intensity) => {
    lastIntensity = intensity;
    if (currentAlgo === 'lut') currentLut = null; // intensity baked into LUT
    runTransfer();
  });

  EventBus.on('algo-changed', (algo) => {
    currentAlgo = algo;
    runTransfer();
  });

  // If a reference was selected before the image was uploaded, run transfer when image arrives.
  EventBus.on('canvas-ready', () => {
    if (lastRefPixels) {
      runTransfer();
    }
  });
}

async function handleReferenceSelected({ id, isCustom, refData }) {
  if (!refData || !refData.pixels) {
    console.warn('[preview] No reference pixel data available');
    updateStatus('参考图数据无效');
    return;
  }

  currentLut = null;
  lastRefPixels = refData.pixels;
  lastRefId = id;

  const intensitySlider = document.getElementById('intensity-slider');
  lastIntensity = intensitySlider ? parseInt(intensitySlider.value) / 100 : 1.0;

  runTransfer();
}

function runTransfer() {
  if (!lastRefPixels) return;

  const srcData = getSourcePixels();
  if (!srcData) {
    updateStatus('请先上传图片');
    return;
  }

  updateStatus('处理中...');

  // Yield to the browser so the status update renders before the heavy CPU loop.
  setTimeout(() => {
    try {
      let resultPixels;
      if (currentAlgo === 'lut') {
        if (!currentLut) {
          currentLut = generateLut(lastRefPixels, 33, lastIntensity);
        }
        resultPixels = applyLut(srcData.data, currentLut);
      } else {
        currentLut = null;
        resultPixels = transferColor(srcData.data, lastRefPixels, lastIntensity);
      }
      currentResultPixels = resultPixels;
      currentResultDimensions = { width: srcData.width, height: srcData.height };
      renderResult(resultPixels, srcData.width, srcData.height);
      updateStatus(lastRefId ? `处理完成 (${lastRefId})` : '处理完成');
      EventBus.emit('transfer-complete', { resultPixels, width: srcData.width, height: srcData.height });
    } catch (err) {
      console.error('[preview] Color transfer failed:', err);
      updateStatus('处理失败: ' + (err.message || err));
    }
  }, 16);
}

function getSourcePixels() {
  // Prefer original full-resolution image data so the output is high quality.
  if (window.canvasWorkspace && window.canvasWorkspace.getOriginalImageData) {
    const data = window.canvasWorkspace.getOriginalImageData();
    if (data && data.data && data.data.length > 0) {
      return { data: data.data, width: data.width, height: data.height };
    }
  }

  // Fallback: scaled display canvas.
  if (window.canvasWorkspace && window.canvasWorkspace.getCanvasData) {
    const data = window.canvasWorkspace.getCanvasData();
    if (data && data.data && data.data.length > 0) {
      return { data: data.data, width: data.width, height: data.height };
    }
  }

  return null;
}

function renderResult(pixels, width, height) {
  const workspace = document.querySelector('.canvas-workspace');
  if (!workspace) return;

  let canvas = document.getElementById('result-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'result-canvas';
    workspace.appendChild(canvas);
  }

  canvas.width = width;
  canvas.height = height;

  // Pin to the bottom-right of the workspace for a side-by-side comparison preview.
  canvas.style.position = 'absolute';
  canvas.style.right = '20px';
  canvas.style.bottom = '20px';
  canvas.style.maxWidth = '40%';
  canvas.style.maxHeight = '40%';
  canvas.style.width = 'auto';
  canvas.style.height = 'auto';
  canvas.style.border = '2px solid #e94560';
  canvas.style.borderRadius = '8px';
  canvas.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
  canvas.style.zIndex = '10';
  canvas.style.background = '#000';

  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
  ctx.putImageData(imageData, 0, 0);
}

function updateStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

export function getResultPixels() {
  return currentResultPixels;
}

export function getResultDimensions() {
  return currentResultDimensions;
}

export function getLastReferencePixels() {
  return lastRefPixels;
}

export function getLastIntensity() {
  return lastIntensity;
}

export function downloadCurrentLut() {
  if (!currentLut) {
    if (window.showToast) window.showToast('请先生成 LUT 结果');
    return;
  }
  const refName = lastRefId || 'custom';
  downloadLutAsCube(currentLut, 33, 'color-muse-' + refName + '.cube');
}

export function getCurrentLut() {
  return currentLut;
}
