import { rgbToLab } from '../color-transfer/color-space.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function densityIndex(x, y, xBins) {
  return y * xBins + x;
}

function findColumnQuantile(density, xBins, yBins, x, ratio) {
  let total = 0;
  for (let y = 0; y < yBins; y++) total += density[densityIndex(x, y, xBins)];
  if (!total) return null;
  const target = total * ratio;
  let cumulative = 0;
  for (let y = 0; y < yBins; y++) {
    cumulative += density[densityIndex(x, y, xBins)];
    if (cumulative >= target) return y / Math.max(1, yBins - 1);
  }
  return 1;
}

function buildEnvelope(density, xBins, yBins) {
  const p10 = [];
  const median = [];
  const p90 = [];
  for (let x = 0; x < xBins; x++) {
    p10.push(findColumnQuantile(density, xBins, yBins, x, 0.1));
    median.push(findColumnQuantile(density, xBins, yBins, x, 0.5));
    p90.push(findColumnQuantile(density, xBins, yBins, x, 0.9));
  }
  return { p10, median, p90 };
}

function normalizeHistogram(histogram, count) {
  return Array.from(histogram, value => count ? value / count : 0);
}

/**
 * Build detailed, spatially aligned scope data.
 * Waveform density uses x-position × signal-level bins so canvas rendering can
 * use logarithmic intensity instead of a sparse point cloud.
 */
export function buildScopeData(image, options = {}) {
  if (!image?.data?.length || !image.width || !image.height) {
    throw new Error('Scopes 需要有效图像');
  }
  const maxSamples = options.maxSamples || 50000;
  const histogramBins = options.bins || 128;
  const xBins = options.xBins || 192;
  const yBins = options.yBins || 128;
  const vectorBins = options.vectorBins || 128;
  const pixelCount = image.width * image.height;
  const spatialStep = Math.max(1, Math.ceil(Math.sqrt(pixelCount / maxSamples)));
  const expectedSamples = Math.ceil(image.width / spatialStep) * Math.ceil(image.height / spatialStep);
  const pointStride = Math.max(1, Math.ceil(expectedSamples / 8000));
  const waveform = [];
  const vectorscope = [];
  const lumaDensity = new Uint32Array(xBins * yBins);
  const rgbDensity = [
    new Uint32Array(xBins * yBins),
    new Uint32Array(xBins * yBins),
    new Uint32Array(xBins * yBins)
  ];
  const vectorscopeDensity = new Uint32Array(vectorBins * vectorBins);
  const rgbHistograms = [
    new Uint32Array(histogramBins),
    new Uint32Array(histogramBins),
    new Uint32Array(histogramBins)
  ];
  let count = 0;

  for (let y = 0; y < image.height; y += spatialStep) {
    for (let x = 0; x < image.width; x += spatialStep) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] < 128) continue;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const [, a, labB] = rgbToLab(r, g, b);
      const signalLuma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const normalizedX = x / Math.max(1, image.width - 1);
      const xBin = clamp(Math.floor(normalizedX * xBins), 0, xBins - 1);
      const lumaBin = clamp(Math.round(signalLuma * (yBins - 1)), 0, yBins - 1);
      const channels = [r, g, b];

      if (count % pointStride === 0) {
        waveform.push({
          x: normalizedX,
          l: signalLuma,
          r: r / 255,
          g: g / 255,
          b: b / 255
        });
        vectorscope.push({ a, b: labB, r, g, blue: b });
      }
      lumaDensity[densityIndex(xBin, lumaBin, xBins)]++;
      channels.forEach((value, channel) => {
        const signalBin = clamp(Math.round(value / 255 * (yBins - 1)), 0, yBins - 1);
        rgbDensity[channel][densityIndex(xBin, signalBin, xBins)]++;
        rgbHistograms[channel][clamp(Math.floor(value / 256 * histogramBins), 0, histogramBins - 1)]++;
      });
      const vectorX = clamp(Math.round((a + 128) / 256 * (vectorBins - 1)), 0, vectorBins - 1);
      const vectorY = clamp(Math.round((labB + 128) / 256 * (vectorBins - 1)), 0, vectorBins - 1);
      vectorscopeDensity[densityIndex(vectorX, vectorY, vectorBins)]++;
      count++;
    }
  }

  return {
    schemaVersion: 2,
    signal: 'display-referred sRGB / Rec.709 luma approximation',
    sampleCount: count,
    resolution: { xBins, yBins, vectorBins, spatialStep },
    waveform,
    vectorscope,
    waveformDensity: Array.from(lumaDensity),
    waveformEnvelope: buildEnvelope(lumaDensity, xBins, yBins),
    rgbWaveformDensity: rgbDensity.map(density => Array.from(density)),
    rgbWaveformEnvelopes: rgbDensity.map(density => buildEnvelope(density, xBins, yBins)),
    vectorscopeDensity: Array.from(vectorscopeDensity),
    rgbHistograms: rgbHistograms.map(histogram => normalizeHistogram(histogram, count))
  };
}
