import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyReferenceRecipe,
  buildReferenceRecipe,
  createPointColorMaskPixels,
  renderReferenceRecipe
} from '../js/color-transfer/reference-recipe-engine.js';
import { runEngine } from '../js/core/engine-registry.js';

function pixels(colors, repeat = 40) {
  const output = new Uint8ClampedArray(colors.length * repeat * 4);
  let offset = 0;
  for (let index = 0; index < repeat; index++) {
    for (const color of colors) {
      output.set([...color, 255], offset);
      offset += 4;
    }
  }
  return output;
}

const source = pixels([
  [34, 38, 45], [82, 88, 96], [128, 118, 105], [172, 96, 66],
  [68, 112, 146], [188, 184, 175], [224, 220, 210]
]);
const reference = pixels([
  [24, 30, 35], [70, 76, 82], [134, 124, 108], [184, 104, 62],
  [54, 104, 132], [198, 190, 174], [236, 224, 204]
]);

test('reference recipe exposes monotonic tone points and real parameter layers', () => {
  const recipe = buildReferenceRecipe(source, reference, { intensity: 0.8 });
  assert.equal(recipe.schemaVersion, 2);
  assert.equal(recipe.engine, 'reference-recipe-v2');
  assert.ok(recipe.toneCurve.length >= 4);
  for (let index = 1; index < recipe.toneCurve.length; index++) {
    assert.ok(recipe.toneCurve[index].input > recipe.toneCurve[index - 1].input);
    assert.ok(recipe.toneCurve[index].output >= recipe.toneCurve[index - 1].output);
  }
  assert.ok(recipe.layers.some(layer => layer.kind === 'white-balance'));
  assert.ok(recipe.layers.some(layer => layer.kind === 'tone-curve'));
  assert.ok(recipe.layers.some(layer => layer.kind === 'protection'));
  assert.ok(recipe.layers.some(layer => layer.kind === 'point-color'));
  assert.equal(recipe.colorGrading.length, 3);
});

test('zero-intensity recipe is pixel-identical and remains serializable', () => {
  const { resultPixels, recipe } = renderReferenceRecipe(source, reference, { intensity: 0 });
  assert.deepEqual(resultPixels, source);
  assert.doesNotThrow(() => JSON.stringify(recipe));
});

test('disabled layers are honored by the actual renderer', () => {
  const recipe = buildReferenceRecipe(source, reference, { intensity: 1 });
  const full = applyReferenceRecipe(source, recipe);
  const disabled = applyReferenceRecipe(source, recipe, {
    disabledLayerIds: recipe.layers.map(layer => layer.id)
  });
  assert.deepEqual(disabled, source);
  assert.notDeepEqual(full, source);
});

test('Point Color range visualization returns a bounded alpha mask', () => {
  const recipe = buildReferenceRecipe(source, reference);
  const point = recipe.pointColors[0];
  assert.ok(point);
  const mask = createPointColorMaskPixels(source, point, { transparentBackground: true });
  let visible = 0;
  for (let index = 3; index < mask.length; index += 4) {
    assert.ok(mask[index] >= 0 && mask[index] <= 255);
    if (mask[index] > 0) visible++;
  }
  assert.ok(visible > 0);
  assert.ok(visible < mask.length / 4);
});

test('reference restoration engine returns the renderable recipe', () => {
  const output = runEngine({
    engineId: 'histogram',
    sourcePixels: source,
    referencePixels: reference,
    intensity: 0.65,
    includeLut: false
  });
  assert.equal(output.resultPixels.length, source.length);
  assert.equal(output.lut, null);
  assert.equal(output.recipe.intensity, 0.65);
});

