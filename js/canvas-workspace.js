import { EventBus } from './main.js';

let currentCanvas = null;
let currentCtx = null;
let currentImage = null;
let currentWidth = 0;
let currentHeight = 0;
let currentImageName = '';
const imageQueue = [];

export function initCanvasWorkspace() {
  EventBus.on('image-loaded', ({ img, file, name, size }) => {
    imageQueue.push({ img, file: file || null, name });
    currentImageName = name || 'image';
    renderImageToCanvas(img);
    const tag = imageQueue.length > 1 ? ` (队列 ${imageQueue.length})` : '';
    updateStatus(`已加载: ${name} (${(size / 1024 / 1024).toFixed(1)}MB)${tag}`);
  });

  EventBus.on('batch-requested', () => {
    if (imageQueue.length === 0) {
      EventBus.emit('batch-start', { images: [] });
      return;
    }
    EventBus.emit('batch-start', { images: imageQueue.slice() });
  });
}

export function renderImageToCanvas(img) {
  try {
    const workspace = document.querySelector('.canvas-workspace');
    if (!workspace) return;

    // Remove old canvas if exists
    const oldCanvas = document.getElementById('workspace-canvas');
    if (oldCanvas) oldCanvas.remove();

    // Create new canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'workspace-canvas';
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
  return { width: currentCanvas?.width || 0, height: currentCanvas?.height || 0 };
}

// Returns full-resolution pixel data from the original Image (not the scaled display canvas).
// This is what color transfer should consume so downloads are at original resolution.
export function getOriginalImageData() {
  if (!currentImage) return null;
  const off = document.createElement('canvas');
  off.width = currentImage.naturalWidth || currentImage.width;
  off.height = currentImage.naturalHeight || currentImage.height;
  const offCtx = off.getContext('2d');
  offCtx.drawImage(currentImage, 0, 0);
  return offCtx.getImageData(0, 0, off.width, off.height);
}

export function getOriginalDimensions() {
  if (!currentImage) return { width: 0, height: 0 };
  return {
    width: currentImage.naturalWidth || currentImage.width,
    height: currentImage.naturalHeight || currentImage.height
  };
}

export function getCurrentImageName() {
  return currentImageName;
}

export function hasImage() {
  return currentImage !== null;
}

function updateStatus(text) {
  const statusEl = document.getElementById('status-text');
  if (statusEl) statusEl.textContent = text;
}

export function setPixels(pixels, width, height) {
  if (!currentCanvas || !currentCtx) return;

  const disp = getDisplayDimensions();
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

  // If full-res pixels don't match canvas display size, scale down for rendering
  if (width === disp.width && height === disp.height) {
    currentCtx.putImageData(imageData, 0, 0);
  } else {
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offCtx = off.getContext('2d');
    offCtx.putImageData(imageData, 0, 0);
    currentCtx.clearRect(0, 0, disp.width, disp.height);
    currentCtx.drawImage(off, 0, 0, disp.width, disp.height);
  }
}

export function getCurrentPixels() {
  if (!currentCanvas || !currentCtx) return null;
  return currentCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
}

export function getDisplayDimensions() {
  if (!currentCanvas) return { width: 0, height: 0 };
  return { width: currentCanvas.width, height: currentCanvas.height };
}

// Expose to window for preview module access
window.canvasWorkspace = {
  getCanvasData,
  getCanvasDimensions,
  getOriginalImageData,
  getOriginalDimensions,
  getCurrentImageName,
  getDisplayDimensions,
  hasImage,
  renderImageToCanvas,
  setPixels,
  getCurrentPixels
};
