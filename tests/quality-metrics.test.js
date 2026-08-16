import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality, computeQualityMetrics } from '../js/analysis/quality-metrics.js';

function pixels(values) {
  return new Uint8ClampedArray(values.flatMap(([r, g, b]) => [r, g, b, 255]));
}

test('identical input preserves structure and creates no clipping', () => {
  const source = pixels([[20, 20, 20], [80, 70, 60], [140, 150, 145], [235, 230, 225]]);
  const metrics = computeQualityMetrics(source, source, source);
  assert.equal(metrics.structurePreservation, 1);
  assert.equal(metrics.addedHighlightClipping, 0);
  assert.equal(metrics.addedShadowClipping, 0);
  assert.equal(metrics.luminanceShift, 0);
  assert.ok(metrics.referenceSimilarity > 0.99);
});

test('quality assessment warns about newly clipped highlights', () => {
  const source = pixels([[80, 80, 80], [120, 120, 120], [160, 160, 160], [200, 200, 200]]);
  const clipped = pixels([[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255]]);
  const assessment = assessQuality(source, clipped, source);
  assert.ok(assessment.metrics.addedHighlightClipping > 0.9);
  assert.ok(assessment.risks.includes('高光有溢出风险'));
  assert.ok(assessment.score < 80);
});

test('neutral drift is detected when gray pixels receive a strong cast', () => {
  const source = pixels([[64, 64, 64], [96, 96, 96], [128, 128, 128], [180, 180, 180]]);
  const cast = pixels([[100, 45, 45], [140, 70, 70], [180, 95, 95], [225, 135, 135]]);
  const metrics = computeQualityMetrics(source, cast, cast);
  assert.ok(metrics.neutralDrift > 0.15);
});

test('reference gain measures improvement over the unedited source', () => {
  const source = pixels([[20, 35, 60], [50, 70, 95], [90, 110, 135], [140, 160, 185]]);
  const reference = pixels([[120, 80, 40], [150, 105, 55], [185, 140, 85], [220, 180, 120]]);
  const result = pixels([[90, 65, 42], [125, 90, 58], [165, 125, 80], [205, 165, 110]]);
  const metrics = computeQualityMetrics(source, result, reference);
  assert.ok(metrics.referenceGain > 0);
  assert.ok(metrics.referenceSimilarity > metrics.sourceReferenceSimilarity);
});

test('local contrast loss is detected when dimensions are supplied', () => {
  const source = pixels([
    [0, 0, 0], [255, 255, 255],
    [255, 255, 255], [0, 0, 0]
  ]);
  const flat = pixels([
    [128, 128, 128], [128, 128, 128],
    [128, 128, 128], [128, 128, 128]
  ]);
  const metrics = computeQualityMetrics(source, flat, source, { width: 2, height: 2 });
  assert.ok(metrics.localContrastPreservation < 0.2);
});
