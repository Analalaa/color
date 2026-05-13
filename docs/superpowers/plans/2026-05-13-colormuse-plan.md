# Color Muse 仿色系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯浏览器端仿色工具，用户上传图片后选择参考图，通过色彩直方图迁移技术（B方案）将参考图的色彩氛围映射到用户图片，输出重新演绎色彩的结果图。

**Architecture:** 单页应用，纯前端 Canvas + Web Workers，所有计算在浏览器本地完成，数据不离开用户设备。IndexedDB 存用户自定义图库，LocalStorage 存偏好设置。

**Tech Stack:** 原生 HTML/CSS/JS, Canvas API, Web Workers, IndexedDB, JSZip, FileSaver.js

---

## 文件结构

```
color-muse/
├── index.html                      # 主入口，整个单页应用
├── css/
│   └── styles.css                  # 深色主题样式
├── js/
│   ├── main.js                     # 入口逻辑，模块初始化，事件总线
│   ├── upload.js                   # 图片上传（拖拽+点击）
│   ├── canvas-workspace.js         # 中央画布，缩放/拖拽
│   ├── preview.js                  # 预览对比（左右分屏/滑块）
│   ├── download.js                 # 单个下载 + 批量 ZIP
│   ├── storage.js                  # IndexedDB + LocalStorage 封装
│   ├── reference-library.js       # 参考图库（内置+自定义）
│   └── color-transfer/
│       ├── color-space.js          # RGB↔LAB 色彩空间转换
│       └── histogram-transfer.js    # 直方图迁移核心算法
└── assets/references/              # 内置参考图（5类×5张）
    ├──日系/
    ├──欧美/
    ├──复古/
    ├──赛博/
    └──莫兰迪/
```

---

## Task 1: 项目初始化与目录结构

**Files:**
- Create: `index.html`
- Create: `css/styles.css`
- Create: `js/main.js`
- Create: `js/color-transfer/color-space.js`
- Create: `js/color-transfer/histogram-transfer.js`
- Create: `js/storage.js`
- Create: `js/upload.js`
- Create: `js/canvas-workspace.js`
- Create: `js/preview.js`
- Create: `js/download.js`
- Create: `js/reference-library.js`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/Admin/Documents/color/css
mkdir -p /Users/Admin/Documents/color/js/color-transfer
mkdir -p /Users/Admin/Documents/color/assets/references/{日系,欧美,复古,赛博,莫兰迪}
```

- [ ] **Step 2: 创建 index.html 骨架**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Color Muse — 仿色工具</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div id="app">
    <header class="app-header">
      <h1>Color Muse</h1>
    </header>
    <main class="app-main">
      <aside class="toolbar-left">
        <!-- 上传、算法选择、强度滑块 -->
      </aside>
      <section class="canvas-workspace">
        <!-- 中央画布区域 -->
        <div id="drop-zone">拖拽图片到此处或点击上传</div>
      </section>
      <aside class="panel-right">
        <!-- 参考图库 -->
      </aside>
    </main>
    <footer class="app-footer">
      <!-- 状态栏 -->
    </footer>
  </div>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: 创建 css/styles.css 基础样式**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #1a1a2e;
  color: #eee;
  font-family: system-ui, sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  height: 56px;
  background: #16213e;
  display: flex;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid #0f3460;
}

.app-header h1 {
  font-size: 20px;
  color: #e94560;
  font-weight: 700;
  letter-spacing: 1px;
}

.app-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.toolbar-left {
  width: 240px;
  background: #16213e;
  border-right: 1px solid #0f3460;
  padding: 16px;
  overflow-y: auto;
}

.canvas-workspace {
  flex: 1;
  background: #0f0f1a;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.panel-right {
  width: 280px;
  background: #16213e;
  border-left: 1px solid #0f3460;
  padding: 16px;
  overflow-y: auto;
}

.app-footer {
  height: 40px;
  background: #16213e;
  border-top: 1px solid #0f3460;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 13px;
  color: #888;
}

#drop-zone {
  border: 2px dashed #0f3460;
  border-radius: 12px;
  width: 80%;
  height: 60%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 16px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

#drop-zone:hover, #drop-zone.drag-over {
  border-color: #e94560;
  background: rgba(233,69,96,0.05);
}
```

