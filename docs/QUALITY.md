# 质量标准

## 质量目标

Architecture Block Studio 处理的是可进入版本控制和 AI 工作流的架构事实。质量目标不是“页面能打开”，而是：设计不丢失、文件可解释、编辑可恢复、复杂图可读、审查结果可追踪。

生产级 Definition of Done 同时覆盖模型、编辑、文件、交互、可视几何、性能、可访问性和发布证据。某一层通过不能替代其他层。

## 当前基线（2026-08-19）

| 证据 | 当前结果 |
| --- | --- |
| TypeScript + Vite production build | 通过，1883 modules transformed，7.17 秒 |
| Vitest 快速单元测试 | 86 / 86 通过，14 个 test files，0.453 秒 |
| 干净检出 | 从远端 `main` 全新克隆后，`pnpm install --frozen-lockfile`、production build、73 / 73 unit 与独立端口双浏览器完整回归通过；测试服务器默认由当前检出拥有，只有显式设置 `PLAYWRIGHT_REUSE_SERVER=1` 才允许复用 |
| Vitest 历史压力通道 | 1000 / 2000、20 次操作：compact snapshot 1,639,002 bytes，21 份保留 34,419,093 bytes；单 fork 在 worker 内强制暴露 GC，三轮 heap / ArrayBuffer / 合计增量中位数为 3,646,384 / 32,780,088 / 36,426,472 bytes，三项离散度均为 0%；Apply / Undo 总耗时中位数 466 / 371 ms |
| 可重复性能证据 | `pnpm performance:baseline -- --runs 3` 连续完成历史与 Chromium 压力档各 3 次，输出 6 份 `performance-sample v1` 和 1 份 observation-only 趋势报告；最新浏览器首次可交互中位数 2552 ms、十次编辑 2692 ms、最终测量内存 65,320,494 bytes；Sources 定位中位数 217 ms，MiniMap 往返定位中位数 63 / 60 ms，每次只发生 1 次 viewport 变换 |
| Chromium Playwright | Playwright 1.62.1 / Chromium build 1234，38 / 38 通过；与 Firefox 在已核验为当前检出的开发服务器上并行完整回归 75 / 75，共 2.2 分钟 |
| Firefox 产品 Playwright | Playwright 1.62.1 / Firefox build 1538，37 / 37 通过；执行除 Chromium CDP heap 压力采样外的全部产品合同，覆盖文件、编辑、审查、可访问性、焦点、Dock、层级、路线线段 / 折点编辑、端点重连、方向 marker、四侧标签轨道、Tooltip、Command Palette 与保存导出 |
| 可访问性门禁 | 默认工作台与 Open Dialog 的 WCAG A / AA 结构规则、可交互责任区和文本对比度通过；Toolbar / Canvas Tooltip、Command Palette 的 pointer、focus、Esc、禁用原因、视口几何与 reduced motion 在 Chromium / Firefox 通过 |
| 默认示例 | 3 levels、32 modules、40 declared connections；两层展开后 54 visual edges |
| 大型设计 | 200 modules / 400 connections 保持全量 Canvas DOM 与 400 条路径逐线段几何检查，默认 Hierarchy 首批仅挂载 40 行；独立执行中首次可交互 950 ms、模块选择并完成 280 ms 平滑聚焦 410 ms、四类模块搜索、一次增量加载并键盘定位 966 ms、接口筛选 255 ms、接口端点聚焦 374 ms、保存并校验 77 ms；测得 JS + embedder + backing storage 总量 71,410,189 bytes |
| 压力设计 | 1000 modules / 2000 connections 的模型、布局、1000 个 MiniMap 节点与保存保持全量，初始 Canvas DOM 只挂载视口内 200 modules / 430 connections，默认 Hierarchy 为完整 1002 行投影但首批 DOM 仅 40 行；三轮中位数：首次可交互 2552 ms，十次 Level 编辑 2692 ms、Undo 199 ms、Redo 190 ms；Sources 选择屏外模块并定位到可读尺寸 217 ms，MiniMap 首尾节点跨图定位 63 / 60 ms，四次 Hierarchy 查询、一次增量加载与最终定位 758 ms，接口筛选 131 ms、接口端点与路径定位 182 ms，保存并校验 62 ms；历史交互测得增量 18,264,378 bytes，最终 JS + embedder + backing storage 总量 65,320,494 bytes |
| 几何检查 | 已覆盖模块碰撞、端点内侵、边界逃逸、设计坐标中的独立线路共路、根级兄弟重叠、线中标签，以及大型设计 400 条路径逐线段穿块检查 |
| 截图证据 | `professional-workbench.png` 复核 1680 × 1050 默认工作台的文档栏、菜单、聚焦工具栏、Sources、Canvas、Inspector、Messages 和状态层级；`edge-editor.png`、`edge-editor-detail.png` 与 `edge-editor-manual-detail.png` 复核 Core ↔ Tool System 密集端口之间的平行线路、虚拟线段点、小型端点抓手、真实折点和手动调整后路线，且 0 线中标签 / 大双圆环；`connection-direction.png` 与 `connection-direction-compact.png` 复核 1680 × 1050 / 1280 × 720 下 Project → Core 向上 target 箭头、中性 source 连接点、selected integration 同色和无反向箭头；`focused-toolbar.png` 复核 1280 × 720 下 12 个直接工作流动作、扩展后的层级路径和 0 全局溢出；`command-palette.png` 复核统一搜索表面、禁用原因、快捷键、画布上下文和无遮挡；`command-tooltip.png` 复核禁用工具的名称、同源成立条件、清晰对比度及与 Canvas caption、节点和 Inspector 的边界；`compact-workbench.png` 复核 1280 × 720 下的手动线路、Inspector、Messages、MiniMap 与固定操作区；`aio-routing-validation.png` 复核默认 AIO 7 modules / 10 interfaces 的低缩放信息收敛、端口名与完整线路；`incremental-routing.png` 复核既有复杂设计中新建模块、端口和接口后的端口外向路径、手动把手、0 中部标签与连接 Inspector；`linked-id-suggestion.png` 复核同名第二模块的唯一 ID 建议、焦点、Dialog 与底层选中模块上下文；`menu-typeahead.png` 复核高频创建命令字符定位；`disabled-menu-focus.png` 复核禁用命令的可见焦点、原因层级、无误导 hover 和工作区无遮挡；`disabled-command-guidance.png` 复核空白设计中三条创建前提；`manual-routing.png` 复核恒定命中区、键盘焦点、手动路径与连接 Inspector；`keyboard-module-move.png` 复核模块键盘移动后的 selection、重新布线和 Inspector 上下文；`rejected-module-drag.png` 复核草稿阻止拖动后的原位投影、未应用表单和明确错误；`drc-remediation.png` 复核问题、修正方向、筛选、画布和 Inspector 的信息层级；`editor-routing-validation.png` 复核层级 continuation；`editor-polished-workbench.png` 与 `firefox-apply-focus.png` 复核选中路径、端口名与双浏览器焦点；`hierarchy-search.png` 复核大型图的列表密度、端口、线路、MiniMap 与 Inspector |
| 端口轨道截图 | `port-label-rails.png`、`port-label-rails-detail.png` 与 `port-label-rails-compact.png` 分别复核 1680 总览、1680 Project / Core 局部放大和 1280 Fit：端口名与 Header / Owner 分层，dataType 常态收敛，连接点保持原几何，紧凑 MiniMap 默认收起且没有卡片遮挡 |
| 文件路径 | URL、本地文件、不可变兼容矩阵、`2.0 -> 2.1` 输入/输出 golden migration、canonical record ordering、保存后重载、无效替换保护已覆盖；本轮 Chromium / Firefox 文件旅程及 Chromium 无效替换 3 / 3，Save As / 重开与 Save / Export 2 / 2 |
| 编辑闭环 | 新建、模块、端口、鼠标拖线、键盘端点选择、手动路由、层级绑定、Undo / Redo、Save / Save As / Export 已覆盖 |
| 浏览器范围 | Chromium 38 / 38 完整自动化；Firefox 37 / 37 产品合同，唯一排除项为 Chromium 专属 CDP heap 采样；WebKit 尚未验证 |

