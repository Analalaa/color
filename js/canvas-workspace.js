import { EventBus } from './main.js';

let currentCanvas = null;
let currentCtx = null;
let currentImage = null;
let currentWidth = 0;
let currentHeight = 0;

export function initCanvasWorkspace() {
  EventBus.on('image-loaded', ({ img, name, size }) => {
    renderImageToCanvas(img);
    updateStatus(`已加载: ${name} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  });
}

export function renderImageToCanvas(img) {
  try {
    const workspace = document.querySelector('.canvas-workspace');
    if (!workspace) return;

    // Remove old canvas if exists
    const oldCanvas = document.getElementById('main-canvas');
    if (oldCanvas) oldCanvas.remove();

    // Create new canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'main-canvas';
    workspace.appendChild(canvas);

    // Calculate display size (fit to 90% of workspace)
    const maxW = workspace.clientWidth * 0.9;
    const maxH = workspace.clientHeight * 0.9;
    let w = img.width;
    let h = img.height;

    if (w > maxW) {
      h = h * (maxW / w);
      w = maxW;
    }
    if (h > maxH) {
      w = w * (maxH / h);
      h = maxH;
    }

    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.imageRendering = 'pixelated';

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    currentCanvas = canvas;
    currentCtx = ctx;
    currentImage = img;
    currentWidth = img.width;
    currentHeight = img.height;

    EventBus.emit('dropzone-hide');

    EventBus.emit('canvas-ready', { canvas, ctx, img, width: img.width, height: img.height });
  } catch (err) {
    console.error('[canvas-workspace] Failed to render image:', err);
    updateStatus('图片加载失败');
  }
}

export function getCanvasData() {
  if (!currentCanvas || !currentCtx) return null;
  return currentCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
}

export function getCanvasDimensions() {
  return { width: currentWidth, height: currentHeight };
}

function updateStatus(text) {
  const statusEl = document.getElementById('status-text');
  if (statusEl) statusEl.textContent = text;
}

// Expose to window for preview module access
window.canvasWorkspace = {
  getCanvasData,
  getCanvasDimensions,
  renderImageToCanvas
};