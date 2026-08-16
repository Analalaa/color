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
import {
  applyReferenceRecipe,
  createPointColorMaskPixels
} from '../color-transfer/reference-recipe-engine.js';

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
let activePointColorId = null;
let scopeMode = 'waveform';
let waveformMode = 'density';
let scopeVisibility = { source: true, reference: true, result: true };
let engineId = null;
let intensity = null;
let referenceRecipe = null;
let recipeTrace = [];
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
      activePointColorId = null;
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
      activePointColorId = null;
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
  document.querySelectorAll('[data-waveform-mode]').forEach(button => {
    button.addEventListener('click', () => {
      waveformMode = button.dataset.waveformMode;
      updateControlState();
      renderScope();
    });
  });
  document.querySelectorAll('[data-scope-state]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.scopeState;
      const visibleCount = Object.values(scopeVisibility).filter(Boolean).length;
      if (scopeVisibility[key] && visibleCount === 1) return;
      scopeVisibility[key] = !scopeVisibility[key];
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
  activePointColorId = null;
  componentMode = 'lightness';
  scopeMode = 'waveform';
  waveformMode = 'density';
  scopeVisibility = { source: true, reference: true, result: true };
  engineId = null;
  intensity = null;
  referenceRecipe = null;
  recipeTrace = [];
  autoOpened = false;
  const live = getElement('color-anatomy-live');
  if (live) live.textContent = '等待画面';
  const summary = getElement('color-anatomy-summary');
  if (summary) summary.textContent = '完成智能审色后，这里会解释颜色发生了什么变化。';
  clearCanvas(getElement('color-component-map'));
  clearCanvas(getElement('color-scope-canvas'), '#151817');
  clearMainOverlay();
  renderMetrics();
  renderReferenceRecipePanel();
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
  referenceRecipe = payload.referenceRecipe || null;
  activePointColorId = referenceRecipe?.pointColors?.some(point => point.id === activePointColorId)
    ? activePointColorId
    : null;
  for (const key of Object.keys(images)) {
    dna[key] = images[key] ? analyzeColorDNA(images[key].data) : null;
    scopes[key] = images[key] ? buildScopeData(images[key]) : null;
  }
  comparison = dna.source && dna.reference && dna.result
    ? compareColorDNA(dna.source, dna.reference, dna.result, { engineId, intensity })
    : null;
  recipeTrace = buildRecipeTrace();
  activeSource = images.result ? 'result' : images.reference ? 'reference' : 'source';
  const live = getElement('color-anatomy-live');
  if (live) live.textContent = images.result ? 'LIVE' : '分析中';
  const summary = getElement('color-anatomy-summary');
  if (summary) {
    summary.textContent = comparison
      ? referenceRecipe
        ? `Reference Recipe V2 用 ${referenceRecipe.layers.filter(layer => layer.enabled).length} 个真实参数层，将参考贴合从 ${Math.round(comparison.sourceFit * 100)} 提升到 ${Math.round(comparison.resultFit * 100)}。`
        : comparison.explanations[comparison.explanations.length - 1]
      : '原图与参考图已经建立 Color DNA，等待结果生成。';
  }
  if (images.result && !autoOpened) {
    autoOpened = true;
    setPanelMode('anatomy');
  }
  renderAll();
}

function buildRecipeTrace() {
  if (!referenceRecipe || !images.source?.data?.length || !dna.source || !dna.reference) return [];
  const enabledLayerIds = new Set();
  let previousFit = colorDnaSimilarity(dna.source, dna.reference);
  const trace = [];
  try {
    for (const layer of referenceRecipe.layers) {
      if (!layer.enabled) {
        trace.push({ id: layer.id, enabled: false, fit: previousFit, gain: 0 });
        continue;
      }
      enabledLayerIds.add(layer.id);
      if (layer.kind === 'protection') {
        trace.push({ id: layer.id, enabled: true, fit: previousFit, gain: null });
        continue;
      }
      const pixels = applyReferenceRecipe(images.source.data, referenceRecipe, {
        intensity: referenceRecipe.intensity,
        enabledLayerIds
      });
      const layerDna = analyzeColorDNA(pixels);
      const fit = colorDnaSimilarity(layerDna, dna.reference);
      trace.push({ id: layer.id, enabled: true, fit, gain: fit - previousFit });
      previousFit = fit;
    }
  } catch (error) {
    console.warn('[color-anatomy] Reference Recipe trace skipped:', error);
    return [];
  }
  return trace;
}

