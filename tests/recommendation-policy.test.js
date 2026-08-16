import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessMetrics,
  buildRecommendation,
  rankCandidates,
  selectBestStrength
} from '../js/analysis/recommendation-policy.js';

function metrics(overrides = {}) {
  return {
    referenceSimilarity: 0.82,
    sourceReferenceSimilarity: 0.62,
    referenceGain: 0.2,
    structurePreservation: 0.95,
    localContrastPreservation: 0.93,
    addedHighlightClipping: 0,
    addedShadowClipping: 0,
    highlightHeadroomLoss: 0,
    shadowHeadroomLoss: 0,
    luminanceShift: 0.04,
    neutralDrift: 0.01,
    addedSaturationOutliers: 0,
    editMagnitude: 0.18,
    ...overrides
  };
}

function candidate(engineId, score, overrides = {}) {
  return {
    engineId,
    engineOrder: engineId === 'a' ? 0 : 1,
    score,
    dimensionScores: {
      referenceFit: score,
      structure: score,
      exposureSafety: score,
      colorSafety: score
    },
    strengths: ['层次稳定'],
    risks: [],
    hardRisks: [],
    ...overrides
  };
}

test('a hard-risk strength cannot beat a safe strength', () => {
  const safe = { intensity: 0.75, assessment: assessMetrics(metrics()) };
  const risky = {
    intensity: 1,
    assessment: {
      ...assessMetrics(metrics({ addedHighlightClipping: 0.08 })),
      score: 99
    }
  };
  assert.equal(selectBestStrength([risky, safe]).intensity, 0.75);
});

test('safe candidates rank ahead of higher-scoring hard-risk candidates', () => {
  const ranked = rankCandidates([
    candidate('a', 96, { risks: ['风险'], hardRisks: ['严重风险'] }),
    candidate('b', 82)
  ]);
  assert.equal(ranked[0].engineId, 'b');
});

test('close candidate scores produce a low-confidence recommendation', () => {
  const recommendation = buildRecommendation([
    candidate('a', 86),
    candidate('b', 84)
  ]);
  assert.equal(recommendation.engineId, 'a');
  assert.equal(recommendation.confidence, 'low');
  assert.equal(recommendation.scoreGap, 2);
});

test('recommendation reasons describe dimensions that actually lead the runner-up', () => {
  const winner = candidate('a', 90, {
    dimensionScores: { referenceFit: 88, structure: 90, exposureSafety: 97, colorSafety: 86 }
  });
  const runnerUp = candidate('b', 82, {
    dimensionScores: { referenceFit: 87, structure: 94, exposureSafety: 75, colorSafety: 85 }
  });
  const recommendation = buildRecommendation([winner, runnerUp]);
  assert.ok(recommendation.reasons.includes('高光与暗部余量更安全'));
});

test('neutral-sensitive scenes increase color-safety weight', () => {
  const normal = assessMetrics(metrics(), {});
  const neutral = assessMetrics(metrics(), { neutralCoverage: 0.8 });
  assert.ok(neutral.weights.colorSafety > normal.weights.colorSafety);
});
