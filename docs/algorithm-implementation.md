# Color Muse 仿色算法实现详解

## 总览

Color Muse 实现了 **3 种**仿色算法，均在浏览器端纯前端完成。三种算法共享色彩空间转换模块和 LUT 查表模块，通过 `preview.js` 调度切换。

| 算法 | 文件 | 核心思想 |
|------|------|----------|
| 直方图迁移 | [histogram-transfer.js](../js/color-transfer/histogram-transfer.js) | 匹配源图与参考图各通道的 CDF 分布 |
| LUT 统计迁移 | [lut-generator.js](../js/color-transfer/lut-generator.js) | 对齐源图与参考图的均值/标准差，烘焙为 3D 查找表 |
| 神经预设迁移 | [neural-preset-transfer.js](../js/color-transfer/neural-preset-transfer.js) | 3×3 协方差矩阵建模通道间相关性，白化-着色变换 |

---

## 前置：色彩空间转换

[color-space.js](../js/color-transfer/color-space.js) 提供 sRGB 与 CIELAB 之间的双向转换。

### 转换链路

```
sRGB ──linearize──> 线性 RGB ──矩阵乘──> CIE XYZ ──CIE公式──> CIELAB
CIELAB ──逆公式──> CIE XYZ ──逆矩阵──> 线性 RGB ──gammaize──> sRGB
```

### 关键步骤

**1. 线性化 `linearize(c)`** — 去除 sRGB 伽马编码

```
v = c / 255
v > 0.04045  →  ((v + 0.055) / 1.055) ^ 2.4
v ≤ 0.04045  →  v / 12.92
```

**2. 矩阵变换 RGB → XYZ**（D65 白点）

```
| X |   | 0.4125  0.3576  0.1804 |   | R |
| Y | = | 0.2127  0.7152  0.0722 | × | G |
| Z |   | 0.0193  0.1192  0.9503 |   | B |
```

**3. XYZ → Lab**

```
f(t) = t^(1/3)             当 t > 0.008856
f(t) = 7.787×t + 16/116    否则

L = 116 × f(Y/1.0) − 16
a = 500 × f(X/0.95047 − Y/1.0)
b = 200 × f(Y/1.0 − Z/1.08883)
```

**4. 伽马编码 `gammaize(c)`** — 还原 sRGB 编码

```
c ≥ 0.0031308  →  1.055 × c^(1/2.4) − 0.055
c < 0.0031308  →  12.92 × c
```

### 为什么用 CIELAB

CIELAB 具有**感知均匀性**：空间中等距移动对应人眼感知的等量色差。均值、标准差、直方图等统计操作在 Lab 空间比在 RGB 空间更有意义。算法一和算法二在 CIELAB 空间中运算，算法三则在线性 RGB 空间中使用矩阵变换（矩阵乘法在 RGB 空间才有线性意义）。

---

## 算法一：直方图迁移（Histogram Transfer）

> 文件：[histogram-transfer.js](../js/color-transfer/histogram-transfer.js)

### 原理

经典的**直方图规定化（Histogram Specification）**。对源图和参考图的 L、a、b 三个通道分别计算 CDF，然后建立映射使源图的 CDF 逼近参考图的 CDF，从而让源图获得参考图的色彩分布。

### 实现流程

```
源图像素 ──rgbToLab──> Lab 像素 ──量化到8bit──> 通道数据
                                                      │
参考图像素 ──rgbToLab──> Lab 像素 ──量化到8bit──> 通道数据
                                                      │
                              ┌────────────────────────┘
                              v
                    对每个通道（L / a / b）：
                    ① computeHistogram  →  256-bin 直方图
                    ② computeCDF        →  归一化累积分布
                    ③ buildMatchMap     →  源→参考 映射表
                              │
                              v
                    对每个源图像素：
                    ④ 查映射表得到新的 Lab 值
                    ⑤ labToRgb 转回 RGB
                    ⑥ 与原像素做强度混合
```

### 核心函数

