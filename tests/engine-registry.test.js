import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_DEFINITIONS, runEngine } from '../js/core/engine-registry.js';

function makePixels(colors) {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}

const source = makePixels([
  [28, 42, 64], [92, 105, 116], [148, 132, 110], [222, 214, 196]
]);
const reference = makePixels([
  [18, 31, 27], [76, 92, 68], [154, 126, 82], [232, 198, 146]
]);

test('all registered engines return a same-sized pixel result', () => {
  for (const engine of ENGINE_DEFINITIONS) {
    const result = runEngine({
      engineId: engine.id,
      sourcePixels: source,
      referencePixels: reference,
      intensity: 0.8,
      includeLut: true
    });
    assert.equal(result.resultPixels.length, source.length, engine.id);
    assert.ok(result.resultPixels instanceof Uint8ClampedArray, engine.id);
    assert.equal(Boolean(result.lut), engine.exportable, engine.id);
  }
});

test('zero strength keeps the original pixels for every engine', () => {
  for (const engine of ENGINE_DEFINITIONS) {
    const result = runEngine({
      engineId: engine.id,
      sourcePixels: source,
      referencePixels: reference,
      intensity: 0,
      includeLut: false
    });
    assert.deepEqual(Array.from(result.resultPixels), Array.from(source), engine.id);
  }
});