Phase 0 真实 Dogfooding 发现的首屏 React 警告、空白设计引导、Inspector 草稿丢失和 Dialog 焦点问题，已在 Iteration 1–4 完成并纳入持续回归。Iteration 9–19 已建立快速单测、稳定 DRC、完整公开 `DesignOperation` 合同、纯历史状态机、自动可访问性门禁、可复现大型设计基线和层级搜索。Iteration 20 重走三角色旅程，Iteration 21 补齐模块直接依赖摘要，Iteration 22 补齐键盘接口创建，Iteration 23 完成连续无鼠标设计与保存，Iteration 24 建立 Firefox 核心自动化并修复跨浏览器焦点链，Iteration 25 收敛布局、Canvas 和选择协议的 Owner，并修复密集线路的确定性车道冲突，Iteration 26 建立 model-owned 逐步迁移注册表和完整支持矩阵，Iteration 27 统一 canonical 文件输出与 dirty baseline，Iteration 28 建立 1000 / 2000 历史与浏览器压力通道并隔离无关编辑触发的整图重排，Iteration 29 让 Sources 搜索结果和接口列表渐进挂载，Iteration 30 完成第三次产品与质量复盘，Iteration 31 让大图选择只更新受影响投影，Iteration 32 在不删减设计事实的前提下建立压力 Canvas 视口裁剪，Iteration 33 将外部交叉定位与画布内选择解耦并支持 MiniMap 节点直达，Iteration 34 将默认 Hierarchy 也收敛为完整投影加渐进 DOM 窗口，Iteration 35 建立带版本的原始样本、重复执行入口与只观察趋势报告，Iteration 36 修正视口证据边界、第三方 MiniMap 陈旧回调和压力跨图动画长尾，Iteration 37 校准历史压力 worker 的 GC 前提并拆清确定性字节与进程 heap 观测，Iteration 38 将 Firefox 扩展到除 Chromium CDP 性能采样外的全部 22 条产品合同；当前仍缺崩溃恢复、历史容量策略、固定 CI 硬件上的性能预算和 WebKit / 桌面系统矩阵，因此仍不标记为 production-ready。

