import { rgbToLab, labToRgb } from './color-space.js';

function extractColorStats(pixels) {
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

function createColorMapper(stats) {
  const srcMu = [50, 0, 0];
  const srcSigma = [25, 20, 20];

  return (r, g, b) => {
    const [L, a, b2] = rgbToLab(r, g, b);
    const newL = (L - srcMu[0]) * (stats.sigmaL / srcSigma[0]) + stats.muL;
    const newA = (a - srcMu[1]) * (stats.sigmaA / srcSigma[1]) + stats.muA;
    const newB = (b2 - srcMu[2]) * (stats.sigmaB / srcSigma[2]) + stats.muB;
    return labToRgb(newL, newA, newB);
  };
}

export function generateLut(refPixels, size = 33, intensity = 1.0) {
  const stats = extractColorStats(refPixels);
  if (!stats) throw new Error('参考图无有效像素');

  const mapper = createColorMapper(stats);
  const lut = new Float64Array(3 * size * size * size);
  const step = 255 / (size - 1);

  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const R = r * step, G = g * step, B = b * step;
        const [nr, ng, nb] = mapper(R, G, B);
        lut[idx++] = (R / 255) + (nr / 255 - R / 255) * intensity;
        lut[idx++] = (G / 255) + (ng / 255 - G / 255) * intensity;
        lut[idx++] = (B / 255) + (nb / 255 - B / 255) * intensity;
      }
    }
  }

  return lut;
}
