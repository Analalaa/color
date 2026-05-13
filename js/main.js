// EventBus - simple event emitter for module communication
const EventBus = {
  events: {},
  on(event, callback) {
    (this.events[event] = this.events[event] || []).push(callback);
  },
  emit(event, data) {
    (this.events[event] || []).forEach(cb => cb(data));
  }
};

window.EventBus = EventBus;

// All modules will be imported and initialized here
import './storage.js';
import './upload.js';
import './canvas-workspace.js';
import './reference-library.js';
import './preview.js';
import './download.js';

window.addEventListener('DOMContentLoaded', async () => {
  // Modules self-initialize via their init functions
  console.log('[Color Muse] initialized');
});