Iteration 39 明确了 WebKit 的宿主依赖边界；Iteration 40 第四次按新用户、日常用户和 Reviewer 复评完整产品；Iteration 41 让 viewport 唯一派生低缩放 detail level，在保留模块标题、端口名、把手和线路的前提下收起不可读的次级文字。上述改进没有改变设计 JSON、布局、路由或 selection 的事实边界。

Iteration 42 将高频 surface、border、row text、control size 与 motion 收敛到最小视觉 token，并删除四个无下游 token；Iteration 43 让同一 viewport 投影提供 inverse zoom，使路由把手在任意缩放下保持 24 px 命中区和 14 px 视觉方块。两轮均以 computed style、双浏览器合同与截图验证，未改变设计事实。

Iteration 44 为每条语义 DRC 和布局失败诊断补齐可检索 remediation；Messages 只展示规则输出，点击后继续复用同一 `SelectionRef` 交叉定位。诊断建议属于派生结果，不进入设计 JSON。

Iteration 45 以 headed Chromium 实测发现从 Messages 命令到筛选输入需要 22 次 Tab；现在 Studio 只发出一次性面板焦点请求，Messages 在自身边界内接管输入焦点。菜单打开、severity 切换、remediation 搜索、结果 Enter 交叉定位与 Shift+Tab 返回筛选器已在 Chromium / Firefox 同一旅程中验证。

Iteration 46 发现 React Flow 的键盘选择只修改库内 selection，无法进入权威 `SelectionRef`；Canvas 现在统一接管 Node / Edge 的 Enter、Space 与 Escape。线路把手以无边界 spinbutton 表达设计坐标，Arrow 每次提交 8 像素并在新 Edge 投影稳定后恢复同一线段焦点；键盘完成 Undo、Redo、Reset、保存和退出，截图人工复核线路、把手、Inspector 与画布无遮挡。

Iteration 47 的 headed 旅程证明 React Flow 把 Agent UI 从 `(60,270)` 临时移到 `(80,272)`，保存仍是 `(60,270)`；现在 Canvas 拦截选中模块的 Arrow，按 16 像素网格提交 `node/move` 并等待文档投影恢复焦点。两次移动、Undo、Redo 的真实下载分别保存 `(76,286)`、`(76,270)`、`(76,286)`，不再存在只在画布上成立的模块位置。

Iteration 48 检查到上述拦截也使 React Flow 内建 assertive live region 保持空白；Canvas 现在只在 Editor 接受移动后，从目标设计坐标派生一次 polite 公告。Chromium / Firefox 均验证 right / down 两次准确位置反馈，并共同通过默认 WCAG 旅程；公告不读取 DOM，也不进入设计或历史。

Iteration 49 用真实未应用 Inspector 草稿验证鼠标拖动拒绝链：React Flow 在按下期间可以显示临时预览，但松手后若 Studio 拒绝 `node/move`，Canvas 会恢复同一文档位置。Chromium / Firefox 都断言预览确实发生、最终 transform 精确回到起点、草稿和错误继续存在；完整 49 / 49 双浏览器回归及 headed 截图复核通过。

Iteration 50 第五次按新用户、日常专业用户和 Reviewer 复评 Design / Understand / Review：headed Chromium 的空白起步、完整键盘设计并保存、模块直接依赖审查、手动布线 4 / 4 通过；双浏览器完整 49 / 49、69 / 69 unit、production build、三轮压力趋势和官方 production dependency audit 同时通过。依赖与 Owner 复核确认 JSON 仍是唯一设计事实，默认示例可被文件、URL、查询参数或嵌入对象替换；线路截图没有中部标签、穿块或明显遮挡。当前没有用机械拆文件代替架构收敛。

Iteration 51 在 1280 × 720 真实桌面视口验证全工作台：Canvas、Inspector、Messages、MiniMap、固定操作区与状态栏都在 viewport 内且无全局滚动，选中线仍提供至少 23 px 的把手，方向键写入手动路由，线中标签保持 0。当前实现已经满足该合同，因此没有为凑修改而增加 CSS；新增合同在 Chromium / Firefox 2 / 2 及完整 51 / 51 回归通过，`compact-workbench.png` 已人工复核。

