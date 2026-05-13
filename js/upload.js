import { EventBus } from './main.js';
import { showToast } from './toast.js';

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

export function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const uploadBtn = document.getElementById('upload-btn');

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

function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILE_TYPES.join(',');
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    Array.from(input.files).forEach(file => loadImageFile(file));
    document.body.removeChild(input);
  });
  input.click();
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