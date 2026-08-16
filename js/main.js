import { initDB } from './storage.js';
import { initUpload } from './upload.js';
import { initCanvasWorkspace } from './canvas-workspace.js';
import { initReferenceLibrary } from './reference-library.js';
import { initPreview } from './preview.js';
import { initDownload } from './download.js';
import { initSplitCompare } from './split-compare.js';
import { initCandidateBoard } from './ui/candidate-board.js';
import { initColorAnatomy } from './ui/color-anatomy.js';
import { initEditorialShell } from './ui/editorial-shell.js';
import { initIntroGate } from './ui/intro-gate.js';
import { showToast } from './toast.js';

class EventBusImpl {
  constructor() {
    this.listeners = {};
  }
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }
  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }
  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(cb => {
      try { cb(data); } catch (err) { console.error(`[EventBus] handler for "${event}" threw:`, err); }
    });
  }
}

export const EventBus = new EventBusImpl();
window.EventBus = EventBus;
window.showToast = showToast;

function initToolbar() {
  const intensitySlider = document.getElementById('intensity-slider');
  const intensityValueEl = document.getElementById('intensity-value');
  if (intensitySlider) {
    let inputTimer = null;
    intensitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (intensityValueEl) intensityValueEl.textContent = val + '%';
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        EventBus.emit('intensity-changed', val / 100);
      }, 120);
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    try {
      await initDB();
    } catch (storageError) {
      console.warn('[Color Muse] Custom reference storage unavailable:', storageError);
    }
    initUpload();
    initCanvasWorkspace();
    await initReferenceLibrary();
    initCandidateBoard();
    initColorAnatomy();
    initEditorialShell(EventBus);
    initIntroGate();
    initPreview();
    initDownload();
    initSplitCompare();
    initToolbar();
    console.log('[Color Muse] initialized');

    // Enable toggle button when transfer completes
    EventBus.on('transfer-complete', ({ hasOriginal }) => {
      const toggleBtn = document.getElementById('btn-toggle-display');
      if (toggleBtn && hasOriginal) {
        toggleBtn.disabled = false;
      }
    });

    EventBus.on('result-invalidated', () => {
      const toggleBtn = document.getElementById('btn-toggle-display');
      if (toggleBtn) toggleBtn.disabled = true;
    });

    // Split compare button is handled by split-compare.js via EventBus
  } catch (err) {
    console.error('[Color Muse] Initialization failed:', err);
    showToast('初始化失败: ' + err.message);
  }
});