Iteration 52 在默认 AIO 复杂设计中真实新建 Review Gateway、左侧输入端口和类型化 RPC，首次捕获到智能路径从目标模块内部接近端口，以及分道末端微小对角段在点击把手后被持久化的问题。路由 Owner 现在仅在端口侧被违反时经外向 stub 重新寻路，并对自动分道、手动提交和端点恢复统一执行严格正交化；Canvas 对无坐标变化的点击不再提交路由。新增场景同时验证 8 modules / 11 interfaces、0 碰撞 / 穿块 / 共路 / 端口内侵 / 中部标签、Arrow 手动调整、保存、Undo / Redo 和 0 可见错误；Chromium / Firefox 2 / 2、完整 53 / 53、73 / 73 unit 与 headed 截图均通过。

Iteration 53 从远端 `main` 建立全新临时检出，证明依赖安装、build、unit、Chromium / Firefox、默认示例、URL、本地 JSON 与 `2.0 -> 2.1` 迁移不依赖原工作区缓存。验收同时发现 Playwright 的固定 4317 端口会静默复用其他检出的 Vite；配置现在以 `PLAYWRIGHT_PORT` 提供显式隔离端口、用 `--strictPort` 禁止 Vite 自动漂移，并把服务器复用收敛为本地显式 opt-in，避免绿灯来自错误代码。

Iteration 54 以专业用户连续创建旅程确认：New Design、Add Module、Add Port 和 Create Child Design 都要求重复填写名称和 ID，虽然 Editor 已有同一合法化与唯一性函数。现在名称在未手改 ID 时实时生成作用域内唯一建议；手改后继续改名称不会覆盖用户决定。同名模块与端口分别得到稳定 `-2` 后缀，最终下载验证自定义文档 ID、两个模块、两个端口与子 Level 精确持久化；双浏览器目标 2 / 2、完整 55 / 55、75 / 75 unit、build 与 headed 截图通过。

Iteration 55 沿统一命令链测量高频创建的无鼠标路径，没有引入会争用浏览器或输入框的全局快捷键。`MenuBar` 现在按可见名称完成顶层与展开菜单的字符定位，重复字符环绕同首字母可用项，禁用项跳过、无匹配保持焦点；Add Module、Add Port、Add Interface 与 Create Child Design 的同一旅程在 Chromium / Firefox 通过，Xvfb headed 截图确认菜单焦点、Inspector、MiniMap 与正交线路互不遮挡。

Iteration 56 在空白设计、单模块无端口和已有子设计三次真实状态转换中确认：Menu 与 Toolbar 原先都只把命令画灰，用户无法知道前提。现在 `StudioCommandAvailability` 强制每个禁用命令携带同一原因；Menu 可见展示，Toolbar 的 title 与 accessible name 同步消费。双浏览器旅程验证 Add Port、Add Interface 和 Create Child Design 的原因随 selection、ports 与 hierarchy 自动变化，菜单结构、文本对比度、完整回归及 headed 截图同时通过。

Iteration 57 按 ARIA 复合菜单语义让禁用菜单项可聚焦但不可激活，原因可被键盘和辅助技术读取；方向键、Home / End、字符定位、Enter / Space 和真实 pointer 已在 Chromium / Firefox 验证。Iteration 58 对照成熟画布工具重建统一视觉系统：浅色文档栏、菜单、语义分组工具栏、Dock、Sources、Canvas、节点、Inspector、Messages、Dialog 与状态栏全部消费同一 token Owner。设计 JSON、命令 eligibility、selection、布局和路由均未改变；完整 59 / 59 双浏览器、75 / 75 unit、1879-module build、7 / 7 headed 场景、双视口截图和文本对比度门禁通过；最终长标题边界、紧凑工作台与 WCAG 门禁又在 Chromium / Firefox 6 / 6 复验。

Iteration 59 用一个局部、自我完备的 `Tooltip` 展示 Owner 取代 Toolbar 与 Canvas controls 的浏览器原生 `title`。Toolbar 只传入同一 `StudioCommands` label、shortcut 与 `unavailableReason`，Canvas 保留原 zoom bounds / Fit 行为；pointer 延迟、focus 即时、Esc / click 关闭、禁用按钮不可激活、视口内定位和 reduced motion 在双浏览器同一旅程验证。E2E 选择器同步改用 accessible role / name，不再把原生 title 当作产品合同。

