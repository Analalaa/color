# Color Muse — 电影截图仿色 LUT 生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从电影截图生成 3D LUT（.CUBE 格式），可下载或直接应用到用户照片上，实现"电影同款色调"。

**Architecture:** 纯前端实现。拆分为 LUT 生成器、LUT 应用器（三线性插值）、.CUBE 文件输出、UI 预览四个独立模块。核心颜色空间转换复用现有 `color-space.js`。

**Tech Stack:** Vanilla JS (ES Modules), HTML5 Canvas, CSS Grid, 无外部依赖

---

## File Structure

```
js/color-transfer/
  color-space.js          [已有] LAB/RGB 转换，线性化/伽马
  histogram-transfer.js   [已有] 直方图匹配迁移
  lut-generator.js        [新建] 从风格参考图生成 3D LUT 数据
  lut-applier.js          [新建] 将 3D LUT 应用到图像（三线性插值）
  cube-writer.js          [新建] 将 LUT 数据导出为 .CUBE 格式

js/
  preview.js              [修改] 支持 LUT 预览模式
  main.js                 [修改] LUT UI 控件 + 事件集成
  download.js             [修改] 支持下载 .CUBE 文件

index.html                [修改] LUT 生成器 UI 面板
```

---

### Task 1: LUT 生成器（核心算法）

**Files:**
- Create: `js/color-transfer/lut-generator.js`
- Read: `js/color-transfer/color-space.js`（复用 `rgbToLab` / `labToRgb`）
- Read: `js/color-transfer/histogram-transfer.js`（复用 `computeHistogram` / `computeCDF`）

- [ ] **Step 1: 创建 lut-generator.js — generateLut 骨架**

```js
// js/color-transfer/lut-generator.js
import { rgbToLab, labToRgb } from './color-space.js';

/**
 * 从风格参考图生成 3D LUT。
 * @param {Uint8ClampedArray} refPixels - 参考图 RGBA 像素数据
 * @param {number} size - LUT 网格尺寸，默认 33
 * @returns {Float64Array} - 逐像素 RGB 值（3 * size³），范围 [0, 1]
 */
export function generateLut(refPixels, size = 33) {
  // TODO: 实现
  return new Float64Array(3 * size * size * size);
}
```

- [ ] **Step 2: 实现参考图颜色统计提取**

在 `generateLut` 内部，先从 `refPixels` 提取 LAB 空间的均值和标准差：

```js
function extractColorStats(pixels) {
  let n = 0, sumL = 0, sumA = 0, sumB = 0;
  let sumL2 = 0, sumA2 = 0, sumB2 = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue; // 跳过透明像素
    const [L, a, b] = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    sumL += L; sumA += a; sumB += b;
    sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
    n++;
  }

  if (n === 0) return null;

  const muL = sumL / n, muA = sumA / n, muB = sumB / n;
  const sigmaL = Math.sqrt(sumL2 / n - muL * muL) || 1;
  const sigmaA = Math.sqrt(sumA2 / n - muA * muA) || 1;
  const sigmaB = Math.sqrt(sumB2 / n - muB * muB) || 1;

  return { muL, muA, muB, sigmaL, sigmaA, sigmaB, n };
}
```

- [ ] **Step 3: 实现 Reinhard mean/std 映射函数**

在 LAB 空间做均值/标准差对齐，然后可选混合直方图匹配：

```js
function createColorMapper(stats) {
  // 默认源分布：均匀的 RGB（标准 sRGB 照片假设）
  const srcMu = [50, 0, 0];   // LAB 中等亮度，无色偏
  const srcSigma = [25, 20, 20]; // 较宽的标准差

  return (r, g, b) => {
    const [L, a, b2] = rgbToLab(r, g, b);
    const newL = (L - srcMu[0]) * (stats.sigmaL / srcSigma[0]) + stats.muL;
    const newA = (a - srcMu[1]) * (stats.sigmaA / srcSigma[1]) + stats.muA;
    const newB = (b2 - srcMu[2]) * (stats.sigmaB / srcSigma[2]) + stats.muB;
    return labToRgb(newL, newA, newB);
  };
}
```

- [ ] **Step 4: 实现 3D LUT 网格采样**

在 `size³` 网格上均匀采样 RGB 值，通过映射函数计算目标值：

