import { EventBus } from './main.js';
import { getResultPixels, getResultDimensions, getLastReferenceData, getLastIntensity, getCurrentLut, getSelectedEngineId, getAnalysisReport } from './preview.js';
import { lutToCubeString } from './color-transfer/cube-writer.js';
import { showToast } from './toast.js';
import { getCurrentImageName } from './canvas-workspace.js';
import { cancelFullRender, renderFullCandidate } from './core/candidate-pipeline.js';
import { getColorAnatomyReport } from './ui/color-anatomy.js';

let batchCounter = 0;
let batchRunning = false;
let batchCancelRequested = false;

export function initDownload() {
  EventBus.on('transfer-complete', () => {
    const btn = document.getElementById('btn-download');
    if (btn) btn.disabled = false;
    const batchBtn = document.getElementById('btn-batch');
    if (batchBtn) batchBtn.disabled = false;
    updateExportAvailability();
  });

  EventBus.on('result-invalidated', () => {
    const btn = document.getElementById('btn-download');
    if (btn) btn.disabled = true;
    const batchBtn = document.getElementById('btn-batch');
    if (batchBtn) batchBtn.disabled = !batchRunning;
    updateExportAvailability();
  });

  initDownloadDropdown();

  const batchBtn = document.getElementById('btn-batch');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => {
      if (batchRunning) {
        batchCancelRequested = true;
        cancelFullRender();
        updateStatus('正在取消批量任务…');
        return;
      }
      EventBus.emit('batch-requested');
    });
  }

  EventBus.on('batch-start', handleBatchStart);
}

function initDownloadDropdown() {
  const dropdown = document.getElementById('download-dropdown');
  const btn = document.getElementById('btn-download');
  const menu = document.getElementById('download-menu');
  if (!dropdown || !btn || !menu) return;

  // Toggle dropdown on button click
  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Handle menu item clicks
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.download-menu-item');
    if (!item || item.disabled) return;

    const action = item.dataset.action;
    dropdown.classList.remove('open');

    switch (action) {
      case 'download-jpg':
        downloadImage('jpeg');
        break;
      case 'download-png':
        downloadImage('png');
        break;
      case 'download-cube':
        downloadCubeLut();
        break;
      case 'download-lr':
        downloadLightroomPreset();
        break;
      case 'download-report':
        downloadAnalysisReport();
        break;
      case 'download-recipe':
        downloadColorRecipe();
        break;
    }
  });
}

function updateExportAvailability() {
  const hasLut = !!getCurrentLut();
  document.querySelectorAll('[data-requires-lut]').forEach(item => {
    item.disabled = !hasLut;
    item.title = hasLut ? '' : '当前方案不生成可复用 LUT';
  });
}

function safeBaseName(name) {
  return (name || 'colormuse')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'colormuse';
}

function downloadImage(format) {
  const pixels = getResultPixels();
  const dims = getResultDimensions();
  if (!pixels || !dims.width || !dims.height) {
    showToast('没有可下载的结果');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(pixels), dims.width, dims.height);
  ctx.putImageData(imageData, 0, 0);

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const quality = format === 'png' ? undefined : 0.95;

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('下载失败');
      return;
    }
    triggerDownload(blob, `${safeBaseName(getCurrentImageName())}_${getSelectedEngineId() || 'result'}_${Math.round(getLastIntensity() * 100)}.${ext}`);
    showToast(`已下载 ${ext.toUpperCase()} 图片`);
  }, mimeType, quality);
}

function downloadCubeLut() {
  const lut = getCurrentLut();
  if (!lut) {
    showToast('当前方案是像素级仿色，请选择带 LUT 标记的方案');
    return;
  }
  const content = lutToCubeString(lut, 33);
  const blob = new Blob([content], { type: 'text/plain' });
  triggerDownload(blob, `${safeBaseName(getCurrentImageName())}_${getSelectedEngineId() || 'lut'}_${Math.round(getLastIntensity() * 100)}.cube`);
  showToast('已下载 .CUBE LUT 文件');
}

