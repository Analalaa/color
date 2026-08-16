import { EventBus } from '../main.js';
import {
  COLOR_SLICES,
  analyzeColorDNA,
  colorDnaSimilarity,
  compareColorDNA,
  createComponentPixels,
  summarizeColorSlice
} from '../analysis/color-dna.js';
import { buildScopeData } from '../analysis/scope-data.js';

const COMPONENT_LABELS = {
  lightness: ['明度 L*', '越亮代表该位置的感知明度越高。'],
  chroma: ['彩度 C*', '越亮代表颜色越浓，中性色会接近黑色。'],
  hue: ['色相 H°', '用纯色显示色相种类，中性色会被压暗。'],
  red: ['红通道 R', '越亮代表红色通道信号越强。'],
  green: ['绿通道 G', '越亮代表绿色通道信号越强。'],
  blue: ['蓝通道 B', '越亮代表蓝色通道信号越强。'],
  slice: ['颜色切片', '彩色区域是当前切片实际影响的像素。']
};

const ENGINE_LABELS = {
  histogram: '参考还原',
  lut: '平衡电影感',
  'neural-preset': '自然色彩关系'
};

let images = { source: null, reference: null, result: null };
let dna = { source: null, reference: null, result: null };
let scopes = { source: null, reference: null, result: null };
let comparison = null;
let activeSource = 'result';
let componentMode = 'lightness';
let activeSliceId = null;
let scopeMode = 'waveform';
let engineId = null;
let intensity = null;
let autoOpened = false;

function getElement(id) {
  return document.getElementById(id);
}

function setPanelMode(mode) {
  document.querySelectorAll('[data-panel-mode]').forEach(button => {
    const active = button.dataset.panelMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  getElement('candidate-panel')?.classList.toggle('hidden', mode !== 'candidates');
  getElement('color-anatomy-panel')?.classList.toggle('hidden', mode !== 'anatomy');
  if (mode !== 'anatomy') clearMainOverlay();
  if (mode === 'anatomy') renderAll();
}

function createSliceControls() {
  const container = getElement('color-slice-controls');
  if (!container) return;
  container.replaceChildren(...COLOR_SLICES.map(slice => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sliceId = slice.id;
    button.style.setProperty('--slice-color', slice.color);
    button.innerHTML = `<span></span><strong>${slice.label}</strong><small>0%</small>`;
    button.addEventListener('click', () => {
      activeSliceId = activeSliceId === slice.id ? null : slice.id;
      componentMode = activeSliceId ? 'slice' : 'hue';
      updateControlState();
      renderComponentMap();
      renderSliceExplanation();
    });
    return button;
  }));
}

function setupControls() {
  document.querySelectorAll('[data-panel-mode]').forEach(button => {
    button.addEventListener('click', () => setPanelMode(button.dataset.panelMode));
  });
  document.querySelectorAll('[data-anatomy-source]').forEach(button => {
    button.addEventListener('click', () => {
      const requested = button.dataset.anatomySource;
      if (!images[requested]) return;
      activeSource = requested;
      updateControlState();
      renderAll();
    });
  });
  document.querySelectorAll('[data-component-mode]').forEach(button => {
    button.addEventListener('click', () => {
      componentMode = button.dataset.componentMode;
      activeSliceId = null;
      updateControlState();
      renderComponentMap();
      renderSliceExplanation();
    });
  });
  document.querySelectorAll('[data-scope-mode]').forEach(button => {
    button.addEventListener('click', () => {
      scopeMode = button.dataset.scopeMode;
      updateControlState();
      renderScope();
    });
  });
}

function resetAnatomy() {
  images = { source: null, reference: null, result: null };
  dna = { source: null, reference: null, result: null };
  scopes = { source: null, reference: null, result: null };
  comparison = null;
  activeSource = 'result';
  activeSliceId = null;
  componentMode = 'lightness';
  engineId = null;
  intensity = null;
  autoOpened = false;
  const live = getElement('color-anatomy-live');
  if (live) live.textContent = '等待画面';
  const summary = getElement('color-anatomy-summary');
  if (summary) summary.textContent = '完成智能审色后，这里会解释颜色发生了什么变化。';
  clearCanvas(getElement('color-component-map'));
  clearCanvas(getElement('color-scope-canvas'), '#151817');
  clearMainOverlay();
  renderMetrics();
  renderExplanation();
  renderRecipe();
  updateControlState();
}

function handleAnalysisState(payload) {
  images = {
    source: payload.source || null,
    reference: payload.reference || null,
    result: payload.result || null
  };
  engineId = payload.engineId || null;
  intensity = Number.isFinite(payload.intensity) ? payload.intensity : null;
  for (const key of Object.keys(images)) {
    dna[key] = images[key] ? analyzeColorDNA(images[key].data) : null;
    scopes[key] = images[key] ? buildScopeData(images[key]) : null;
  }
  comparison = dna.source && dna.reference && dna.result
    ? compareColorDNA(dna.source, dna.reference, dna.result, { engineId, intensity })
    : null;
  activeSource = images.result ? 'result' : images.reference ? 'reference' : 'source';
  const live = getElement('color-anatomy-live');
  if (live) live.textContent = images.result ? 'LIVE' : '分析中';
  const summary = getElement('color-anatomy-summary');
  if (summary) {
    summary.textContent = comparison
      ? comparison.explanations[comparison.explanations.length - 1]
      : '原图与参考图已经建立 Color DNA，等待结果生成。';
  }
  if (images.result && !autoOpened) {
    autoOpened = true;
    setPanelMode('anatomy');
  }
  renderAll();
}

function updateControlState() {
  document.querySelectorAll('[data-anatomy-source]').forEach(button => {
    const key = button.dataset.anatomySource;
    button.disabled = !images[key];
    button.classList.toggle('active', key === activeSource);
  });
  document.querySelectorAll('[data-component-mode]').forEach(button => {
    button.classList.toggle('active', !activeSliceId && button.dataset.componentMode === componentMode);
  });
  document.querySelectorAll('[data-scope-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.scopeMode === scopeMode);
  });
  document.querySelectorAll('[data-slice-id]').forEach(button => {
    button.classList.toggle('active', button.dataset.sliceId === activeSliceId);
    const slice = dna[activeSource]?.colorSlices?.find(item => item.id === button.dataset.sliceId);
    const percent = button.querySelector('small');
    if (percent) percent.textContent = slice ? `${Math.round(slice.imageCoverage * 100)}%` : '0%';
  });
}

