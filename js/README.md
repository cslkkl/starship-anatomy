# js/ — 文档层

前端模块索引与变更影响路由。
工作约束见 [AGENTS.md](AGENTS.md)。
设计决策见 [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。

## 模块清单

| 文件 | 行数量级 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `main.js` | 约 900 | 渲染器、灯光、后处理、拾取、UI 接线、`window.__ARGUS__` | 无（入口） |
| `ship.js` | 约 1300 | 程序化建模：部件几何、参数表、材质、内部结构、贴花 | `SHIP` `createMaterialSet` `buildShip` `shipBounds` |
| `camera-rig.js` | 约 200 | 取景适配、机位方向、飞行动画 | `VIEW_DIRS` `createCameraRig` |
| `exploder.js` | 约 50 | 剖析状态机与级联缓动 | `createExploder` |
| `labels.js` | 约 220 | 引线标签、安全区夹取、防重叠、同组合并 | `createLabels` |
| `gesture.js` | 约 340 | 手势控制层：姿态 → 准星 / 点选 / 旋转 / 剖析 / 推近 | `createGestureController` |
| `hands.js` | 约 290 | MediaPipe 手部关键点追踪、骨架绘制 | `HandTracker` `drawHandOverlay` |
| `vfx.js` | 约 500 | 尾焰着色器、激光、枪口闪光、扫描环贴图 | `createEngineFX` `createLaserFX` `createScanRingTexture` |
| `env.js` | 约 280 | 星云背景着色器、星场、全息网格 | `createEnvironment` |
| `textures.js` | 约 560 | Canvas 程序化贴图 | `hullTextures` `flameTexture` `glowSprite` `softCircle` `turbulenceTexture` `decalTexture` `starTexture` |
| `util.js` | 约 50 | 缓动、阻尼、确定性随机 | `clamp` `lerp` `smoothstep` `damp` `mulberry32` 等 |

行数量级用于判断文件是否过大，不追精确值。

## 依赖方向

单向，不允许反向。

```
main.js
├── ship.js ──── textures.js ──── util.js
├── camera-rig.js
├── exploder.js
├── labels.js
├── gesture.js ── hands.js ── vendor/vision
├── vfx.js ───── textures.js
└── env.js ───── textures.js
```

`ship.js` 不依赖 `main.js`，`gesture.js` 不碰 three 渲染对象，`hands.js` 不知道页面存在。

## 加文件前后必读

- `SHIP` 的 13 个部件定义在 `ship.js` 的 `PART_DEFS`。
  增删部件会同时影响：HUD 计数、左侧列表、标签、剖析展开、取景适配。
- 新增模块必须被 `main.js` 引入并接线，否则不会进入渲染循环。

## 变更影响路由

改完代码按此表同步文档。

| 改动 | 必跑 | 必同步文档 |
| --- | --- | --- |
| `ship.js` 部件 / 参数 / 材质 | 手动验收：剖析、检视、X 光 | [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 二、三项 |
| 后处理链 / 像素比 / MSAA | 手动验收：清晰度、帧率 | [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 第四节 |
| `exploder.js` / `camera-rig.js` | 手动验收：剖析、5 个机位、逐级 | 架构第五、六节 |
| `labels.js` | 手动验收：展开后标签数与合并 | 架构第七节 |
| `gesture.js` / `hands.js` | 手动验收：手势四姿态、关闭清场 | 架构第八节 |
| `textures.js` / `vfx.js` | 手动验收：贴图无接缝、尾焰、激光 | 架构第三、四节 |
| `util.js` | 影响面全站，改签名必全量回归 | 不涉及 |
| `css/style.css` | 手动验收：宽屏 / 竖屏 / 抽屉 | 不涉及 |

## 调试接口

`main.js` 把内部对象挂到 `window.__ARGUS__`，控制台可直接驱动，不必改代码。

```js
__ARGUS__.setExplode(1)        // 直接设展开度（0–1）
__ARGUS__.inspect('engineC')   // 选中某部件
__ARGUS__.laser(true)          // 开关激光
__ARGUS__.xray(true)           // 开关 X 光透视
__ARGUS__.view('rear')         // 切机位：hero / side / front / rear / top
__ARGUS__.ortho('top')         // 正交相机看轮廓（top / side / front）
__ARGUS__.persp()              // 回到透视相机
```

同时暴露 `scene` `camera` `controls` `renderer` `composer` `ship` `state`
`exploder` `rig` `labels` `laserFX` `gesture`，供排查时直接读状态。

## 参考

- 设计决策与防错清单 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- 全局规则与命令 → [../AGENTS.md](../AGENTS.md)