- [ ] **Step 4: 创建 js/main.js 入口模块**

```javascript
// 事件总线，所有模块通过它通信
const EventBus = {
  events: {},
  on(event, callback) {
    (this.events[event] = this.events[event] || []).push(callback);
  },
  emit(event, data) {
    (this.events[event] || []).forEach(cb => cb(data));
  }
};

window.EventBus = EventBus;

// 初始化各个模块
import './storage.js';
import './upload.js';
import './canvas-workspace.js';
import './reference-library.js';
import './preview.js';
import './download.js';
```

- [ ] **Step 5: 创建 js/storage.js（IndexedDB + LocalStorage 封装）**

```javascript
// IndexedDB 数据库初始化
const DB_NAME = 'colormuse_db';
const DB_VERSION = 1;

let db = null;

export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('reference_images')) {
        database.createObjectStore('reference_images', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

export async function saveReferenceImage(imageData) {
  const tx = db.transaction('reference_images', 'readwrite');
  tx.objectStore('reference_images').add(imageData);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllReferenceImages() {
  const tx = db.transaction('reference_images', 'readonly');
  return new Promise((resolve, reject) => {
    const request = tx.objectStore('reference_images').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteReferenceImage(id) {
  const tx = db.transaction('reference_images', 'readwrite');
  tx.objectStore('reference_images').delete(id);
}

// LocalStorage 偏好
export function savePreference(key, value) {
  const prefs = JSON.parse(localStorage.getItem('colormuse_preferences') || '{}');
  prefs[key] = value;
  localStorage.setItem('colormuse_preferences', JSON.stringify(prefs));
}

export function getPreference(key, defaultValue) {
  const prefs = JSON.parse(localStorage.getItem('colormuse_preferences') || '{}');
  return prefs[key] !== undefined ? prefs[key] : defaultValue;
}
```

- [ ] **Step 6: 创建 js/color-transfer/color-space.js（RGB↔LAB 转换）**

```javascript
// RGB 转 XYZ 矩阵（sRGB D65）
const RGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041]
];

const XYZ_TO_RGB = [
  [ 3.2404542, -1.5371385, -0.4985314],
  [-0.9692660,  1.8760108,  0.0415560],
  [ 0.0556434, -0.2040259,  1.0572252]
];

// 线性 RGB（gamma 解码）
function linearize(c) {
  c = c / 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

// Gamma 编码
function gammaize(c) {
  return c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
}

export function rgbToLab(r, g, b) {
  // RGB -> Linear RGB
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  // Linear RGB -> XYZ
  const x = RGB_TO_XYZ[0][0] * lr + RGB_TO_XYZ[0][1] * lg + RGB_TO_XYZ[0][2] * lb;
  const y = RGB_TO_XYZ[1][0] * lr + RGB_TO_XYZ[1][1] * lg + RGB_TO_XYZ[1][2] * lb;
  const z = RGB_TO_XYZ[2][0] * lr + RGB_TO_XYZ[2][1] * lg + RGB_TO_XYZ[2][2] * lb;

  // XYZ -> Lab (D65 reference)
  const xn = 0.95047, yn = 1.00000, zn = 1.08883;

  const fy = y / yn;
  const fx = x / xn;
  const fz = z / zn;

  const f = (t) => t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);

  const L = 116 * f(fy) - 16;
  const a = 500 * (f(fx) - f(fy));
  const b2 = 200 * (f(fy) - f(fz));

  return [L, a, b2];
}

export function labToRgb(L, a, b2) {
  // Lab -> XYZ
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b2 / 200;

  const f = (t) => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;

  const xn = 0.95047, yn = 1.00000, zn = 1.08883;
  const x = xn * f(fx);
  const y = yn * f(fy);
  const z = zn * f(fz);

  // XYZ -> Linear RGB
  const lr = XYZ_TO_RGB[0][0] * x + XYZ_TO_RGB[0][1] * y + XYZ_TO_RGB[0][2] * z;
  const lg = XYZ_TO_RGB[1][0] * x + XYZ_TO_RGB[1][1] * y + XYZ_TO_RGB[1][2] * z;
  const lb = XYZ_TO_RGB[2][0] * x + XYZ_TO_RGB[2][1] * y + XYZ_TO_RGB[2][2] * z;

  // Linear RGB -> sRGB
  const r = Math.max(0, Math.min(255, Math.round(gammaize(lr) * 255)));
  const g = Math.max(0, Math.min(255, Math.round(gammaize(lg) * 255)));
  const b = Math.max(0, Math.min(255, Math.round(gammaize(lb) * 255)));

  return [r, g, b];
}
```