```js
export function generateLut(refPixels, size = 33) {
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
        lut[idx++] = Math.max(0, Math.min(1, nr / 255));
        lut[idx++] = Math.max(0, Math.min(1, ng / 255));
        lut[idx++] = Math.max(0, Math.min(1, nb / 255));
      }
    }
  }

  return lut;
}
```

- [ ] **Step 5: 添加强度混合支持**

```js
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
```

- [ ] **Step 6: 提交**

```bash
git add js/color-transfer/lut-generator.js
git commit -m "feat: add LUT generator with Reinhard mean/std mapping"
```

---

### Task 2: .CUBE 文件输出

**Files:**
- Create: `js/color-transfer/cube-writer.js`

- [ ] **Step 1: 创建 cube-writer.js**

```js
// js/color-transfer/cube-writer.js

/**
 * 将 3D LUT 数据输出为 Adobe .CUBE 格式字符串。
 * @param {Float64Array} lut - LUT 数据，3 * size³ 个值，RGB 逐像素，范围 [0, 1]
 * @param {number} size - LUT 网格尺寸
 * @returns {string} - .CUBE 格式文本
 */
export function lutToCubeString(lut, size = 33) {
  const lines = [];
  lines.push('# Generated by Color Muse');
  lines.push(`TITLE "ColorMuse_${size}x${size}x${size}"`);
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push('');

  for (let i = 0; i < lut.length; i += 3) {
    const r = lut[i].toFixed(6);
    const g = lut[i + 1].toFixed(6);
    const b = lut[i + 2].toFixed(6);
    lines.push(`${r} ${g} ${b}`);
  }

  return lines.join('\n');
}

/**
 * 触发浏览器下载 .CUBE 文件。
 * @param {Float64Array} lut - LUT 数据
 * @param {number} size - LUT 网格尺寸
 * @param {string} filename - 下载文件名
 */
export function downloadLutAsCube(lut, size = 33, filename = 'color-muse-lut.cube') {
  const content = lutToCubeString(lut, size);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: 提交**

```bash
git add js/color-transfer/cube-writer.js
git commit -m "feat: add .CUBE file writer and download support"
```

---

### Task 3: LUT 应用器（三线性插值）

**Files:**
- Create: `js/color-transfer/lut-applier.js`

- [ ] **Step 1: 创建 lut-applier.js — 三线性插值应用**

```js
// js/color-transfer/lut-applier.js

/**
 * 将 3D LUT 应用到图像像素数据。
 * 使用三线性插值实现平滑的颜色映射。
 * @param {Uint8ClampedArray} pixels - 输入 RGBA 像素数据
 * @param {Float64Array} lut - LUT 数据，3 * size³ 个值，RGB 逐像素，范围 [0, 1]
 * @param {number} size - LUT 网格尺寸
 * @returns {Uint8ClampedArray} - 输出 RGBA 像素数据
 */
