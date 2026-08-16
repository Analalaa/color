import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScene } from '../js/analysis/scene-profile.js';

function pixels(colors) {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}

test('neutral-heavy scenes are marked as neutral sensitive', () => {
  const scene = analyzeScene(pixels([
    [45, 45, 45], [80, 82, 81], [128, 128, 128], [190, 188, 189], [220, 220, 220]
  ]));
  assert.ok(scene.neutralCoverage > 0.7);
  assert.ok(scene.flags.includes('neutral-sensitive'));
});
test('wide luminance distributions are marked as high dynamic range', () => {
  const scene = analyzeScene(pixels([
    [0, 0, 0], [8, 8, 8], [45, 45, 45], [128, 128, 128], [235, 235, 235], [255, 255, 255]
  ]));
  assert.ok(scene.dynamicRange > 0.85);
  assert.ok(scene.flags.includes('high-dynamic-range'));
});