Iteration 60 第六次复评重走新用户、日常专业用户、Reviewer、DRC 和 200 / 400 大图五条 headed Chromium 旅程，并复核文件、依赖、Owner、状态分类与关键截图。复评捕获两条“画面已经可操作、延迟状态仍在变化”的竞争：Dialog 接受名称后被较晚的 passive effect 重置建议 ID；Sources 平滑定位尚未结束时，模块继续移动使 pointerdown 偶尔命中 pane。Dialog 初始化现统一前移到 layout effect；Studio Fit、交叉定位、MiniMap 和 Canvas controls 的动画统一由 Canvas generation 管理，并在 pointer 进入时固定当前 transform。唯一 ID headed 并发重复 10 / 10、Dialog / 键盘链双浏览器 8 / 8、草稿保护与 Canvas controls 动画中断双浏览器重复 20 / 20 通过；最终 75 / 75 unit、1880-module build 与 Chromium 31 / 31 + Firefox 30 / 30 完整回归通过。空白设计与 Dialog 截图已刷新到当前视觉系统，没有用重跑掩盖首次失败。

Iteration 61 实测从已聚焦 Design 入口到 Validate 仍需 8 次键击，且用户必须记住命令分类。现在 `CommandPalette` 以 `Ctrl/⌘ K` 从同一 `StudioCommands` 派生 21 个可检索动作，支持中英文名称、快捷键、禁用原因、Arrow 环绕、Enter、Esc 和无结果；它不复制 execute 或 eligibility。双浏览器旅程验证禁用 Add Port 不执行、Dialog 模态期间不叠层、Add Module 焦点交接、Validate 直接进入 DRC 筛选、reduced motion、WCAG 结构与文本对比度；headed `command-palette.png` 复核弹层、画布和线路无遮挡。

Iteration 62 对新用户启动、日常连续建模和 Reviewer 审查三类路径测量后，将 Toolbar 从 18 个常驻动作收敛到 File、History、Create、Fit / Validate 共 12 个。低频全图布局与已有 Dock 上下文入口的 6 个动作仍由同一 `StudioCommands` 在 Menu / Command Palette 完整提供；命令、eligibility 和反馈均未改变。常驻命令宽度从 618 px 降至 415 px，1280 视口层级路径从 546 px 增至 749 px；双浏览器完整 65 / 65、75 / 75 unit、build 与五张 headed 截图通过。

Iteration 63 从 JSON、validation、layout、route 和 Canvas 完整追踪 Project / Knowledge → Core：错误不在 source / target，而在边没有 marker、Port Handle 又用同一个固定三角形冒充方向。现在每条非 continuation edge 只在真实 target 显示一个与线宽解耦的闭合箭头，Port 使用中性圆点；接口颜色由 edge 变量统一供给普通态、selected state 和 marker。根图 10 / 10 marker、hierarchy continuation 0 marker、向上 target approach 和 selected integration amber 已在 Chromium / Firefox 验证；完整 67 / 67、截图全图与局部放大、typecheck、unit 和 build 同时通过。

Iteration 64 将连接点几何与端口标签排版拆成两个投影：Handle 继续使用既有稳定位置，标签由 `layout/nodeGeometry` 的同一宽度估算与四侧 rail 独立排布，已有合法 authored size 不被展示层放大。端口名常驻，dataType 只在可读缩放的 hover / focus 与 Properties 渐进出现；紧凑桌面 MiniMap 默认收起并提供显式开关。首次完整回归如实暴露 authored 尺寸误钳制、层级路线共路和 Firefox 标签遮住 Handle，修正 Owner 后 79 / 79 unit、1882-module build、Chromium 35 / 35 + Firefox 34 / 34 = 69 / 69 全部通过；三张截图人工复核无标题、Owner、标签或 MiniMap 遮挡。

Iteration 65 对照 draw.io 的 edge handler 边界，将“路径生成”和“线路直接编辑”拆开：`routing/routeEditing` 只负责可测试的正交线段、折点移动与折点删除几何，Edge 只拥有 gesture 预览。选中自动线显示空心菱形虚拟线段点，拖动后物化手动 route；手动线显示实心真实折点，支持拖动、Arrow、Delete / 双击删除；端点重连进入独立 `connection/reconnect`，合法端点写回 source / target 并清除旧 waypoint，非法目标保持原文档。重连仍保留透明大命中区，但只显示小实心抓手，避免 Port 外形成第二个大圆环。86 / 86 unit（0.453 秒）、1883-module build（7.17 秒）、完整 Chromium 38 / 38 + Firefox 37 / 37 = 75 / 75（2.2 分钟）通过；三张 1680 × 1050 / 放大截图人工复核密集四线平行、编辑点清楚、0 线中标签和 0 大双圈。

## 每次迭代的最小验证门槛

每个完成的迭代必须留下与风险相称的证据：

1. `pnpm typecheck` 或等价的 `pnpm build` 通过。
2. 与改动 Owner 对应的测试通过；公共状态链变化必须跑完整 E2E。
3. 浏览器中真实完成受影响旅程，不只调用内部函数。
4. 检查 console error、page error、未处理 Promise 与可见失败反馈。
5. UI 变化在 1680 × 1050 主视口截图检查；响应式或窄屏变化增加对应视口。
6. 记录本轮目标、根因、修改、证据和剩余问题到 `ROADMAP.md`。
7. 不以更新截图、降低断言或扩大超时来掩盖回归。

