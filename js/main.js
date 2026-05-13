import { EventBus } from './main.js';
import { initDB } from './storage.js';
import { initUpload } from './upload.js';
import { initCanvasWorkspace } from './canvas-workspace.js';
import { initReferenceLibrary } from './reference-library.js';
import { initPreview } from './preview.js';
import { initDownload } from './download.js';

window.EventBus = EventBus;

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
    initUpload();
    initCanvasWorkspace();
    await initReferenceLibrary();
    initPreview();
    initDownload();
    console.log('[Color Muse] initialized');
  } catch (err) {
    console.error('[Color Muse] Initialization failed:', err);
  }
});