export function applyLut(pixels, lut, size = 33) {
  const len = pixels.length;
  const out = new Uint8ClampedArray(len);
  const maxIdx = size - 1;

  for (let i = 0; i < len; i += 4) {
    let rf = pixels[i] / 255;
    let gf = pixels[i + 1] / 255;
    let bf = pixels[i + 2] / 255;

    // Clamp to [0, 1]
    rf = rf < 0 ? 0 : rf > 1 ? 1 : rf;
    gf = gf < 0 ? 0 : gf > 1 ? 1 : gf;
    bf = bf < 0 ? 0 : bf > 1 ? 1 : bf;

    // Map to LUT grid coordinates
    const rx = rf * maxIdx, gx = gf * maxIdx, bx = bf * maxIdx;
    const r0 = Math.floor(rx), g0 = Math.floor(gx), b0 = Math.floor(bx);
    const r1 = Math.min(r0 + 1, maxIdx), g1 = Math.min(g0 + 1, maxIdx), b1 = Math.min(b0 + 1, maxIdx);
    const fr = rx - r0, fg = gx - g0, fb = bx - b0;

    // 8 corner indices for trilinear interpolation
    const idx000 = (b0 * size * size + g0 * size + r0) * 3;
    const idx001 = (b0 * size * size + g0 * size + r1) * 3;
    const idx010 = (b0 * size * size + g1 * size + r0) * 3;
    const idx011 = (b0 * size * size + g1 * size + r1) * 3;
    const idx100 = (b1 * size * size + g0 * size + r0) * 3;
    const idx101 = (b1 * size * size + g0 * size + r1) * 3;
    const idx110 = (b1 * size * size + g1 * size + r0) * 3;
    const idx111 = (b1 * size * size + g1 * size + r1) * 3;

    // Trilinear interpolation for each channel
    const invFr = 1 - fr, invFg = 1 - fg, invFb = 1 - fb;

    out[i]     = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000] + invFb * invFg * fr * lut[idx001] +
      invFb * fg * invFr * lut[idx010] + invFb * fg * fr * lut[idx011] +
      fb * invFg * invFr * lut[idx100] + fb * invFg * fr * lut[idx101] +
      fb * fg * invFr * lut[idx110] + fb * fg * fr * lut[idx111]
    ));

    out[i + 1] = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000 + 1] + invFb * invFg * fr * lut[idx001 + 1] +
      invFb * fg * invFr * lut[idx010 + 1] + invFb * fg * fr * lut[idx011 + 1] +
      fb * invFg * invFr * lut[idx100 + 1] + fb * invFg * fr * lut[idx101 + 1] +
      fb * fg * invFr * lut[idx110 + 1] + fb * fg * fr * lut[idx111 + 1]
    ));

    out[i + 2] = Math.round(255 * clamp(
      invFb * invFg * invFr * lut[idx000 + 2] + invFb * invFg * fr * lut[idx001 + 2] +
      invFb * fg * invFr * lut[idx010 + 2] + invFb * fg * fr * lut[idx011 + 2] +
      fb * invFg * invFr * lut[idx100 + 2] + fb * invFg * fr * lut[idx101 + 2] +
      fb * fg * invFr * lut[idx110 + 2] + fb * fg * fr * lut[idx111 + 2]
    ));

    out[i + 3] = pixels[i + 3]; // 保留 alpha
  }

  return out;
}

