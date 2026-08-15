import { rgbToLab, labToRgb } from './color-space.js';

function computeHistogram(channelData) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < channelData.length; i++) {
    let v = channelData[i] | 0;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    hist[v]++;
  }
  return hist;
}

function computeCDF(hist) {
  const cdf = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    cdf[i] = sum;
  }
  const total = cdf[255];
  if (total === 0) return cdf;
  let minIdx = 0;
  while (minIdx < 256 && cdf[minIdx] === 0) minIdx++;
  const min = cdf[minIdx];
  const range = total - min || 1;
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    out[i] = Math.round(((cdf[i] - min) / range) * 255);
  }
  return out;
}

// For each source value v, return the reference value y where refCDF[y] >= srcCDF[v].
// This is the standard histogram-specification mapping: output gets the reference distribution.
function buildMatchMap(srcCDF, refCDF) {
  const map = new Uint8Array(256);
  let y = 0;
  for (let v = 0; v < 256; v++) {
    const target = srcCDF[v];
    while (y < 255 && refCDF[y] < target) y++;
    map[v] = y;
  }
  return map;
}

/**
 * Transfer color from reference to source image using histogram matching in LAB space.
 * @param {Uint8ClampedArray} srcPixels - source image pixel data (RGBA)
 * @param {Uint8ClampedArray} refPixels - reference image pixel data (RGBA)
 * @param {number} intensity - transfer intensity 0.0 to 1.0
 * @returns {Uint8ClampedArray} - output pixel data
 */
export function transferColor(srcPixels, refPixels, intensity = 1.0) {
  const len = srcPixels.length;
  const out = new Uint8ClampedArray(len);
  const srcCount = len >> 2;
  const refCount = refPixels.length >> 2;

  const srcL = new Uint8Array(srcCount);
  const srcA = new Uint8Array(srcCount);
  const srcB = new Uint8Array(srcCount);
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const [L, a, b] = rgbToLab(srcPixels[i], srcPixels[i + 1], srcPixels[i + 2]);
    srcL[j] = Math.max(0, Math.min(255, Math.round(L * 2.55)));
    srcA[j] = Math.max(0, Math.min(255, Math.round(a + 128)));
    srcB[j] = Math.max(0, Math.min(255, Math.round(b + 128)));
  }

  const refL = new Uint8Array(refCount);
  const refA = new Uint8Array(refCount);
  const refB = new Uint8Array(refCount);
  for (let i = 0, j = 0; i < refPixels.length; i += 4, j++) {
    const [L, a, b] = rgbToLab(refPixels[i], refPixels[i + 1], refPixels[i + 2]);
    refL[j] = Math.max(0, Math.min(255, Math.round(L * 2.55)));
    refA[j] = Math.max(0, Math.min(255, Math.round(a + 128)));
    refB[j] = Math.max(0, Math.min(255, Math.round(b + 128)));
  }

  const mapL = buildMatchMap(computeCDF(computeHistogram(srcL)), computeCDF(computeHistogram(refL)));
  const mapA = buildMatchMap(computeCDF(computeHistogram(srcA)), computeCDF(computeHistogram(refA)));
  const mapB = buildMatchMap(computeCDF(computeHistogram(srcB)), computeCDF(computeHistogram(refB)));

  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const L_new = mapL[srcL[j]] / 2.55;
    const a_new = mapA[srcA[j]] - 128;
    const b_new = mapB[srcB[j]] - 128;

    const origR = srcPixels[i];
    const origG = srcPixels[i + 1];
    const origBch = srcPixels[i + 2];
    const [newR, newG, newB] = labToRgb(L_new, a_new, b_new);

    out[i] = Math.round(origR + (newR - origR) * intensity);
    out[i + 1] = Math.round(origG + (newG - origG) * intensity);
    out[i + 2] = Math.round(origBch + (newB - origBch) * intensity);
    out[i + 3] = srcPixels[i + 3];
  }

  return out;
}
