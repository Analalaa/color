import { rgbToLab, labToRgb } from './color-space.js';

// Compute 256-bin histogram for channel data
function computeHistogram(channelData) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < channelData.length; i++) {
    const idx = Math.max(0, Math.min(255, Math.round(channelData[i])));
    hist[idx]++;
  }
  return hist;
}

// Compute cumulative distribution function, normalized to [0, 255]
function computeCDF(hist) {
  const cdf = new Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    cdf[i] = sum;
  }
  const min = cdf.find(v => v > 0);
  const max = cdf[255];
  return cdf.map(v => Math.round(((v - min) / (max - min)) * 255));
}

// Build mapping: for each target value, find closest source CDF value
function buildMatchMap(sourceCDF, targetCDF) {
  const map = new Array(256);
  let si = 0;
  for (let ti = 0; ti < 256; ti++) {
    while (si < 255 && sourceCDF[si] < targetCDF[ti]) si++;
    map[ti] = si;
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

  // Extract L, a, b channels for source and reference
  const srcL = [], srcA = [], srcB = [];
  const refL = [], refA = [], refB = [];

  for (let i = 0; i < len; i += 4) {
    const [L1, a1, b1] = rgbToLab(srcPixels[i], srcPixels[i+1], srcPixels[i+2]);
    const [L2, a2, b2] = rgbToLab(refPixels[i], refPixels[i+1], refPixels[i+2]);
    srcL.push(L1); srcA.push(a1 + 128); srcB.push(b1 + 128); // shift to 0-255 range
    refL.push(L2); refA.push(a2 + 128); refB.push(b2 + 128);
  }

  // Build CDF match maps for each channel
  const srcLCDF = computeCDF(computeHistogram(srcL));
  const refLCDF = computeCDF(computeHistogram(refL));
  const mapL = buildMatchMap(srcLCDF, refLCDF);

  const srcACDF = computeCDF(computeHistogram(srcA));
  const refACDF = computeCDF(computeHistogram(refA));
  const mapA = buildMatchMap(srcACDF, refACDF);

  const srcBCDF = computeCDF(computeHistogram(srcB));
  const refBCDF = computeCDF(computeHistogram(refB));
  const mapB = buildMatchMap(srcBCDF, refBCDF);

  // Apply matching with intensity blending
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const L_shifted = Math.round(srcL[j]);
    const a_shifted = Math.round(srcA[j]);
    const b_shifted = Math.round(srcB[j]);

    const L_new = mapL[L_shifted];
    const a_new = mapA[a_shifted] - 128; // shift back
    const b_new = mapB[b_shifted] - 128;

    const [origR, origG, origB] = [srcPixels[i], srcPixels[i+1], srcPixels[i+2]];
    const [newR, newG, newB] = labToRgb(L_new, a_new, b_new);

    out[i]   = Math.round(origR + (newR - origR) * intensity);
    out[i+1] = Math.round(origG + (newG - origG) * intensity);
    out[i+2] = Math.round(origB + (newB - origB) * intensity);
    out[i+3] = srcPixels[i+3]; // preserve alpha
  }

  return out;
}