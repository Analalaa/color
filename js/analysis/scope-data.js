import { rgbToLab } from '../color-transfer/color-space.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function buildScopeData(image, options = {}) {
  if (!image?.data?.length || !image.width || !image.height) {
    throw new Error('Scopes 需要有效图像');
  }
  const maxSamples = options.maxSamples || 8000;
  const bins = options.bins || 64;
  const pixelCount = image.data.length >> 2;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const waveform = [];
  const vectorscope = [];
  const rgbHistograms = [new Uint32Array(bins), new Uint32Array(bins), new Uint32Array(bins)];
  let count = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4;
    if (image.data[i + 3] < 128) continue;
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const [L, a, labB] = rgbToLab(r, g, b);
    waveform.push({
      x: (pixel % image.width) / Math.max(1, image.width - 1),
      l: L / 100,
      r: r / 255,
      g: g / 255,
      b: b / 255
    });
    vectorscope.push({ a, b: labB, r, g, blue: b });
    rgbHistograms[0][clamp(Math.floor(r / 256 * bins), 0, bins - 1)]++;
    rgbHistograms[1][clamp(Math.floor(g / 256 * bins), 0, bins - 1)]++;
    rgbHistograms[2][clamp(Math.floor(b / 256 * bins), 0, bins - 1)]++;
    count++;
  }

  return {
    sampleCount: count,
    waveform,
    vectorscope,
    rgbHistograms: rgbHistograms.map(histogram => Array.from(histogram, value => count ? value / count : 0))
  };
}
