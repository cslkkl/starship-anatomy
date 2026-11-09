# 第三方声明

本仓库内 `vendor/` 与 `models/` 目录包含第三方资源。
它们的版权与许可归各自上游项目，不适用本仓库自身的许可条款。

## three.js

- 位置：`vendor/three.module.js`、`vendor/three.core.js`、`vendor/jsm/`
- 版本：r187
- 许可：MIT
- 全文：见 [vendor/three.LICENSE.txt](vendor/three.LICENSE.txt)

## MediaPipe Tasks Vision

- 位置：`vendor/vision/vision_bundle.mjs`、`vendor/vision/wasm/`
- 用途：手部关键点识别
- 许可：Apache License 2.0
- 上游：https://github.com/google-ai-edge/mediapipe

## MediaPipe Hand Landmarker 模型

- 位置：`models/hand_landmarker.task`
- 许可：Apache License 2.0
- 上游：https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

## 字体

HUD 不使用任何内嵌字体文件，只引用操作系统自带字体
（`Segoe UI Variable` 等）。
字体本身不随本仓库分发，不受本文件约束。
