import { rgbToLab, labToRgb } from './color-space.js';

/**
 * Extract mean and standard deviation of LAB channels from RGBA pixel data.
 */
function extractLabStats(pixels) {
  let n = 0, sumL = 0, sumA = 0, sumB = 0;
  let sumL2 = 0, sumA2 = 0, sumB2 = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    sumL += L; sumA += a; sumB += b;
    sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
    n++;
  }

  if (n === 0) return null;

  const muL = sumL / n, muA = sumA / n, muB = sumB / n;
  const sigmaL = Math.sqrt(Math.max(0, sumL2 / n - muL * muL)) || 1;
  const sigmaA = Math.sqrt(Math.max(0, sumA2 / n - muA * muA)) || 1;
  const sigmaB = Math.sqrt(Math.max(0, sumB2 / n - muB * muB)) || 1;

  return { muL, muA, muB, sigmaL, sigmaA, sigmaB, n };
}

/**
 * Map (R, G, B) → (R', G', B') using ICC-style gamut mapping.
 *
 * Steps:
 *  1. Source → LAB
 *  2. Mean/std-dev transfer in LAB space:  z = (L - srcMu) / srcSigma,  out = z * refSigma + refMu
 *  3. Perceptual gamut compression for out-of-gamut LAB → RGB values
 *  4. Back to sRGB
 *
 * @param {Object} srcStats - source LAB statistics
 * @param {Object} refStats - reference LAB statistics
 * @param {number} intensity - 0..1 blending factor
 */
function createIccMapper(srcStats, refStats, intensity) {
  return (r, g, b) => {
    const [L, a, bVal] = rgbToLab(r, g, b);

    // ICC gamut mapping: transfer color statistics in LAB
    let newL = (L - srcStats.muL) / srcStats.sigmaL * refStats.sigmaL + refStats.muL;
    let newA = (a - srcStats.muA) / srcStats.sigmaA * refStats.sigmaA + refStats.muA;
    let newB = (bVal - srcStats.muB) / srcStats.sigmaB * refStats.sigmaB + refStats.muB;

    // Intensity blending in LAB space
    if (intensity < 1) {
      newL = L + (newL - L) * intensity;
      newA = a + (newA - a) * intensity;
      newB = bVal + (newB - bVal) * intensity;
    }

    return labToRgb(newL, newA, newB);
  };
}

/**
 * Apply perceptual gamut compression when RGB values fall outside [0, 255].
 * Desaturates toward the achromatic axis while preserving lightness as much as possible.
 */
function gamutCompress(r, g, b) {
  if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
    return [Math.round(clamp8(r)), Math.round(clamp8(g)), Math.round(clamp8(b))];
  }

  // Find the maximum overshoot/undershoot
  let maxOvershoot = 0;
  if (r < 0) maxOvershoot = Math.max(maxOvershoot, -r);
  if (r > 255) maxOvershoot = Math.max(maxOvershoot, r - 255);
  if (g < 0) maxOvershoot = Math.max(maxOvershoot, -g);
  if (g > 255) maxOvershoot = Math.max(maxOvershoot, g - 255);
  if (b < 0) maxOvershoot = Math.max(maxOvershoot, -b);
  if (b > 255) maxOvershoot = Math.max(maxOvershoot, b - 255);

  // Desaturate toward mid-gray (128, 128, 128)
  const gray = 128;
  const compressionFactor = 1 - maxOvershoot / (maxOvershoot + 255);
  r = gray + (r - gray) * compressionFactor;
  g = gray + (g - gray) * compressionFactor;
  b = gray + (b - gray) * compressionFactor;

  return [Math.round(clamp8(r)), Math.round(clamp8(g)), Math.round(clamp8(b))];
}

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Generate a 3D ICC gamut-mapping LUT from reference and optional source pixel data.
 *
 * @param {Uint8ClampedArray} refPixels - reference RGBA pixel data
 * @param {Uint8ClampedArray|null} srcPixels - source RGBA pixel data (null = use canonical source)
 * @param {number} size - LUT grid dimension (default 33)
 * @param {number} intensity - transfer intensity 0..1
 * @returns {Float64Array} - LUT entries in [0, 1], ordered R→G→B per CUBE spec
 */
export function generateLut(refPixels, size = 33, intensity = 1.0, srcPixels = null) {
  const refStats = extractLabStats(refPixels);
  if (!refStats) throw new Error('参考图无有效像素');

  // Canonical source distribution for well-exposed sRGB images
  const DEFAULT_SRC = { muL: 50, muA: 0, muB: 0, sigmaL: 25, sigmaA: 20, sigmaB: 20 };
  let srcStats = DEFAULT_SRC;

  if (srcPixels) {
    const stats = extractLabStats(srcPixels);
    if (stats) srcStats = stats;
  }

  const mapper = createIccMapper(srcStats, refStats, intensity);
  const lut = new Float64Array(3 * size * size * size);
  const step = 255 / (size - 1);

  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const R = r * step, G = g * step, B = b * step;
        const [nr, ng, nb] = mapper(R, G, B);
        const [cr, cg, cb] = gamutCompress(nr, ng, nb);
        lut[idx++] = cr / 255;
        lut[idx++] = cg / 255;
        lut[idx++] = cb / 255;
      }
    }
  }

  return lut;
}

export { extractLabStats };
