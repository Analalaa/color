import { EventBus } from './main.js';
import { transferColor } from './color-transfer/histogram-transfer.js';

let currentResultPixels = null;
let currentResultDimensions = { width: 0, height: 0 };
let lastIntensity = 1.0;
let lastRefPixels = null;

export function initPreview() {
  // Listen for reference selection
  EventBus.on('reference-selected', handleReferenceSelected);

  // Listen for intensity changes (re-run transfer if already have result)
  EventBus.on('intensity-changed', (intensity) => {
    lastIntensity = intensity;
    // Re-run transfer if we have source pixels and stored reference pixels
    const srcData = getSourcePixels();
    if (srcData && lastRefPixels) {
      const resultPixels = transferColor(srcData.data, lastRefPixels, lastIntensity);
      currentResultPixels = resultPixels;
      renderResult(resultPixels, srcData.width, srcData.height);
      EventBus.emit('transfer-complete', { resultPixels, width: srcData.width, height: srcData.height });
    }
  });
}

// Store the last reference data for re-processing on intensity change
async function handleReferenceSelected({ id, isCustom, refData }) {
  if (!refData || !refData.pixels) {
    console.warn('[preview] No reference pixel data available');
    return;
  }

  lastRefPixels = refData.pixels;

  const srcData = getSourcePixels();
  if (!srcData) {
    console.warn('[preview] No source image loaded');
    updateStatus('请先上传图片');
    return;
  }

  // Get intensity from slider
  const intensitySlider = document.getElementById('intensity-slider');
  lastIntensity = intensitySlider ? parseInt(intensitySlider.value) / 100 : 1.0;

  // Run color transfer
  updateStatus('处理中...');

  try {
    const resultPixels = transferColor(srcData.data, refData.pixels, lastIntensity);
    currentResultPixels = resultPixels;
    currentResultDimensions = { width: srcData.width, height: srcData.height };

    // Render result
    renderResult(resultPixels, srcData.width, srcData.height);

    updateStatus(`处理完成 (${id})`);
    EventBus.emit('transfer-complete', { resultPixels, width: srcData.width, height: srcData.height });
  } catch (err) {
    console.error('[preview] Color transfer failed:', err);
    updateStatus('处理失败');
  }
}

function getSourcePixels() {
  // Try to get from canvas-workspace
  if (window.canvasWorkspace && window.canvasWorkspace.getCanvasData) {
    const data = window.canvasWorkspace.getCanvasData();
    if (!data || !data.data) return null;
    if (data) return { data: data.data, width: data.width, height: data.height };
  }

  // Fallback: get from main canvas
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function renderResult(pixels, width, height) {
  // Create or update result canvas
  let canvas = document.getElementById('result-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'result-canvas';
    document.querySelector('.canvas-workspace').appendChild(canvas);
  }

  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.right = '20px';
  canvas.style.bottom = '80px';
  canvas.style.maxWidth = '200px';
  canvas.style.maxHeight = 'auto';
  canvas.style.border = '2px solid #e94560';
  canvas.style.borderRadius = '8px';
  canvas.style.zIndex = '10';

  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
  ctx.putImageData(imageData, 0, 0);
}

function updateStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

// Export for access by other modules
export function getResultPixels() {
  return currentResultPixels;
}

export function getResultDimensions() {
  return currentResultDimensions;
}