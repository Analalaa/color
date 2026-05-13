# Color Muse — 仿色工具

> 通过色彩直方图迁移技术，将参考图的色彩氛围映射到你的图片上

[English](README.md) | [中文](README_zh.md)

---

## 功能特性

- **纯浏览器端运行** — 无需服务器，所有计算在本地完成，图片不离开你的设备
- **直方图色彩迁移** — 基于 LAB 色彩空间的统计色彩迁移，还原参考图的色调氛围
- **内置风格图库** — 5 种预设风格：日系、欧美、复古、赛博、莫兰迪
- **自定义图库** — 上传你自己的参考图，存入本地 IndexedDB
- **迁移强度调节** — 滑块控制 0%~100%，实时预览效果
- **批量下载** — 一次处理多张图片，打包为 ZIP 下载

---

## 技术架构

```
浏览器 (Client)
│
├── Canvas API          图像读取与渲染
├── Web Workers         色彩迁移计算（防止 UI 卡顿）
├── IndexedDB           自定义参考图库持久化
└── LocalStorage        用户偏好设置
```

**色彩迁移原理：** 将图片从 RGB 转换到 LAB 色彩空间，对 L/A/B 三个通道分别做直方图匹配（Histogram Matching），使源图的色彩分布趋近于参考图，最后转回 RGB 输出。

---

## 快速开始

### 方法一：直接打开

```bash
# 克隆仓库
git clone https://github.com/Analalaa/color.git
cd color

# 用任意 HTTP 服务器启动，例如：
python -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

### 方法二：VS Code Live Server

在 VS Code 中安装 Live Server 扩展，右键 `index.html` → "Open with Live Server"

### 方法三：直接双击

双击 `index.html` 即可在浏览器中打开（部分浏览器可能限制 IndexedDB 功能，建议使用 HTTP 服务器）

---

## 使用方法

### 1. 上传图片

- **拖拽上传**：将图片文件拖入中央画布区域
- **点击上传**：点击"选择图片"按钮或画布区域

支持格式：JPEG、PNG、WebP、BMP，单文件最大 50MB。

### 2. 选择参考图

在右侧面板选择内置预设风格（点击缩略图），或切换到"自定义图库"上传自己的参考图。

### 3. 调整迁移强度

使用左侧工具栏的滑块，0% = 原图不变，100% = 完全应用参考图色调。

### 4. 下载结果

点击底部"下载结果"按钮，保存为 PNG 图片。

如需批量处理，先在画布中加载多张图片，再点击"批量处理"。

---

## 内置风格说明

| 风格 | 色调特点 |
|------|---------|
| 日系 | 低饱和度、高亮度、冷调 |
| 欧美 | 高对比度、高饱和度、暖调 |
| 复古 | 颗粒感、褪色效果、色偏 |
| 赛博 | 霓虹色、高对比、紫绿为主 |
| 莫兰迪 | 低饱和灰调、柔和 |

---

## 项目结构

```
color/
├── index.html                  # 主入口
├── css/styles.css              # 样式
├── js/
│   ├── main.js                 # 入口模块、EventBus
│   ├── upload.js               # 图片上传（拖拽+点击）
│   ├── canvas-workspace.js     # 画布工作区
│   ├── reference-library.js    # 参考图库（内置+自定义）
│   ├── preview.js              # 色彩迁移执行与预览
│   ├── download.js             # 下载与批量处理
│   ├── storage.js              # IndexedDB / LocalStorage
│   ├── toast.js                # 提示消息
│   └── color-transfer/
│       ├── color-space.js      # RGB ↔ LAB 色彩空间转换
│       └── histogram-transfer.js # 直方图迁移核心算法
└── assets/references/          # 内置参考图（占位）
```

---

## 进阶自定义

### 替换内置参考图

将真实图片放入 `assets/references/{风格}/` 目录，更新 `js/reference-library.js` 中的 `BUILTIN_REFS` 列表的 URL 路径。

### 添加新的色彩迁移算法

在 `js/color-transfer/` 目录下创建新的算法文件（如 `icc-transfer.js`），在 `reference-library.js` 的算法切换逻辑中引入即可。

---

## 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

建议使用最新版 Chrome 以获得最佳性能。

---

## License

MIT