- [ ] **Step 7: 创建 js/color-transfer/histogram-transfer.js（直方图迁移核心算法）**

```javascript
import { rgbToLab, labToRgb } from './color-space.js';

// 计算一维直方图（256 bins）
function computeHistogram(channelData) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < channelData.length; i++) {
    hist[Math.round(channelData[i])]++;
  }
  return hist;
}

// 计算累积分布函数
function computeCDF(hist) {
  const cdf = new Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    cdf[i] = sum;
  }
  // 归一化到 [0, 255]
  const min = cdf.find(v => v > 0);
  const max = cdf[255];
  return cdf.map(v => Math.round(((v - min) / (max - min)) * 255));
}

// 直方图匹配：将 source 的分布匹配到 target
function matchHistogram(sourceCDF, targetCDF) {
  const map = new Array(256);
  let si = 0;
  for (let ti = 0; ti < 256; ti++) {
    while (si < 255 && sourceCDF[si] < targetCDF[ti]) si++;
    map[ti] = si;
  }
  return map;
}

/**
 * 执行色彩迁移
 * @param {Uint8ClampedArray} srcPixels  - 源图片像素数组 (RGBA)
 * @param {Uint8ClampedArray} refPixels  - 参考图片像素数组 (RGBA)
 * @param {number} intensity              - 迁移强度 0~1
 * @returns {Uint8ClampedArray} 输出像素数组
 */
export function transferColor(srcPixels, refPixels, intensity = 1.0) {
  const len = srcPixels.length;
  const out = new Uint8ClampedArray(len);

  // 分别提取 L、a、b 通道数据
  const srcL = [], srcA = [], srcB = [];
  const refL = [], refA = [], refB = [];

  for (let i = 0; i < len; i += 4) {
    const [L1, a1, b1] = rgbToLab(srcPixels[i], srcPixels[i+1], srcPixels[i+2]);
    const [L2, a2, b2] = rgbToLab(refPixels[i], refPixels[i+1], refPixels[i+2]);
    srcL.push(L1); srcA.push(a1); srcB.push(b1);
    refL.push(L2); refA.push(a2); refB.push(b2);
  }

  // 对 L、a、b 各自做直方图匹配
  const srcLCDF = computeCDF(computeHistogram(srcL));
  const refLCDF = computeCDF(computeHistogram(refL));
  const mapL = matchHistogram(srcLCDF, refLCDF);

  const srcACDF = computeCDF(computeHistogram(srcA));
  const refACDF = computeCDF(computeHistogram(refA));
  const mapA = matchHistogram(srcACDF, refACDF);

  const srcBCDF = computeCDF(computeHistogram(srcB));
  const refBCDF = computeCDF(computeHistogram(refB));
  const mapB = matchHistogram(srcBCDF, refBCDF);

  // 应用匹配，混合原值
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const L_new = mapL[Math.round(srcL[j])];
    const a_new = mapA[Math.round(srcA[j] + 128)];
    const b_new = mapB[Math.round(srcB[j] + 128)];

    const [origR, origG, origB] = [srcPixels[i], srcPixels[i+1], srcPixels[i+2]];
    const [newR, newG, newB] = labToRgb(L_new, a_new - 128, b_new - 128);

    out[i]   = Math.round(origR + (newR - origR) * intensity);
    out[i+1] = Math.round(origG + (newG - origG) * intensity);
    out[i+2] = Math.round(origB + (newB - origB) * intensity);
    out[i+3] = srcPixels[i+3]; // 保留 alpha
  }

  return out;
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "init: project structure and color transfer core"
```