function clearCanvas(canvas, fill = '#efede8') {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function renderComponentMap() {
  const canvas = getElement('color-component-map');
  const image = images[activeSource];
  const label = COMPONENT_LABELS[activeSliceId ? 'slice' : componentMode] || COMPONENT_LABELS.lightness;
  const caption = getElement('component-map-caption');
  const help = getElement('component-map-help');
  if (caption) caption.textContent = activeSliceId
    ? `${COLOR_SLICES.find(slice => slice.id === activeSliceId)?.label || ''}色切片`
    : label[0];
  if (help) help.textContent = label[1];
  if (!canvas || !image) {
    clearCanvas(canvas);
    clearMainOverlay();
    return;
  }
  const map = createComponentPixels(image.data, activeSliceId ? 'slice' : componentMode, { sliceId: activeSliceId });
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(map, image.width, image.height), 0, 0);
  renderMainOverlay();
}

function clearMainOverlay() {
  const overlay = getElement('anatomy-overlay-canvas');
  if (!overlay) return;
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  overlay.style.display = 'none';
}

function renderMainOverlay() {
  const overlay = getElement('anatomy-overlay-canvas');
  const image = images[activeSource];
  if (!overlay || !activeSliceId || !image || activeSource === 'reference') {
    clearMainOverlay();
    return;
  }
  const mask = createComponentPixels(image.data, 'slice', {
    sliceId: activeSliceId,
    transparentBackground: true,
    highlightOverlay: true
  });
  overlay.width = image.width;
  overlay.height = image.height;
  overlay.getContext('2d').putImageData(new ImageData(mask, image.width, image.height), 0, 0);
  overlay.style.display = 'block';
}

function prepareScopeCanvas() {
  const canvas = getElement('color-scope-canvas');
  if (!canvas) return null;
  const width = Math.max(260, canvas.clientWidth || 296);
  const height = 156;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#151817';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    context.beginPath();
    context.moveTo(0, height * i / 4);
    context.lineTo(width, height * i / 4);
    context.stroke();
  }
  return { canvas, context, width, height };
}

function availableScopeEntries() {
  return [
    { key: 'source', data: scopes.source, color: '#b9b5ad', alpha: 0.08 },
    { key: 'reference', data: scopes.reference, color: '#d5aa4d', alpha: 0.1 },
    { key: 'result', data: scopes.result, color: '#74bea1', alpha: 0.18 }
  ].filter(entry => entry.data);
}

function renderWaveform(context, width, height) {
  availableScopeEntries().forEach(entry => {
    context.fillStyle = entry.color;
    context.globalAlpha = entry.alpha;
    const points = entry.data.waveform;
    const stride = Math.max(1, Math.ceil(points.length / 4500));
    for (let i = 0; i < points.length; i += stride) {
      const point = points[i];
      context.fillRect(point.x * width, (1 - point.l) * (height - 4) + 2, 1.2, 1.2);
    }
  });
  context.globalAlpha = 1;
}

function renderVectorscope(context, width, height) {
  const radius = Math.min(width, height) * 0.4;
  const centerX = width / 2;
  const centerY = height / 2;
  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
  COLOR_SLICES.forEach(slice => {
    const angle = slice.center * Math.PI / 180;
    context.strokeStyle = `${slice.color}55`;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + Math.cos(angle) * radius, centerY - Math.sin(angle) * radius);
    context.stroke();
  });
  availableScopeEntries().forEach(entry => {
    context.fillStyle = entry.color;
    context.globalAlpha = entry.alpha + 0.05;
    const points = entry.data.vectorscope;
    const stride = Math.max(1, Math.ceil(points.length / 4000));
    for (let i = 0; i < points.length; i += stride) {
      const point = points[i];
      const x = centerX + point.a / 128 * radius;
      const y = centerY - point.b / 128 * radius;
      context.fillRect(x, y, 1.2, 1.2);
    }
  });
  context.globalAlpha = 1;
}