function downloadLightroomPreset() {
  const lut = getCurrentLut();
  if (!lut) {
    showToast('当前方案是像素级仿色，请选择带 LUT 标记的方案');
    return;
  }

  const xmp = generateLrXmp(lut, 33);
  const blob = new Blob([xmp], { type: 'application/xml' });
  triggerDownload(blob, `${safeBaseName(getCurrentImageName())}_${getSelectedEngineId() || 'preset'}_${Math.round(getLastIntensity() * 100)}.xmp`);
  showToast('已下载近似 Lightroom 预设 (.xmp)');
}

function downloadAnalysisReport() {
  const report = getAnalysisReport();
  if (!report) {
    showToast('当前还没有可导出的审色报告');
    return;
  }
  const serializable = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    sourceName: getCurrentImageName(),
    sceneProfile: report.sceneProfile,
    recommendation: report.recommendation,
    candidates: report.candidates.map(({ pixels, ...candidate }) => candidate),
    failures: report.failures,
    timings: report.timings,
    selection: report.selection,
    colorDNA: getColorAnatomyReport()
  };
  const blob = new Blob([JSON.stringify(serializable, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeBaseName(getCurrentImageName())}_color-audit.json`);
  showToast('已下载审色报告');
}

function downloadColorRecipe() {
  const anatomy = getColorAnatomyReport();
  if (!anatomy?.comparison?.recipe?.length) {
    showToast('当前还没有可导出的 Color Recipe');
    return;
  }
  const recipe = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceName: getCurrentImageName(),
    colorSpace: anatomy.colorSpace,
    engineId: getSelectedEngineId(),
    intensity: getLastIntensity(),
    referenceDNA: anatomy.reference,
    targetDNA: anatomy.result,
    referenceFitGain: anatomy.comparison.referenceFitGain,
    layers: anatomy.comparison.recipe,
    explanations: anatomy.comparison.explanations
  };
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeBaseName(getCurrentImageName())}_color-recipe.json`);
  showToast('已下载 Color Recipe');
}

/**
 * Generate a Lightroom-compatible XMP preset from a 3D LUT.
 * Uses the ToneCurve and color adjustments to approximate the LUT effect.
 */
