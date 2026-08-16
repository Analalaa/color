import { rgbToLab } from '../color-transfer/color-space.js';
import { analyzeScene } from './scene-profile.js';
import { assessMetrics } from './recommendation-policy.js';

const clamp01 = value => Math.max(0, Math.min(1, value));

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function sampleStep(pixels, maxSamples = 50000) {
  const pixelCount = pixels.length >> 2;
  return Math.max(1, Math.ceil(pixelCount / maxSamples));
}

function extractLabProfile(pixels, maxSamples = 30000) {
  const step = sampleStep(pixels, maxSamples);
  let count = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumL2 = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  const histL = new Uint32Array(32);
  const histA = new Uint32Array(32);
  const histB = new Uint32Array(32);
  const histC = new Uint32Array(32);

  for (let pixel = 0; pixel < (pixels.length >> 2); pixel += step) {
    const i = pixel * 4;
    if (pixels[i + 3] < 128) continue;
    const [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    sumL += L;
    sumA += a;
    sumB += b;
    sumL2 += L * L;
    sumA2 += a * a;
    sumB2 += b * b;
    const chroma = Math.sqrt(a * a + b * b);
    histL[Math.min(31, Math.max(0, Math.floor(L / 100 * 32)))]++;
    histA[Math.min(31, Math.max(0, Math.floor((a + 128) / 256 * 32)))]++;
    histB[Math.min(31, Math.max(0, Math.floor((b + 128) / 256 * 32)))]++;
    histC[Math.min(31, Math.max(0, Math.floor(chroma / 150 * 32)))]++;
    count++;
  }

  if (!count) {
    return { mean: [0, 0, 0], deviation: [1, 1, 1], histograms: [histL, histA, histB, histC], count: 0 };
  }

  const mean = [sumL / count, sumA / count, sumB / count];
  return {
    mean,
    deviation: [
      Math.sqrt(Math.max(0, sumL2 / count - mean[0] ** 2)),
      Math.sqrt(Math.max(0, sumA2 / count - mean[1] ** 2)),
      Math.sqrt(Math.max(0, sumB2 / count - mean[2] ** 2))
    ],
    histograms: [histL, histA, histB, histC],
    count
  };
}

function cdfDistance(histA, countA, histB, countB) {
  if (!countA || !countB) return 1;
  let cumulativeA = 0;
  let cumulativeB = 0;
  let distance = 0;
  for (let i = 0; i < histA.length; i++) {
    cumulativeA += histA[i] / countA;
    cumulativeB += histB[i] / countB;
    distance += Math.abs(cumulativeA - cumulativeB);
  }
  return distance / histA.length;
}

function profileSimilarity(resultPixels, referencePixels) {
  const result = extractLabProfile(resultPixels);
  const reference = extractLabProfile(referencePixels);
  const meanDistance = (
    Math.abs(result.mean[0] - reference.mean[0]) / 100 +
    Math.abs(result.mean[1] - reference.mean[1]) / 128 +
    Math.abs(result.mean[2] - reference.mean[2]) / 128
  ) / 3;
  const deviationDistance = (
    Math.abs(result.deviation[0] - reference.deviation[0]) / 50 +
    Math.abs(result.deviation[1] - reference.deviation[1]) / 64 +
    Math.abs(result.deviation[2] - reference.deviation[2]) / 64
  ) / 3;
  const distributionDistance = result.histograms.reduce((sum, histogram, index) => (
    sum + cdfDistance(histogram, result.count, reference.histograms[index], reference.count)
  ), 0) / result.histograms.length;
  return clamp01(Math.exp(-(meanDistance * 1.8 + deviationDistance * 0.9 + distributionDistance * 2.4)));
}

function localContrastPreservation(sourcePixels, resultPixels, width, height, maxSamples = 30000) {
  if (!width || !height || width * height * 4 !== sourcePixels.length || width < 2 || height < 2) return null;
  const pixelCount = width * height;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  let scoreSum = 0;
  let count = 0;

  for (let pixel = 0; pixel < pixelCount - width - 1; pixel += step) {
    const x = pixel % width;
    if (x >= width - 1) continue;
    const i = pixel * 4;
    if (sourcePixels[i + 3] < 128) continue;
    const right = i + 4;
    const down = i + width * 4;
    const sourceCenter = luminance(sourcePixels[i], sourcePixels[i + 1], sourcePixels[i + 2]);
    const resultCenter = luminance(resultPixels[i], resultPixels[i + 1], resultPixels[i + 2]);
    const sourceGradient = (
      Math.abs(sourceCenter - luminance(sourcePixels[right], sourcePixels[right + 1], sourcePixels[right + 2])) +
      Math.abs(sourceCenter - luminance(sourcePixels[down], sourcePixels[down + 1], sourcePixels[down + 2]))
    ) / 2;
    const resultGradient = (
      Math.abs(resultCenter - luminance(resultPixels[right], resultPixels[right + 1], resultPixels[right + 2])) +
      Math.abs(resultCenter - luminance(resultPixels[down], resultPixels[down + 1], resultPixels[down + 2]))
    ) / 2;
    scoreSum += clamp01(1 - Math.abs(resultGradient - sourceGradient) / (sourceGradient + 0.08));
    count++;
  }
  return count ? scoreSum / count : null;
}

export function computeQualityMetrics(sourcePixels, resultPixels, referencePixels, options = {}) {
  if (!sourcePixels?.length || sourcePixels.length !== resultPixels?.length) {
    throw new Error('质量分析需要尺寸一致的原图与结果图');
  }
  if (!referencePixels?.length) {
    throw new Error('质量分析需要有效参考图');
  }

  const step = sampleStep(sourcePixels);
  let count = 0;
  let sourceHighlights = 0;
  let resultHighlights = 0;
  let sourceShadows = 0;
  let resultShadows = 0;
  let sourceSatOutliers = 0;
  let resultSatOutliers = 0;
  let sourceLumaSum = 0;
  let resultLumaSum = 0;
  let sourceLumaSq = 0;
  let resultLumaSq = 0;
  let crossLuma = 0;
  let neutralCount = 0;
  let neutralDriftSum = 0;
  let sourceNearHighlights = 0;
  let resultCompressedHighlights = 0;
  let sourceNearShadows = 0;
  let resultCompressedShadows = 0;
  let perceptualChangeSum = 0;

  for (let pixel = 0; pixel < (sourcePixels.length >> 2); pixel += step) {
    const i = pixel * 4;
    if (sourcePixels[i + 3] < 128) continue;

    const sr = sourcePixels[i];
    const sg = sourcePixels[i + 1];
    const sb = sourcePixels[i + 2];
    const rr = resultPixels[i];
    const rg = resultPixels[i + 1];
    const rb = resultPixels[i + 2];
    const sourceLuma = luminance(sr, sg, sb);
    const resultLuma = luminance(rr, rg, rb);
    const sourceSaturation = saturation(sr, sg, sb);
    const resultSaturation = saturation(rr, rg, rb);

    if (sourceLuma >= 0.98) sourceHighlights++;
    if (resultLuma >= 0.98) resultHighlights++;
    if (sourceLuma <= 0.02) sourceShadows++;
    if (resultLuma <= 0.02) resultShadows++;
    if (sourceSaturation >= 0.92) sourceSatOutliers++;
    if (resultSaturation >= 0.92) resultSatOutliers++;

    const sourceSpread = Math.max(sr, sg, sb) - Math.min(sr, sg, sb);
    if (sourceSpread <= 18 && sourceLuma > 0.08 && sourceLuma < 0.92) {
      const [, sourceA, sourceB] = rgbToLab(sr, sg, sb);
      const [, resultA, resultB] = rgbToLab(rr, rg, rb);
      neutralDriftSum += Math.sqrt((resultA - sourceA) ** 2 + (resultB - sourceB) ** 2) / 128;
      neutralCount++;
    }

    if (sourceLuma >= 0.9 && sourceLuma < 0.98) {
      sourceNearHighlights++;
      if (resultLuma >= 0.98) resultCompressedHighlights++;
    }
    if (sourceLuma > 0.02 && sourceLuma <= 0.1) {
      sourceNearShadows++;
      if (resultLuma <= 0.02) resultCompressedShadows++;
    }

    const [sourceLabL, sourceLabA, sourceLabB] = rgbToLab(sr, sg, sb);
    const [resultLabL, resultLabA, resultLabB] = rgbToLab(rr, rg, rb);
    perceptualChangeSum += Math.sqrt(
      (resultLabL - sourceLabL) ** 2 +
      (resultLabA - sourceLabA) ** 2 +
      (resultLabB - sourceLabB) ** 2
    ) / 100;

    sourceLumaSum += sourceLuma;
    resultLumaSum += resultLuma;
    sourceLumaSq += sourceLuma * sourceLuma;
    resultLumaSq += resultLuma * resultLuma;
    crossLuma += sourceLuma * resultLuma;
    count++;
  }

  if (!count) throw new Error('图片没有可分析的有效像素');

  const sourceMean = sourceLumaSum / count;
  const resultMean = resultLumaSum / count;
  const covariance = crossLuma / count - sourceMean * resultMean;
  const sourceVariance = Math.max(0, sourceLumaSq / count - sourceMean ** 2);
  const resultVariance = Math.max(0, resultLumaSq / count - resultMean ** 2);
  const denominator = Math.sqrt(sourceVariance * resultVariance);
  const structurePreservation = denominator < 1e-8
    ? (Math.abs(sourceMean - resultMean) < 1e-4 ? 1 : 0)
    : clamp01(covariance / denominator);

  const sourceReferenceSimilarity = profileSimilarity(sourcePixels, referencePixels);
  const referenceSimilarity = profileSimilarity(resultPixels, referencePixels);
  const localContrast = localContrastPreservation(
    sourcePixels,
    resultPixels,
    options.width,
    options.height
  );

  return {
    referenceSimilarity,
    sourceReferenceSimilarity,
    referenceGain: referenceSimilarity - sourceReferenceSimilarity,
    structurePreservation,
    localContrastPreservation: localContrast ?? structurePreservation,
    addedHighlightClipping: Math.max(0, (resultHighlights - sourceHighlights) / count),
    addedShadowClipping: Math.max(0, (resultShadows - sourceShadows) / count),
    highlightHeadroomLoss: sourceNearHighlights ? resultCompressedHighlights / count : 0,
    shadowHeadroomLoss: sourceNearShadows ? resultCompressedShadows / count : 0,
    luminanceShift: Math.abs(resultMean - sourceMean),
    neutralDrift: neutralCount ? neutralDriftSum / neutralCount : 0,
    addedSaturationOutliers: Math.max(0, (resultSatOutliers - sourceSatOutliers) / count),
    editMagnitude: perceptualChangeSum / count
  };
}

export function assessQuality(sourcePixels, resultPixels, referencePixels, options = {}) {
  const metrics = computeQualityMetrics(sourcePixels, resultPixels, referencePixels, options);
  const sceneProfile = options.sceneProfile || analyzeScene(sourcePixels);
  return assessMetrics(metrics, sceneProfile);
}
