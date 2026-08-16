import { labToRgb, rgbToLab } from './color-space.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = value => clamp(value, 0, 1);
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const HUE_NAMES = [
  ['红', 0], ['橙', 30], ['黄', 60], ['黄绿', 95], ['绿', 135], ['青', 185],
  ['蓝', 235], ['靛蓝', 270], ['紫', 300], ['洋红', 330]
];

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

function nearestHueName(hue) {
  return HUE_NAMES.reduce((best, item) => (
    hueDistance(hue, item[1]) < hueDistance(hue, best[1]) ? item : best
  ), HUE_NAMES[0])[0];
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function createAccumulator() {
  return { count: 0, sumL: 0, sumA: 0, sumB: 0, sumC: 0, sumSin: 0, sumCos: 0 };
}

function addSample(accumulator, L, a, b, C, hue) {
  accumulator.count++;
  accumulator.sumL += L;
  accumulator.sumA += a;
  accumulator.sumB += b;
  accumulator.sumC += C;
  const radians = hue * Math.PI / 180;
  accumulator.sumSin += Math.sin(radians);
  accumulator.sumCos += Math.cos(radians);
}

function finishAccumulator(accumulator, sampleCount) {
  if (!accumulator.count) {
    return {
      count: 0,
      coverage: 0,
      meanL: 0,
      meanA: 0,
      meanB: 0,
      meanC: 0,
      meanHue: 0
    };
  }
  return {
    count: accumulator.count,
    coverage: accumulator.count / sampleCount,
    meanL: accumulator.sumL / accumulator.count,
    meanA: accumulator.sumA / accumulator.count,
    meanB: accumulator.sumB / accumulator.count,
    meanC: accumulator.sumC / accumulator.count,
    meanHue: (Math.atan2(accumulator.sumSin, accumulator.sumCos) * 180 / Math.PI + 360) % 360
  };
}

function analyzeRecipeProfile(pixels, maxSamples = 36000) {
  if (!pixels?.length) throw new Error('Reference Recipe 需要有效像素');
  const pixelCount = pixels.length >> 2;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const lightness = [];
  const neutral = createAccumulator();
  const global = createAccumulator();
  const hueBins = Array.from({ length: 36 }, createAccumulator);
  const toneBands = {
    shadows: createAccumulator(),
    midtones: createAccumulator(),
    highlights: createAccumulator()
  };
  let count = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4;
    if (pixels[i + 3] < 128) continue;
    const [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const C = Math.hypot(a, b);
    const hue = hueFromLab(a, b);
    lightness.push(L);
    addSample(global, L, a, b, C, hue);
    if (C <= 11 && L > 7 && L < 93) addSample(neutral, L, a, b, C, hue);
    if (C > 7) addSample(hueBins[Math.floor(hue / 10) % 36], L, a, b, C, hue);
    const band = L < 34 ? toneBands.shadows : L < 67 ? toneBands.midtones : toneBands.highlights;
    addSample(band, L, a, b, C, hue);
    count++;
  }

  lightness.sort((a, b) => a - b);
  return {
    sampleCount: count,
    quantiles: [0.05, 0.25, 0.5, 0.75, 0.95].map(ratio => percentile(lightness, ratio)),
    neutral: finishAccumulator(neutral, count),
    global: finishAccumulator(global, count),
    hueBins: hueBins.map(bin => finishAccumulator(bin, count)),
    toneBands: Object.fromEntries(
      Object.entries(toneBands).map(([key, value]) => [key, finishAccumulator(value, count)])
    )
  };
}

function enforceMonotonicPoints(points) {
  const filtered = [];
  for (const point of points.sort((a, b) => a.input - b.input)) {
    const previous = filtered[filtered.length - 1];
    if (previous && point.input - previous.input < 1.25) {
      previous.output = Math.max(previous.output, point.output);
      previous.percentile = point.percentile ?? previous.percentile;
      continue;
    }
    filtered.push({ ...point });
  }
  for (let index = 1; index < filtered.length; index++) {
    filtered[index].output = Math.max(filtered[index - 1].output, filtered[index].output);
  }
  return filtered.map(point => ({
    ...point,
    input: round(clamp(point.input, 0, 100), 1),
    output: round(clamp(point.output, 0, 100), 1)
  }));
}

export function buildToneCurve(sourceProfile, referenceProfile) {
  const ratios = [0.05, 0.25, 0.5, 0.75, 0.95];
  const points = [{ input: 0, output: 0, percentile: 0 }];
  ratios.forEach((ratio, index) => {
    const input = sourceProfile.quantiles[index];
    const desired = referenceProfile.quantiles[index];
    const limited = input + clamp(desired - input, -18, 18);
    points.push({ input, output: limited, percentile: ratio });
  });
  points.push({ input: 100, output: 100, percentile: 1 });
  return enforceMonotonicPoints(points);
}

function interpolateCurve(points, value) {
  if (value <= points[0].input) return points[0].output;
  for (let index = 1; index < points.length; index++) {
    const right = points[index];
    if (value <= right.input) {
      const left = points[index - 1];
      const ratio = (value - left.input) / Math.max(0.001, right.input - left.input);
      return left.output + (right.output - left.output) * ratio;
    }
  }
  return points[points.length - 1].output;
}

function choosePeakBins(profile, limit = 4) {
  const candidates = profile.hueBins
    .map((bin, index) => ({ ...bin, center: index * 10 + 5 }))
    .filter(bin => bin.coverage >= 0.012 && bin.meanC >= 8)
    .sort((a, b) => b.coverage - a.coverage);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(item => hueDistance(item.meanHue, candidate.meanHue) >= 35)) {
      selected.push(candidate);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function findSourceColor(sourceProfile, referencePeak) {
  return sourceProfile.hueBins
    .filter(bin => bin.count && hueDistance(bin.meanHue, referencePeak.meanHue) <= 52)
    .sort((a, b) => {
      const aScore = a.coverage / (1 + hueDistance(a.meanHue, referencePeak.meanHue) / 18);
      const bScore = b.coverage / (1 + hueDistance(b.meanHue, referencePeak.meanHue) / 18);
      return bScore - aScore;
    })[0] || null;
}

function buildPointColors(sourceProfile, referenceProfile) {
  const peaks = choosePeakBins(referenceProfile);
  const points = [];
  peaks.forEach((referencePeak, index) => {
    const sourceColor = findSourceColor(sourceProfile, referencePeak);
    if (!sourceColor || sourceColor.coverage < 0.006) return;
    const hueShift = clamp(signedHueDelta(sourceColor.meanHue, referencePeak.meanHue), -18, 18);
    const chromaScale = clamp(referencePeak.meanC / Math.max(5, sourceColor.meanC), 0.72, 1.32);
    const lightnessShift = clamp(referencePeak.meanL - sourceColor.meanL, -8, 8);
    const centerHue = sourceColor.meanHue;
    points.push({
      id: `point-color-${index + 1}-${Math.round(centerHue)}`,
      label: `${nearestHueName(centerHue)}色范围`,
      centerHue: round(centerHue, 1),
      targetHue: round((centerHue + hueShift + 360) % 360, 1),
      hueRange: 34,
      feather: 0.42,
      chromaRange: [7, round(Math.max(42, sourceColor.meanC * 2.1), 1)],
      lightnessRange: [clamp(round(sourceColor.meanL - 35, 1), 0, 100), clamp(round(sourceColor.meanL + 35, 1), 0, 100)],
      hueShift: round(hueShift, 1),
      saturationScale: round(chromaScale, 3),
      lightnessShift: round(lightnessShift, 1),
      affectedPixelRatio: round(sourceColor.coverage, 4),
      referencePixelRatio: round(referencePeak.coverage, 4)
    });
  });
  return points;
}

function buildWhiteBalance(sourceProfile, referenceProfile) {
  const sourceNeutral = sourceProfile.neutral.coverage >= 0.008 ? sourceProfile.neutral : sourceProfile.global;
  const referenceNeutral = referenceProfile.neutral.coverage >= 0.008 ? referenceProfile.neutral : referenceProfile.global;
  const confidence = clamp01(Math.min(sourceProfile.neutral.coverage, referenceProfile.neutral.coverage) / 0.08);
  return {
    deltaA: round(clamp(referenceNeutral.meanA - sourceNeutral.meanA, -6, 6), 2),
    deltaB: round(clamp(referenceNeutral.meanB - sourceNeutral.meanB, -6, 6), 2),
    confidence: round(confidence, 3),
    neutralCoverage: round(sourceProfile.neutral.coverage, 4)
  };
}

function buildColorGrading(sourceProfile, referenceProfile, whiteBalance) {
  const labels = { shadows: '阴影', midtones: '中间调', highlights: '高光' };
  return Object.entries(labels).map(([id, label]) => {
    const source = sourceProfile.toneBands[id];
    const reference = referenceProfile.toneBands[id];
    const shiftA = clamp(reference.meanA - source.meanA - whiteBalance.deltaA * 0.45, -4.5, 4.5);
    const shiftB = clamp(reference.meanB - source.meanB - whiteBalance.deltaB * 0.45, -4.5, 4.5);
    const amount = Math.hypot(shiftA, shiftB);
    return {
      id: `grading-${id}`,
      band: id,
      label: `${label}色轮`,
      shiftA: round(shiftA, 2),
      shiftB: round(shiftB, 2),
      hue: round(hueFromLab(shiftA, shiftB), 1),
      saturation: round(amount, 2),
      luminanceShift: round(clamp(reference.meanL - source.meanL, -3, 3), 2),
      affectedPixelRatio: round(source.coverage, 4)
    };
  });
}

function describeDirection(deltaA, deltaB) {
  if (Math.hypot(deltaA, deltaB) < 0.45) return '保持中性';
  const parts = [];
  if (Math.abs(deltaA) >= 0.35) parts.push(deltaA > 0 ? '洋红' : '绿色');
  if (Math.abs(deltaB) >= 0.35) parts.push(deltaB > 0 ? '暖黄' : '冷蓝');
  return `向${parts.join('、')}移动`;
}

function buildLayers(recipe) {
  const layers = [
    {
      id: 'white-balance',
      kind: 'white-balance',
      label: '白平衡',
      enabled: true,
      amount: round(Math.hypot(recipe.whiteBalance.deltaA, recipe.whiteBalance.deltaB), 1),
      unit: 'Δab',
      affected: '全局 · 以中性色为锚点',
      explanation: `中性色${describeDirection(recipe.whiteBalance.deltaA, recipe.whiteBalance.deltaB)}；置信度 ${Math.round(recipe.whiteBalance.confidence * 100)}%。`
    },
    {
      id: 'tone-curve',
      kind: 'tone-curve',
      label: '参考色调曲线',
      enabled: true,
      amount: round(recipe.toneCurve.reduce((sum, point) => sum + Math.abs(point.output - point.input), 0) / recipe.toneCurve.length, 1),
      unit: 'L*',
      affected: '黑位 · 阴影 · 中间调 · 高光 · 白位',
      explanation: `使用 ${recipe.toneCurve.length} 个单调控制点匹配参考明度分布，并限制单点最大位移。`
    },
    {
      id: 'protection',
      kind: 'protection',
      label: '保护区域',
      enabled: true,
      amount: Math.round(recipe.protection.neutral * 100),
      unit: '%',
      affected: '中性色 · 肤色 · 极端高光/暗部',
      explanation: '降低选择性色偏和分区着色对敏感区域的影响；不阻断必要的明度匹配。'
    }
  ];
  recipe.pointColors.forEach(point => layers.push({
    id: point.id,
    kind: 'point-color',
    label: point.label,
    enabled: true,
    amount: point.hueShift,
    unit: '°',
    affected: `${Math.round(point.affectedPixelRatio * 100)}% 画面 · 范围 ±${point.hueRange}°`,
    explanation: `色相${point.hueShift >= 0 ? '顺时针' : '逆时针'} ${Math.abs(point.hueShift)}°，彩度 ×${point.saturationScale.toFixed(2)}，明度 ${point.lightnessShift >= 0 ? '+' : ''}${point.lightnessShift} L*。`
  }));
  recipe.colorGrading.forEach(grade => layers.push({
    id: grade.id,
    kind: 'color-grading',
    label: grade.label,
    enabled: true,
    amount: grade.saturation,
    unit: 'Δab',
    affected: `${Math.round(grade.affectedPixelRatio * 100)}% ${grade.band}`,
    explanation: `${describeDirection(grade.shiftA, grade.shiftB)}，明度 ${grade.luminanceShift >= 0 ? '+' : ''}${grade.luminanceShift} L*。`
  }));
  return layers;
}

export function buildReferenceRecipe(sourcePixels, referencePixels, options = {}) {
  const sourceProfile = analyzeRecipeProfile(sourcePixels, options.maxSamples);
  const referenceProfile = analyzeRecipeProfile(referencePixels, options.maxSamples);
  const whiteBalance = buildWhiteBalance(sourceProfile, referenceProfile);
  const recipe = {
    schemaVersion: 2,
    engine: 'reference-recipe-v2',
    colorSpace: 'sRGB / CIELAB D65',
    intensity: clamp01(options.intensity ?? 1),
    whiteBalance,
    toneCurve: buildToneCurve(sourceProfile, referenceProfile),
    pointColors: buildPointColors(sourceProfile, referenceProfile),
    colorGrading: buildColorGrading(sourceProfile, referenceProfile, whiteBalance),
    gradingMix: {
      blending: 50,
      balance: round(clamp((referenceProfile.quantiles[2] - sourceProfile.quantiles[2]) * 1.5, -30, 30), 1)
    },
    protection: {
      neutral: 0.82,
      skin: 0.68,
      highlights: 0.72,
      shadows: 0.58
    },
    sourceSummary: {
      medianLightness: round(sourceProfile.quantiles[2], 1),
      neutralCoverage: round(sourceProfile.neutral.coverage, 4)
    },
    referenceSummary: {
      medianLightness: round(referenceProfile.quantiles[2], 1),
      neutralCoverage: round(referenceProfile.neutral.coverage, 4)
    }
  };
  recipe.layers = buildLayers(recipe);
  const disabledLayerIds = new Set(options.disabledLayerIds || []);
  recipe.layers.forEach(layer => {
    layer.enabled = !disabledLayerIds.has(layer.id);
  });
  return recipe;
}

function layerEnabled(recipe, layerId, options) {
  if (options.enabledLayerIds) return options.enabledLayerIds.has(layerId);
  if (options.disabledLayerIds?.has(layerId)) return false;
  return recipe.layers?.find(layer => layer.id === layerId)?.enabled !== false;
}

function pointColorWeight(L, C, hue, point) {
  const hueRatio = hueDistance(hue, point.centerHue) / Math.max(1, point.hueRange);
  if (hueRatio >= 1) return 0;
  const hueWeight = 1 - smoothstep(Math.max(0, 1 - point.feather), 1, hueRatio);
  const [minC, maxC] = point.chromaRange;
  const [minL, maxL] = point.lightnessRange;
  const chromaWeight = smoothstep(minC * 0.55, minC, C) * (1 - smoothstep(maxC, maxC * 1.18 + 1, C));
  const lightnessWeight = smoothstep(Math.max(0, minL - 10), minL, L) * (1 - smoothstep(maxL, Math.min(100, maxL + 10), L));
  return clamp01(hueWeight * chromaWeight * lightnessWeight);
}

function protectionAttenuation(L, C, hue, protection) {
  const neutralMask = (1 - smoothstep(4, 13, C)) * protection.neutral;
  const highlightMask = smoothstep(88, 98, L) * protection.highlights;
  const shadowMask = (1 - smoothstep(3, 13, L)) * protection.shadows;
  const skinHue = hueDistance(hue, 48);
  const skinMask = (1 - smoothstep(22, 48, skinHue)) * smoothstep(7, 16, C) *
    (1 - smoothstep(50, 72, C)) * smoothstep(18, 34, L) * (1 - smoothstep(84, 97, L)) * protection.skin;
  return 1 - clamp(Math.max(neutralMask, highlightMask, shadowMask, skinMask), 0, 0.92);
}

function tonalBandWeights(L, balance = 0) {
  const shift = balance / 100 * 14;
  const shadow = 1 - smoothstep(20 + shift, 52 + shift, L);
  const highlight = smoothstep(50 + shift, 82 + shift, L);
  return {
    shadows: clamp01(shadow),
    highlights: clamp01(highlight),
    midtones: clamp01(1 - shadow - highlight)
  };
}

export function applyReferenceRecipe(pixels, recipe, options = {}) {
  if (!pixels?.length || !recipe) throw new Error('应用 Reference Recipe 需要有效像素和处方');
  const output = new Uint8ClampedArray(pixels.length);
  const intensity = clamp01(options.intensity ?? recipe.intensity ?? 1);
  const enabledLayerIds = options.enabledLayerIds
    ? new Set(options.enabledLayerIds)
    : null;
  const disabledLayerIds = options.disabledLayerIds
    ? new Set(options.disabledLayerIds)
    : null;
  const state = { enabledLayerIds, disabledLayerIds };
  const useWhiteBalance = layerEnabled(recipe, 'white-balance', state);
  const useToneCurve = layerEnabled(recipe, 'tone-curve', state);
  const useProtection = layerEnabled(recipe, 'protection', state);

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 1) {
      output.set(pixels.subarray(i, i + 4), i);
      continue;
    }
    let [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);

    if (useWhiteBalance) {
      a += recipe.whiteBalance.deltaA * intensity;
      b += recipe.whiteBalance.deltaB * intensity;
    }
    if (useToneCurve) {
      const mapped = interpolateCurve(recipe.toneCurve, L);
      L += (mapped - L) * intensity;
    }

    let C = Math.hypot(a, b);
    let hue = hueFromLab(a, b);
    const attenuation = useProtection ? protectionAttenuation(L, C, hue, recipe.protection) : 1;
    let hueDelta = 0;
    let chromaDelta = 0;
    let lightnessDelta = 0;
    let totalWeight = 0;
    for (const point of recipe.pointColors) {
      if (!layerEnabled(recipe, point.id, state)) continue;
      const weight = pointColorWeight(L, C, hue, point) * attenuation;
      if (!weight) continue;
      hueDelta += point.hueShift * weight;
      chromaDelta += C * (point.saturationScale - 1) * weight;
      lightnessDelta += point.lightnessShift * weight;
      totalWeight += weight;
    }
    if (totalWeight > 0) {
      const normalization = Math.max(1, totalWeight);
      hue += hueDelta / normalization * intensity;
      C = Math.max(0, C + chromaDelta / normalization * intensity);
      L = clamp(L + lightnessDelta / normalization * intensity, 0, 100);
      const radians = hue * Math.PI / 180;
      a = Math.cos(radians) * C;
      b = Math.sin(radians) * C;
    }

    const bandWeights = tonalBandWeights(L, recipe.gradingMix.balance);
    for (const grade of recipe.colorGrading) {
      if (!layerEnabled(recipe, grade.id, state)) continue;
      const weight = bandWeights[grade.band] * attenuation * intensity;
      a += grade.shiftA * weight;
      b += grade.shiftB * weight;
      L = clamp(L + grade.luminanceShift * weight, 0, 100);
    }

    const [r, g, blue] = labToRgb(L, a, b);
    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = blue;
    output[i + 3] = alpha;
  }
  return output;
}

