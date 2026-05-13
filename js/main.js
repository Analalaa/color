// EventBus implementation
class EventBus {
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
    this.listeners[event].forEach(cb => cb(data));
  }
}

const eventBus = new EventBus();
window.EventBus = eventBus;

// Initialize toolbar controls
function initToolbar() {
  // Algorithm switch handler
  document.querySelectorAll('input[name="algo"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      EventBus.emit('algo-changed', e.target.value);
    });
  });

  // Intensity slider handler
  const intensitySlider = document.getElementById('intensity-slider');
  if (intensitySlider) {
    intensitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      // Update displayed value
      const valEl = document.getElementById('intensity-value');
      if (valEl) valEl.textContent = val + '%';
      EventBus.emit('intensity-changed', val / 100);
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
  } catch (err) {
    console.error('[Color Muse] Initialization failed:', err);
  }
});
