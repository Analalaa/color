const DB_NAME = 'colormuse_db';
const DB_VERSION = 1;
let db = null;

export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('reference_images')) {
        database.createObjectStore('reference_images', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

export async function saveReferenceImage(imageData) {
  const tx = db.transaction('reference_images', 'readwrite');
  tx.objectStore('reference_images').add(imageData);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllReferenceImages() {
  const tx = db.transaction('reference_images', 'readonly');
  return new Promise((resolve, reject) => {
    const request = tx.objectStore('reference_images').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteReferenceImage(id) {
  const tx = db.transaction('reference_images', 'readwrite');
  tx.objectStore('reference_images').delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export function savePreference(key, value) {
  const prefs = JSON.parse(localStorage.getItem('colormuse_preferences') || '{}');
  prefs[key] = value;
  localStorage.setItem('colormuse_preferences', JSON.stringify(prefs));
}

export function getPreference(key, defaultValue) {
  const prefs = JSON.parse(localStorage.getItem('colormuse_preferences') || '{}');
  return prefs[key] !== undefined ? prefs[key] : defaultValue;
}