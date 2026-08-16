const clamp01 = value => Math.max(0, Math.min(1, value));

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function quantile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)));
  return sortedValues[index];
}

/**
 * Extract a compact, deterministic scene profile used to adapt recommendation weights.
 * "skinCandidateCoverage" is deliberately a color-range hint, not face detection.
 */
export function analyzeScene(pixels, maxSamples = 50000) {
  if (!pixels?.length) throw new Error('场景分析需要有效像素');

  const pixelCount = pixels.length >> 2;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const luminances = [];
  let count = 0;
  let saturationSum = 0;
  let neutralCount = 0;
  let highlightCount = 0;
  let shadowCount = 0;
  let skinCandidateCount = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4;
    if (pixels[i + 3] < 128) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = luminance(r, g, b);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    luminances.push(luma);
    saturationSum += saturation(r, g, b);
    if (spread <= 18 && luma > 0.08 && luma < 0.92) neutralCount++;
    if (luma >= 0.92) highlightCount++;
    if (luma <= 0.08) shadowCount++;
    if (luma > 0.15 && luma < 0.95 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
      skinCandidateCount++;
    }
    count++;
  }

  if (!count) throw new Error('图片没有可分析的有效像素');
  luminances.sort((a, b) => a - b);
  const low = quantile(luminances, 0.05);
  const high = quantile(luminances, 0.95);
  const dynamicRange = clamp01(high - low);
  const neutralCoverage = neutralCount / count;
  const saturationLevel = saturationSum / count;
  const highlightPressure = highlightCount / count;
  const shadowPressure = shadowCount / count;
  const skinCandidateCoverage = skinCandidateCount / count;

  const flags = [];
  if (dynamicRange >= 0.72 || highlightPressure + shadowPressure >= 0.18) flags.push('high-dynamic-range');
  if (shadowPressure >= 0.22) flags.push('low-key');
  if (neutralCoverage >= 0.2) flags.push('neutral-sensitive');
  if (saturationLevel >= 0.52) flags.push('high-saturation');
  if (skinCandidateCoverage >= 0.08) flags.push('skin-candidate-sensitive');

  return {
    dynamicRange,
    neutralCoverage,
    saturationLevel,
    highlightPressure,
    shadowPressure,
    skinCandidateCoverage,
    luminancePercentiles: { p05: low, p95: high },
    flags
  };
}
