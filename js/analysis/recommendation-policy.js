const clamp01 = value => Math.max(0, Math.min(1, value));
const round = value => Math.round(value * 1000) / 1000;

export const DEFAULT_STRENGTH_GRID = Object.freeze([0.6, 0.75, 0.9, 1]);

export const QUALITY_THRESHOLDS = Object.freeze({
  warning: Object.freeze({
    highlightClipping: 0.015,
    shadowClipping: 0.02,
    luminanceShift: 0.16,
    neutralDrift: 0.045,
    saturationOutliers: 0.025,
    structure: 0.86,
    localContrast: 0.8
  }),
  hard: Object.freeze({
    highlightClipping: 0.04,
    shadowClipping: 0.05,
    neutralDrift: 0.09,
    saturationOutliers: 0.06,
    structure: 0.7,
    localContrast: 0.62
  })
});

function getAdaptiveWeights(scene = {}) {
  const weights = {
    referenceFit: 0.4,
    structure: 0.25,
    exposureSafety: 0.2,
    colorSafety: 0.15
  };

  if ((scene.dynamicRange || 0) >= 0.72 || (scene.highlightPressure || 0) + (scene.shadowPressure || 0) >= 0.18) {
    weights.exposureSafety += 0.08;
    weights.referenceFit -= 0.04;
    weights.structure -= 0.04;
  }
  if ((scene.neutralCoverage || 0) >= 0.2) {
    weights.colorSafety += 0.06;
    weights.referenceFit -= 0.03;
    weights.structure -= 0.03;
  }
  if ((scene.saturationLevel || 0) >= 0.52) {
    weights.colorSafety += 0.04;
    weights.referenceFit -= 0.02;
    weights.structure -= 0.02;
  }
  if ((scene.skinCandidateCoverage || 0) >= 0.08) {
    weights.colorSafety += 0.05;
    weights.referenceFit -= 0.025;
    weights.structure -= 0.025;
  }

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total]));
}

function riskState(metrics) {
  const warning = QUALITY_THRESHOLDS.warning;
  const hard = QUALITY_THRESHOLDS.hard;
  const risks = [];
  const hardRisks = [];

  if (metrics.addedHighlightClipping > warning.highlightClipping) risks.push('高光有溢出风险');
  if (metrics.addedShadowClipping > warning.shadowClipping) risks.push('暗部可能丢失细节');
  if (metrics.highlightHeadroomLoss > 0.04) risks.push('高光余量有所压缩');
  if (metrics.shadowHeadroomLoss > 0.04) risks.push('暗部余量有所压缩');
  if (metrics.luminanceShift > warning.luminanceShift) risks.push('整体明暗变化较大');
  if (metrics.neutralDrift > warning.neutralDrift) risks.push('中性色可能出现偏色');
  if (metrics.addedSaturationOutliers > warning.saturationOutliers) risks.push('高饱和区域需要留意');
  if (metrics.structurePreservation < warning.structure || metrics.localContrastPreservation < warning.localContrast) {
    risks.push('原片局部层次变化较明显');
  }

  if (metrics.addedHighlightClipping > hard.highlightClipping) hardRisks.push('高光明显溢出');
  if (metrics.addedShadowClipping > hard.shadowClipping) hardRisks.push('暗部明显堵塞');
  if (metrics.neutralDrift > hard.neutralDrift) hardRisks.push('中性色偏移明显');
  if (metrics.addedSaturationOutliers > hard.saturationOutliers) hardRisks.push('过饱和范围较大');
  if (metrics.structurePreservation < hard.structure || metrics.localContrastPreservation < hard.localContrast) {
    hardRisks.push('局部层次损失明显');
  }

  return { risks: [...new Set(risks)], hardRisks: [...new Set(hardRisks)] };
}

