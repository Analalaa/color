import { EventBus } from './main.js';
import { saveReferenceImage, getAllReferenceImages, deleteReferenceImage, getReferenceImageById } from './storage.js';

// Built-in reference images sourced from the local assets/references tree.
// Only the 复古 category currently ships with real images; other categories
// rely on user-uploaded customs.
const BUILTIN_REFS = [
  { id: 'vintage-1', category: '复古', url: 'assets/references/复古/find.jpg' },
  { id: 'vintage-2', category: '复古', url: 'assets/references/复古/图1.jpeg' },
  { id: 'vintage-3', category: '复古', url: 'assets/references/复古/图2.jpeg' },
  { id: 'vintage-4', category: '复古', url: 'assets/references/复古/Feynman正经证件照.png' },
  { id: 'vintage-5', category: '复古', url: 'assets/references/复古/Feynman证件照侧身.png' },
];

let selectedRefId = null;
let selectedIsCustom = false;

export async function initReferenceLibrary() {
  renderBuiltinRefs();
  await renderCustomRefs();
  setupUploadButton();
  setupCategoryFilter();
}

// Render built-in reference images as clickable thumbnails
function renderBuiltinRefs() {
  const container = document.getElementById('builtin-library');
  if (!container) return;

  if (BUILTIN_REFS.length === 0) {
    container.innerHTML = '<p style="color:#555;font-size:12px;text-align:center;padding:10px">暂无内置参考图</p>';
    return;
  }

  container.innerHTML = BUILTIN_REFS.map(ref => {
    const encodedUrl = encodeURI(ref.url);
    return `
    <div class="ref-thumb" data-id="${ref.id}" data-category="${ref.category}" onclick="window.selectBuiltinRef('${ref.id}')">
      <img src="${encodedUrl}" alt="${ref.category}" onerror="this.parentElement.style.display='none'">
    </div>
  `;
  }).join('');
}

// Load built-in reference image as pixel data
async function loadBuiltinRefPixels(id) {
  const ref = BUILTIN_REFS.find(r => r.id === id);
  if (!ref) return null;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({ pixels: data.data, width: canvas.width, height: canvas.height });
        } catch (err) {
          console.error('[reference-library] getImageData failed (CORS/tainted?):', err);
          resolve(null);
        }
      };
      img.onerror = (e) => {
        console.error('[reference-library] Failed to load builtin ref:', ref.url, e);
        resolve(null);
      };
      img.src = encodeURI(ref.url);
    } catch (err) {
      console.error('[reference-library] loadBuiltinRefPixels error:', err);
      resolve(null);
    }
  });
}

// Render custom reference images from IndexedDB
async function renderCustomRefs() {
  const container = document.getElementById('custom-library');
  if (!container) return;

  try {
    const customs = await getAllReferenceImages();
    if (customs.length === 0) {
      container.innerHTML = '<p style="color:#555;font-size:12px;text-align:center;padding:10px">暂无自定义图库</p>';
      return;
    }

    container.innerHTML = customs.map(ref => `
      <div class="ref-thumb" data-id="${ref.id}" onclick="window.selectCustomRef('${ref.id}')">
        <img src="${ref.thumbnail}" alt="custom">
      </div>
    `).join('');
  } catch (err) {
    console.error('[reference-library] Failed to load custom refs:', err);
    container.innerHTML = '<p style="color:#e94560;font-size:12px">加载失败</p>';
  }
}

// Load custom reference image from IndexedDB
async function loadCustomRefPixels(id) {
  try {
    const ref = await getReferenceImageById(id);
    if (!ref) return null;

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(ref.blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve({ pixels: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch (err) {
    console.error('[reference-library] Failed to load custom ref pixels:', err);
    return null;
  }
}

// Select a built-in reference image
window.selectBuiltinRef = async function(id) {
  selectRefElement(id);
  selectedRefId = id;
  selectedIsCustom = false;

  // Load reference image pixels and emit
  const refData = await loadBuiltinRefPixels(id);
  if (refData) {
    EventBus.emit('reference-selected', { id, isCustom: false, refData });
  } else if (window.showToast) {
    window.showToast('参考图加载失败');
  }
};

// Select a custom reference image
window.selectCustomRef = async function(id) {
  selectRefElement(id);
  selectedRefId = id;
  selectedIsCustom = true;

  const refData = await loadCustomRefPixels(id);
  if (refData) {
    EventBus.emit('reference-selected', { id, isCustom: true, refData });
  } else if (window.showToast) {
    window.showToast('自定义参考图加载失败');
  }
};

function selectRefElement(id) {
  document.querySelectorAll('.ref-thumb').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.ref-thumb[data-id="${id}"]`);
  if (el) el.classList.add('selected');
}

// Setup upload button for custom reference images
function setupUploadButton() {
  const btn = document.getElementById('upload-ref-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const input = document.getElementById('ref-file-input');
    if (!input) return;

    input.value = '';

    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('change', async () => {
      for (const file of Array.from(newInput.files)) {
        if (file.size > 10 * 1024 * 1024) {
          if (window.showToast) {
            window.showToast('参考图需小于 10MB');
          } else {
            alert('参考图需小于 10MB');
          }
          continue;
        }

        const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const thumbnail = await createThumbnail(file);
        try {
          await saveReferenceImage({ id, name: file.name, blob: file, thumbnail });
        } catch (err) {
          console.error('[reference-library] Failed to save custom ref:', err);
          if (window.showToast) window.showToast('上传失败，请重试');
        }
      }
      await renderCustomRefs();
      newInput.value = '';
    });

    newInput.click();
  });
}

// Create 80x80 thumbnail for custom reference image
async function createThumbnail(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        // Crop to square
        const s = Math.min(img.width, img.height);
        const dx = (img.width - s) / 2;
        const dy = (img.height - s) / 2;
        ctx.drawImage(img, dx, dy, s, s, 0, 0, 80, 80);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve('data:image/png,encoded_error');
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('data:image/png,encoded_error');
    reader.readAsDataURL(file);
  });
}

// Setup category filter (future enhancement — for now just groups visually)
function setupCategoryFilter() {
  // Filter functionality can be added as a future enhancement
  // Currently images are displayed in a flat grid
}