function updateControlState() {
  document.querySelectorAll('[data-anatomy-source]').forEach(button => {
    const key = button.dataset.anatomySource;
    button.disabled = !images[key];
    button.classList.toggle('active', key === activeSource);
  });
  document.querySelectorAll('[data-component-mode]').forEach(button => {
    button.classList.toggle('active', !activeSliceId && !activePointColorId && button.dataset.componentMode === componentMode);
  });
  document.querySelectorAll('[data-scope-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.scopeMode === scopeMode);
  });
  document.querySelectorAll('[data-waveform-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.waveformMode === waveformMode);
  });
  document.querySelectorAll('[data-scope-state]').forEach(button => {
    const key = button.dataset.scopeState;
    const visible = !!scopeVisibility[key];
    button.disabled = !scopes[key];
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', String(visible));
  });
  getElement('waveform-mode-controls')?.classList.toggle('hidden', scopeMode !== 'waveform');
  const resolution = getElement('scope-resolution');
  const scope = scopes.result || scopes.reference || scopes.source;
  if (resolution) resolution.textContent = scope
    ? `${scope.resolution.xBins} × ${scope.resolution.yBins} · ${scope.sampleCount.toLocaleString()} samples`
    : '192 × 128';
  const help = getElement('scope-detail-help');
  if (help) {
    if (scopeMode === 'vectorscope') help.textContent = 'Lab a*/b* 密度图；同心圆表示彩度，放射线标记主要色相方向。';
    else if (scopeMode === 'parade') help.textContent = '真实 RGB 通道波形；每个分栏的横轴仍对应画面位置，而不是普通直方图。';
    else if (waveformMode === 'rgb') help.textContent = 'RGB 三通道按画面位置叠加；通道分离表示局部色偏，白色区域表示通道接近。';
    else if (waveformMode === 'envelope') help.textContent = '显示每个横向位置的 10%、中位数与 90% 明度，快速比较动态范围和明暗结构。';
    else help.textContent = '横轴对应画面位置，纵轴为 0–100 IRE；采用对数密度保留稀疏高光和暗部细节。';
  }
  document.querySelectorAll('[data-slice-id]').forEach(button => {
    button.classList.toggle('active', button.dataset.sliceId === activeSliceId);
    const slice = dna[activeSource]?.colorSlices?.find(item => item.id === button.dataset.sliceId);
    const percent = button.querySelector('small');
    if (percent) percent.textContent = slice ? `${Math.round(slice.imageCoverage * 100)}%` : '0%';
  });
  document.querySelectorAll('[data-point-color-id]').forEach(button => {
    button.classList.toggle('active', button.dataset.pointColorId === activePointColorId);
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
  const activePoint = referenceRecipe?.pointColors?.find(point => point.id === activePointColorId) || null;
  const label = COMPONENT_LABELS[activeSliceId ? 'slice' : componentMode] || COMPONENT_LABELS.lightness;
  const caption = getElement('component-map-caption');
  const help = getElement('component-map-help');
  if (caption) caption.textContent = activePoint
    ? `${activePoint.label} · Visualize Range`
    : activeSliceId
      ? `${COLOR_SLICES.find(slice => slice.id === activeSliceId)?.label || ''}色切片`
      : label[0];
  if (help) help.textContent = activePoint
    ? `仅彩色显示实际受 ${activePoint.label} 参数影响的区域。`
    : label[1];
  if (!canvas || !image) {
    clearCanvas(canvas);
    clearMainOverlay();
    return;
  }
  const map = activePoint
    ? createPointColorMaskPixels(image.data, activePoint, { target: activeSource })
    : createComponentPixels(image.data, activeSliceId ? 'slice' : componentMode, { sliceId: activeSliceId });
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
  const activePoint = referenceRecipe?.pointColors?.find(point => point.id === activePointColorId) || null;
  if (!overlay || (!activeSliceId && !activePoint) || !image || activeSource === 'reference') {
    clearMainOverlay();
    return;
  }
  const mask = activePoint
    ? createPointColorMaskPixels(image.data, activePoint, {
      target: activeSource,
      transparentBackground: true
    })
    : createComponentPixels(image.data, 'slice', {
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
  const height = 220;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#151817';
  context.fillRect(0, 0, width, height);
  return {
    canvas,
    context,
    width,
    height,
    plot: { left: 25, top: 9, width: width - 33, height: height - 26, bottom: height - 17 }
  };
}

function availableScopeEntries() {
  return [
    { key: 'source', data: scopes.source, color: '#b9b5ad', densityAlpha: 0.34, dash: [2, 3] },
    { key: 'reference', data: scopes.reference, color: '#d5aa4d', densityAlpha: 0.38, dash: [6, 3] },
    { key: 'result', data: scopes.result, color: '#74bea1', densityAlpha: 0.5, dash: [] }
  ].filter(entry => entry.data && scopeVisibility[entry.key]);
}

function drawIreGrid(context, plot, { vertical = true } = {}) {
  context.save();
  context.font = '7px system-ui, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  [0, 25, 50, 75, 100].forEach(level => {
    const y = plot.bottom - level / 100 * plot.height;
    context.strokeStyle = level === 0 || level === 100
      ? 'rgba(255,255,255,0.17)'
      : 'rgba(255,255,255,0.08)';
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();
    context.fillStyle = 'rgba(220,225,221,0.46)';
    context.fillText(String(level), plot.left - 4, y);
  });
  if (vertical) {
    for (let index = 1; index < 4; index++) {
      const x = plot.left + plot.width * index / 4;
      context.strokeStyle = 'rgba(255,255,255,0.055)';
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, plot.bottom);
      context.stroke();
    }
  }
  context.fillStyle = 'rgba(220,225,221,0.33)';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('IRE', 3, 9);
  context.restore();
}

