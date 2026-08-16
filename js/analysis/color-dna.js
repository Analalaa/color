import { rgbToLab } from '../color-transfer/color-space.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = value => clamp(value, 0, 1);
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const COLOR_SLICES = Object.freeze([
  Object.freeze({ id: 'red', label: '红', center: 20, color: '#d8645b' }),
  Object.freeze({ id: 'yellow', label: '黄', center: 80, color: '#d5aa4d' }),
  Object.freeze({ id: 'green', label: '绿', center: 140, color: '#6f9d6f' }),
  Object.freeze({ id: 'cyan', label: '青', center: 200, color: '#57989b' }),
  Object.freeze({ id: 'blue', label: '蓝', center: 250, color: '#667fb0' }),
  Object.freeze({ id: 'magenta', label: '洋红', center: 320, color: '#a66b91' })
]);

function hueDistance(a, b) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function signedHueDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function hueFromLab(a, b) {
  return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}

function hueToRgb(hue, value = 0.92) {
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = value * (1 - Math.abs((h % 2) - 1));
  const index = Math.floor(h);
  const pairs = [
    [value, x, 0], [x, value, 0], [0, value, x],
    [0, x, value], [x, 0, value], [value, 0, x]
  ];
  return pairs[index] || pairs[0];
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function createSliceAccumulator(slice) {
  return {
    ...slice,
    count: 0,
    sumL: 0,
    sumC: 0,
    sumSin: 0,
    sumCos: 0
  };
}

function finishSlice(slice, chromaticCount, totalCount) {
  if (!slice.count) {
    return {
      id: slice.id,
      label: slice.label,
      center: slice.center,
      color: slice.color,
      coverage: 0,
      imageCoverage: 0,
      meanLightness: 0,
      meanChroma: 0,
      meanHue: slice.center
    };
  }
  const meanHue = (Math.atan2(slice.sumSin, slice.sumCos) * 180 / Math.PI + 360) % 360;
  return {
    id: slice.id,
    label: slice.label,
    center: slice.center,
    color: slice.color,
    coverage: chromaticCount ? slice.count / chromaticCount : 0,
    imageCoverage: totalCount ? slice.count / totalCount : 0,
    meanLightness: slice.sumL / slice.count,
    meanChroma: slice.sumC / slice.count,
    meanHue
  };
}

function finishToneBand(accumulator, totalCount) {
  if (!accumulator.count) {
    return { coverage: 0, meanLightness: 0, meanChroma: 0, meanHue: 0 };
  }
  return {
    coverage: accumulator.count / totalCount,
    meanLightness: accumulator.sumL / accumulator.count,
    meanChroma: accumulator.sumC / accumulator.count,
    meanHue: (Math.atan2(accumulator.sumSin, accumulator.sumCos) * 180 / Math.PI + 360) % 360
  };
}

function normalizeHistogram(histogram, count) {
  return Array.from(histogram, value => count ? value / count : 0);
}

function dominantSlice(slices) {
  return [...slices].sort((a, b) => b.imageCoverage - a.imageCoverage)[0] || slices[0];
}

/**
 * Build a serializable, source-independent description of an image's color state.
 * Values are relative measurements in decoded sRGB / CIELAB D65, not a hardware
 * colorimeter reading.
 */
export function analyzeColorDNA(pixels, options = {}) {
  if (!pixels?.length) throw new Error('Color DNA 需要有效像素');

  const maxSamples = options.maxSamples || 40000;
  const pixelCount = pixels.length >> 2;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const lightnessValues = [];
  const toneHistogram = new Uint32Array(64);
  const chromaHistogram = new Uint32Array(48);
  const hueHistogram = new Uint32Array(24);
  const rgbHistograms = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
  const slices = COLOR_SLICES.map(createSliceAccumulator);
  const toneBands = {
    shadows: { count: 0, sumL: 0, sumC: 0, sumSin: 0, sumCos: 0 },
    midtones: { count: 0, sumL: 0, sumC: 0, sumSin: 0, sumCos: 0 },
    highlights: { count: 0, sumL: 0, sumC: 0, sumSin: 0, sumCos: 0 }
  };

  let count = 0;
  let chromaticCount = 0;
  let neutralCount = 0;
  let sumL = 0;
  let sumC = 0;
  let sumC2 = 0;
  let sumLC = 0;
  let sumL2 = 0;
  let neutralA = 0;
  let neutralB = 0;
  let sumR = 0;
  let sumG = 0;
  let sumBlue = 0;
  let highlightClip = 0;
  let shadowClip = 0;
  let saturationEdge = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4;
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const blue = pixels[i + 2];
    const [L, a, b] = rgbToLab(r, g, blue);
    const C = Math.sqrt(a * a + b * b);
    const hue = hueFromLab(a, b);
    const radians = hue * Math.PI / 180;

    lightnessValues.push(L);
    toneHistogram[clamp(Math.floor(L / 100 * 64), 0, 63)]++;
    chromaHistogram[clamp(Math.floor(C / 120 * 48), 0, 47)]++;
    rgbHistograms[0][Math.floor(r / 256 * 64)]++;
    rgbHistograms[1][Math.floor(g / 256 * 64)]++;
    rgbHistograms[2][Math.floor(blue / 256 * 64)]++;

    sumL += L;
    sumC += C;
    sumL2 += L * L;
    sumC2 += C * C;
    sumLC += L * C;
    sumR += r;
    sumG += g;
    sumBlue += blue;
    if (L >= 98) highlightClip++;
    if (L <= 2) shadowClip++;
    if ((Math.max(r, g, blue) - Math.min(r, g, blue)) / 255 >= 0.92) saturationEdge++;

    if (C <= 10 && L > 6 && L < 94) {
      neutralCount++;
      neutralA += a;
      neutralB += b;
    }

    const toneBand = L < 33 ? toneBands.shadows : L < 67 ? toneBands.midtones : toneBands.highlights;
    toneBand.count++;
    toneBand.sumL += L;
    toneBand.sumC += C;
    if (C > 5) {
      toneBand.sumSin += Math.sin(radians);
      toneBand.sumCos += Math.cos(radians);
    }

    if (C > 7) {
      chromaticCount++;
      hueHistogram[Math.floor(hue / 360 * 24) % 24]++;
      const slice = slices.reduce((best, current) => (
        hueDistance(hue, current.center) < hueDistance(hue, best.center) ? current : best
      ), slices[0]);
      slice.count++;
      slice.sumL += L;
      slice.sumC += C;
      slice.sumSin += Math.sin(radians);
      slice.sumCos += Math.cos(radians);
    }
    count++;
  }

  if (!count) throw new Error('图片没有可分析的有效像素');
  lightnessValues.sort((a, b) => a - b);
  const meanL = sumL / count;
  const meanC = sumC / count;
  const covarianceLC = sumLC / count - meanL * meanC;
  const varianceL = Math.max(0, sumL2 / count - meanL * meanL);
  const varianceC = Math.max(0, sumC2 / count - meanC * meanC);
  const correlationDenominator = Math.sqrt(varianceL * varianceC);
  const finishedSlices = slices.map(slice => finishSlice(slice, chromaticCount, count));
  const dominant = dominantSlice(finishedSlices);
  const meanNeutralA = neutralCount ? neutralA / neutralCount : 0;
  const meanNeutralB = neutralCount ? neutralB / neutralCount : 0;

  return {
    schemaVersion: 1,
    colorSpace: 'sRGB / CIELAB D65',
    sampleCount: count,
    tone: {
      mean: round(meanL),
      p05: round(percentile(lightnessValues, 0.05)),
      p25: round(percentile(lightnessValues, 0.25)),
      median: round(percentile(lightnessValues, 0.5)),
      p75: round(percentile(lightnessValues, 0.75)),
      p95: round(percentile(lightnessValues, 0.95)),
      contrastSpan: round(percentile(lightnessValues, 0.95) - percentile(lightnessValues, 0.05)),
      histogram: normalizeHistogram(toneHistogram, count)
    },
    chroma: {
      mean: round(meanC),
      deviation: round(Math.sqrt(varianceC)),
      histogram: normalizeHistogram(chromaHistogram, count),
      lumaCorrelation: round(correlationDenominator ? covarianceLC / correlationDenominator : 0, 3)
    },
    hue: {
      histogram: normalizeHistogram(hueHistogram, chromaticCount),
      chromaticCoverage: chromaticCount / count,
      dominantSliceId: dominant?.id || 'red'
    },
    rgb: {
      mean: [round(sumR / count), round(sumG / count), round(sumBlue / count)],
      histograms: rgbHistograms.map(histogram => normalizeHistogram(histogram, count))
    },
    neutral: {
      coverage: neutralCount / count,
      a: round(meanNeutralA),
      b: round(meanNeutralB),
      magnitude: round(Math.sqrt(meanNeutralA * meanNeutralA + meanNeutralB * meanNeutralB))
    },
    toneBands: {
      shadows: finishToneBand(toneBands.shadows, count),
      midtones: finishToneBand(toneBands.midtones, count),
      highlights: finishToneBand(toneBands.highlights, count)
    },
    colorSlices: finishedSlices.map(slice => ({
      ...slice,
      coverage: round(slice.coverage, 4),
      imageCoverage: round(slice.imageCoverage, 4),
      meanLightness: round(slice.meanLightness),
      meanChroma: round(slice.meanChroma),
      meanHue: round(slice.meanHue)
    })),
    risk: {
      highlightClip: highlightClip / count,
      shadowClip: shadowClip / count,
      saturationEdge: saturationEdge / count
    }
  };
}

