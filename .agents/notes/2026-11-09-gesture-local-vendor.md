# 决策：手势识别走本地 vendor（2026-11-09）

状态：生效

## 问题

要加摄像头手势控制，需要手部关键点识别。
MediaPipe 官方推荐从 CDN 加载 WASM 与模型，但那会让页面在离线或断网时直接失效。

## 决策

- 手部识别用 MediaPipe `HandLandmarker`，WASM 与模型全部 vendor 进仓库。
- 资源位置：`vendor/vision/`（含 `vision_bundle.mjs` 与 `wasm/`）、`models/hand_landmarker.task`。
- 运行时零网络请求。
- GPU delegate 优先，失败自动回退 CPU。

## 替代方案（强制）

- 走 CDN 加载：体积省 30 MB，但离线即废，且引入外部可用性依赖，与项目"运行时零 CDN"的既有约束冲突。
- 用浏览器原生手部检测 API：无此标准 API，不可行。
- 只做鼠标交互不做手势：功能缺位，用户明确要求摄像头手势。
- 自训练轻量关键点模型：工作量与精度都不划算，MediaPipe 已是成熟方案。

## 影响

- 收益：离线可用，与 three 一样走本地 vendor，仓库自包含。
- 代价：仓库体积增加约 36 MB（两份 WASM 各约 14 MB + 模型 7.5 MB）。
- 移除方式：删 `vendor/vision/`、`models/`、`js/hands.js`、`js/gesture.js`
  以及 `index.html` 的手势区块，其余功能不受影响。