export function generateLrXmp(lut, size) {
  // Sample the LUT at key points to extract tone curve and color grading info
  const samples = sampleLutForLr(lut, size);

  const presetUuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replaceAll('-', '').toUpperCase()
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32).toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:PresetType="Normal"
    crs:Cluster=""
    crs:UUID="${presetUuid}"
    crs:SupportsAmount="False"
    crs:SupportsColor="True"
    crs:SupportsMonochrome="True"
    crs:SupportsHighDynamicRange="True"
    crs:SupportsNormalDynamicRange="True"
    crs:SupportsSceneReferred="True"
    crs:SupportsOutputReferred="True"
    crs:CameraModelRestriction=""
    crs:Copyright=""
    crs:ContactInfo=""
    crs:Version="15.4"
    crs:ProcessVersion="11.0"
    crs:WhiteBalance="As Shot"
    crs:Temperature="0"
    crs:Tint="0"
    crs:Exposure2="0.00"
    crs:Contrast2012="0"
    crs:Highlights2012="${samples.highlights}"
    crs:Shadows2012="${samples.shadows}"
    crs:Whites2012="${samples.whites}"
    crs:Blacks2012="${samples.blacks}"
    crs:Texture="0"
    crs:Clarity2012="0"
    crs:Dehaze="0"
    crs:Vibrance="${samples.vibrance}"
    crs:Saturation="${samples.saturation}"
    crs:ParametricShadows="0"
    crs:ParametricDarks="0"
    crs:ParametricLights="0"
    crs:ParametricHighlights="0"
    crs:ParametricShadowSplit="25"
    crs:ParametricMidtoneSplit="50"
    crs:ParametricHighlightSplit="75"
    crs:Sharpness="25"
    crs:SharpenRadius="+1.0"
    crs:SharpenDetail="25"
    crs:SharpenEdgeMasking="60"
    crs:LuminanceSmoothing="0"
    crs:ColorNoiseReduction="25"
    crs:HueAdjustmentRed="${samples.hueRed}"
    crs:HueAdjustmentOrange="${samples.hueOrange}"
    crs:HueAdjustmentYellow="${samples.hueYellow}"
    crs:HueAdjustmentGreen="${samples.hueGreen}"
    crs:HueAdjustmentAqua="${samples.hueAqua}"
    crs:HueAdjustmentBlue="${samples.hueBlue}"
    crs:HueAdjustmentPurple="${samples.huePurple}"
    crs:HueAdjustmentMagenta="${samples.hueMagenta}"
    crs:SaturationAdjustmentRed="${samples.satRed}"
    crs:SaturationAdjustmentOrange="${samples.satOrange}"
    crs:SaturationAdjustmentYellow="${samples.satYellow}"
    crs:SaturationAdjustmentGreen="${samples.satGreen}"
    crs:SaturationAdjustmentAqua="${samples.satAqua}"
    crs:SaturationAdjustmentBlue="${samples.satBlue}"
    crs:SaturationAdjustmentPurple="${samples.satPurple}"
    crs:SaturationAdjustmentMagenta="${samples.satMagenta}"
    crs:LuminanceAdjustmentRed="${samples.lumRed}"
    crs:LuminanceAdjustmentOrange="${samples.lumOrange}"
    crs:LuminanceAdjustmentYellow="${samples.lumYellow}"
    crs:LuminanceAdjustmentGreen="${samples.lumGreen}"
    crs:LuminanceAdjustmentAqua="${samples.lumAqua}"
    crs:LuminanceAdjustmentBlue="${samples.lumBlue}"
    crs:LuminanceAdjustmentPurple="${samples.lumPurple}"
    crs:LuminanceAdjustmentMagenta="${samples.lumMagenta}"
    crs:SplitToningShadowHue="0"
    crs:SplitToningShadowSaturation="0"
    crs:SplitToningHighlightHue="0"
    crs:SplitToningHighlightSaturation="0"
    crs:SplitToningBalance="0"
    crs:ColorGradeMidtoneHue="${samples.gradeMidHue}"
    crs:ColorGradeMidtoneSat="${samples.gradeMidSat}"
    crs:ColorGradeMidtoneLum="0"
    crs:ColorGradeShadowLum="0"
    crs:ColorGradeHighlightLum="0"
    crs:ColorGradeBlending="50"
    crs:ColorGradeGlobalHue="${samples.gradeGlobalHue}"
    crs:ColorGradeGlobalSat="${samples.gradeGlobalSat}"
    crs:ColorGradeGlobalLum="0"
    crs:GrainAmount="0"
    crs:GrainSize="25"
    crs:GrainFrequency="50"
    crs:VignetteAmount="0"
    crs:VignetteMidpoint="50"
    crs:VignetteRoundness="0"
    crs:VignetteFeather="25"
    crs:VignetteHighlightContrast="0"
    crs:ShadowTint="0"
    crs:RedHue="0"
    crs:RedSaturation="0"
    crs:GreenHue="0"
    crs:GreenSaturation="0"
    crs:BlueHue="0"
    crs:BlueSaturation="0"
    crs:OverrideLookVignette="True"
    crs:ToneCurveName2012="Custom"
    crs:HasSettings="True">
    <crs:Name>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">Color Muse Preset</rdf:li>
     </rdf:Alt>
    </crs:Name>
    <crs:ShortName>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">ColorMuse</rdf:li>
     </rdf:Alt>
    </crs:ShortName>
    <crs:Group>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">Color Muse</rdf:li>
     </rdf:Alt>
    </crs:Group>
    <crs:Description>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">Generated by Color Muse</rdf:li>
     </rdf:Alt>
    </crs:Description>
    <crs:ToneCurvePV2012>
     <rdf:Seq>
