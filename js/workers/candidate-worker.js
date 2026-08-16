import { runEngine } from '../core/engine-registry.js';
import { assessQuality } from '../analysis/quality-metrics.js';

self.onmessage = event => {
  const {
    jobId,
    engineId,
    sourceBuffer,
    referenceBuffer,
    sourceWidth,
    sourceHeight,
    intensity,
    intensities,
    includeLut,
    calculateMetrics,
    sceneProfile,
    recipeOptions
  } = event.data;

  try {
    const sourcePixels = new Uint8ClampedArray(sourceBuffer);
    const referencePixels = new Uint8ClampedArray(referenceBuffer);
    if (intensities?.length) {
      const variants = intensities.map(variantIntensity => {
        const { resultPixels } = runEngine({
          engineId,
          sourcePixels,
          referencePixels,
          intensity: variantIntensity,
          includeLut: false
        });
        return {
          intensity: variantIntensity,
          resultPixels,
          assessment: assessQuality(sourcePixels, resultPixels, referencePixels, {
            width: sourceWidth,
            height: sourceHeight,
            sceneProfile
          })
        };
      });
      self.postMessage({
        jobId,
        engineId,
        variants: variants.map(variant => ({
          intensity: variant.intensity,
          resultBuffer: variant.resultPixels.buffer,
          assessment: variant.assessment
        }))
      }, variants.map(variant => variant.resultPixels.buffer));
      return;
    }

    const { resultPixels, lut, recipe } = runEngine({
      engineId,
      sourcePixels,
      referencePixels,
      intensity,
      includeLut,
      recipeOptions
    });
    const assessment = calculateMetrics
      ? assessQuality(sourcePixels, resultPixels, referencePixels, {
        width: sourceWidth,
        height: sourceHeight,
        sceneProfile
      })
      : null;
    const transferables = [resultPixels.buffer];
    if (lut) transferables.push(lut.buffer);

    self.postMessage({
      jobId,
      engineId,
      resultBuffer: resultPixels.buffer,
      lutBuffer: lut ? lut.buffer : null,
      recipe: recipe || null,
      assessment
    }, transferables);
  } catch (error) {
    self.postMessage({
      jobId,
      engineId,
      error: error?.message || String(error)
    });
  }
};