## 生产级 Definition of Done

### 数据与编辑完整性

- 所有持久修改只通过 `DesignOperation` 进入文档。
- 无效操作、加载、布局和保存失败都不会产生部分文档状态。
- Undo / Redo 覆盖每类持久操作，并明确历史容量与大文档内存策略。
- 删除和迁移维护引用完整性，没有悬空 interface、level、port 或 binding。
- dirty 判断、保存快照与下载内容使用同一序列化合同。
- 未提交表单草稿在切换选择、关闭面板、加载文件和执行 Undo 前得到显式处理。

### 文件安全与兼容

- 支持的每个 Schema 版本有合法、非法和迁移 golden fixtures。
- 迁移按版本逐步执行，失败保留原文件与当前已安装设计。
- 未知字段采用严格拒绝或保留写回的统一策略；不能静默删除用户文件事实。
- 同一文档重复序列化结果稳定；默认值、字段顺序和尾换行有测试。
- Save、Save As、Export、外部 URL 和本地文件语义在 UI 中清楚区分。
- 浏览器下载失败或权限拒绝有可见反馈，不能提前标记 saved。
- 正式发布前提供自动恢复方案，并明确恢复副本不是正式事实源。

### 视觉与交互

- 页面必须保持稳定的画布工作台层级：文档与校验摘要、菜单、分组工具栏、左右上下文面板、中心 Canvas、按需 Messages 和次要状态栏；Canvas 是唯一视觉主面。
- surface、文字、边界、控件高度、圆角、阴影与状态色必须由统一 token Owner 提供；组件只表达语义角色，不建立局部第二套视觉常量。
- 强调色只表达选择、错误、dirty 与主操作；普通结构依靠留白、密度和弱分隔线建立层级，不以装饰性阴影、渐变或多套边框争夺注意力。
- 选择在 Tree、接口列表、Canvas、DRC 和 Inspector 之间一致。
- Studio Fit、Sources、Messages、Inspector、MiniMap 或 Canvas controls 发起的平滑定位必须可被新的画布 pointer 操作立即中断；移动中的目标不能让随后拖动落到 pane。
- DRC 同时说明问题与简短修正方向；修正方向由规则 Owner 派生、可搜索、可读屏，不由 Messages 复制或自动改写设计。
- 属性编辑、选择和面板调整不导致画布重挂、意外 Fit 或缩放跳变。
- 紧凑桌面下 MiniMap 默认不覆盖模块或线路，并保留明确的显示 / 收起入口；开关只改变 viewport 辅助展示。
- 选中线路必须直接暴露可区分的虚拟线段点、真实折点和端点抓手；视觉图形小于命中区，端点抓手不能与 Port 叠成大双圆环，线路仍不得出现中部标签。
- 线段 / 折点拖动、键盘微调、折点删除、Reset Auto 和端点重连都必须经具名原子操作进入同一 Undo / Redo 与保存链；预览、焦点恢复和非法拖动不得成为第二份路线或端点事实。
- 空白画布提供清晰的第一步，不迫使新用户猜工具栏图标。
- 菜单、工具栏、快捷键和命令面板来自同一命令定义，名称、快捷键、禁用与反馈一致；命令面板只能维护查询和当前结果，不能保存动作副本或重新判断可用性。
- 常驻工具栏只投影启动、连续编辑、建模和审查直接工作流；低频全图动作与已有上下文入口的面板动作必须继续在完整 Menu / Command Palette 可达，不能通过删除命令换取视觉简洁。
- 所有禁用命令都必须由同一命令合同给出原因；Menu 可见显示，Toolbar hover 与 accessible name 同步表达，不允许投影层复制 eligibility 判断。
- 菜单字符定位从当前焦点向后环绕全部实际渲染且名称匹配的命令，包括 `aria-disabled` 项；重复字符循环同首字母项，无匹配时焦点不移动，禁用项激活保持无操作，命令执行仍由统一命令定义负责。
- 弹窗支持 Esc、初始焦点、焦点循环与关闭后的焦点恢复。
- 弹窗的打开态草稿必须在可交互画面与初始焦点成立前完成初始化；用户的首次快速输入不能被更晚的初始化 effect 覆盖。
- 破坏性操作说明级联范围，并支持取消；可撤销时明确告知。
- 所有错误进入一致的可见反馈通道，不依赖 console。
- 选中模块时可以在不追逐画布线路的情况下查看其直接入站、出站接口与对端，并跳转到接口合同。

### 布局与路由

