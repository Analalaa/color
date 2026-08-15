import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  addEventListener() {},
  canvasWorkspace: null
};
globalThis.document = {};

const { generateLrXmp } = await import('../js/download.js');

function identityLut(size = 33) {
  const lut = new Float64Array(size * size * size * 3);
  let index = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lut[index++] = r / (size - 1);
        lut[index++] = g / (size - 1);
        lut[index++] = b / (size - 1);
      }
    }
  }
  return lut;
}

test('generated XMP has a UUID and bounded Adobe hue adjustments', () => {
  const xmp = generateLrXmp(identityLut(), 33);
  const uuid = xmp.match(/crs:UUID="([A-F0-9]+)"/)?.[1];
  const hueValues = [...xmp.matchAll(/crs:HueAdjustment\w+="(-?\d+)"/g)]
    .map(match => Number(match[1]));

  assert.equal(uuid?.length, 32);
  assert.equal(hueValues.length, 8);
  assert.ok(hueValues.every(value => value >= -100 && value <= 100));
});