#### `computeHistogram(channelData)` — 构建直方图

```javascript
hist = new Uint32Array(256)  // 256 个 bin
for each v in channelData:
    hist[v]++               // 统计每个灰度级出现次数
```

#### `computeCDF(hist)` — 累积分布函数

```
cdf[0] = hist[0]
for i = 1..255:  cdf[i] = cdf[i-1] + hist[i]

// 找到第一个非零 bin 的值 minVal
// 归一化到 [0, 255]
out[i] = round(((cdf[i] - minVal) / (total - minVal)) × 255)
```

返回 `Uint8Array(256)`，是一个查找表：输入任意值，输出其在 CDF 中归一化后的位置。

#### `buildMatchMap(srcCDF, refCDF)` — 构建匹配映射表（核心步骤）

```
y = 0
for v = 0..255:
    while y < 255 AND refCDF[y] < srcCDF[v]:
        y++
    matchMap[v] = y
```

含义：对于源图中的值 `v`，在参考 CDF 中找到第一个 `refCDF[y] ≥ srcCDF[v]` 的 `y`。由于 CDF 单调递增，指针 `y` 只增不减，整体 O(256)。

#### `transferColor(srcPixels, refPixels, intensity)` — 主入口

1. 将源图和参考图所有像素转为 Lab，量化到 8-bit：
   - L：`L × 2.55`（Lab L 范围 0-100 → 0-255）
   - a：`a + 128`（Lab a 范围约 -128~+127 → 0-255）
   - b：`b + 128`
2. 对 L、a、b 分别执行 `computeHistogram → computeCDF → buildMatchMap`
3. 对每个像素查表得到新的量化 Lab 值，还原后 `labToRgb` 转回 RGB
4. 强度混合（在 RGB 空间）：`output = orig + (mapped - orig) × intensity`

### 特点

- **精确分布匹配**：迁移后每个通道的 CDF 严格等于参考图的 CDF
- **通道独立**：L、a、b 三通道独立处理，不建模通道间相关性
- **映射单调**：不会引入新的局部极值或伪影

### 适用场景

**精确复制参考图的色调分布**。适合：
- 需要严格匹配参考图色调风格的场景（如同一批照片的一致化）
- 参考图与源图色域差异较大时（CDF 匹配天然处理极端分布）
- 对色彩保真度要求高、不希望出现意外色偏的场景

**原因**：直方图规定化是数学上精确的分布匹配——迁移后源图每个通道的 CDF 与参考图完全一致。映射的单调性保证了不会产生原始色彩中不存在的新极值，因此输出不会有突兀的色块或伪影。

---

## 算法二：LUT 统计迁移（Reinhard Statistical Transfer）

> 文件：[lut-generator.js](../js/color-transfer/lut-generator.js) + [lut-applier.js](../js/color-transfer/lut-applier.js)

### 原理

基于 **Reinhard 等人的统计色彩迁移**方法（"Color Transfer between Images", 2001）。不逐像素匹配分布，而是将源图和参考图在 Lab 空间的**均值和标准差**对齐（z-score 标准化），然后将映射关系烘焙到一个 33×33×33 的 3D 查找表（LUT）中，应用时通过查表完成迁移。

### 实现流程

```
参考图像素 ──extractLabStats──> {muL, muA, muB, sigmaL, sigmaA, sigmaB}
源图像素 ──extractLabStats──> 同上（若无源图则用默认值）
                │
                v
        createIccMapper(srcStats, refStats, intensity)
        生成映射函数: (R,G,B) → (R',G',B')
                │
                v
        遍历 33×33×33 RGB 网格，每个点过映射函数 + gamutCompress
        输出 → Float64Array (35,937 × 3 = 107,811 个值)
                │
                v
        applyLut：对源图每个像素做三线性插值查表
```

### 核心函数

#### `extractLabStats(pixels)` — 提取 Lab 统计量

遍历所有非透明像素（alpha ≥ 128），计算 L、a、b 各通道的均值和标准差：

