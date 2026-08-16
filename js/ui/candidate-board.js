import { EventBus } from '../main.js';

let candidates = [];
let recommendation = null;
let sceneProfile = null;
let activeEngineId = null;
let isReady = false;
let isGenerating = false;

const CONFIDENCE_LABELS = {
  high: '置信度高',
  medium: '置信度中',
  low: '结果接近'
};

const METRIC_LABELS = {
  referenceFit: '参考贴合',
  structure: '层次保留',
  exposureSafety: '曝光安全',
  colorSafety: '色彩安全'
};

const SCENE_FLAG_LABELS = {
  'high-dynamic-range': '高动态范围',
  'low-key': '暗调画面',
  'neutral-sensitive': '中性色敏感',
  'high-saturation': '高饱和画面',
  'skin-candidate-sensitive': '肤色候选区域'
};

function getElements() {
  return {
    board: document.getElementById('candidate-board'),
    status: document.getElementById('candidate-status'),
    summary: document.getElementById('candidate-recommendation'),
    summaryTitle: document.getElementById('candidate-recommendation-title'),
    summaryConfidence: document.getElementById('candidate-recommendation-confidence'),
    summaryReason: document.getElementById('candidate-recommendation-reason'),
    sceneTags: document.getElementById('candidate-scene-tags'),
    generateButton: document.getElementById('generate-candidates-btn'),
    regenerateButton: document.getElementById('regenerate-candidates-btn')
  };
}

