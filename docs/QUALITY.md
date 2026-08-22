# 质量与验证

## 质量目标

Architecture Block Studio 的质量标准不是“页面能打开”，而是设计事实、直接操作、Windows 文件闭环和可视化审查在同一合同下成立。任何看不清、选不中、拖不动、方向误导或保存后变化的图形，都视为产品问题。

## 验证分层

| 层级 | 验证对象 | 失败说明 |
| --- | --- | --- |
| TypeScript | 类型、公开接口、删除旧路径后的引用闭合 | 类型失败时不能进入构建 |
| Unit | Schema、Editor、布局、端口几何、直线投影、手动 waypoint、Windows 服务 | 纯合同不成立，不应靠 UI 测试掩盖 |
| Browser E2E | 真实鼠标 / 键盘、选择、端口、线路、层级、文件下载、Undo / Redo | DOM 断言必须对应产品行为，不保留已删除算法的旧 telemetry |
| Firefox core | 浏览器事件、Pointer、焦点和 CSS 差异 | Chromium 通过不能替代第二引擎证据 |
| Electron | Windows 壳、sandbox preload、原生文件、最近设计、固定 Dock、端口拖动 | 浏览器开发页不能替代桌面产品验收 |
| Production build | 自架构门禁、TypeScript 与 Vite 生产输出 | 生成图漂移或构建失败不得发布 |
| Screenshot review | 线路方向、文字、端口、选中态、折点、Dock 与遮挡 | 自动化通过不等于视觉可读 |

## 数据与编辑完整性

- `BlockDesignDocument` 是唯一设计事实源。
- 每次持久修改必须是一个具名 `DesignOperation`，成功只写一次 History，失败保持原文档。
- Undo / Redo、dirty、saved baseline 和 canonical serialization 必须使用同一文档语义。
- 无效加载、迁移或保存不能替换当前文档、改变文件绑定或清空 dirty。
- 工作区选择、语言、Dock、viewport、预览和最近文件引用不能进入设计 JSON。
- 旧 Schema 迁移后必须经过当前 Schema 与 DRC，不能静默保留不可解释字段。

## 连线合同

浏览器对每条可见线路读取完整 `data-route-points`，逐条验证：

1. 所有坐标有限。
2. 相邻点不重复。
3. 自动线路恰好两个点。
4. 手动线路相邻点共享 x 或 y。
5. 路线开始和结束于当前源 / 目标端口。
6. 语义箭头只出现在真实 target，层级 continuation 不重复箭头。
7. 线中标签数量始终为 0。

交叉、共线和经过模块是自动直线的明确允许结果，不再运行旧避障、lane、线桥、route certificate 或成对冲突断言。判断重点是规则可解释、线路可选中，以及用户能把具体线路调整成手动正交路线。

压力场景必须覆盖非均匀分布：

- 五层层级全部展开，逐条检查 20 条可见线路；
- 一个 Hub 拥有 100 条连接，卫星模块各只有 1 条，逐条检查全部 100 条线路；
- 大设计验证选择、聚焦、缩放和连接预览不会因线路数量失去响应。

布局 node-first 安装期间允许某条线短暂没有端点；此时只能暂不投影该线，不能伪造坐标或使 Canvas 崩溃。该生命周期必须有独立单元与真实五层 / 100 线浏览器证据。

## 端口与图形操作

- 输入 / 输出语义由文档方向拥有；常规布局建议 input 在左、output 在右，但用户可把端口放在四边。
- 圆形 Handle 只负责创建连接；端口名称是唯一移动入口。
- 端口名称透明命中区必须通过 inverse zoom 保持约 30 CSS px，低缩放仍能直接抓取。
- 顶 / 底端口显示为向卡片内部展开的垂直 chip，不能推低 Header 或盖住线路。
- 端口拖动越过角点可换边，相连线路实时跟随，pointerup 只提交一次 `side + offset`。
- 自动线选中后显示中点菱形；鼠标拖动和键盘方向键都能创建手动路线。
- 自动线第一次拖动后必须形成带端口短桩和可继续拖动中央主干的清晰路线，不能只在端点旁生成微小折弯。
- 手动线的段、折点和端点入口必须可区分，视觉形状小于透明命中区。
- 连接创建 / 重连预览必须恰好是一条直接线，合法与非法端口反馈明确，Escape 完整取消。
- 模块移动、缩放、多选、对齐、分布、复制、粘贴和视口 auto-pan 继续使用各自唯一 Owner，不因连线简化而退化。

## 视觉审查清单

每张关键截图人工检查：

- 箭头与 `source → target` 一致；
- 无线中标签；
- 模块标题、端口名、线路和 Properties 不互相遮挡；
- 自动直线的选择高亮清楚，中点入口可识别但不过分抢眼；
- 手动折线段与折点可区分；
- 顶 / 底端口 chip 垂直且位于卡片内部；
- 低缩放端口名称仍容易命中，不出现额外抓手；
- 左右栏固定、可隐藏和恢复，不出现无法关闭的中央浮窗；
- MiniMap、Controls、状态提示和菜单不覆盖当前操作目标；
- 截图中没有 error / warning 横幅或明显布局跳变。

本轮关键截图：

- `direct-line-routing.png`：默认设计的自动直线、端口与箭头。
- `direct-line-selected.png`：线路选择高亮与中点调整入口。
- `manual-route-editing.png`：直线物化为手动正交路线后的段、折点与 Inspector。
- `vertical-port-chips.png`：顶 / 底端口文字方向与卡片内部 rail。
- `windows-port-label-drag.png`：Windows 低缩放端口名称命中与拖动。

## 性能与测试时间

验证时间必须按层报告，不能用一个“测试很久”掩盖实际成本：

- 开发中优先运行受影响 unit 和 5～10 条 focused Chromium 场景。
- TypeScript 与 unit 应是秒级门禁。
- Production build 只在实现稳定后运行。
- Chromium、Firefox 和 Electron 完整回归各集中执行一次，并分别报告用时。
- 测试失败先保存错误、trace 和截图，再修根因；不反复重跑整套套件碰运气。

性能样本只记录可比较的产品动作，例如加载到可交互、选择、聚焦、组缩放、保存和连接预览。已删除的 Worker 求解、障碍注册、route patch 或 certificate 指标不得继续作为当前质量门槛。

## 发布门槛

发布 Windows 新版本前必须同时满足：

- 自架构生成文件无漂移；
- TypeScript、unit、Chromium、Firefox core 和 Electron 通过；
- production build 与 Windows NSIS 打包成功；
- 安装包哈希和 Release 资产可验证；
- packaged 应用能在客户端检查、下载并触发更新；
- dirty / 未应用草稿会阻止安装重启；
- README、产品、架构、连线和质量文档描述当前实现；
- 关键截图已人工检查；
- 用户未授权时不得自行推送、打 tag 或发布。

当前安装包未签名，SmartScreen 信誉仍是已知发布风险。产品只支持 Windows x64，不投入移动端适配或测试。
