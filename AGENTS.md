# ARGUS-IX — 维护索引

面向维护者的仪表盘：全局规则、常用命令、验证快照、文档地图。

## 文档地图

- 架构设计与防错清单 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 模块索引与变更路由 → [js/README.md](js/README.md)
- 决策与依据 → [.agents/notes/](.agents/notes/)
- 第三方许可 → [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 用户视角的用法 → [README.md](README.md)

## 全局规则

以下每条都在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 有展开。

- 无构建步骤，纯 ES Module + importmap，运行时零 CDN。
- 动画用绝对时间，不用帧增量。
- 取包围盒用 `part.bbox`，不用 `Box3.setFromObject`。
- 部件唯一来源是 `ship.js` 的 `PART_DEFS`。
- 改后处理链或像素比前，先读架构文档的「清晰度契约」。

## 常用命令

- 开发预览：`node server.mjs 4173` → http://127.0.0.1:4173/
- 远程仓库：https://github.com/cslkkl/starship-anatomy
- 重新 vendor three：从 `node_modules/three` 拷贝内核与用到的 addons 到 `vendor/`
- 文档链接校验：

```shell
python C:\Users\11965\.agents\skills\maintenance-flow\check-markdown-links.py . --fragments --refs
```

- 换行校验：

```shell
python C:\Users\11965\.agents\skills\maintenance-flow\check-line-endings.py .
```

检查选择：

- 改文档 → 链接校验 + 换行校验。
- 改 js → 手动验收清单（见下），项目暂无自动化测试。
- 改 css → 手动验收宽屏 / 竖屏 / 抽屉三态。

## 验证快照

项目无 CI，验收靠手动清单。

- 13 个部件、79 个可拾取网格、展开后 11 条标签（同组合并后）。
- 控制台 0 错误 0 警告（干净加载）。
- 已手动验收：剖析、逐级、复位、检视、单件剖析、聚焦、X 光、激光、GTAO、
  5 个机位、截图导出、移动端抽屉、手势四姿态与关闭清场。
- 文档校验：链接 0 错误 0 警告，行尾 0 不一致。
- 手势的真实识别效果未经真人验证（开发环境无可用摄像头）。

## 待办

- [ ] 无自动化测试，验收全靠手动清单
- [ ] `main.js` 约 900 行、`ship.js` 约 1300 行，超出单文件合适规模
- [ ] 未配 ESLint / Prettier / pre-commit / CI

## 活跃坑

- `file://` 打开必失败，ES Module 与 importmap 都需要 HTTP。
- `EffectComposer` 自建渲染目标 `samples` 默认 0，不开 MSAA 则边缘全锯齿。
- `devicePixelRatio` 可能小于 1，按原值渲染会被浏览器放大而发虚。
- `Color.lerp` 在线性空间，小系数经 sRGB 编码后观感远大于预期。
- 无头 / 后台标签页会把 rAF 限流到约 1fps，此时帧率读数显示 `—` 属正常。
- `getUserMedia` 可能永久挂起，必须带超时兜底。

## 文档网络约定

- 根 README 面向外部访客，是门面。
- 根 AGENTS 面向维护者，是仪表盘。
- 子目录双件：README 写「有什么、改哪」，AGENTS 写「要遵守什么」。
- 所有引用用相对路径，不写本机绝对路径。
- 每次文档改动后跑链接校验，报错必须修。