function parseHexColor(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function drawDensityLayer(context, density, xBins, yBins, rect, color, alpha, composite = 'lighter') {
  if (!density?.length) return;
  let max = 0;
  for (const value of density) max = Math.max(max, value);
  if (!max) return;
  const [r, g, b] = parseHexColor(color);
  const offscreen = document.createElement('canvas');
  offscreen.width = xBins;
  offscreen.height = yBins;
  const offscreenContext = offscreen.getContext('2d');
  const image = offscreenContext.createImageData(xBins, yBins);
  const logMax = Math.log1p(max);
  for (let y = 0; y < yBins; y++) {
    for (let x = 0; x < xBins; x++) {
      const value = density[y * xBins + x];
      if (!value) continue;
      const targetIndex = ((yBins - 1 - y) * xBins + x) * 4;
      const normalized = Math.log1p(value) / logMax;
      image.data[targetIndex] = r;
      image.data[targetIndex + 1] = g;
      image.data[targetIndex + 2] = b;
      image.data[targetIndex + 3] = Math.round(255 * alpha * Math.pow(normalized, 0.72));
    }
  }
  offscreenContext.putImageData(image, 0, 0);
  context.save();
  context.globalCompositeOperation = composite;
  context.imageSmoothingEnabled = true;
  context.drawImage(offscreen, rect.left, rect.top, rect.width, rect.height);
  context.restore();
}

function drawEnvelopeLine(context, values, rect, color, width = 1, dash = [], alpha = 1) {
  if (!values?.length) return;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.globalAlpha = alpha;
  context.setLineDash(dash);
  context.beginPath();
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null) {
      drawing = false;
      return;
    }
    const x = rect.left + index / Math.max(1, values.length - 1) * rect.width;
    const y = rect.top + (1 - value) * rect.height;
    if (!drawing) {
      context.moveTo(x, y);
      drawing = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.restore();
}

function drawEnvelope(context, envelope, rect, entry, emphasize = true) {
  if (!envelope) return;
  context.save();
  context.fillStyle = entry.color;
  context.globalAlpha = emphasize ? 0.055 : 0.03;
  envelope.p10.forEach((low, index) => {
    const high = envelope.p90[index];
    if (low == null || high == null) return;
    const x = rect.left + index / Math.max(1, envelope.p10.length - 1) * rect.width;
    const top = rect.top + (1 - high) * rect.height;
    const bottom = rect.top + (1 - low) * rect.height;
    context.fillRect(x, top, Math.max(1, rect.width / envelope.p10.length + 0.3), Math.max(1, bottom - top));
  });
  context.restore();
  drawEnvelopeLine(context, envelope.p10, rect, entry.color, 0.75, entry.dash, 0.34);
  drawEnvelopeLine(context, envelope.p90, rect, entry.color, 0.75, entry.dash, 0.34);
  drawEnvelopeLine(context, envelope.median, rect, entry.color, emphasize ? 1.55 : 1.05, entry.dash, 0.94);
}

function renderWaveform(context, plot) {
  drawIreGrid(context, plot);
  const entries = availableScopeEntries();
  if (waveformMode === 'envelope') {
    entries.forEach(entry => drawEnvelope(context, entry.data.waveformEnvelope, plot, entry, true));
    return;
  }
  entries.forEach(entry => {
    const { xBins, yBins } = entry.data.resolution;
    if (waveformMode === 'rgb') {
      const colors = ['#f0625f', '#65c987', '#668fe0'];
      entry.data.rgbWaveformDensity.forEach((density, channel) => {
        drawDensityLayer(context, density, xBins, yBins, plot, colors[channel], entry.densityAlpha * 0.68);
      });
    } else {
      drawDensityLayer(context, entry.data.waveformDensity, xBins, yBins, plot, entry.color, entry.densityAlpha);
    }
    drawEnvelopeLine(context, entry.data.waveformEnvelope.median, plot, entry.color, 1.3, entry.dash, 0.92);
  });
}

function renderVectorscope(context, width, height) {
  const radius = Math.min(width - 42, height - 18) * 0.46;
  const centerX = width / 2;
  const centerY = height / 2;
  context.save();
  [0.25, 0.5, 0.75, 1].forEach((ratio, index) => {
    context.strokeStyle = index === 3 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
    context.beginPath();
    context.arc(centerX, centerY, radius * ratio, 0, Math.PI * 2);
    context.stroke();
  });
  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.beginPath();
  context.moveTo(centerX - radius, centerY);
  context.lineTo(centerX + radius, centerY);
  context.moveTo(centerX, centerY - radius);
  context.lineTo(centerX, centerY + radius);
  context.stroke();
  context.font = '7px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  COLOR_SLICES.forEach(slice => {
    const angle = slice.center * Math.PI / 180;
    const targetX = centerX + Math.cos(angle) * radius;
    const targetY = centerY - Math.sin(angle) * radius;
    context.strokeStyle = `${slice.color}48`;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(targetX, targetY);
    context.stroke();
    context.fillStyle = slice.color;
    context.globalAlpha = 0.78;
    context.fillText(slice.label, centerX + Math.cos(angle) * (radius + 8), centerY - Math.sin(angle) * (radius + 8));
  });
  context.restore();
  const rect = { left: centerX - radius, top: centerY - radius, width: radius * 2, height: radius * 2 };
  availableScopeEntries().forEach(entry => {
    const bins = entry.data.resolution.vectorBins;
    drawDensityLayer(context, entry.data.vectorscopeDensity, bins, bins, rect, entry.color, entry.densityAlpha * 0.9);
  });
}