```
μ = ΣLab / n
σ = √(ΣLab²/n − μ²)    // 若 σ = 0 则回退为 1
```

返回：`{ muL, muA, muB, sigmaL, sigmaA, sigmaB, n }`

#### `createIccMapper(srcStats, refStats, intensity)` — 创建映射函数

**核心公式**（Reinhard z-score 标准化）：

```
newL = (L − srcμL) / srcσL × refσL + refμL
newA = (a − srcμA) / srcσA × refσA + refμA
newB = (b − srcμB) / srcσB × refσB + refμB
```

直觉：先将源图像素"去均值除标准差"变成 z-score，再用参考图的均值和标准差"重建"，从而将源图的色调整体拉向参考图。

强度混合在 Lab 空间做 lerp：`new = orig + (mapped − orig) × intensity`

#### `gamutCompress(r, g, b)` — 色域压缩

z-score 迁移后 Lab → RGB 反算可能出现超出 [0, 255] 的值。处理方式：

```
maxOvershoot = max(各通道超出量)
factor = 1 − maxOvershoot / (maxOvershoot + 255)
output = 128 + (color − 128) × factor
```

将颜色向中性灰 (128, 128, 128) 方向拉回色域内，保持明度尽量不变。

#### `generateLut(refPixels, size, intensity, srcPixels)` — 生成 3D LUT

- 无源图时使用默认统计量：`μL=50, μA=0, μB=0, σL=25, σA=20, σB=20`（典型正常曝光图像）
- 遍历 33³ = 35,937 个 RGB 网格点，每个点经映射函数 + 色域压缩
- 结果存入 `Float64Array`，值归一化到 [0, 1]

### LUT 应用：三线性插值（lut-applier.js）

对源图每个像素，在 3D LUT 中做**三线性插值**：

1. 将 RGB 归一化到 [0, 1]，乘以 `(size-1)` 得到网格坐标
2. 取 floor 和 ceil 得到 8 个相邻网格顶点
3. 计算小数偏移 `fr, fg, fb`
4. 8 个顶点值按权重加权求和：

| 顶点 | 权重 |
|------|------|
| (r0,g0,b0) | `(1−fb) × (1−fg) × (1−fr)` |
| (r1,g0,b0) | `(1−fb) × (1−fg) × fr` |
| (r0,g1,b0) | `(1−fb) × fg × (1−fr)` |
| (r1,g1,b0) | `(1−fb) × fg × fr` |
| (r0,g0,b1) | `fb × (1−fg) × (1−fr)` |
| (r1,g0,b1) | `fb × (1−fg) × fr` |
| (r0,g1,b1) | `fb × fg × (1−fr)` |
| (r1,g1,b1) | `fb × fg × fr` |

5. 结果 clamp 到 [0, 1] 后缩放到 [0, 255]，Alpha 保持不变

LUT 索引方式：`(b × size² + g × size + r) × 3`，每个网格点存 R、G、B 三个值。

### 附带功能：CUBE 文件导出

[cube-writer.js](../js/color-transfer/cube-writer.js) 将生成的 3D LUT 序列化为 Adobe `.cube` 格式，可导入 Photoshop、DaVinci Resolve 等专业软件使用。

### 适用场景

**电影/摄影调色氛围的整体迁移**。适合：
- 需要快速预览和迭代调色方案（LUT 生成后应用极快）
- 参考图色调比较统一时（如电影画面的整体色偏）
- 需要导出 LUT 供专业软件使用的工作流

**原因**：Reinhard z-score 只对齐一阶和二阶统计量（均值和标准差），是一种"模糊"的色彩匹配——它捕捉整体色调趋势而非精确分布。烘焙为 LUT 后应用速度为 O(1)/像素，适合实时预览和批量处理。但当源图和参考图的色彩分布形态差异较大时（如一张高对比 vs 一张低对比），仅对齐均值/标准差会丢失细节。

---

## 算法三：神经预设迁移（Neural Preset Transfer）