${samples.toneCurve.map(p => `      <rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('\n')}
     </rdf:Seq>
    </crs:ToneCurvePV2012>
    <crs:ToneCurvePV2012Red>
     <rdf:Seq>
${samples.toneCurveRed.map(p => `      <rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('\n')}
     </rdf:Seq>
    </crs:ToneCurvePV2012Red>
    <crs:ToneCurvePV2012Green>
     <rdf:Seq>
${samples.toneCurveGreen.map(p => `      <rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('\n')}
     </rdf:Seq>
    </crs:ToneCurvePV2012Green>
    <crs:ToneCurvePV2012Blue>
     <rdf:Seq>
${samples.toneCurveBlue.map(p => `      <rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('\n')}
     </rdf:Seq>
    </crs:ToneCurvePV2012Blue>
   </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}

/**
 * Sample the 3D LUT to extract Lightroom-compatible adjustments.
 */
export function sampleLutForLr(lut, size) {
  const clampAdjustment = value => Math.max(-100, Math.min(100, Math.round(value)));

  // Helper: lookup LUT value for normalized RGB [0,1]
  function lutLookup(r, g, b) {
    const ri = Math.min(size - 1, Math.max(0, Math.round(r * (size - 1))));
    const gi = Math.min(size - 1, Math.max(0, Math.round(g * (size - 1))));
    const bi = Math.min(size - 1, Math.max(0, Math.round(b * (size - 1))));
    const idx = (bi * size * size + gi * size + ri) * 3;
    return [lut[idx], lut[idx + 1], lut[idx + 2]];
  }

  // Helper: sRGB to linear
  function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  // Helper: luminance from linear RGB
  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Helper: RGB to HSL
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s, l];
  }

  // Sample tone curve: 9 points from black to white
  const toneCurve = [];
  const toneCurveRed = [];
  const toneCurveGreen = [];
  const toneCurveBlue = [];
  const numPoints = 9;

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const input = Math.round(t * 255);
    const [or, og, ob] = lutLookup(t, t, t);
    const outLum = Math.round(luminance(srgbToLinear(or), srgbToLinear(og), srgbToLinear(ob)) * 255);
    toneCurve.push([input, Math.round(Math.min(255, Math.max(0, outLum)))]);
    toneCurveRed.push([input, Math.round(or * 255)]);
    toneCurveGreen.push([input, Math.round(og * 255)]);
    toneCurveBlue.push([input, Math.round(ob * 255)]);
  }

  // Sample HSL shifts at key hues
  const hslSamples = [
    { name: 'Red', hue: 0 },
    { name: 'Orange', hue: 30 },
    { name: 'Yellow', hue: 60 },
    { name: 'Green', hue: 120 },
    { name: 'Aqua', hue: 180 },
    { name: 'Blue', hue: 240 },
    { name: 'Purple', hue: 270 },
    { name: 'Magenta', hue: 330 },
  ];

  const hslResults = {};
  for (const sample of hslSamples) {
    const hRad = sample.hue * Math.PI / 180;
    const r = 0.5 + 0.4 * Math.cos(hRad);
    const g = 0.5 + 0.4 * Math.cos(hRad - 2 * Math.PI / 3);
    const b = 0.5 + 0.4 * Math.cos(hRad + 2 * Math.PI / 3);
    const [or, og, ob] = lutLookup(
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b))
    );
    const [inH, inS, inL] = rgbToHsl(r, g, b);
    const [outH, outS, outL] = rgbToHsl(or, og, ob);
    const shortestHueDelta = ((outH - inH + 540) % 360) - 180;
    hslResults[sample.name] = {
      hueShift: clampAdjustment(shortestHueDelta / 1.8),
      satShift: clampAdjustment((outS - inS) * 100),
      lumShift: clampAdjustment((outL - inL) * 100),
    };
  }

  // Sample overall stats
  const [wmR, wmG, wmB] = lutLookup(0.5, 0.5, 0.5);
  const [inH, inS, inL] = rgbToHsl(0.5, 0.5, 0.5);
  const [outH, outS, outL] = rgbToHsl(wmR, wmG, wmB);

  // Highlights/shadows from tone curve
  const highlights = Math.round((toneCurve[7][1] - toneCurve[7][0]) * 0.3);
  const shadows = Math.round((toneCurve[1][1] - toneCurve[1][0]) * 0.3);
  const whites = Math.round((toneCurve[8][1] - 255) * 0.2);
  const blacks = Math.round((toneCurve[0][1]) * 0.3);

  // Vibrance/saturation from average saturation shift
  const avgSatShift = Object.values(hslResults).reduce((s, v) => s + v.satShift, 0) / 8;
  const saturation = Math.round(avgSatShift * 0.5);

  return {
    toneCurve,
    toneCurveRed,
    toneCurveGreen,
    toneCurveBlue,
    highlights: Math.max(-100, Math.min(100, highlights)),
    shadows: Math.max(-100, Math.min(100, shadows)),
    whites: Math.max(-100, Math.min(100, whites)),
    blacks: Math.max(-100, Math.min(100, blacks)),
    vibrance: Math.max(-100, Math.min(100, Math.round(avgSatShift * 0.8))),
    saturation: Math.max(-100, Math.min(100, saturation)),
    hueRed: hslResults.Red.hueShift,
    hueOrange: hslResults.Orange.hueShift,
    hueYellow: hslResults.Yellow.hueShift,
    hueGreen: hslResults.Green.hueShift,
    hueAqua: hslResults.Aqua.hueShift,
    hueBlue: hslResults.Blue.hueShift,
    huePurple: hslResults.Purple.hueShift,
    hueMagenta: hslResults.Magenta.hueShift,
    satRed: hslResults.Red.satShift,
    satOrange: hslResults.Orange.satShift,
    satYellow: hslResults.Yellow.satShift,
    satGreen: hslResults.Green.satShift,
    satAqua: hslResults.Aqua.satShift,
    satBlue: hslResults.Blue.satShift,
    satPurple: hslResults.Purple.satShift,
    satMagenta: hslResults.Magenta.satShift,
    lumRed: hslResults.Red.lumShift,
    lumOrange: hslResults.Orange.lumShift,
    lumYellow: hslResults.Yellow.lumShift,
    lumGreen: hslResults.Green.lumShift,
    lumAqua: hslResults.Aqua.lumShift,
    lumBlue: hslResults.Blue.lumShift,
    lumPurple: hslResults.Purple.lumShift,
    lumMagenta: hslResults.Magenta.lumShift,
    gradeMidHue: Math.round(outH),
    gradeMidSat: Math.round(outS * 100),
    gradeGlobalHue: Math.round(outH),
    gradeGlobalSat: Math.round(outS * 50),
  };
}

