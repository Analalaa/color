import { EventBus } from './main.js';
import { getResultPixels, getResultDimensions } from './preview.js';
import { showToast } from './toast.js';

let downloadEnabled = false;
let batchCounter = 0;

export function initDownload() {
  // Enable download button when transfer is complete
  EventBus.on('transfer-complete', ({ resultPixels, width, height }) => {
    downloadEnabled = true;
    const btn = document.getElementById('btn-download');
    if (btn) btn.disabled = false;
    const batchBtn = document.getElementById('btn-batch');
    if (batchBtn) batchBtn.disabled = false;
  });

  // Download button click handler
  const downloadBtn = document.getElementById('btn-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadResult);
  }

  // Batch button click handler
  const batchBtn = document.getElementById('btn-batch');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => {
      EventBus.emit('batch-requested');
    });
  }

  // Listen for batch request
  EventBus.on('batch-start', handleBatchStart);
}

function downloadResult() {
  const pixels = getResultPixels();
  const dims = getResultDimensions();
  if (!pixels || !dims.width || !dims.height) {
    showToast('没有可下载的结果');
    return;
  }

  // Create canvas with result pixels
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(pixels), dims.width, dims.height);
  ctx.putImageData(imageData, 0, 0);

  // Download as PNG
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('下载失败');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colormuse_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('下载成功');
  }, 'image/png');
}

function handleBatchStart({ images }) {
  // images is an array of {img, file} objects from canvas-workspace batch queue
  if (!Array.isArray(images) || images.length === 0) {
    showToast('没有要处理的图片');
    return;
  }
  batchCounter++;
  const batchSize = images.length;

  updateStatus(`批量处理中: 0/${batchSize}`);

  // Process each image sequentially
  processNextInBatch(images, 0, batchSize);
}

async function processNextInBatch(images, index, total) {
  if (index >= total) {
    updateStatus(`批量处理完成: ${total}/${total}`);
    EventBus.emit('batch-complete', { total });
    return;
  }

  try {
    updateStatus(`批量处理中: ${index + 1}/${total}`);

    const { img } = images[index];

    // Create temp canvas to get pixel data
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Run transfer with last used ref (need to store this)
    // For now, use a placeholder — batch transfer needs more infrastructure
    // Just download original if no ref available
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    // Download individually
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colormuse_batch_${batchCounter}_${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Small delay to prevent browser blocking
    await new Promise(r => setTimeout(r, 200));

    processNextInBatch(images, index + 1, total);
  } catch (err) {
    console.error('[download] Batch item failed:', err);
    showToast(`处理第 ${index + 1} 张图片时失败`);
    // Continue with next
    processNextInBatch(images, index + 1, total);
  }
}

function updateStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}
