import { EventBus } from './main.js';
import { showToast } from './toast.js';

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

export function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const uploadBtn = document.getElementById('upload-btn');
  const sampleBtn = document.getElementById('sample-btn');

  EventBus.on('dropzone-hide', () => {
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.display = 'none';
  });

  if (!dropZone || !uploadBtn) {
    console.warn('[upload] Drop zone or upload button not found');
    return;
  }

  // Click to upload (fallback when drag fails)
  dropZone.addEventListener('click', () => {
    openFilePicker();
  });

  uploadBtn.addEventListener('click', () => {
    openFilePicker();
  });

  sampleBtn?.addEventListener('click', () => {
    loadSampleImage();
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(f => FILE_TYPES.includes(f.type));
    const invalidCount = files.length - validFiles.length;
    if (invalidCount > 0) {
      showToast(`${invalidCount} 个文件格式不支持，已跳过`);
    }
    validFiles.forEach(file => loadImageFile(file));
  });
}

function loadSampleImage() {
  const img = new Image();
  img.onload = () => {
    EventBus.emit('image-loaded', {
      file: null,
      img,
      dataUrl: img.src,
      name: 'Color Muse 示例原图',
      size: 0
    });
    if (typeof window.selectBuiltinRef === 'function') {
      window.selectBuiltinRef('vintage-2');
      showToast('演示素材已载入，正在自动审色');
    } else {
      showToast('示例原图已载入，请选择右侧参考风格');
    }
  };
  img.onerror = () => showToast('示例图片加载失败');
  img.src = encodeURI('assets/references/复古/find.jpg');
}

function openFilePicker() {
  const input = document.getElementById('file-input');
  if (!input) return;

  // Reset so selecting the same file twice still fires change
  input.value = '';

  // Remove any old listener to avoid stacking
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.addEventListener('change', () => {
    Array.from(newInput.files).forEach(file => loadImageFile(file));
    newInput.value = '';
  });
  newInput.click();
}

function loadImageFile(file) {
  // Validate file size (max 50MB)
  if (file.size > 50 * 1024 * 1024) {
    showToast('图片文件过大，请选择小于 50MB 的图片');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      EventBus.emit('image-loaded', {
        file,
        img,
        dataUrl: e.target.result,
        name: file.name,
        size: file.size
      });
    };
    img.onerror = () => {
      console.error('[upload] Failed to load image:', file.name);
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    console.error('[upload] FileReader error:', file.name);
  };
  reader.readAsDataURL(file);
}