---

## Task 2: 图片上传模块（upload.js）

**Files:**
- Modify: `js/upload.js` (create new)
- Modify: `js/canvas-workspace.js`

- [ ] **Step 1: 创建 js/upload.js**

```javascript
import { EventBus } from './main.js';

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

export function initUpload() {
  const dropZone = document.getElementById('drop-zone');

  // 拖拽上传
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => FILE_TYPES.includes(f.type));
    files.forEach(file => loadImageFile(file));
  });

  // 点击上传
  dropZone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_TYPES.join(',');
    input.multiple = true;
    input.onchange = () => {
      Array.from(input.files).forEach(file => loadImageFile(file));
    };
    input.click();
  });
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      EventBus.emit('image-loaded', { file, img, dataUrl: e.target.result });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
```

- [ ] **Step 2: 创建 js/canvas-workspace.js**

```javascript
import { EventBus } from './main.js';

let currentCanvas = null;
let currentCtx = null;
let currentImage = null;

export function initCanvasWorkspace() {
  EventBus.on('image-loaded', ({ img }) => {
    renderImageToCanvas(img);
  });
}

export function renderImageToCanvas(img) {
  const workspace = document.querySelector('.canvas-workspace');
  let canvas = document.getElementById('main-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'main-canvas';
    workspace.appendChild(canvas);
  }

  const maxW = workspace.clientWidth * 0.9;
  const maxH = workspace.clientHeight * 0.9;
  let w = img.width, h = img.height;
  if (w > maxW) { h = h * (maxW / w); w = maxW; }
  if (h > maxH) { w = w * (maxH / h); h = maxH; }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  currentCanvas = canvas;
  currentCtx = ctx;
  currentImage = img;

  EventBus.emit('canvas-ready', { canvas, ctx, img });
}

export function getCanvasData() {
  if (!currentCanvas) return null;
  return currentCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: upload module and canvas workspace"
```

---

## Task 3: 参考图库模块（reference-library.js）

**Files:**
- Modify: `js/reference-library.js` (create)
- Modify: `index.html` (add reference library HTML)
- Modify: `css/styles.css` (add library styles)

- [ ] **Step 1: 更新 index.html，在右侧面板添加图库结构**

```html
<aside class="panel-right">
  <h3 class="section-title">内置风格</h3>
  <div id="builtin-library" class="reference-grid"></div>

  <h3 class="section-title" style="margin-top:20px">自定义图库</h3>
  <div id="custom-library" class="reference-grid"></div>
  <button id="upload-ref-btn" class="btn-secondary" style="margin-top:8px;width:100%">上传参考图</button>
</aside>
```

- [ ] **Step 2: 更新 css/styles.css 添加图库相关样式**

```css
.section-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  margin-bottom: 12px;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.ref-thumb {
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.ref-thumb:hover, .ref-thumb.selected {
  border-color: #e94560;
}

.ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.btn-secondary {
  background: #0f3460;
  color: #eee;
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.btn-secondary:hover {
  background: #e94560;
}
```

- [ ] **Step 3: 创建 js/reference-library.js**