function renderParade(context, plot) {
  drawIreGrid(context, plot, { vertical: false });
  const channelColors = ['#ef625f', '#65c987', '#668fe0'];
  const channelLabels = ['R', 'G', 'B'];
  const gap = 5;
  const segmentWidth = (plot.width - gap * 2) / 3;
  channelColors.forEach((channelColor, channel) => {
    const left = plot.left + channel * (segmentWidth + gap);
    const rect = { left, top: plot.top, width: segmentWidth, height: plot.height };
    context.fillStyle = channelColor;
    context.globalAlpha = 0.82;
    context.font = '700 8px system-ui, sans-serif';
    context.fillText(channelLabels[channel], left + 3, plot.top + 10);
    context.globalAlpha = 1;
    availableScopeEntries().forEach(entry => {
      const { xBins, yBins } = entry.data.resolution;
      drawDensityLayer(
        context,
        entry.data.rgbWaveformDensity[channel],
        xBins,
        yBins,
        rect,
        channelColor,
        entry.densityAlpha * 0.72
      );
      drawEnvelopeLine(
        context,
        entry.data.rgbWaveformEnvelopes[channel].median,
        rect,
        entry.color,
        1.05,
        entry.dash,
        0.92
      );
    });
    if (channel < 2) {
      context.strokeStyle = 'rgba(255,255,255,0.1)';
      context.beginPath();
      context.moveTo(left + segmentWidth + gap / 2, plot.top);
      context.lineTo(left + segmentWidth + gap / 2, plot.bottom);
      context.stroke();
    }
  });
}

