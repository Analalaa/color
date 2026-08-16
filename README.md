# Color Muse — 三方案智能审色 Agent

Color Muse 是一个纯浏览器端运行的参考图审色工具。它不会要求用户先选择算法，而是同时比较三条色彩迁移路径，为每条路径寻找合适强度，再依据参考贴合、层次保留、曝光安全和色彩安全给出推荐、置信度与风险说明。

## 核心能力

- 三种结果导向方案：参考还原、平衡电影感、自然色彩关系
- 每条方案自动比较 60% / 75% / 90% / 100% 四档强度
- 根据画面动态范围、中性色、高饱和区域和肤色候选区域调整评分权重
- 检查 Lab 分布贴合、局部层次、明暗余量、中性色漂移和过饱和风险
- 输出推荐方案、建议强度、四维分数、置信度和审色依据
- Web Worker 并行生成轻量候选，仅对采用方案做全尺寸渲染
- 支持分屏对照、JPEG/PNG、CUBE LUT、近似 Lightroom XMP、审色报告 JSON，以及带进度与取消能力的 Worker 批处理
- 原图与参考图均保留在本地浏览器，不上传服务器

## 快速演示

```bash
python3 -m http.server 8080
```

打开 `http://localhost:8080`，点击“没有素材？一键演示”。应用会自动载入一组不同的原图与参考图并开始审色。

建议通过 HTTP 服务运行；直接双击 `index.html` 时，部分浏览器会限制模块 Worker 或 IndexedDB。

## 决策流程

```text
原图 + 参考图
  → 场景画像
  → 3 条引擎路径 × 4 档强度轻预览
  → 质量指标与风险门控
  → 每条路径保留最佳强度
  → 推荐方案 + 置信度 + 决策理由
  → 仅对采用方案执行全尺寸渲染
```

当前 Agent 是可解释、确定性的本地决策系统，不依赖远程大模型。`自然色彩关系`使用协方差白化—着色变换，受 Neural Preset 的综合色彩关系建模思想启发，但不声称在浏览器中运行神经网络推理。

## 项目结构

```text
js/
├── analysis/
│   ├── scene-profile.js          # 场景画像
│   ├── quality-metrics.js        # 质量指标 V2
│   └── recommendation-policy.js  # 强度选择、风险门控、排序和置信度
├── core/
│   ├── engine-registry.js        # 三条引擎统一接口
│   └── candidate-pipeline.js     # 候选与全尺寸渲染管线
├── workers/candidate-worker.js   # Worker 计算入口
├── ui/candidate-board.js         # 推荐摘要和候选解释界面
├── color-transfer/               # 色彩迁移与 LUT 实现
├── preview.js                    # 审色会话与采用状态
└── download.js                   # 图片、LUT、XMP、报告与批处理
```

## 测试

```bash
npm test

for file in $(rg --files js -g '*.js'); do
  node --check "$file"
done
```

测试覆盖引擎统一接口、零强度恒等输出、参考增益、局部层次损失、曝光与中性色风险、场景画像、强度风险门控、候选排序和推荐置信度。

## 输出说明

- `参考还原`是像素级结果，不提供可复用 LUT。
- `平衡电影感`与`自然色彩关系`可导出 CUBE LUT。
- Lightroom XMP 是从 3D LUT 采样得到的近似参数，不能保证与 CUBE 在所有照片上完全一致。
- 审色报告 JSON 不包含原图像素，只记录场景画像、候选分数、风险、推荐和最终采用参数。

## License

MIT