- 线中标签 DOM 数量始终为 0；接口完整名称通过选择进入 Inspector。
- 每条真实连接只在 `BlockConnection.target` 显示一个箭头；端口连接点保持中性，hierarchy continuation 不重复箭头，选中态不丢失接口类型颜色。
- 端口连接点与标签轨道分别投影：排版不能移动 source / target；端口名不与 Header、Owner、相邻标签或端点重叠，dataType 只作为渐进细节出现。
- 路径不穿过无关模块或层级容器，不在端口之外进入节点。
- 同端点和密集路径在设计坐标中保持可区分轨道，Fit / 缩放不改变路由事实；选中态在白色衬底上仍清楚。
- 展开或收起层级不丢失父级上下文与 hierarchy continuation。
- Optimize Routing 不移动 authored blocks；Regenerate Layout 才改变派生 placement。
- 几何测试基于实际浏览器边界框和可点击路径，不只比较 SVG 字符串。

### 可访问性

- 所有图标按钮有稳定 accessible name；焦点样式可见。
- 菜单、tabs、dialogs、tree-like navigation 与 forms 使用正确角色和键盘行为。
- 全流程可在不使用鼠标的情况下完成核心选择、编辑、校验和保存。
- 尊重 `prefers-reduced-motion`，不依赖颜色单独表达错误、选择或接口类型。
- 表单错误与字段关联，读屏可感知；对比度达到 WCAG 2.2 AA。
- 自动化包含 axe 或等价规则扫描，关键复杂组件保留人工键盘验证。

当前门禁使用 Axe 覆盖 WCAG A / AA 结构规则；Axe `color-contrast` 在该 transformed SVG 工作台无法于正常测试预算内完成，因此由浏览器 computed color、透明度合成和 WCAG luminance 计算提供等价文本对比度门禁，不跳过该质量项。

当前键盘能力已覆盖菜单、命令面板、Dialog、Hierarchy 搜索、Inspector 表单、端点选择、类型化接口创建、删除、Undo / Redo 与保存。Iteration 23 已用一条从空白设计到下载 JSON 的连续 Chromium 旅程证明这些能力可以组合成立；Iteration 24 已在 Firefox 重跑同一旅程并验证 Apply 后焦点恢复，Iteration 38 已把菜单、Dialog、完整编辑和文件合同扩展到 Firefox 产品旅程；Iteration 55 补齐顶层与展开菜单的字符定位，Iteration 56 让禁用前提进入可见文案和辅助名称，Iteration 61 用统一命令搜索缩短跨菜单与跨面板路径并验证焦点交接。WebKit 自动化和读屏人工验证仍不得省略。

### 性能与大设计

必须建立三档可复现实例，而不是用默认示例代替大设计：

| 档位 | 建议规模 | 验证重点 |
| --- | --- | --- |
| 基准 | 32 modules / 40 connections | 功能、几何、截图与日常回归 |
| 大型 | 200 modules / 400 connections / 多层级 | 加载、展开、选择、筛选、布局和内存 |
| 压力 | 1000 modules / 2000 connections | 降级策略、虚拟化边界、错误恢复，不要求全量同时展开 |

每档记录解析、首次可交互、布局、Fit、选择反馈、保存耗时和峰值内存。正式性能预算必须在 CI 硬件上测出基线后冻结；在此之前不使用未经测量的数字宣称达标。

性能证据分为两个入口：`pnpm test:performance` 快速执行一次纯历史压力测量；`pnpm performance:baseline -- --runs 3` 在同一进程环境编排多轮历史压力和 Chromium 1000 / 2000 真实旅程。每轮测试只负责产生包含场景、运行序号、环境和有限数值指标的 `performance-sample v1`；聚合器校验 Schema、样本完整性、场景、环境与指标字段一致后，在 `performance-results/<timestamp>/` 写入原始样本和 min / median / max / mean / relative spread 报告。该目录由性能证据链独占且被 Git 忽略，不会被 Playwright 的 `test-results/` 生命周期误删；它不是设计事实源，也不进入保存 JSON。

当前报告模式为 `observation-only`：功能失败、样本缺失、Schema 漂移、环境漂移或非有限指标会使命令失败；`policy.thresholds` 明确为 `null`。固定 CI 环境积累足够样本之前，趋势只用于发现长尾和回归候选，不能升级为发布通过声明。

历史内存样本进一步区分两类证据：`snapshotBytes`、`retainedHistoryBytes` 来自 canonical 序列化，是同一文档和操作序列下的确定性事实；`heapDeltaBytes`、`arrayBufferDeltaBytes` 与合计值是特定 Node / 平台进程观测。`vitest.performance.config.ts` 使用单 fork 并为 worker 显式传入 `--expose-gc`，测试在测量前后主动回收且缺少 GC 时直接失败；这能减少回收时机噪声，但仍不能把开发机 heap 数字提升为跨平台预算。