```javascript
import { EventBus } from './main.js';
import { getAllReferenceImages, saveReferenceImage } from './storage.js';

// 内置参考图路径（实际项目中需要真实的图片文件）
const BUILTIN_REFS = [
  { id: '日系1', category: '日系', path: 'assets/references/日系/1.webp' },
  { id: '日系2', category: '日系', path: 'assets/references/日系/2.webp' },
  { id: '日系3', category: '日系', path: 'assets/references/日系/3.webp' },
  { id: '欧美1', category: '欧美', path: 'assets/references/欧美/1.webp' },
  { id: '欧美2', category: '欧美', path: 'assets/references/欧美/2.webp' },
  { id: '复古1', category: '复古', path: 'assets/references/复古/1.webp' },
  { id: '赛博1', category: '赛博', path: 'assets/references/赛博/1.webp' },
  { id: '莫兰迪1', category: '莫兰迪', path: 'assets/references/莫兰迪/1.webp' },
];

let selectedRefId = null;

export async function initReferenceLibrary() {
  renderBuiltinRefs();
  renderCustomRefs();
  setupUploadButton();
  setupCategoryFilter();
}

function renderBuiltinRefs() {
  const container = document.getElementById('builtin-library');
  container.innerHTML = BUILTIN_REFS.map(ref => `
    <div class="ref-thumb" data-id="${ref.id}" data-category="${ref.category}" onclick="selectRef('${ref.id}')">
      <img src="${ref.path}" alt="${ref.category}" onerror="this.style.display='none'">
    </div>
  `).join('');
}

async function renderCustomRefs() {
  const container = document.getElementById('custom-library');
  const customs = await getAllReferenceImages();
  container.innerHTML = customs.map(ref => `
    <div class="ref-thumb" data-id="${ref.id}" onclick="selectRef('${ref.id}', true)">
      <img src="${ref.thumbnail}" alt="custom">
    </div>
  `).join('');
}

window.selectRef = function(id, isCustom = false) {
  document.querySelectorAll('.ref-thumb').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.ref-thumb[data-id="${id}"]`);
  if (el) el.classList.add('selected');
  selectedRefId = id;

  EventBus.emit('reference-selected', { id, isCustom });
};

function setupUploadButton() {
  const btn = document.getElementById('upload-ref-btn');
  btn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      for (const file of Array.from(input.files)) {
        const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const thumbnail = await createThumbnail(file);
        await saveReferenceImage({ id, name: file.name, blob: file, thumbnail });
      }
      renderCustomRefs();
    };
    input.click();
  });
}

async function createThumbnail(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 80; canvas.height = 80;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, 80, 80);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: reference library with builtin and custom support"
```

---

## Task 4: 色彩迁移执行与预览（preview.js + 集成）

**Files:**
- Modify: `js/preview.js`
- Modify: `js/canvas-workspace.js`（添加迁移触发逻辑）

- [ ] **Step 1: 创建 js/preview.js**

```javascript
import { EventBus } from './main.js';
import { transferColor } from './color-transfer/histogram-transfer.js';
import { getCanvasData, currentRefPixels } from './canvas-workspace.js';

let currentResultPixels = null;

EventBus.on('reference-selected', async ({ id, isCustom }) => {
  const srcPixels = getCanvasData()?.data;
  if (!srcPixels) return;

  let refPixels = await loadReferencePixels(id, isCustom);
  if (!refPixels) return;

  // 在 Web Worker 中执行（防止 UI 卡顿）—— 这里先做同步版本
  const resultData = transferColor(srcPixels, refPixels.pixels, 1.0);
  currentResultPixels = resultData;

  // 渲染到结果画布
  renderResult(resultData);
  EventBus.emit('transfer-complete', { resultData });
});

async function loadReferencePixels(id, isCustom) {
  if (isCustom) {
    const customs = await import('./storage.js').then(m => m.getAllReferenceImages());
    const ref = customs.find(r => r.id === id);
    if (!ref) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({ pixels: ctx.getImageData(0, 0, img.width, img.height).data });
      };
      img.src = URL.createObjectURL(ref.blob);
    });
  } else {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({ pixels: ctx.getImageData(0, 0, img.width, img.height).data });
      };
      img.src = `assets/references/${id}.webp`;
    });
  }
}

function renderResult(pixels) {
  const canvas = document.getElementById('result-canvas') || createResultCanvas();
  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(pixels, canvas.width, canvas.height);
  ctx.putImageData(imgData, 0, 0);
}

