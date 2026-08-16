/**
 * NeuralPreset-inspired color transfer.
 *
 * Implements the core mathematical idea from "Neural Preset for Color Style Transfer"
 * (Ke et al., CVPR 2023): a full 3x3 affine color transform that captures channel
 * correlations, unlike per-channel methods (Reinhard z-score, histogram matching).
 *
 * Pipeline:
 *   1. Downsample images for fast statistics
 *   2. Compute mean + 3×3 covariance in linear RGB
 *   3. Whitening-coloring transform: A = C_ref^½ · C_src^(-½)
 *   4. Bake into a 33³ LUT with trilinear interpolation application
 *   5. Intensity blending on top of the LUT (blend in sRGB space)
 */

import { applyLut } from './lut-applier.js';

// ─── sRGB ↔ linear RGB ─────────────────────────────────────────────

/**
 * sRGB byte [0,255] → linear value [0,1].
 * Identical to color-space.js linearize(), duplicated here for self-containment.
 */
function srgbToLinear(c) {
  c /= 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

/**
 * Linear value [0,1] → gamma-encoded linear value [0,1].
 * Note: color-space.js gammaize() additionally multiplies by 255.
 * Here we keep values in [0,1] for the LUT (0-1 range required by applyLut).
 */
function linearToSrgb01(c) {
  c = c < 0 ? 0 : c > 1 ? 1 : c;
  return c >= 0.0031308
    ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    : 12.92 * c;
}

// ─── 3×3 matrix helpers ────────────────────────────────────────────

function matZero() {
  return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
}

function matIdentity() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function matMul(A, B) {
  const R = matZero();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        R[i][j] += A[i][k] * B[k][j];
  return R;
}

function matScale(A, s) {
  return A.map(row => row.map(v => v * s));
}

function matAdd(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function matVecMul(A, v) {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]
  ];
}

/**
 * Eigendecomposition of a 3×3 symmetric matrix via Jacobi iteration.
 * Returns { values: [λ0,λ1,λ2], vectors: V } where A = V diag(λ) Vᵀ.
 */
function eigenDecomp(M) {
  const A = M.map(r => [...r]);
  const V = matIdentity();

  for (let iter = 0; iter < 60; iter++) {
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        if (Math.abs(A[i][j]) > maxVal) { maxVal = Math.abs(A[i][j]); p = i; q = j; }

    if (maxVal < 1e-12) break;

    const theta = 0.5 * Math.atan2(2 * A[p][q], A[p][p] - A[q][q]);
    const c = Math.cos(theta), s = Math.sin(theta);

    const newA = A.map(r => [...r]);
    newA[p][p] = c * c * A[p][p] + 2 * s * c * A[p][q] + s * s * A[q][q];
    newA[q][q] = s * s * A[p][p] - 2 * s * c * A[p][q] + c * c * A[q][q];
    newA[p][q] = 0; newA[q][p] = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        newA[i][p] = c * A[i][p] + s * A[i][q];
        newA[p][i] = newA[i][p];
        newA[i][q] = -s * A[i][p] + c * A[i][q];
        newA[q][i] = newA[i][q];
      }
    }
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        A[i][j] = newA[i][j];

    for (let i = 0; i < 3; i++) {
      const vp = V[i][p], vq = V[i][q];
      V[i][p] = c * vp + s * vq;
      V[i][q] = -s * vp + c * vq;
    }
  }

  return { values: [A[0][0], A[1][1], A[2][2]], vectors: V };
}

/**
 * M^p for a symmetric positive-definite 3×3 matrix via eigendecomposition.
 */
function matPow(M, p) {
  const { values, vectors: V } = eigenDecomp(M);
  const D = matZero();
  for (let i = 0; i < 3; i++)
    D[i][i] = Math.pow(Math.max(values[i], 1e-10), p);
  return matMul(matMul(V, D), transpose(V));
}

function transpose(M) {
  return M.map((row, i) => row.map((_, j) => M[j][i]));
}

// ─── Image statistics ───────────────────────────────────────────────

function downsampleForStats(pixels, maxPixels) {
  const total = pixels.length >> 2;
  if (total <= maxPixels) return { pixels, count: total };
  const step = Math.ceil(total / maxPixels);
  const count = Math.floor(total / step);
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0, j = 0; i < total; i += step, j++) {
    const si = i * 4;
    out[j * 4] = pixels[si];
    out[j * 4 + 1] = pixels[si + 1];
    out[j * 4 + 2] = pixels[si + 2];
    out[j * 4 + 3] = pixels[si + 3];
  }
  return { pixels: out, count };
}

/**
 * Compute mean and 3×3 covariance matrix in LINEAR RGB space.
 * Values in [0,1] (linear).
 */
