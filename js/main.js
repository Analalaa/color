import { initDB } from './storage.js';
import { initUpload } from './upload.js';
import { initCanvasWorkspace } from './canvas-workspace.js';
import { initReferenceLibrary } from './reference-library.js';
import { initPreview } from './preview.js';
import { initDownload } from './download.js';
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
  document.querySelectorAll('input[name="algo"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      EventBus.emit('algo-changed', e.target.value);
    });
  });

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
    await initDB();
    initUpload();
    initCanvasWorkspace();
    await initReferenceLibrary();
    initPreview();
    initDownload();
    initToolbar();
    console.log('[Color Muse] initialized');

    // Toggle download buttons based on algorithm
    EventBus.on('algo-changed', (algo) => {
      const btnLut = document.getElementById('btn-lut-download');
      const btnDownload = document.getElementById('btn-download');
      if (btnLut) {
        btnLut.style.display = algo === 'lut' ? '' : 'none';
        btnLut.disabled = true;
      }
      if (btnDownload) {
        btnDownload.style.display = algo === 'lut' ? 'none' : '';
      }
    });

    // LUT download button
    const btnLutDownload = document.getElementById('btn-lut-download');
    if (btnLutDownload) {
      btnLutDownload.addEventListener('click', () => {
        import('./preview.js').then(mod => mod.downloadCurrentLut());
      });
    }

    // Enable LUT download button when transfer completes and algo is LUT
    EventBus.on('transfer-complete', () => {
      const currentAlgo = document.querySelector('input[name="algo"]:checked');
      const btnLut = document.getElementById('btn-lut-download');
      if (btnLut && currentAlgo && currentAlgo.value === 'lut') {
        btnLut.disabled = false;
      }
    });
  } catch (err) {
    console.error('[Color Muse] Initialization failed:', err);
    showToast('初始化失败: ' + err.message);
  }
});