function pixelsToDataUrl(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function qualitativeLabel(candidate) {
  if (isGenerating) return '完成';
  if (candidate.rank === 1) return recommendation?.confidence === 'low' ? '倾向' : '推荐';
  if (candidate.riskLevel === 'high') return '谨慎';
  return '备选';
}

function createMetricRow(key, value) {
  const row = document.createElement('div');
  row.className = 'candidate-metric';
  const label = document.createElement('span');
  label.textContent = METRIC_LABELS[key];
  const track = document.createElement('span');
  track.className = 'candidate-metric-track';
  const fill = document.createElement('span');
  fill.className = 'candidate-metric-fill';
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  const score = document.createElement('span');
  score.className = 'candidate-metric-score';
  score.textContent = String(value);
  track.append(fill);
  row.append(label, track, score);
  return row;
}

function createDetails(candidate) {
  const details = document.createElement('details');
  details.className = 'candidate-evidence';
  const summary = document.createElement('summary');
  summary.textContent = '依据';
  const list = document.createElement('ul');
  const hardRiskSet = new Set(candidate.hardRisks || []);
  const evidence = [
    ...candidate.strengths.map(text => `优势：${text}`),
    ...(candidate.hardRisks || []).map(text => `重点检查：${text}`),
    ...candidate.risks.filter(text => !hardRiskSet.has(text)).map(text => `检查：${text}`)
  ];
  if (!candidate.risks.length) evidence.push('检查：未发现明显曝光或偏色风险');
  evidence.slice(0, 3).forEach(text => {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  });
  details.append(summary, list);
  return details;
}

function createCandidateCard(candidate) {
  const card = document.createElement('article');
  card.className = 'candidate-card';
  card.dataset.engineId = candidate.engineId;
  if (candidate.rank === 1) card.classList.add('recommended');
  if (candidate.engineId === activeEngineId) card.classList.add('active');

  const image = document.createElement('img');
  image.className = 'candidate-preview';
  image.alt = `${candidate.label}预览`;
  image.src = pixelsToDataUrl(candidate.pixels, candidate.width, candidate.height);

  const content = document.createElement('div');
  content.className = 'candidate-content';
  const heading = document.createElement('div');
  heading.className = 'candidate-heading';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'candidate-title-group';
  const title = document.createElement('strong');
  title.textContent = candidate.label;
  const badge = document.createElement('span');
  badge.className = 'candidate-badge';
  badge.textContent = qualitativeLabel(candidate);
  titleGroup.append(title, badge);
  const score = document.createElement('span');
  score.className = 'candidate-score';
  score.innerHTML = `<strong>${candidate.score}</strong><small>分</small>`;
  heading.append(titleGroup, score);

  const strength = document.createElement('div');
  strength.className = 'candidate-strength';
  const suggestedPercent = Math.round(candidate.suggestedIntensity * 100);
  strength.innerHTML = `<span>建议强度</span><strong>${suggestedPercent}%</strong>`;
  const currentStrength = document.createElement('span');
  currentStrength.className = 'candidate-current-strength';
  strength.append(currentStrength);

  const metrics = document.createElement('div');
  metrics.className = 'candidate-metrics';
  Object.entries(candidate.dimensionScores).forEach(([key, value]) => {
    metrics.append(createMetricRow(key, value));
  });

  const insight = document.createElement('p');
  insight.className = `candidate-insight ${candidate.risks.length ? 'has-risk' : ''}`;
  const primaryRisk = candidate.hardRisks?.[0] || candidate.risks[0];
  insight.textContent = primaryRisk ? `留意：${primaryRisk}` : '';

  const actions = document.createElement('div');
  actions.className = 'candidate-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'candidate-apply';
  button.textContent = candidate.engineId === activeEngineId ? '已采用' : '采用';
  button.disabled = isGenerating;
  button.addEventListener('click', () => {
    EventBus.emit('candidate-selection-requested', { engineId: candidate.engineId });
  });
  actions.append(button);
  content.append(heading, strength, metrics);
  if (primaryRisk) content.append(insight);
  content.append(createDetails(candidate), actions);
  card.append(image, content);
  return card;
}

function renderRecommendation() {
  const { summary, summaryTitle, summaryConfidence, summaryReason, sceneTags } = getElements();
  const winner = candidates.find(candidate => candidate.engineId === recommendation?.engineId);
  if (!summary || !winner || !recommendation) {
    summary?.classList.add('hidden');
    return;
  }
  summary.classList.remove('hidden');
  if (summaryTitle) {
    summaryTitle.textContent = recommendation.confidence === 'low'
      ? `更倾向「${winner.label}」`
      : `推荐「${winner.label}」`;
  }
  if (summaryConfidence) {
    summaryConfidence.textContent = CONFIDENCE_LABELS[recommendation.confidence] || '已评估';
    summaryConfidence.dataset.level = recommendation.confidence;
  }
  if (summaryReason) {
    const reason = recommendation.reasons[0] || '综合表现更稳定';
    const caution = recommendation.cautions[0] ? `；留意${recommendation.cautions[0]}` : '';
    summaryReason.textContent = `${reason}${caution} · ${Math.round(winner.suggestedIntensity * 100)}%`;
  }
  if (sceneTags) {
    sceneTags.replaceChildren(...(sceneProfile?.flags || []).slice(0, 2).map(flag => {
      const tag = document.createElement('span');
      tag.textContent = SCENE_FLAG_LABELS[flag] || flag;
      return tag;
    }));
  }
}

function renderBoard() {
  const { board } = getElements();
  if (!board) return;
  board.replaceChildren(...candidates.map(createCandidateCard));
  renderRecommendation();
}

function updateActiveState({
  engineId,
  rendering = false,
  currentIntensity,
  suggestedIntensity
}) {
  activeEngineId = engineId;
  document.querySelectorAll('.candidate-card').forEach(card => {
    const active = card.dataset.engineId === engineId;
    card.classList.toggle('active', active);
    const button = card.querySelector('.candidate-apply');
    if (button) {
      button.disabled = active && rendering;
      button.textContent = active ? (rendering ? '应用中…' : '已采用') : '采用';
    }
    const manualLabel = card.querySelector('.candidate-current-strength');
    if (manualLabel) {
      const manuallyAdjusted = active && Number.isFinite(currentIntensity)
        && Number.isFinite(suggestedIntensity)
        && Math.abs(currentIntensity - suggestedIntensity) >= 0.005;
      manualLabel.textContent = manuallyAdjusted ? `当前 ${Math.round(currentIntensity * 100)}%` : '';
    }
  });
}

function requestGeneration() {
  if (!isReady) return;
  EventBus.emit('candidate-generation-requested');
}

export function initCandidateBoard() {
  const { generateButton, regenerateButton, status, board, summary } = getElements();
  generateButton?.addEventListener('click', requestGeneration);
  regenerateButton?.addEventListener('click', requestGeneration);

  const resetBoard = () => {
    candidates = [];
    recommendation = null;
    sceneProfile = null;
    activeEngineId = null;
    isGenerating = false;
    isGenerating = true;
    summary?.classList.add('hidden');
    status?.classList.remove('hidden');
    if (board) board.replaceChildren();
  };
  EventBus.on('reference-selection-started', resetBoard);
  EventBus.on('canvas-ready', resetBoard);

  EventBus.on('candidate-input-state', ({ ready, sourceReady, referenceReady }) => {
    isReady = ready;
    if (generateButton) generateButton.disabled = !ready;
    if (regenerateButton) regenerateButton.disabled = !ready;
    if (!ready && status) {
      status.classList.remove('hidden');
      status.textContent = sourceReady ? '请选择参考图' : referenceReady ? '请选择原图' : '等待原图和参考图';
      summary?.classList.add('hidden');
    }
  });

  EventBus.on('candidate-generation-started', () => {
    candidates = [];
    recommendation = null;
    sceneProfile = null;
    activeEngineId = null;
    if (status) {
      status.classList.remove('hidden');
      status.textContent = '正在分析…';
    }
    if (board) board.innerHTML = '<div class="candidate-loading"><span></span><span></span><span></span></div>';
    summary?.classList.add('hidden');
    if (generateButton) generateButton.disabled = true;
    if (regenerateButton) regenerateButton.disabled = true;
  });

  EventBus.on('candidate-generation-progress', payload => {
    if (payload.candidate) {
      const existingIndex = candidates.findIndex(item => item.engineId === payload.candidate.engineId);
      if (existingIndex >= 0) candidates[existingIndex] = payload.candidate;
      else candidates.push(payload.candidate);
      if (board) board.replaceChildren(...candidates.map(createCandidateCard));
    }
    if (status) {
      status.classList.remove('hidden');
      status.textContent = `分析 ${payload.completed}/${payload.total}`;
    }
  });

  EventBus.on('candidates-ready', payload => {
    isGenerating = false;
    candidates = payload.candidates;
    recommendation = payload.recommendation;
    sceneProfile = payload.sceneProfile;
    if (status) {
      status.textContent = payload.failures?.length ? `${payload.failures.length} 项未完成` : '';
      status.classList.toggle('hidden', !payload.failures?.length);
    }
    if (generateButton) generateButton.disabled = false;
    if (regenerateButton) regenerateButton.disabled = false;
    renderBoard();
    document.querySelector('.panel-right')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  EventBus.on('candidate-active', updateActiveState);

  EventBus.on('candidate-render-error', ({ engineId }) => {
    const card = document.querySelector(`.candidate-card[data-engine-id="${engineId}"]`);
    const button = card?.querySelector('.candidate-apply');
    if (button) {
      button.disabled = false;
      button.textContent = '重试';
    }
  });

  EventBus.on('candidate-generation-error', ({ message }) => {
    isGenerating = false;
    if (status) {
      status.classList.remove('hidden');
      status.textContent = message || '生成失败，请重试';
    }
    if (board) board.replaceChildren();
    summary?.classList.add('hidden');
    if (generateButton) generateButton.disabled = !isReady;
    if (regenerateButton) regenerateButton.disabled = !isReady;
  });
}