async function handleBatchStart({ images }) {
  if (batchRunning) {
    showToast('批量任务正在进行中');
    return;
  }
  if (!Array.isArray(images) || images.length === 0) {
    showToast('没有要处理的图片');
    return;
  }

  const reference = getLastReferenceData();
  if (!reference) {
    showToast('请先选择参考图');
    return;
  }

  batchCounter++;
  batchRunning = true;
  batchCancelRequested = false;
  const intensity = getLastIntensity();
  const batchSize = images.length;
  const engineId = getSelectedEngineId() || 'lut';
  const batchButton = document.getElementById('btn-batch');
  if (batchButton) batchButton.textContent = '取消批处理';

  let failures = 0;
  let processed = 0;
  try {
    for (let index = 0; index < batchSize; index++) {
      if (batchCancelRequested) break;
      updateStatus(`批量处理中: ${index + 1}/${batchSize}`);
      try {
        await processBatchItem({
          item: images[index],
          index,
          engineId,
          reference,
          intensity
        });
        processed++;
      } catch (error) {
        if (batchCancelRequested) break;
        failures++;
        console.error('[download] Batch item failed:', error);
        showToast(`第 ${index + 1} 张处理失败`);
      }
    }
    if (batchCancelRequested) {
      updateStatus(`批量处理已取消: ${processed}/${batchSize}`);
      showToast(`已取消批量处理，完成 ${processed} 张`);
      EventBus.emit('batch-cancelled', { total: batchSize, processed, failures });
    } else {
      updateStatus(`批量处理完成: ${batchSize - failures}/${batchSize}`);
      showToast(failures ? `批量处理完成，${failures} 张失败` : `批量处理完成 (${batchSize} 张)`);
      EventBus.emit('batch-complete', { total: batchSize, failures });
    }
  } finally {
    batchRunning = false;
    batchCancelRequested = false;
    if (batchButton) {
      batchButton.disabled = false;
      batchButton.textContent = '批量处理';
    }
  }
}

async function processBatchItem({ item, index, engineId, reference, intensity }) {
  const { img, name } = item;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0);
  const sourceData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { resultPixels } = await renderFullCandidate({
    engineId,
    source: { data: sourceData.data, width: canvas.width, height: canvas.height },
    reference,
    intensity
  });
  context.putImageData(new ImageData(new Uint8ClampedArray(resultPixels), canvas.width, canvas.height), 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('无法生成批量导出文件');
  triggerDownload(blob, `${safeBaseName(name)}_${engineId}_${Math.round(intensity * 100)}_${batchCounter}_${index + 1}.jpg`);
  await new Promise(resolve => setTimeout(resolve, 180));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}