export function assessMetrics(metrics, sceneProfile = {}) {
  const exposureRisk = clamp01(
    metrics.addedHighlightClipping * 9 +
    metrics.addedShadowClipping * 9 +
    metrics.highlightHeadroomLoss * 2.2 +
    metrics.shadowHeadroomLoss * 2.2 +
    metrics.luminanceShift * 1.25
  );
  const neutralRisk = clamp01(metrics.neutralDrift * 5);
  const saturationRisk = clamp01(metrics.addedSaturationOutliers * 6);
  const structureScore = clamp01(
    metrics.structurePreservation * 0.58 + metrics.localContrastPreservation * 0.42
  );
  const styleNeed = clamp01(1 - metrics.sourceReferenceSimilarity);
  const gainFulfilment = styleNeed < 0.08
    ? 1
    : clamp01(metrics.referenceGain / Math.max(0.05, styleNeed * 0.35));

  const dimensionScores = {
    referenceFit: Math.round(100 * clamp01(metrics.referenceSimilarity * 0.75 + gainFulfilment * 0.25)),
    structure: Math.round(100 * structureScore),
    exposureSafety: Math.round(100 * (1 - exposureRisk)),
    colorSafety: Math.round(100 * (1 - clamp01(neutralRisk * 0.58 + saturationRisk * 0.42)))
  };
  const weights = getAdaptiveWeights(sceneProfile);
  const score = Math.round(Object.entries(dimensionScores).reduce(
    (sum, [key, value]) => sum + value * weights[key],
    0
  ));
  const { risks, hardRisks } = riskState(metrics);

  const strengths = [];
  if (dimensionScores.referenceFit >= 78) strengths.push('参考色调贴合度高');
  if (dimensionScores.structure >= 92) strengths.push('原片局部层次保留稳定');
  if (dimensionScores.exposureSafety >= 88) strengths.push('高光与暗部保护稳妥');
  if (dimensionScores.colorSafety >= 88) strengths.push('中性色与饱和度控制自然');
  if (metrics.referenceGain >= 0.04) strengths.push('相比原片更接近参考氛围');
  if (!strengths.length) strengths.push('色调变化相对克制');

  return {
    metrics,
    score,
    dimensionScores,
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value)])),
    risks,
    hardRisks,
    strengths,
    riskLevel: hardRisks.length ? 'high' : risks.length > 2 ? 'medium' : risks.length ? 'low' : 'none',
    verdict: hardRisks.length ? '建议降低强度' : risks.length === 0 ? '画面状态稳妥' : risks.length <= 2 ? '建议局部检查' : '建议谨慎采用'
  };
}

export function selectBestStrength(variants) {
  if (!variants?.length) return null;
  const safeVariants = variants.filter(variant => !variant.assessment.hardRisks?.length);
  const pool = safeVariants.length ? safeVariants : variants;
  return [...pool].sort((a, b) => {
    const scoreGap = b.assessment.score - a.assessment.score;
    if (Math.abs(scoreGap) > 2) return scoreGap;
    const gainGap = b.assessment.metrics.referenceGain - a.assessment.metrics.referenceGain;
    if (Math.abs(gainGap) > 0.005) return gainGap;
    return b.intensity - a.intensity;
  })[0];
}

function compareCandidates(a, b) {
  const aBlocked = a.hardRisks?.length ? 1 : 0;
  const bBlocked = b.hardRisks?.length ? 1 : 0;
  if (aBlocked !== bBlocked) return aBlocked - bBlocked;
  if (a.score !== b.score) return b.score - a.score;
  if (a.risks.length !== b.risks.length) return a.risks.length - b.risks.length;
  return a.engineOrder - b.engineOrder;
}

function buildReasons(winner, runnerUp) {
  const comparativeLabels = {
    referenceFit: '参考贴合度略高',
    structure: '局部层次保留更占优',
    exposureSafety: '高光与暗部余量更安全',
    colorSafety: '中性色与饱和度控制更稳'
  };
  const stableLabels = {
    referenceFit: '参考贴合表现稳定',
    structure: '局部层次保留稳定',
    exposureSafety: '曝光余量控制稳妥',
    colorSafety: '色彩安全性较高'
  };
  const reasons = [];
  if (runnerUp) {
    Object.entries(winner.dimensionScores)
      .map(([key, value]) => ({ key, value, advantage: value - runnerUp.dimensionScores[key] }))
      .filter(item => item.advantage > 0)
      .sort((a, b) => b.advantage - a.advantage)
      .slice(0, 2)
      .forEach(item => reasons.push(comparativeLabels[item.key]));
  }
  if (reasons.length < 2) {
    Object.entries(winner.dimensionScores)
      .sort((a, b) => b[1] - a[1])
      .forEach(([key]) => {
        if (reasons.length < 2) reasons.push(stableLabels[key]);
      });
  }
  return [...new Set(reasons)].slice(0, 2);
}

export function rankCandidates(candidates) {
  return [...candidates]
    .sort(compareCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function buildRecommendation(candidates) {
  if (!candidates?.length) return null;
  const ranked = rankCandidates(candidates);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const scoreGap = runnerUp ? Math.max(0, winner.score - runnerUp.score) : winner.score;
  let confidence = scoreGap >= 8 ? 'high' : scoreGap >= 4 ? 'medium' : 'low';
  if (winner.hardRisks?.length || winner.risks.length > 2) confidence = 'low';

  return {
    engineId: winner.engineId,
    confidence,
    scoreGap,
    reasons: buildReasons(winner, runnerUp),
    cautions: winner.hardRisks?.length ? winner.hardRisks.slice(0, 2) : winner.risks.slice(0, 2)
  };
}