export function colorDnaSimilarity(a, b) {
  if (!a || !b) return 0;
  const toneDistance = (
    Math.abs(a.tone.p05 - b.tone.p05) +
    Math.abs(a.tone.median - b.tone.median) +
    Math.abs(a.tone.p95 - b.tone.p95)
  ) / 300;
  const chromaDistance = clamp01(Math.abs(a.chroma.mean - b.chroma.mean) / 80);
  const hueDistanceScore = a.hue.histogram.reduce(
    (sum, value, index) => sum + Math.abs(value - (b.hue.histogram[index] || 0)),
    0
  ) / 2;
  const neutralDistance = clamp01(Math.hypot(a.neutral.a - b.neutral.a, a.neutral.b - b.neutral.b) / 40);
  const densityDistance = Math.abs(a.chroma.lumaCorrelation - b.chroma.lumaCorrelation) / 2;
  return clamp01(1 - (
    toneDistance * 0.3 +
    chromaDistance * 0.22 +
    hueDistanceScore * 0.28 +
    neutralDistance * 0.12 +
    densityDistance * 0.08
  ));
}

function describeNeutralShift(deltaA, deltaB) {
  if (Math.hypot(deltaA, deltaB) < 1.2) return '中性色基本保持稳定';
  const horizontal = Math.abs(deltaA) >= 1.2 ? (deltaA > 0 ? '洋红' : '绿色') : '';
  const vertical = Math.abs(deltaB) >= 1.2 ? (deltaB > 0 ? '暖黄' : '冷蓝') : '';
  return `中性色轻微向${[horizontal, vertical].filter(Boolean).join('、')}方向移动`;
}