> 文件：[neural-preset-transfer.js](../js/color-transfer/neural-preset-transfer.js)
>
> 灵感来源：Ke et al., "Neural Preset for Color Style Transfer" (CVPR 2023)

### 原理

受 NeuralPreset 论文启发，实现其核心数学思想：使用**完整的 3×3 仿射色彩变换矩阵**建模颜色通道之间的相关性。与前两种算法的逐通道独立处理不同，本算法通过协方差矩阵捕捉 R、G、B 三个通道之间的统计耦合关系，实现更自然的色彩迁移。

NeuralPreset 原论文使用神经网络在学习到的色彩空间中计算变换矩阵。本实现用经典的**白化-着色变换（Whitening-Coloring Transform）**替代神经网络，在线性 RGB 空间中直接从图像统计量推导矩阵，无需训练或服务器。

### 实现流程

```
参考图像素 ──downsample──> 降采样 ──computeColorStats──> {μ_ref, C_ref}
源图像素 ──downsample──> 降采样 ──computeColorStats──> {μ_src, C_src}
                                        │
                                        v
                            正则化协方差矩阵 (C += ε·tr(C)·I)
                                        │
                                        v
                        C_src⁻¹ (3×3 矩阵求逆，伴随法)
                        C_ref^½, C_src⁻¹^½ (特征值分解 + 矩阵幂)
                                        │
                                        v
                        A = C_ref^½ · C_src⁻¹^½   (白化-着色矩阵)
                        bias = μ_ref − A · μ_src   (仿射偏移)
                                        │
                                        v
                    遍历 33×33×33 RGB 网格：
                    ① sRGB → 线性 RGB
                    ② 线性插值：T = intensity × A + (1−intensity) × I
                    ③ nr = T·lr + intensity × bias
                    ④ 线性 RGB → sRGB
                    ⑤ 存入 LUT
                                        │
                                        v
                    applyLut：三线性插值查表（复用 lut-applier.js）
```

### 核心数学

#### 白化-着色变换（Whitening-Coloring Transform）

给定源图协方差 `C_src` 和参考图协方差 `C_ref`，变换矩阵 `A` 将源图的色彩分布"旋转+缩放"到参考图的分布：

```
A = C_ref^(1/2) · C_src^(-1/2)
```

**直觉**：
1. `C_src^(-1/2)` 先将源图"白化"——去除源图的色彩相关性，使各通道独立且方差为 1
2. `C_ref^(1/2)` 再"着色"——赋予参考图的色彩相关性和方差

**与 Reinhard z-score 的关键区别**：

| | Reinhard z-score | 白化-着色变换 |
|--|-----------------|-------------|
| 协方差建模 | 只用对角元素（各通道标准差） | 使用完整 3×3 协方差矩阵 |
| 通道关系 | R/G/B 独立处理 | 捕捉通道间旋转和剪切 |
| 色彩空间 | CIELAB | 线性 RGB（矩阵乘法要求线性空间） |
| 变换类型 | 逐通道缩放+平移 | 完整仿射变换（旋转+缩放+剪切+平移） |

#### 矩阵平方根：特征值分解

3×3 对称正定矩阵的平方根通过 Jacobi 迭代特征值分解实现：

```
M = V · diag(λ₁, λ₂, λ₃) · Vᵀ
M^(1/2) = V · diag(√λ₁, √λ₂, √λ₃) · Vᵀ
M^(-1/2) = V · diag(1/√λ₁, 1/√λ₂, 1/√λ₃) · Vᵀ
```

Jacobi 迭代最多 60 次，对 3×3 矩阵收敛极快（通常 < 10 次）。

#### 仿射变换

完整映射为：

```
p' = A · p + bias
bias = μ_ref − A · μ_src
```

其中 `p` 和 `p'` 为线性 RGB 颜色向量。强度混合通过矩阵 lerp 实现：

```
T = intensity · A + (1 − intensity) · I
p' = T · p + intensity · bias
```