export function renderReferenceRecipe(sourcePixels, referencePixels, options = {}) {
  const recipe = buildReferenceRecipe(sourcePixels, referencePixels, options);
  return {
    resultPixels: applyReferenceRecipe(sourcePixels, recipe, {
      intensity: recipe.intensity,
      disabledLayerIds: options.disabledLayerIds
    }),
    recipe
  };
}

export function createPointColorMaskPixels(pixels, point, options = {}) {
  if (!pixels?.length || !point) throw new Error('Point Color 范围图需要有效像素与参数');
  const output = new Uint8ClampedArray(pixels.length);
  const centerHue = options.target === 'reference'
    ? point.targetHue
    : options.target === 'result'
      ? (point.centerHue + point.hueShift + 360) % 360
      : point.centerHue;
  const maskPoint = { ...point, centerHue };
  for (let i = 0; i < pixels.length; i += 4) {
    const [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const C = Math.hypot(a, b);
    const hue = hueFromLab(a, b);
    const weight = pointColorWeight(L, C, hue, maskPoint);
    if (options.transparentBackground) {
      output[i] = 221;
      output[i + 1] = 166;
      output[i + 2] = 73;
      output[i + 3] = Math.round(weight * 215);
    } else if (weight > 0.08) {
      output[i] = pixels[i];
      output[i + 1] = pixels[i + 1];
      output[i + 2] = pixels[i + 2];
      output[i + 3] = pixels[i + 3];
    } else {
      const dim = Math.round(L / 100 * 38);
      output[i] = dim;
      output[i + 1] = dim;
      output[i + 2] = dim;
      output[i + 3] = pixels[i + 3];
    }
  }
  return output;
}