function drawHistogramLine(context, histogram, x, width, height, color, alpha, dashed) {
  const max = Math.max(...histogram, 0.001);
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.setLineDash(dashed ? [3, 3] : []);
  context.beginPath();
  histogram.forEach((value, index) => {
    const px = x + index / Math.max(1, histogram.length - 1) * width;
    const py = height - 6 - value / max * (height - 18);
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
}

function renderParade(context, width, height) {
  const channelColors = ['#ef6a62', '#70c68a', '#6d91d7'];
  const segmentWidth = width / 3;
  availableScopeEntries().forEach(entry => {
    entry.data.rgbHistograms.forEach((histogram, channel) => {
      drawHistogramLine(
        context,
        histogram,
        channel * segmentWidth + 6,
        segmentWidth - 12,
        height,
        channelColors[channel],
        entry.key === 'result' ? 0.95 : entry.key === 'reference' ? 0.42 : 0.25,
        entry.key !== 'result'
      );
    });
  });
}

function renderScope() {
  const prepared = prepareScopeCanvas();
  if (!prepared) return;
  const { context, width, height } = prepared;
  if (scopeMode === 'vectorscope') renderVectorscope(context, width, height);
  else if (scopeMode === 'parade') renderParade(context, width, height);
  else renderWaveform(context, width, height);
}

function renderMetrics() {
  const current = dna[activeSource];
  const fit = current && dna.reference ? colorDnaSimilarity(current, dna.reference) : null;
  const fitScore = getElement('anatomy-fit-score');
  const lightness = getElement('anatomy-lightness');
  const chroma = getElement('anatomy-chroma');
  const neutral = getElement('anatomy-neutral');
  if (fitScore) fitScore.textContent = fit == null ? '—' : String(Math.round(fit * 100));
  if (lightness) lightness.textContent = current ? current.tone.median.toFixed(1) : '—';
  if (chroma) chroma.textContent = current ? current.chroma.mean.toFixed(1) : '—';
  if (neutral) neutral.textContent = current ? current.neutral.magnitude.toFixed(1) : '—';
}

function renderSliceExplanation() {
  const element = getElement('color-slice-explanation');
  if (!element) return;
  if (!activeSliceId || !dna.source || !dna.reference || !dna.result) {
    element.textContent = '选择一个颜色切片，查看它在画面中的位置与变化。';
    return;
  }
  const summary = summarizeColorSlice(dna.source, dna.reference, dna.result, activeSliceId);
  element.textContent = summary?.explanation || '当前切片没有足够的有效像素。';
}

function renderExplanation() {
  const list = getElement('color-explanation-list');
  const engineLabel = getElement('anatomy-engine-label');
  if (engineLabel) {
    const intensityLabel = Number.isFinite(intensity) ? ` · ${Math.round(intensity * 100)}%` : '';
    engineLabel.textContent = `${ENGINE_LABELS[engineId] || '实时'}${intensityLabel}`;
  }
  if (!list) return;
  if (!comparison) {
    list.innerHTML = '<li>等待结果生成</li>';
    return;
  }
  list.replaceChildren(...comparison.explanations.slice(0, 5).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function renderRecipe() {
  const container = getElement('color-recipe-stack');
  if (!container) return;
  if (!comparison?.recipe?.length) {
    container.innerHTML = '<p class="candidate-empty">调色步骤会显示在这里</p>';
    return;
  }
  container.replaceChildren(...comparison.recipe.map((layer, index) => {
    const article = document.createElement('article');
    article.className = 'color-recipe-layer';
    article.innerHTML = `
      <span class="recipe-index">${String(index + 1).padStart(2, '0')}</span>
      <div><strong>${layer.label}</strong><small>${layer.affected}</small><p>${layer.explanation}</p></div>
      <span class="recipe-amount">${layer.amount >= 0 ? '+' : ''}${layer.amount}${layer.unit}</span>
    `;
    return article;
  }));
}

function renderAll() {
  updateControlState();
  renderMetrics();
  renderComponentMap();
  renderSliceExplanation();
  renderScope();
  renderExplanation();
  renderRecipe();
}

export function getColorAnatomyReport() {
  if (!comparison) return null;
  return {
    schemaVersion: 1,
    colorSpace: dna.result?.colorSpace || dna.source?.colorSpace,
    source: dna.source,
    reference: dna.reference,
    result: dna.result,
    comparison
  };
}

export function initColorAnatomy() {
  createSliceControls();
  setupControls();
  EventBus.on('color-analysis-state', handleAnalysisState);
  EventBus.on('color-analysis-reset', resetAnatomy);
  resetAnatomy();
}