function renderScope() {
  const prepared = prepareScopeCanvas();
  if (!prepared) return;
  const { context, width, height, plot } = prepared;
  if (scopeMode === 'vectorscope') renderVectorscope(context, width, height);
  else if (scopeMode === 'parade') renderParade(context, plot);
  else renderWaveform(context, plot);
}

function prepareRecipeCurveCanvas() {
  const canvas = getElement('recipe-tone-curve');
  if (!canvas) return null;
  const width = Math.max(260, canvas.clientWidth || 296);
  const height = 184;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#171a18';
  context.fillRect(0, 0, width, height);
  return { context, width, height };
}

function drawRecipeHistogram(context, histogram, color, width, height, dashed = false) {
  if (!histogram?.length) return;
  const max = Math.max(...histogram, 0.001);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  context.globalAlpha = 0.72;
  context.setLineDash(dashed ? [3, 3] : []);
  context.beginPath();
  histogram.forEach((value, index) => {
    const x = 10 + index / Math.max(1, histogram.length - 1) * (width - 20);
    const y = height - 10 - value / max * (height - 28);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
}

function renderRecipeToneCurve() {
  const prepared = prepareRecipeCurveCanvas();
  if (!prepared) return;
  const { context, width, height } = prepared;
  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 1;
  for (let index = 1; index < 4; index++) {
    const x = 10 + (width - 20) * index / 4;
    const y = 10 + (height - 20) * index / 4;
    context.beginPath();
    context.moveTo(x, 10);
    context.lineTo(x, height - 10);
    context.moveTo(10, y);
    context.lineTo(width - 10, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255,255,255,0.2)';
  context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(10, height - 10);
  context.lineTo(width - 10, 10);
  context.stroke();
  context.setLineDash([]);

  drawRecipeHistogram(context, dna.source?.tone?.histogram, '#9c9b96', width, height, true);
  drawRecipeHistogram(context, dna.reference?.tone?.histogram, '#d5aa4d', width, height, true);
  drawRecipeHistogram(context, dna.result?.tone?.histogram, '#74bea1', width, height);
  if (!referenceRecipe?.toneCurve?.length) return;

  context.strokeStyle = '#f5eee1';
  context.lineWidth = 2.2;
  context.beginPath();
  referenceRecipe.toneCurve.forEach((point, index) => {
    const x = 10 + point.input / 100 * (width - 20);
    const y = height - 10 - point.output / 100 * (height - 20);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  referenceRecipe.toneCurve.forEach(point => {
    const x = 10 + point.input / 100 * (width - 20);
    const y = height - 10 - point.output / 100 * (height - 20);
    context.fillStyle = '#d5aa4d';
    context.beginPath();
    context.arc(x, y, 3.2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#171a18';
    context.lineWidth = 1;
    context.stroke();
  });
}

function renderPointColorControls() {
  const container = getElement('recipe-point-colors');
  const explanation = getElement('recipe-point-explanation');
  if (!container) return;
  const points = referenceRecipe?.pointColors || [];
  if (!points.length) {
    container.innerHTML = '<p class="candidate-empty">当前画面没有需要单独调整的显著颜色范围</p>';
    if (explanation) explanation.textContent = '引擎只保留必要参数，避免为弱颜色生成无效调节。';
    return;
  }
  container.replaceChildren(...points.map(point => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe-point-color';
    button.dataset.pointColorId = point.id;
    button.style.setProperty('--point-hue', String(Math.round(point.centerHue)));
    button.innerHTML = `
      <span class="point-swatch"></span>
      <strong>${point.label}</strong>
      <small>H ${point.hueShift >= 0 ? '+' : ''}${point.hueShift}° · C ×${point.saturationScale.toFixed(2)} · L ${point.lightnessShift >= 0 ? '+' : ''}${point.lightnessShift}</small>
    `;
    button.addEventListener('click', () => {
      activePointColorId = activePointColorId === point.id ? null : point.id;
      activeSliceId = null;
      updateControlState();
      renderComponentMap();
      renderSliceExplanation();
    });
    return button;
  }));
  if (explanation) {
    const activePoint = points.find(point => point.id === activePointColorId);
    explanation.textContent = activePoint
      ? `${activePoint.label}中心 ${activePoint.centerHue}°、范围 ±${activePoint.hueRange}°，影响约 ${Math.round(activePoint.affectedPixelRatio * 100)}% 画面。`
      : `引擎自动提取 ${points.length} 个主要颜色范围；点击任一范围查看实际受影响像素。`;
  }
  updateControlState();
}

function renderReferenceRecipePanel() {
  const panel = getElement('reference-recipe-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !referenceRecipe);
  const count = getElement('recipe-layer-count');
  const status = getElement('reference-recipe-status');
  if (count) count.textContent = referenceRecipe
    ? `${referenceRecipe.layers.filter(layer => layer.enabled).length}/${referenceRecipe.layers.length} 层启用`
    : '0 层';
  if (status) status.textContent = referenceRecipe
    ? `当前显示的是实际参与「参考还原」渲染的参数；全局强度 ${Math.round(referenceRecipe.intensity * 100)}%。`
    : '切换到「参考还原」方案后显示真实可渲染处方。';
  renderRecipeToneCurve();
  renderPointColorControls();
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
  const activePoint = referenceRecipe?.pointColors?.find(point => point.id === activePointColorId);
  if (activePoint) {
    element.textContent = `${activePoint.label}实际作用约 ${Math.round(activePoint.affectedPixelRatio * 100)}%；色相 ${activePoint.hueShift >= 0 ? '顺时针' : '逆时针'} ${Math.abs(activePoint.hueShift)}°，彩度 ×${activePoint.saturationScale.toFixed(2)}，明度 ${activePoint.lightnessShift >= 0 ? '+' : ''}${activePoint.lightnessShift} L*。`;
    return;
  }
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
  const explanations = referenceRecipe
    ? [
      `实际渲染由 ${referenceRecipe.layers.filter(layer => layer.enabled).length} 个参数层组成，可逐层关闭验证。`,
      `参考曲线使用 ${referenceRecipe.toneCurve.length} 个单调控制点；Point Color 自动识别 ${referenceRecipe.pointColors.length} 个主要颜色范围。`,
      ...comparison.explanations
    ]
    : comparison.explanations;
  list.replaceChildren(...explanations.slice(0, 6).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function renderRecipe() {
  const container = getElement('color-recipe-stack');
  const caption = getElement('recipe-stack-caption');
  if (!container) return;
  if (referenceRecipe?.layers?.length) {
    if (caption) caption.textContent = '开关任一实际渲染层';
    container.replaceChildren(...referenceRecipe.layers.map((layer, index) => {
      const trace = recipeTrace.find(item => item.id === layer.id);
      const article = document.createElement('article');
      article.className = `color-recipe-layer${layer.enabled ? '' : ' disabled'}`;
      const amount = Number(layer.amount) || 0;
      const gainLabel = trace?.gain == null
        ? layer.kind === 'protection' ? '保护优先' : ''
        : `${trace.gain >= 0 ? '+' : ''}${Math.round(trace.gain * 100)} Fit`;
      article.innerHTML = `
        <button class="recipe-layer-toggle" type="button" role="switch" aria-checked="${layer.enabled}" aria-label="${layer.enabled ? '关闭' : '启用'}${layer.label}"></button>
        <div><strong>${String(index + 1).padStart(2, '0')} · ${layer.label}</strong><small>${layer.affected}</small><p>${layer.explanation}</p></div>
        <span class="recipe-amount">${amount >= 0 ? '+' : ''}${amount}${layer.unit}<small>${gainLabel}</small></span>
      `;
      article.querySelector('.recipe-layer-toggle')?.addEventListener('click', () => {
        layer.enabled = !layer.enabled;
        recipeTrace = buildRecipeTrace();
        renderRecipe();
        renderReferenceRecipePanel();
        EventBus.emit('reference-recipe-options-changed', {
          disabledLayerIds: referenceRecipe.layers.filter(item => !item.enabled).map(item => item.id)
        });
      });
      return article;
    }));
    return;
  }
  if (caption) caption.textContent = '结果反推摘要';
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
  renderReferenceRecipePanel();
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
    comparison,
    referenceRecipe,
    recipeTrace
  };
}

export function initColorAnatomy() {
  createSliceControls();
  setupControls();
  EventBus.on('color-analysis-state', handleAnalysisState);
  EventBus.on('color-analysis-reset', resetAnatomy);
  resetAnatomy();
}