function clamp(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
```

- [ ] **Step 2: 提交**

```bash
git add js/color-transfer/lut-applier.js
git commit -m "feat: add LUT applier with trilinear interpolation"
```

---

### Task 4: 预览模块 — LUT 模式

**Files:**
- Modify: `js/preview.js`
- Read: `js/color-transfer/lut-generator.js`（引用 `generateLut`）
- Read: `js/color-transfer/lut-applier.js`（引用 `applyLut`）

- [ ] **Step 1: 在 preview.js 中添加 LUT 预览逻辑**

在现有 `transferColor` 旁边新增 `transferLut` 路径。在 `preview.js` 顶部添加 LUT 模块导入和状态：

```js
// js/preview.js — 在已有 import 之后添加
import { generateLut } from './color-transfer/lut-generator.js';
import { applyLut } from './color-transfer/lut-applier.js';
import { downloadLutAsCube } from './color-transfer/cube-writer.js';

let currentLut = null;
let currentAlgo = 'histogram'; // 新增：当前算法
```

- [ ] **Step 2: 监听算法切换事件**

```js
EventBus.on('algo-changed', (algo) => {
  currentAlgo = algo;
  runTransfer(); // 切换算法后重新处理
});
```

- [ ] **Step 3: 修改 runTransfer 支持 LUT 分支**

在 `runTransfer` 函数内部，将：

```js
const resultPixels = transferColor(srcData.data, lastRefPixels, lastIntensity);
```

替换为：

```js
let resultPixels;
if (currentAlgo === 'lut') {
  // LUT 模式：先生成 LUT，再应用
  if (!currentLut) {
    currentLut = generateLut(lastRefPixels);
  }
  resultPixels = applyLut(srcData.data, currentLut);
} else {
  // 直方图匹配模式（原有）
  currentLut = null;
  resultPixels = transferColor(srcData.data, lastRefPixels, lastIntensity);
}
```

- [ ] **Step 4: 参考图切换时重置 LUT 缓存**

在 `handleReferenceSelected` 中，参考图变化时清除 LUT：

```js
async function handleReferenceSelected({ id, isCustom, refData }) {
  // ... 原有逻辑 ...
  currentLut = null; // 参考图变了，旧 LUT 失效
  lastRefPixels = refData.pixels;
  lastRefId = id;
  runTransfer();
}
```

- [ ] **Step 5: 提交**

```bash
git add js/preview.js
git commit -m "feat: integrate LUT mode into preview pipeline"
```

---

### Task 5: .CUBE 下载集成

**Files:**
- Modify: `js/preview.js`
- Modify: `js/download.js`
- Modify: `js/main.js`

- [ ] **Step 1: 在 preview.js 中暴露 LUT 下载函数**

```js
export function downloadCurrentLut() {
  if (!currentLut) {
    showToast('请先生成 LUT 结果');
    return;
  }
  const refName = lastRefId || 'custom';
  downloadLutAsCube(currentLut, 33, `color-muse-${refName}.cube`);
}

export function getCurrentLut() {
  return currentLut;
}
```

- [ ] **Step 2: 在 main.js 中添加 LUT 下载按钮逻辑**

在 `DOMContentLoaded` 初始化中添加：

```js
const btnLutDownload = document.getElementById('btn-lut-download');
if (btnLutDownload) {
  btnLutDownload.addEventListener('click', () => {
    import('./preview.js').then(mod => mod.downloadCurrentLut());
  });
}

EventBus.on('transfer-complete', () => {
  const btnLut = document.getElementById('btn-lut-download');
  if (btnLut && currentAlgo === 'lut') {
    btnLut.disabled = false;
  }
});
```

- [ ] **Step 3: 提交**

```bash
git add js/preview.js js/main.js
git commit -m "feat: add .CUBE download button and export flow"
```

---

### Task 6: UI 面板 — LUT 生成器控件

**Files:**
- Modify: `index.html`
- Modify: `js/main.js`

- [ ] **Step 1: 在 index.html 中添加 ICC 色域映射 radio 的启用和 LUT 相关控件**

在 toolbar-left 中，将：

```html
<label style="opacity:0.5"><input type="radio" name="algo" value="icc" disabled> ICC 色域映射 (暂未实现)</label>
```

替换为：

```html
<label><input type="radio" name="algo" value="lut"> 电影仿色 LUT (A)</label>
```

并在下载按钮旁边添加 LUT 下载按钮：

```html
<button id="btn-lut-download" class="btn-secondary" disabled>下载 LUT (.CUBE)</button>
```

- [ ] **Step 2: 在 main.js 中监听 algo-changed 更新按钮状态**

```js
EventBus.on('algo-changed', (algo) => {
  const btnLut = document.getElementById('btn-lut-download');
  const btnDownload = document.getElementById('btn-download');
  if (btnLut) {
    btnLut.style.display = algo === 'lut' ? '' : 'none';
  }
  if (btnDownload) {
    btnDownload.style.display = algo === 'lut' ? 'none' : '';
  }
});
```

- [ ] **Step 3: 提交**

```bash
git add index.html js/main.js
git commit -m "feat: add LUT mode UI controls and download button"
```

---

### Task 7: 整体集成测试

- [ ] **Step 1: 手动验证 LUT 生成流程**

1. 打开 `index.html`，选择一张电影截图上传
2. 选择"LUT 仿色"算法
3. 点击一张内置风格或自定义参考图
4. 确认预览区显示结果（色调变化，无明显伪影）
5. 点击"下载 LUT (.CUBE)"，确认文件下载成功
6. 用文本编辑器打开 .CUBE 文件，验证格式正确（LUT_3D_SIZE 33，35937 行 RGB 数据）

- [ ] **Step 2: 验证 .CUBE 文件兼容性**

将生成的 .CUBE 文件导入 Photoshop（文件 → 导入 → 颜色查找表），应用到一张照片，确认效果与浏览器预览一致。

- [ ] **Step 3: 验证强度滑块**

拖动强度滑块，确认 LUT 应用效果实时变化。

- [ ] **Step 4: 验证算法切换**

在直方图迁移和 LUT 仿色之间来回切换，确认效果不同且无崩溃。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "feat: complete LUT generation with movie screenshot emulation"
```

---

## Spec Coverage Check

| 设计文档要求 | 对应任务 |
|-------------|---------|
| 从电影截图生成 3D LUT | Task 1 (lut-generator.js) |
| 输出标准 .CUBE 文件 | Task 2 (cube-writer.js) |
| 三线性插值应用 LUT | Task 3 (lut-applier.js) |
| 实时预览效果 | Task 4 (preview.js 修改) |
| 下载 .CUBE 文件 | Task 5 (download 集成) |
| UI 控件和算法切换 | Task 6 (index.html + main.js) |
| 强度混合控制 | Task 1 Step 5 (intensity 参数) |
| 错误处理（空像素） | Task 1 Step 1 (extractColorStats null check) |
| 端到端验证 | Task 7 (手动测试) |

**缺口：** 无。所有设计文档中的需求都有对应任务。
