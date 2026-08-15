import { transferColor } from '../color-transfer/histogram-transfer.js';
import { generateLut } from '../color-transfer/lut-generator.js';
import { applyLut } from '../color-transfer/lut-applier.js';
import { generateNeuralPresetLut } from '../color-transfer/neural-preset-transfer.js';

export const ENGINE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'histogram',
    label: '参考还原',
    detail: '优先贴近参考图的整体色彩分布',
    exportable: false
  }),
  Object.freeze({
    id: 'lut',
    label: '平衡电影感',
    detail: '在参考氛围与原片层次之间取得平衡',
    exportable: true
  }),
  Object.freeze({
    id: 'neural-preset',
    label: '自然色彩关系',
    detail: '保留综合色彩关系与通道之间的联动',
    exportable: true
  })
]);

export function getEngineDefinition(engineId) {
  return ENGINE_DEFINITIONS.find(engine => engine.id === engineId) || null;
}

export function blendPixels(sourcePixels, resultPixels, intensity) {
  if (intensity >= 1) return resultPixels;
  if (intensity <= 0) return new Uint8ClampedArray(sourcePixels);

  const output = new Uint8ClampedArray(sourcePixels.length);
  const originalWeight = 1 - intensity;
  for (let i = 0; i < sourcePixels.length; i += 4) {
    output[i] = Math.round(sourcePixels[i] * originalWeight + resultPixels[i] * intensity);
    output[i + 1] = Math.round(sourcePixels[i + 1] * originalWeight + resultPixels[i + 1] * intensity);
    output[i + 2] = Math.round(sourcePixels[i + 2] * originalWeight + resultPixels[i + 2] * intensity);
    output[i + 3] = sourcePixels[i + 3];
  }
  return output;
}

function createIdentityLut(size = 33) {
  const lut = new Float64Array(3 * size * size * size);
  let index = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lut[index++] = r / (size - 1);
        lut[index++] = g / (size - 1);
        lut[index++] = b / (size - 1);
      }
    }
  }
  return lut;
}

/**
 * Run any Color Muse transfer engine through one stable interface.
 */
export function runEngine({
  engineId,
  sourcePixels,
  referencePixels,
  intensity = 1,
  includeLut = true
}) {
  if (!getEngineDefinition(engineId)) {
    throw new Error(`未知仿色方案: ${engineId}`);
  }
  if (!sourcePixels?.length || !referencePixels?.length) {
    throw new Error('原图或参考图像素无效');
  }

  const safeIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
  if (safeIntensity === 0) {
    const engine = getEngineDefinition(engineId);
    return {
      resultPixels: new Uint8ClampedArray(sourcePixels),
      lut: includeLut && engine.exportable ? createIdentityLut() : null
    };
  }

  if (engineId === 'histogram') {
    return {
      resultPixels: transferColor(sourcePixels, referencePixels, safeIntensity),
      lut: null
    };
  }

  if (engineId === 'lut') {
    const lut = generateLut(referencePixels, 33, safeIntensity, sourcePixels);
    return {
      resultPixels: applyLut(sourcePixels, lut),
      lut: includeLut ? lut : null
    };
  }

  const lut = generateNeuralPresetLut(referencePixels, 33, 1, sourcePixels);
  const transferredPixels = applyLut(sourcePixels, lut);
  return {
    resultPixels: blendPixels(sourcePixels, transferredPixels, safeIntensity),
    lut: includeLut ? lut : null
  };
}