function getSlice(dna, id) {
  return dna?.colorSlices?.find(slice => slice.id === id) || null;
}

export function summarizeColorSlice(source, reference, result, sliceId) {
  const definition = COLOR_SLICES.find(slice => slice.id === sliceId) || COLOR_SLICES[0];
  const sourceSlice = getSlice(source, definition.id);
  const referenceSlice = getSlice(reference, definition.id);
  const resultSlice = getSlice(result, definition.id);
  if (!sourceSlice || !referenceSlice || !resultSlice) return null;

  const hueShift = signedHueDelta(sourceSlice.meanHue, resultSlice.meanHue);
  const chromaDelta = resultSlice.meanChroma - sourceSlice.meanChroma;
  const lightnessDelta = resultSlice.meanLightness - sourceSlice.meanLightness;
  const referenceHueGap = Math.abs(signedHueDelta(resultSlice.meanHue, referenceSlice.meanHue));
  return {
    id: definition.id,
    label: definition.label,
    color: definition.color,
    affectedPixelRatio: resultSlice.imageCoverage,
    hueShift: round(hueShift, 1),
    chromaDelta: round(chromaDelta, 1),
    lightnessDelta: round(lightnessDelta, 1),
    referenceHueGap: round(referenceHueGap, 1),
    explanation: `${definition.label}色影响画面 ${Math.round(resultSlice.imageCoverage * 100)}%；` +
      `${Math.abs(hueShift) >= 1 ? `色相${hueShift > 0 ? '顺时针' : '逆时针'}移动 ${Math.abs(round(hueShift, 1))}°，` : '色相基本稳定，'}` +
      `彩度${chromaDelta >= 0 ? '增加' : '降低'} ${Math.abs(round(chromaDelta, 1))}，` +
      `与参考色相仍相差 ${round(referenceHueGap, 1)}°。`
  };
}

