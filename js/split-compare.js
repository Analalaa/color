/**
 * Split-screen image comparison.
 * Renders original on the left half, result on the right half,
 * with a white divider that follows cursor movement.
 */
import { EventBus } from './main.js';

let isActive = false;
let splitRatio = 0.5;
let originalPixels = null;
let resultPixels = null;
let canvasWidth = 0;
let canvasHeight = 0;

let overlayCanvas = null;
let overlayCtx = null;

export function initSplitCompare() {
  overlayCanvas = document.getElementById('split-overlay-canvas');
  overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;

  const toggleBtn = document.getElementById('btn-toggle-display');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSplit);
  }

  if (overlayCanvas) {
    overlayCanvas.addEventListener('mousemove', onCanvasMouseMove);
    overlayCanvas.addEventListener('touchmove', onCanvasTouchMove, { passive: true });
  }

  EventBus.on('transfer-complete', onTransferComplete);
  EventBus.on('result-invalidated', resetSplit);
  EventBus.on('canvas-ready', resetSplit);
}

function onTransferComplete({ hasOriginal, originalPixels: origPx }) {
  if (!hasOriginal || !origPx) return;

  originalPixels = new Uint8ClampedArray(origPx);

  // Capture result at display resolution from canvas (after setPixels rendered it)
  const data = window.canvasWorkspace?.getCurrentPixels?.();
  if (data) {
    resultPixels = new Uint8ClampedArray(data.data);
    canvasWidth = data.width;
    canvasHeight = data.height;
  }
}

function toggleSplit() {
  if (!resultPixels || !originalPixels) return;
  isActive = !isActive;
  if (isActive) {
    splitRatio = 0.5;
    showSplit();
  } else {
    hideSplit();
  }
  updateToggleLabel();
}

function resetSplit() {
  isActive = false;
  originalPixels = null;
  resultPixels = null;
  hideSplit();
  updateToggleLabel();
}

function updateToggleLabel() {
  const label = document.getElementById('toggle-label');
  if (label) label.textContent = isActive ? '关闭对照' : '分屏对照';
}

function showSplit() {
  if (!overlayCanvas) return;

  overlayCanvas.width = canvasWidth;
  overlayCanvas.height = canvasHeight;
  overlayCanvas.style.maxWidth = '90%';
  overlayCanvas.style.maxHeight = '90%';
  overlayCanvas.style.width = canvasWidth + 'px';
  overlayCanvas.style.height = canvasHeight + 'px';
  overlayCanvas.style.pointerEvents = 'auto';

  renderSplit();
}

function hideSplit() {
  if (overlayCanvas && overlayCtx) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCanvas.style.pointerEvents = 'none';
  }
}

function makeOffscreenCanvas(pixels, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  return c;
}

function renderSplit() {
  if (!overlayCtx || !originalPixels || !resultPixels) return;

  const w = canvasWidth;
  const h = canvasHeight;
  const splitX = Math.round(w * splitRatio);

  // Build offscreen canvases (putImageData ignores clip, drawImage respects it)
  const origCanvas = makeOffscreenCanvas(originalPixels, w, h);
  const resultCanvas = makeOffscreenCanvas(resultPixels, w, h);

  // Draw original as full background
  overlayCtx.clearRect(0, 0, w, h);
  overlayCtx.drawImage(origCanvas, 0, 0);

  // Draw result clipped to right half
  overlayCtx.save();
  overlayCtx.beginPath();
  overlayCtx.rect(splitX, 0, w - splitX, h);
  overlayCtx.clip();
  overlayCtx.drawImage(resultCanvas, 0, 0);
  overlayCtx.restore();

  // Full-height white divider line
  overlayCtx.save();
  overlayCtx.strokeStyle = '#ffffff';
  overlayCtx.lineWidth = 2;
  overlayCtx.shadowColor = 'rgba(0,0,0,0.4)';
  overlayCtx.shadowBlur = 6;
  overlayCtx.beginPath();
  overlayCtx.moveTo(splitX + 0.5, 0);
  overlayCtx.lineTo(splitX + 0.5, h);
  overlayCtx.stroke();
  overlayCtx.restore();
}

function onCanvasMouseMove(e) {
  if (!isActive || !overlayCanvas) return;
  const rect = overlayCanvas.getBoundingClientRect();
  splitRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  renderSplit();
}

function onCanvasTouchMove(e) {
  if (!isActive || !overlayCanvas) return;
  const touch = e.touches[0];
  const rect = overlayCanvas.getBoundingClientRect();
  splitRatio = Math.max(0.02, Math.min(0.98, (touch.clientX - rect.left) / rect.width));
  renderSplit();
}