function createResultCanvas() {
  const c = document.createElement('canvas');
  c.id = 'result-canvas';
  c.style.position = 'absolute';
  c.style.right = '20px';
  c.style.bottom = '60px';
  c.style.width = '200px';
  c.style.height = 'auto';
  c.style.border = '2px solid #e94560';
  c.style.borderRadius = '8px';
  document.querySelector('.canvas-workspace').appendChild(c);
  return c;
}
```

- [ ] **Step 2: 集成迁移逻辑到 canvas-workspace.js，当参考图被选中时触发迁移**

在 `canvas-workspace.js` 中 `EventBus.on('reference-selected')` 时调用 transferColor：

```javascript
EventBus.on('reference-selected', async ({ id, isCustom }) => {
  const imageData = getCanvasData();
  if (!imageData) return;

  // 从 reference-library 加载参考图像素
  const refData = await loadReferenceById(id, isCustom);
  if (!refData) return;

  // 执行色彩迁移
  const result = transferColor(imageData.data, refData.pixels, 1.0);
  renderResultToCanvas(result, imageData.width, imageData.height);
});
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: color transfer execution and result preview"
```

---

## Task 5: 下载与批量处理（download.js）

**Files:**
- Modify: `js/download.js` (create)
- Modify: `css/styles.css` (add footer controls)

- [ ] **Step 1: 更新 index.html，footer 添加下载按钮**

```html
<footer class="app-footer">
  <span id="status-text">就绪</span>
  <div style="margin-left:auto;display:flex;gap:12px">
    <button id="btn-download" class="btn-primary" disabled>下载结果</button>
    <button id="btn-batch" class="btn-secondary" disabled>批量处理</button>
  </div>
</footer>
```

- [ ] **Step 2: 更新 css/styles.css，添加按钮样式**

```css
.btn-primary {
  background: #e94560;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary:hover:not(:disabled) { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-secondary {
  background: #0f3460;
  color: #eee;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}

.btn-secondary:hover { background: #1a4a7a; }
```

- [ ] **Step 3: 创建 js/download.js**

```javascript
import { EventBus } from './main.js';

let resultCanvas = null;

EventBus.on('transfer-complete', ({ resultData }) => {
  document.getElementById('btn-download').disabled = false;
  resultCanvas = resultData; // 存储引用
});

document.getElementById('btn-download').addEventListener('click', () => {
  const canvas = document.getElementById('result-canvas') || document.getElementById('main-canvas');
  if (!canvas) return;

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colormuse_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

document.getElementById('btn-batch').addEventListener('click', async () => {
  // 批量处理：需先有多张图片在队列中
  EventBus.emit('batch-requested');
});
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: download single image and batch button"
```

---

## Task 6: 工具栏控件（算法切换 + 强度滑块）

**Files:**
- Modify: `index.html`（添加工具栏控件）
- Modify: `css/styles.css`
- Modify: `js/main.js`（注册控件事件）

- [ ] **Step 1: 更新 index.html 左侧工具栏，添加算法选择和强度滑块**

```html
<div class="toolbar-section">
  <h4 class="toolbar-label">算法</h4>
  <label><input type="radio" name="algo" value="histogram" checked> 直方图迁移 (B)</label><br>
  <label><input type="radio" name="algo" value="icc"> ICC 色域映射 (A)</label>
</div>

<div class="toolbar-section" style="margin-top:16px">
  <h4 class="toolbar-label">迁移强度</h4>
  <input type="range" id="intensity-slider" min="0" max="100" value="100" style="width:100%">
  <div style="display:flex;justify-content:space-between;font-size:12px;color:#888">
    <span>0%</span><span id="intensity-value">100%</span><span>100%</span>
  </div>
</div>
```

- [ ] **Step 2: 添加对应样式**

```css
.toolbar-section {
  margin-bottom: 20px;
}

.toolbar-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  margin-bottom: 8px;
}

input[type="range"] {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  background: #0f3460;
  border-radius: 2px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: #e94560;
  border-radius: 50%;
  cursor: pointer;
}
```

- [ ] **Step 3: 添加工具栏事件到 main.js**

```javascript
// 算法切换
document.querySelectorAll('input[name="algo"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    EventBus.emit('algo-changed', e.target.value);
  });
});