function computeColorStats(pixels) {
  const { pixels: sample, count } = downsampleForStats(pixels, 65536);

  const linR = new Float64Array(count);
  const linG = new Float64Array(count);
  const linB = new Float64Array(count);
  let n = 0, sR = 0, sG = 0, sB = 0;

  for (let i = 0; i < count; i++) {
    const si = i * 4;
    if (sample[si + 3] < 128) continue;
    const r = srgbToLinear(sample[si]);
    const g = srgbToLinear(sample[si + 1]);
    const b = srgbToLinear(sample[si + 2]);
    linR[n] = r; linG[n] = g; linB[n] = b;
    sR += r; sG += g; sB += b;
    n++;
  }

  if (n < 3) return null;

  const muR = sR / n, muG = sG / n, muB = sB / n;

  const C = matZero();
  for (let i = 0; i < n; i++) {
    const dr = linR[i] - muR, dg = linG[i] - muG, db = linB[i] - muB;
    C[0][0] += dr * dr; C[0][1] += dr * dg; C[0][2] += dr * db;
    C[1][0] += dg * dr; C[1][1] += dg * dg; C[1][2] += dg * db;
    C[2][0] += db * dr; C[2][1] += db * dg; C[2][2] += db * db;
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      C[i][j] /= n;

  // Regularize for numerical stability
  const trace = C[0][0] + C[1][1] + C[2][2];
  const eps = 1e-4 * trace;
  C[0][0] += eps; C[1][1] += eps; C[2][2] += eps;

  return { mean: [muR, muG, muB], covariance: C };
}

// ─── Matrix inverse (3×3 adjugate) ───────────────────────────────

function invertMat(M) {
  const a = M[0][0], b = M[0][1], c = M[0][2];
  const d = M[1][0], e = M[1][1], f = M[1][2];
  const g = M[2][0], h = M[2][1], k = M[2][2];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) return matIdentity();
  const inv = 1 / det;
  return [
    [(e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv],
    [(f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv]
  ];
}

// ─── LUT generation ─────────────────────────────────────────────────

/**
 * Generate a 3D LUT for the NeuralPreset-inspired whitening-coloring transform.
 *
 * The transform maps linear RGB pixels as:  p' = A · p + bias
 * where A = C_ref^½ · C_src^(-½) and bias = μ_ref − A · μ_src
 *
 * All operations are in LINEAR RGB space. The LUT outputs values in [0,1]
 * (linear), matching what applyLut() expects.
 *
 * Note: intensity blending is NOT baked into the LUT. The caller should blend
 * in sRGB space: output = orig_sRGB + (lut_sRGB − orig_sRGB) × intensity.
 * This avoids the mathematical inconsistency of lerping transform parameters.
 */
export function generateNeuralPresetLut(refPixels, size = 33, intensity = 1.0, srcPixels = null) {
  const refStats = computeColorStats(refPixels);
  if (!refStats) throw new Error('参考图无有效像素');

  // Default: mid-gray with isotropic covariance (typical well-exposed sRGB)
  let srcStats = {
    mean: [0.18, 0.18, 0.18],
    covariance: [
      [0.04, 0.002, 0.002],
      [0.002, 0.04, 0.002],
      [0.002, 0.002, 0.04]
    ]
  };

  if (srcPixels) {
    const s = computeColorStats(srcPixels);
    if (s) srcStats = s;
  }

  // Whitening-coloring: A = C_ref^½ · C_src^(-½)
  const CsrcInv = invertMat(srcStats.covariance);
  const CrefHalf = matPow(refStats.covariance, 0.5);
  const CsrcInvHalf = matPow(CsrcInv, 0.5);
  const A = matMul(CrefHalf, CsrcInvHalf);

  // Bias in linear RGB space: bias = μ_ref − A · μ_src
  const Amu = matVecMul(A, srcStats.mean);
  const bias = [
    refStats.mean[0] - Amu[0],
    refStats.mean[1] - Amu[1],
    refStats.mean[2] - Amu[2]
  ];

  // Bake into LUT — all in LINEAR RGB
  const lut = new Float64Array(3 * size * size * size);
  const step = 1 / (size - 1);
  let idx = 0;

  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        // Grid in sRGB [0,255] → linear [0,1]
        const lr = srgbToLinear(Math.round(ri * step * 255));
        const lg = srgbToLinear(Math.round(gi * step * 255));
        const lb = srgbToLinear(Math.round(bi * step * 255));

        // Full transform in linear RGB
        const nr = A[0][0] * lr + A[0][1] * lg + A[0][2] * lb + bias[0];
        const ng = A[1][0] * lr + A[1][1] * lg + A[1][2] * lb + bias[1];
        const nb = A[2][0] * lr + A[2][1] * lg + A[2][2] * lb + bias[2];

        // Output: linear RGB [0,1] → gamma-encoded linear [0,1]
        // applyLut clamps to [0,1] internally, so this is the correct format.
        lut[idx++] = linearToSrgb01(nr);
        lut[idx++] = linearToSrgb01(ng);
        lut[idx++] = linearToSrgb01(nb);
      }
    }
  }

  return lut;
}

// Re-export applyLut for callers who need both
export { applyLut };