大设计策略优先保持正确性：按层级展开、列表渐进挂载、缓存纯派生结果、限制历史内存，并在昂贵操作前提供明确状态。压力档允许 Canvas 只挂载当前视口内的节点和边，但文档、布局、React Flow store、MiniMap、状态总数和保存输出必须保持完整；跨视口平移后必须恢复节点选择、端口和线路。200 / 400 档继续全量挂载，以保留逐线段穿块门禁。不得把布局结果写回文档或删减接口事实来换取速度。

跨视口导航与 Canvas 挂载策略必须共同成立。默认和 200 / 400 档保留 280 ms 平滑视口动画；1000 / 2000 压力档直接定位到目标，避免动画途经区域反复换挂载造成多秒卡顿。直接定位不是删减事实：MiniMap、目标选择、端口、线路与 Inspector 必须在同一次 viewport 变换后恢复。`prefers-reduced-motion` 在所有规模下继续使用无动画路径。

### 平台矩阵

| 平台 | 开发门槛 | 正式发布门槛 |
| --- | --- | --- |
| Chromium / Linux | 每次完整 E2E | 必须通过 |
| Chromium / Windows | 关键文件与编辑流程 | 必须通过 |
| Chromium / macOS | 冒烟与快捷键差异 | 必须通过 |
| Firefox | 除 Chromium CDP 性能采样外的全部产品 E2E | 必须通过 |
| WebKit / Safari | 当前未覆盖 | 核心流程、布局和下载必须通过 |

快捷键显示和行为必须处理 Ctrl / Meta 差异。平台未验证时，文档只能说明已验证范围。

## 测试分层

### 模型与编辑单元测试

- Schema 合法 / 非法边界、默认值和错误路径。
- 每种 `DesignOperation` 的成功、失败、级联与原子性。
- DRC issue 的稳定 id、严重性与目标定位。
- 序列化与文件名规范化。
- Schema migration golden tests。

当前已覆盖 Schema 支持矩阵、2.0 输入 / 2.1 输出 golden migration、缺失 / 非字符串 / 未支持版本、旧版新字段拒绝，公开 `DesignOperation` 的创建 / 更新 / 移动 / 绑定 / 删除及失败原子性，connection route 写入 / Reset、endpoint reconnect / 旧 route 清理 / 非法方向原子拒绝，正交线段 / 折点移动与折点删除，Undo / Redo / canonical dirty 历史状态机、compact UTF-8 history snapshot、布局 / 几何签名边界、无序 record 稳定序列化与有序数组保留、文件名与加载错误、DRC 稳定定位及正交路由纯函数。`pnpm test:performance` 独立运行大历史测量，不拖慢日常快速单测；Playwright 只组合真实浏览器压力旅程，不重新实现纯历史规则。

### 布局与路由合同测试

- 纯输入产生确定性节点、边和 hierarchy continuation。
- 祖先循环、缺失端点和路由失败行为。
- authored 与 automatic placement 边界。
- 冲突连接的确定性 lane planning 与 lane separation；无冲突连接允许复用车道。

### 浏览器集成与端到端

- 新手：空白设计到第一条合法接口。
- 日常用户：连续编辑、草稿处理、Undo / Redo、保存和恢复。
- 审查者：筛选接口、跨层定位、DRC 处理和源码合同查看。
- 文件：本地、URL、无效替换、保存、另存、导出和重新打开。
- 工作区：resize、collapse、maximize、float、reset 与快捷键。
- 大设计：真实几何、选择可达性、交互响应和截图。

监听 console 必须在页面导航前安装，避免 React 的去重机制让首屏错误逃过测试。

## UI 审查清单

- 信息层级是否一眼可辨，主画布是否保持最大注意力？
- 文案语言、大小写、术语和命令是否一致？
- 控件间距、边框、色彩、焦点与 disabled 是否来自统一 token？
- 是否存在重复或已失效 CSS、无下游行为的 class 和第二套视觉规则？
- 线是否穿过、贴住或被模块遮挡？端口和选中路径是否可辨？
- 空、加载、错误、忙碌、未保存和无结果状态是否都有明确反馈？
- 截图是否来自实际用户流程，并与自动化断言对应？

## 发布门槛

正式发布候选必须：

1. 工作区干净，版本、变更日志和支持的 Schema 范围一致。
2. 单元、合同、E2E、a11y 与平台矩阵达到该版本声明范围。
3. production build 通过，首屏 console / page error 为 0。
4. 三种角色 Dogfooding 通过：新用户、专业日常用户、代码审查者。
5. 文件保存、重新打开、失败恢复和旧版本迁移完成真实验证。
6. 默认与大型设计的几何、截图、带版本原始性能样本和趋势报告可追溯；没有固定 CI 基线时不得伪造数值预算。
7. 已知问题按严重性登记；数据丢失、崩溃、错误保存或 Schema 破坏为零容忍。

历史一次性验证报告已被本文件的持续标准与 `ROADMAP.md` 的迭代记录替代。测试通过是证据，不是产品合同本身。