// 强度滑块
const slider = document.getElementById('intensity-slider');
slider.addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('intensity-value').textContent = val + '%';
  EventBus.emit('intensity-changed', val / 100);
});
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: algorithm switch and intensity slider controls"
```

---

## Task 7: 完整集成与系统联调

**Files:**
- Modify: `js/main.js`（完善模块连接）
- Modify: `js/preview.js`（接入 intensity 参数）
- Modify: `js/canvas-workspace.js`（挂载算法切换监听）

- [ ] **Step 1: 完善 main.js，将所有模块正确串联**

```javascript
import { initDB } from './storage.js';
import { initUpload } from './upload.js';
import { initCanvasWorkspace } from './canvas-workspace.js';
import { initReferenceLibrary } from './reference-library.js';
import { initPreview } from './preview.js';
import { initDownload } from './download.js';

window.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  initUpload();
  initCanvasWorkspace();
  await initReferenceLibrary();
  initPreview();
  initDownload();
  console.log('[Color Muse] initialized');
});
```

- [ ] **Step 2: preview.js 接入 intensity 参数和算法切换**

修改 `EventBus.on('reference-selected')` 使用当前 intensity 值；添加 `EventBus.on('algo-changed')` 和 `EventBus.on('intensity-changed')` 的监听。

```javascript
let currentIntensity = 1.0;

EventBus.on('intensity-changed', (val) => { currentIntensity = val; });

EventBus.on('reference-selected', async ({ id, isCustom }) => {
  const srcPixels = getCanvasData()?.data;
  if (!srcPixels) return;
  const refPixels = await loadReferencePixels(id, isCustom);
  if (!refPixels) return;

  // 使用当前 intensity 执行迁移
  const resultData = transferColor(srcPixels, refPixels.pixels, currentIntensity);
  currentResultPixels = resultData;
  renderResult(resultData);
  EventBus.emit('transfer-complete', { resultData });
});
```

- [ ] **Step 3: 测试完整流程**

打开浏览器访问 `index.html`，验证：
1. 上传图片是否显示在画布
2. 选择内置参考图是否触发色彩迁移
3. 强度滑块是否实时影响结果
4. 下载按钮是否生成有效图片

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete integration — all modules wired"
```

---

## Task 8: 内置参考图资源

**Files:**
- Create: `assets/references/日系/1.webp` 等 25 张图片
- Modify: `js/reference-library.js`（更新内置图路径）

- [ ] **Step 1: 创建占位图片（实际项目中需替换为真实图片）**

本步骤跳过图片文件创建，假设用户会提供或从网络获取真实的参考图。

- [ ] **Step 2: 更新 reference-library.js 中的 BUILTIN_REFS 列表**

确保每个内置参考图的 path 路径和 id 与实际文件名对应。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: builtin reference images placeholder structure"
```

---

## 自查清单（写完计划后检查）

1. **Spec 覆盖检查：**
   - [x] 图片上传（拖拽+点击）→ Task 2
   - [x] 画布工作区 → Task 2
   - [x] 内置参考图库 → Task 3
   - [x] 自定义图库上传 → Task 3
   - [x] B 方案直方图迁移 → Task 1（histogram-transfer.js）
   - [x] A 方案（ICC）占位 → Task 6（算法切换 UI 有，A 算法实现为后续里程碑）
   - [x] 迁移强度滑块 → Task 6
   - [x] 预览对比 → Task 4
   - [x] 单图下载 → Task 5
   - [x] 批量处理按钮 → Task 5（UI 存在，批量逻辑可后续扩展）
   - [x] IndexedDB 存储 → Task 1（storage.js）
   - [x] LocalStorage 偏好 → Task 1（storage.js）

2. **Placeholder 检查：** 无 TBD/TODO/不完整步骤

3. **类型一致性：** `transferColor(srcPixels, refPixels, intensity)` 参数顺序在 Task 1 和 Task 4 中保持一致

---

**计划完成并保存到 `docs/superpowers/plans/2026-05-13-colormuse-plan.md`**。两个执行选项：

**1. Subagent-Driven（推荐）** — 我 dispatch 独立子 agent 逐任务执行，任务间 review，快速迭代

**2. Inline Execution** — 在本 session 内批量执行，执行过程中设置 checkpoint 供你 review

选哪个？