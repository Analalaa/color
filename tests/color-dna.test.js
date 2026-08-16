import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeColorDNA,
  colorDnaSimilarity,
  compareColorDNA,
  createComponentPixels,
  summarizeColorSlice
} from '../js/analysis/color-dna.js';
import { buildScopeData } from '../js/analysis/scope-data.js';

function pixels(colors) {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}

test('neutral images produce low chroma and strong neutral coverage', () => {
  const dna = analyzeColorDNA(pixels([
    [32, 32, 32], [80, 80, 80], [128, 128, 128], [200, 200, 200]
  ]));
  assert.ok(dna.chroma.mean < 0.1);
  assert.ok(dna.neutral.coverage > 0.99);
  assert.equal(dna.colorSpace, 'sRGB / CIELAB D65');
});

test('warm red samples create a red-dominant color slice', () => {
  const dna = analyzeColorDNA(pixels([
    [210, 52, 45], [180, 44, 38], [240, 82, 62], [120, 30, 28]
  ]));
  assert.equal(dna.hue.dominantSliceId, 'red');
  const red = dna.colorSlices.find(slice => slice.id === 'red');
  assert.ok(red.imageCoverage > 0.9);
});

test('a result matching the reference has higher Color DNA fit', () => {
  const source = analyzeColorDNA(pixels([
    [30, 50, 90], [60, 80, 120], [100, 120, 160], [150, 170, 205]
  ]));
  const referencePixels = pixels([
    [110, 55, 35], [145, 80, 45], [185, 115, 62], [220, 155, 90]
  ]);
  const reference = analyzeColorDNA(referencePixels);
  const result = analyzeColorDNA(referencePixels);
  const comparison = compareColorDNA(source, reference, result, { engineId: 'lut', intensity: 0.75 });
  assert.ok(colorDnaSimilarity(result, reference) > colorDnaSimilarity(source, reference));
  assert.ok(comparison.referenceFitGain > 0);
  assert.ok(comparison.recipe.length >= 3);
});

test('component maps preserve alpha and expose single RGB channels', () => {
  const input = new Uint8ClampedArray([220, 80, 30, 200]);
  const red = createComponentPixels(input, 'red');
  const blue = createComponentPixels(input, 'blue');
  assert.deepEqual(Array.from(red), [220, 220, 220, 200]);
  assert.deepEqual(Array.from(blue), [30, 30, 30, 200]);

  const overlay = createComponentPixels(input, 'slice', {
    sliceId: 'blue',
    transparentBackground: true,
    highlightOverlay: true
  });
  assert.equal(overlay[3], 0);
});

test('scope and color-slice summaries are serializable and bounded', () => {
  const sourcePixels = pixels([
    [200, 45, 40], [210, 60, 50],
    [40, 95, 190], [55, 110, 210]
  ]);
  const referencePixels = pixels([
    [180, 65, 50], [195, 70, 55],
    [35, 110, 205], [45, 125, 220]
  ]);
  const scope = buildScopeData(
    { data: sourcePixels, width: 2, height: 2 },
    { xBins: 8, yBins: 8, vectorBins: 8 }
  );
  assert.equal(scope.schemaVersion, 2);
  assert.equal(scope.waveform.length, 4);
  assert.equal(scope.vectorscope.length, 4);
  assert.equal(scope.waveformDensity.length, 64);
  assert.equal(scope.waveformDensity.reduce((a, b) => a + b, 0), scope.sampleCount);
  assert.ok(scope.rgbWaveformDensity.every(density => density.reduce((a, b) => a + b, 0) === scope.sampleCount));
  assert.equal(scope.vectorscopeDensity.reduce((a, b) => a + b, 0), scope.sampleCount);
  assert.equal(scope.waveformEnvelope.median.length, 8);
  assert.ok(scope.waveformEnvelope.median.every(value => value == null || (value >= 0 && value <= 1)));
  assert.ok(scope.rgbHistograms.every(histogram => Math.abs(histogram.reduce((a, b) => a + b, 0) - 1) < 1e-8));

  const source = analyzeColorDNA(sourcePixels);
  const reference = analyzeColorDNA(referencePixels);
  const summary = summarizeColorSlice(source, reference, reference, 'blue');
  assert.ok(summary.affectedPixelRatio >= 0 && summary.affectedPixelRatio <= 1);
  assert.match(summary.explanation, /蓝色影响画面/);
});