export function compareColorDNA(source, reference, result, options = {}) {
  if (!source || !reference || !result) return null;
  const sourceFit = colorDnaSimilarity(source, reference);
  const resultFit = colorDnaSimilarity(result, reference);
  const toneDelta = result.tone.median - source.tone.median;
  const contrastDelta = result.tone.contrastSpan - source.tone.contrastSpan;
  const chromaDelta = result.chroma.mean - source.chroma.mean;
  const neutralDeltaA = result.neutral.a - source.neutral.a;
  const neutralDeltaB = result.neutral.b - source.neutral.b;
  const dominantId = reference.hue.dominantSliceId || result.hue.dominantSliceId;
  const dominantSlice = summarizeColorSlice(source, reference, result, dominantId);
  const explanations = [
    `${toneDelta >= 0 ? '中间调提升' : '中间调压低'} ${Math.abs(round(toneDelta, 1))} L*，` +
      `明暗跨度${contrastDelta >= 0 ? '增加' : '收窄'} ${Math.abs(round(contrastDelta, 1))}。`,
    `平均彩度${chromaDelta >= 0 ? '增加' : '降低'} ${Math.abs(round(chromaDelta, 1))}，` +
      `${result.chroma.lumaCorrelation < source.chroma.lumaCorrelation ? '饱和颜色趋向更厚重' : '饱和颜色趋向更明亮'}。`,
    `${describeNeutralShift(neutralDeltaA, neutralDeltaB)}。`,
    `Color DNA 参考贴合从 ${Math.round(sourceFit * 100)} 提升到 ${Math.round(resultFit * 100)}。`
  ];
  if (dominantSlice) explanations.splice(2, 0, dominantSlice.explanation);

  const recipe = [
    {
      id: 'tone',
      label: '明暗结构',
      amount: round(toneDelta, 1),
      unit: 'L*',
      affected: '全局',
      explanation: explanations[0]
    },
    {
      id: 'chroma-density',
      label: '彩度与密度',
      amount: round(chromaDelta, 1),
      unit: 'C*',
      affected: '综合色彩',
      explanation: explanations[1]
    },
    {
      id: 'neutral-balance',
      label: '中性色平衡',
      amount: round(Math.hypot(neutralDeltaA, neutralDeltaB), 1),
      unit: 'Δab',
      affected: `${Math.round(result.neutral.coverage * 100)}% 中性色区域`,
      explanation: explanations.find(text => text.startsWith('中性色')) || explanations[2]
    }
  ];
  if (dominantSlice) {
    recipe.splice(2, 0, {
      id: `slice-${dominantSlice.id}`,
      label: `${dominantSlice.label}色色相层`,
      amount: dominantSlice.hueShift,
      unit: '°',
      affected: `${Math.round(dominantSlice.affectedPixelRatio * 100)}% 画面`,
      explanation: dominantSlice.explanation
    });
  }

  return {
    schemaVersion: 1,
    engineId: options.engineId || null,
    intensity: options.intensity ?? null,
    sourceFit: round(sourceFit, 4),
    resultFit: round(resultFit, 4),
    referenceFitGain: round(resultFit - sourceFit, 4),
    deltas: {
      medianLightness: round(toneDelta, 2),
      contrastSpan: round(contrastDelta, 2),
      meanChroma: round(chromaDelta, 2),
      neutralA: round(neutralDeltaA, 2),
      neutralB: round(neutralDeltaB, 2)
    },
    explanations,
    recipe
  };
}

function componentValueToByte(value) {
  return clamp(Math.round(value), 0, 255);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function createComponentPixels(pixels, mode, options = {}) {
  if (!pixels?.length) throw new Error('分量图需要有效像素');
  const output = new Uint8ClampedArray(pixels.length);
  const slice = COLOR_SLICES.find(item => item.id === options.sliceId) || null;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const alpha = pixels[i + 3];
    const [L, a, labB] = rgbToLab(r, g, b);
    const C = Math.sqrt(a * a + labB * labB);
    const hue = hueFromLab(a, labB);
    let outR;
    let outG;
    let outB;
    let outAlpha = alpha;

    if (mode === 'lightness') {
      outR = outG = outB = componentValueToByte(L / 100 * 255);
    } else if (mode === 'chroma') {
      const value = componentValueToByte(C / 100 * 255);
      outR = outG = outB = value;
    } else if (mode === 'hue') {
      if (C < 5) {
        outR = outG = outB = componentValueToByte(L / 100 * 90);
      } else {
        [outR, outG, outB] = hueToRgb(hue, 0.9).map(value => componentValueToByte(value * 255));
      }
    } else if (mode === 'red' || mode === 'green' || mode === 'blue') {
      const value = mode === 'red' ? r : mode === 'green' ? g : b;
      outR = outG = outB = value;
    } else if (mode === 'slice' && slice) {
      const selected = C > 7 && hueDistance(hue, slice.center) <= 34;
      if (selected) {
        if (options.highlightOverlay) {
          [outR, outG, outB] = hexToRgb(slice.color);
          outAlpha = 205;
        } else {
          outR = r;
          outG = g;
          outB = b;
        }
      } else {
        if (options.transparentBackground) {
          outR = outG = outB = 0;
          outAlpha = 0;
        } else {
          const dim = componentValueToByte(L / 100 * 255 * 0.16);
          outR = outG = outB = dim;
        }
      }
    } else {
      outR = r;
      outG = g;
      outB = b;
    }

    output[i] = componentValueToByte(outR);
    output[i + 1] = componentValueToByte(outG);
    output[i + 2] = componentValueToByte(outB);
    output[i + 3] = outAlpha;
  }
  return output;
}
