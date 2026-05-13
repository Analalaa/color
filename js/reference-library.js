import { EventBus } from './main.js';
import { saveReferenceImage, getAllReferenceImages, deleteReferenceImage, getReferenceImageById } from './storage.js';

// Built-in reference images — placeholders use picsum.photos for demo
// In production, these would be actual curated reference images
const BUILTIN_REFS = [
  // 日系 — low saturation, high brightness, cool tones
  { id: 'japanese-1', category: '日系', url: 'https://picsum.photos/seed/jp1/200/200' },
  { id: 'japanese-2', category: '日系', url: 'https://picsum.photos/seed/jp2/200/200' },
  { id: 'japanese-3', category: '日系', url: 'https://picsum.photos/seed/jp3/200/200' },
  // 欧美 — high contrast, high saturation, warm tones
  { id: 'european-1', category: '欧美', url: 'https://picsum.photos/seed/eu1/200/200' },
  { id: 'european-2', category: '欧美', url: 'https://picsum.photos/seed/eu2/200/200' },
  { id: 'european-3', category: '欧美', url: 'https://picsum.photos/seed/eu3/200/200' },
  // 复古 — grainy, faded, color cast
  { id: 'vintage-1', category: '复古', url: 'https://picsum.photos/seed/vn1/200/200' },
  { id: 'vintage-2', category: '复古', url: 'https://picsum.photos/seed/vn2/200/200' },
  { id: 'vintage-3', category: '复古', url: 'https://picsum.photos/seed/vn3/200/200' },
  // 赛博 — neon colors, high contrast, purple/green
  { id: 'cyber-1', category: '赛博', url: 'https://picsum.photos/seed/cy1/200/200' },
  { id: 'cyber-2', category: '赛博', url: 'https://picsum.photos/seed/cy2/200/200' },
  { id: 'cyber-3', category: '赛博', url: 'https://picsum.photos/seed/cy3/200/200' },
  // 莫兰迪 — low saturation grayish, soft
  { id: 'morandi-1', category: '莫兰迪', url: 'https://picsum.photos/seed/mo1/200/200' },
  { id: 'morandi-2', category: '莫兰迪', url: 'https://picsum.photos/seed/mo2/200/200' },
  { id: 'morandi-3', category: '莫兰迪', url: 'https://picsum.photos/seed/mo3/200/200' },
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

  container.innerHTML = BUILTIN_REFS.map(ref => `
    <div class="ref-thumb" data-id="${ref.id}" data-category="${ref.category}" data-url="${ref.url}" onclick="window.selectBuiltinRef('${ref.id}')">
      <img src="${ref.url}" alt="${ref.category}" crossorigin="anonymous" onerror="this.parentElement.style.display='none'">
    </div>
  `).join('');
}

// Load built-in reference image as pixel data
async function loadBuiltinRefPixels(id) {
  const ref = BUILTIN_REFS.find(r => r.id === id);
  if (!ref) return null;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({ pixels: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height });
      };
      img.onerror = () => resolve(null);
      img.src = ref.url;
    } catch (err) {
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
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      for (const file of Array.from(input.files)) {
        if (file.size > 10 * 1024 * 1024) {
          // Use showToast if available, otherwise alert
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
      document.body.removeChild(input);
    });

    input.click();
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