当 `intensity = 0` 时退化为恒等变换（输出 = 输入），当 `intensity = 1` 时为完整白化-着色变换。

#### 协方差正则化

为避免病态矩阵导致数值不稳定，在对角线上添加小量正则化：

```
C += ε · tr(C) · I,   ε = 10⁻⁴
```

这确保矩阵始终正定，特征值分解稳定收敛，矩阵求逆安全。

#### 性能优化：降采样统计

协方差计算遍历所有像素，对大图（4K = 800万像素）开销较大。通过降采样到 ~65,000 像素（约 256×256）进行统计：

```
step = ceil(totalPixels / 65536)
每隔 step 个像素取样
```

协方差矩阵在降采样后足够准确，而 LUT 生成与像素数无关（O(33³) 固定开销）。

### 适用场景

**保留色彩通道间自然关系的专业调色**。适合：
- 源图和参考图的色彩相关性差异较大时（如暖色调中 R-G 耦合紧密的场景）
- 需要更"真实"的色彩迁移结果（保持肤色、天空等自然色彩的通道间关系）
- 参考图有丰富的色彩层次（如日落、霓虹灯等多通道耦合的场景）

**原因**：现实世界中，颜色的 R/G/B 通道不是独立的——暖色调中 R 强则 G 也偏强，冷色调中 B 强则 R 偏弱。直方图迁移和 Reinhard z-score 都忽略这种耦合，逐通道独立处理可能导致通道间关系被破坏（如肤色偏绿、天空偏紫等）。白化-着色变换通过完整协方差矩阵保留了这种通道间关系，迁移结果更自然。

---

## 三种算法对比

| 维度 | 直方图迁移 | LUT 统计迁移 | 神经预设迁移 |
|------|-----------|-------------|-------------|
| **理论基础** | 直方图规定化（CDF 匹配） | Reinhard z-score 标准化 | 白化-着色变换（协方差矩阵） |
| **色彩空间** | CIELAB | CIELAB | 线性 RGB |
| **匹配精度** | 精确——CDF 严格相等 | 近似——仅均值+标准差 | 近似——均值+完整协方差 |
| **通道关系** | 独立 | 独立 | **耦合** |
| **计算方式** | 逐像素直接计算 | LUT（固定开销）+ 查表 | LUT（固定开销）+ 查表 |
| **强度控制** | RGB 空间 lerp | Lab 空间 lerp | 矩阵 lerp + 偏移缩放 |
| **色域处理** | `labToRgb` 内部 clamp | 专用 `gamutCompress` | sRGB 伽马编码自动 clamp |
| **可导出性** | 不支持 | 支持 `.cube` | 支持 `.cube` |
| **适用场景** | 精确色调分布复制 | 电影氛围整体迁移 | 自然色彩关系保留 |
| **性能** | O(N) 逐像素 | O(33³) LUT 生成 + O(N) 查表 | O(33³) LUT 生成 + O(N) 查表 |

### 选择指南

```
需要精确匹配参考图的色调分布？
  → 直方图迁移

需要快速迭代、导出 LUT、整体氛围迁移？
  → LUT 统计迁移

需要保留色彩的自然通道关系、处理复杂色彩层次？
  → 神经预设迁移
```

---

## 代码入口

[preview.js](../js/preview.js) 中的 `runTransfer()` 根据用户选择的算法模式分发：

```javascript
if (currentAlgo === 'lut') {
    currentLut = generateLut(refPixels, 33, intensity, srcPixels);
    result = applyLut(srcPixels, currentLut);
} else if (currentAlgo === 'neural-preset') {
    currentLut = generateNeuralPresetLut(refPixels, 33, intensity, srcPixels);
    result = applyLut(srcPixels, currentLut);
} else {
    // histogram
    result = transferColor(srcPixels, refPixels, intensity);
}
```

两种 LUT 算法复用同一个 `applyLut` 三线性插值函数和同一个 `.cube` 导出函数。
