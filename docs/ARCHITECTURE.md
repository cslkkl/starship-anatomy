# ARGUS-IX 架构说明

本文件只记录**不变的设计决策、契约与防错清单**。
文件级职责与变更路由见 [js/README.md](../js/README.md)。
工作约束见 [AGENTS.md](../AGENTS.md)。

## 一、项目形态

纯前端静态站点，无构建步骤。

- 运行时零依赖外部 CDN：three 与 MediaPipe 全部 vendor 在仓库内。
- `index.html` 用 importmap 把 `three` / `three/addons/` 映射到 `vendor/`。
- 因此**必须经 HTTP 打开**，`file://` 下 ES Module 与 importmap 均不可用。
- `node_modules/` 只在需要重新 vendor 时用，运行时不读。

## 二、不变量

违反以下任一条都会破坏现有行为，改动前先读本文件。

- **坐标系**：舰首 +Z，引擎 −Z，上方 +Y。
- **部件集合**：`ship.js` 的 `PART_DEFS` 是 13 个可剖析部件的唯一来源，索引、标签、面板列表、HUD 计数全部由它派生。
- **部件自己的 bbox**：`part.bbox` 是构建期几何包围盒，不含运行时特效。
  所有取景、角标、聚焦一律用它，不用 `Box3.setFromObject`。
- **动画用绝对时间**：剖析、相机飞行、手势保持时长全部基于 `performance.now()` 差值。
  帧增量在低帧率或 rAF 被限流时会严重失真。
- **每部件独立材质实例**：高亮只作用于选中部件，不共享材质。
- **内部结构不进可剖析集合**：聚变堆、燃料环、隔框只在 X 光模式显示。

## 三、几何生成

程序化建模，零外部模型文件。

- **船体**：`loftHull()` 用圆角矩形截面沿 Z 轴放样。
- **机翼**：`loftSpan()` 把同样的截面沿 X 轴放样后旋转对齐，得到翼根厚、翼尖薄的翼型，而不是挤出平板。
- **翼面与细节**：`extrudePlanform()` 处理平面轮廓件；`greeble` / `box` / `strip` 生成小结构。
- **UV 按世界尺度生成**（`TEX = 0.34`）：贴图密度全船一致，大面不拉伸。
- **合批**：`Batch` 按材质合并几何，每部件每材质一个 mesh，全舰约 40 个 draw call。

## 四、材质与后处理

- `MeshStandardMaterial` + 程序化 2048² Canvas 贴图（颜色 / 粗糙度 / 由高度图 Sobel 生成的法线）。
- 环境光照来自手工搭建的自发光面板场景经 PMREM 生成，不用 HDR 文件。
- 色调映射 ACES Filmic，曝光 1.22。
- 后处理链：`RenderPass` → `GTAOPass` → `UnrealBloomPass` → `OutputPass`。

### 清晰度契约

这条踩过坑，改动后处理链时必须复核。

- **合成器渲染目标必须显式开 MSAA**：`EffectComposer` 自建目标 `samples` 为 0，`antialias: true` 只作用于默认帧缓冲。
  走后处理链时几何边缘全靠渲染目标的 MSAA，默认值下全是锯齿。
- **像素比下限必须锁 1**：`devicePixelRatio < 1` 时按原值渲染会让画布被浏览器放大，画面必然发虚。
  当前策略：下限 1、上限 2。
- **MSAA 采样数随画幅自适应**：超过约 340 万像素降为 2x，控制显存与带宽。
- **Bloom 分辨率交给 `composer.setSize`**：手动写死 CSS 像素会让 mip 链尺寸和渲染缓冲不一致。

### 高亮的色彩空间陷阱

- `Color.lerp` 在线性空间插值。
- 系数 0.05 经 sRGB 编码后观感接近 25%，会把整块装甲染成橙色。
- 当前系数 0.012；选中反馈主要由角标框与参数卡承担，材质只做极轻暖光。

## 五、交互状态机

`main.js` 的 `state` 是唯一事实源。

- `explode`：当前展开度（0–1，阻尼逼近 `explodeTarget`）。
- `exploding`：目标值（0 或 1 或逐级的 1/3、2/3、1）。
- `inspecting`：选中部件 id。
- `solo`：单件剖析的部件 id。
- `hovered`：鼠标或手势悬停的部件 id，两者共用。
- `opts`：`glow` / `laser` / `labels` / `grid` / `autoRotate` / `xray` / `ao`。

约束：

- 进入剖析时若 `explode < 1`，先补到 1 再进。
- `clearInspect()` 必须同时清 `solo`、重置按钮文案、收起面板。
- 关闭手势会立即清 `hovered` 与准星，不等下一帧。

## 六、取景

- `fitDistanceExact()` 对包围盒逐个角点求所需距离，取最大值，不用包围球近似。
- 投影后用 HUD 安全区（左右面板、顶栏、底栏）做平移与距离补偿。
- 补偿必须**同时放大距离**：只平移会让主体顶到画面边缘。
- 手机的左面板是抽屉，收起时不计入安全区。

## 七、引线标签

- 起点取部件包围盒角点的屏幕投影中最外侧者。
- 落点夹到面板安全区，再做垂直防重叠。
- 同一屏幕区域的同组部件合并为一个标签（`GROUP_OF` / `GROUP_NAME`）。
- 合并是两趟结构：先算组、再应用 `hiddenByGroup`，单趟实现会漏还原。

## 八、手势管线

- `hands.js` 只负责 landmark → 归一化指针 + 姿态（指向 / 捏合 / 握拳 / 张掌）。
- `gesture.js` 只负责姿态 → 页面动作，不碰渲染。
- 两者都用绝对时间判定边沿，不依赖 tracker 的一次性脉冲字段。
- 摄像头权限请求必须有超时兜底，否则权限弹窗无人应答时界面永久卡在请求态。
- MediaPipe 的 WASM 与模型走本地文件，运行时不联网。
- 只保留 `vision_wasm_internal.{js,wasm}` 一份 WASM：
  `FilesetResolver.forVisionTasks(path, useModule = false)` 的第二参数决定拼哪个变体，
  本项目不传，故 `*_module_internal.*` 永不加载，回退方案里可不再保留。

## 九、防错清单

改对应模块前先读一遍。

- **`file://` 打不开不是 bug**：ES Module 需要 HTTP。
- **`EffectComposer` 的 `samples` 默认 0**：见清晰度契约。
- **`devicePixelRatio` 可能小于 1**：见清晰度契约。
- **`Color.lerp` 是线性空间**：见高亮陷阱。
- **`Box3.setFromObject` 会包含着色器特效体**：一律用 `part.bbox`。
- **帧增量动画在 rAF 被限流时失真**：一律用绝对时间。
- **标签组还原要排除 host**：否则组标签文案会被 `baseText` 覆盖。
- **`getUserMedia` 可能永不返回**：必须带超时。
- **`P` 键与 `F` 键已在 keydown 全局绑定**：新增快捷键先查 `main.js` 的 `onKey`。
