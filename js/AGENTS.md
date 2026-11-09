# js/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

## 本目录特有约束

- 纯 ES Module，**不加构建步骤**；import 路径必须带 `.js` 后缀。
- 只从 `vendor/` 或 `../vendor/` 引第三方，不引 CDN。
- 动画一律用 `performance.now()` 绝对时间，不用帧累加。
- 取包围盒一律用 `part.bbox`，不用 `Box3.setFromObject`（会带上着色器特效体）。
- 材质高亮的 emissive 插值在线性空间，系数按 sRGB 观感取值，不要凭直觉放大。
- 部件集合只认 `ship.js` 的 `PART_DEFS`，不在别处硬编码部件 id。
- 文件超 800 行先考虑拆分；拆不动就合并，假拆分比不拆更危险。

## 边界

- 本文件只写“在这里工作要遵守什么”。
- 有什么文件、改哪波及谁 → [README.md](README.md)。
- 为什么这么设计 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。
