# 质量标准

## 质量目标

Architecture Block Studio 处理的是可进入版本控制和 AI 工作流的架构事实。质量目标不是“页面能打开”，而是：设计不丢失、文件可解释、编辑可恢复、复杂图可读、审查结果可追踪。

生产级 Definition of Done 同时覆盖模型、编辑、文件、交互、可视几何、性能、可访问性和发布证据。某一层通过不能替代其他层。

## 当前基线（2026-08-20）

| 证据 | 当前结果 |
| --- | --- |
| TypeScript + Vite production build | 通过，1900 modules transformed，Vite 7.14 秒 |
| Vitest 快速单元测试 | 168 / 168 通过，20 个 test files / 1.50 秒；除既有场景路由、viewport auto-pan、片段与 Editor 原子合同外，覆盖组选区四边四角、选择顺序不变、内容上下限、旧/超限几何只朝合法范围变化，以及 `nodes/resize` 全批预检与一次提交 |
| 干净检出 | 从远端 `main` 全新克隆后，`pnpm install --frozen-lockfile`、production build、73 / 73 unit 与独立端口双浏览器完整回归通过；测试服务器默认由当前检出拥有，只有显式设置 `PLAYWRIGHT_REUSE_SERVER=1` 才允许复用 |
| Vitest 历史压力通道 | 1000 / 2000、20 次操作：compact snapshot 1,639,002 bytes，21 份保留 34,419,093 bytes；单 fork 在 worker 内强制暴露 GC，三轮 heap / ArrayBuffer / 合计增量中位数为 3,646,384 / 32,780,088 / 36,426,472 bytes，三项离散度均为 0%；Apply / Undo 总耗时中位数 466 / 371 ms |
| 可重复性能证据 | `pnpm performance:baseline -- --runs 3` 连续完成历史与 Chromium 压力档各 3 次，输出 6 份 `performance-sample v1` 和 1 份 observation-only 趋势报告；最新浏览器首次可交互中位数 2552 ms、十次编辑 2692 ms、最终测量内存 65,320,494 bytes；Sources 定位中位数 217 ms，MiniMap 往返定位中位数 63 / 60 ms，每次只发生 1 次 viewport 变换 |
| Chromium Playwright | Playwright 1.62.1 / Chromium 151.0.7922.34，80 / 80 通过；与 Firefox 在当前检出上并行完整回归 159 / 159（4.8 分钟） |
| Firefox 产品 Playwright | Playwright 1.62.1 / Firefox build 1538，79 / 79 通过；执行除 Chromium CDP heap 压力采样外的全部产品合同，覆盖文件、编辑、审查、可访问性、焦点、Dock、层级、模块 move / resize / Shift 比例 resize、不同尺寸组选区八向 resize、单卡与多选组边界辅助线、单卡与不同尺寸选择组实时等距、抓取入口一致性、多选原子对齐 / 分布 / 模块接口混选删除、从模块扩展 1 / 8 / 100 条直接接口、按 source / target 选择入站 / 出站接口与邻域、当前 Level 全选 / 清空 / 按模块或接口类型选择、Copy / Cut / Paste / Duplicate / Ctrl/⌘ 拖动克隆、选中线路完整聚焦、Zoom / Actual Size、Space / middle / right / wheel pan、八条直接手势的边缘自动平移、场景级自动路由、五层真实展开、100 连接偏斜压力、路线线段 / 折点编辑、完整障碍预览、gesture session 注册 / 复用 / 清理、pointer 候选 / 取消 / 非法 / no-op / 成功重连、键盘端点重连、方向 marker、四侧标签轨道、Tooltip、Command Palette 与保存导出 |
| 可访问性门禁 | 默认工作台与 Open Dialog 的 WCAG A / AA 结构规则、可交互责任区和文本对比度通过；Toolbar / Canvas Tooltip、Command Palette 的 pointer、focus、Esc、禁用原因、视口几何与 reduced motion 在 Chromium / Firefox 通过 |
| 默认示例 | 3 levels、32 modules、40 declared connections；两层展开后 54 visual edges |
| 大型设计 | 200 modules / 400 connections 保持全量 Canvas DOM 与 400 条路径逐线段几何检查，默认 Hierarchy 首批仅挂载 40 行；本轮完整回归样本中首次可交互 1420 ms、选择全部 400 interfaces / 200 modules 为 690 / 534 ms、模块选择 435 ms、直接邻域 / 出站邻域为 684 / 749 ms、多选两个模块 695 ms、两模块成组 resize / Undo 为 1508 / 922 ms、Alt 命中 264 ms、键盘遍历 398 ms、模块搜索与定位 1364 ms、接口筛选 440 ms、接口端点聚焦 547 ms、单模块 Cut + Undo 1578 ms、保存并校验 69 ms；连接预览峰值 3.8 ms、末次 0.4 ms；测得 JS + embedder + backing storage 总量 111,109,742 bytes，均为 observation-only 环境观测而非固定预算 |
| 压力设计 | 1000 modules / 2000 connections 的模型、布局、1000 个 MiniMap 节点与保存保持全量，初始 Canvas DOM 只挂载视口内 200 modules / 430 connections，默认 Hierarchy 为完整 1002 行投影但首批 DOM 仅 40 行；三轮中位数仍是历史趋势证据。本轮 Iteration 98 单次复验为首次可交互 4125 ms、选择全部 2000 interfaces / 1000 modules 为 1189 / 693 ms、十次编辑 3540 ms、两模块成组 resize / Undo 为 3369 / 2791 ms、单模块 Cut + Undo 5879 ms，最终测量内存 184,005,434 bytes；这些是本机 observation，不是固定性能预算 |
| 路由五层压力 | 双展开真实场景逐条审计 54 legs、枚举 1431 个无序线对；偏斜 fixture 让一个 5000 × 3500 Hub 拥有 100 个端口和 100 条线、100 个卫星各只有 1 条线，逐条审计 100 routes、枚举 4950 pairs，并在 Optimize Routing 后重跑；纯路由场景覆盖 120 legs / 7140 pairs；真实 UI 五层展开覆盖 20 routes / 190 pairs，并在第 4→5 层键盘重连及 Undo 后重新全量审计；另以 12 个 commodity 穿过五层 Gate 链形成 72 legs / 2556 pairs，检查每条线的 domain 与全部线对；密集共享端口必须诚实 `Unresolved`。逐线检查有限 / 非零 / 正交 / 微短段 / 反向 / 自交，逐对检查共线、8px separation、共享 stub 豁免、每个 strict crossing 的线桥与孤立桥 |
| 几何检查 | 已覆盖模块碰撞、端点内侵、边界逃逸、设计坐标中的独立线路共路、根级兄弟重叠、线中标签、逐线与全部无序线对审计、move 的实时等距 / 边缘 / 中心吸附、不同尺寸多选组的完整包围框 / 等距 / 抓取入口一致性、组选区四边四角、Shift 等比、Alt 绕过、最小 / 最大 scale、嵌套父坐标和低缩放恒定命中区、单卡 resize 的同宽 / 同高吸附、多选六向对齐与水平 / 垂直等中心分布、粘贴子图最近网格无碰撞落位、Ctrl/⌘ 拖动子图在明确指针位移处的路线穿块检查，以及大型设计 400 条路径逐线段穿块检查 |
| 比例尺寸截图 | `aspect-ratio-resize.png` 复核 Platform Provider 从 240 × 145 比例调整为 336 × 203：四角 / 四边抓手、端口、正交线路、Inspector 与工作区无遮挡 |
| 截图证据 | `select-interfaces-in-level.png` 复核当前 Level 全部 10 条接口互斥选中：7 张模块卡保持普通态，10 条线的端口法向、唯一 target 箭头和类型色清楚，Inspector 精确显示 0 modules / 10 interfaces / 1 level，0 穿卡、0 线中标签或工作区遮挡；`select-direct-interfaces.png` 复核 Core 与全部 8 条直接接口一次进入选择：8 条线仍从真实端口法向进出，唯一 target 箭头方向正确，未选的 2 条 Tool 注册线保持普通态，0 穿卡、0 线中标签，模块、端口名、Properties 与 MiniMap 均无遮挡；`batch-delete-after.png` 复核两模块 / 一显式接口经一次删除后剩余 5 modules / 2 interfaces：两条线分别从 Plugin / Platform Provider 进入 Tool System，0 穿卡、0 搅线、0 线中标签，6 个 required-port warning 诚实保留；`equal-distance-guides.png` 与 `equal-distance-group.png` 复核单模块 244 单位、不同尺寸选择组 288 单位的两侧等距：每个场景只有两段无文字洋红括号，现有正交线路、端口名、卡片、Properties 与 MiniMap 均无遮挡；`scene-connection-preview.png` 复核实时连接从源端口法向离开、完整绕过中央高障碍并从目标端口法向进入，0 穿卡、0 回钩、0 线中标签，状态面板不遮挡卡片或线路；`pointer-connection-feedback.png` 复核鼠标改接中的合法候选、端口法向正交预览、右上非遮挡状态面板、既有手工路线与 Inspector 上下文；预览无语义箭头、无线中标签。`ctrl-drag-clone.png` 复核两模块 / 两内部接口 / 一完整子 Level 在指针落点原子克隆：新旧卡片、端口、正交线路、选择轮廓、Properties 摘要与状态反馈无遮挡；`pan-mode.png` 复核选中接口并 Space + 左拖后的临时 PAN MODE pill：默认 7 modules / 10 interfaces、选中路线、箭头、端口、百分比、MiniMap 和 Inspector 均无遮挡；`viewport-zoom-controls.png` 复核聚焦选中接口后的 Actual Size (100%)：实时百分比、选中线路、全部折点、两端模块、方向箭头、端口和 Inspector 可读，控件不遮挡图形；`select-all-level.png` 复核当前 Level 的 7 modules / 10 interfaces 全量选择：Canvas 和 Sources 轮廓一致，Inspector 为 17 objects，端口、标题、线路和箭头仍可辨；`fit-selection.png` 复核单条接口的全部正交折点与两端模块进入可读视口，线路把手、端口与 Inspector 无遮挡。`copy-paste-subgraph.png` 复核两模块 / 两内部接口 / 一完整子 Level 的粘贴结果落在现有系统下方，模块、端口、文字与新旧正交线无遮挡；外部 required Port 被排除后保留 6 个可审查 warning、0 error。`scene-routing-double-expanded.png`、`scene-routing-core-detail.png` 与 `scene-routing-tool-detail.png` 复核真实双展开场景的端口法向、卡片净空、层级 Gate、正交交叉线桥和 0 线中标签；`routing-five-level-overview.png` 与 `routing-five-level-detail.png` 复核五层边界、每层 2 条稀疏流的连续性、局部端口法向和层级净空；`routing-stress-overview.png` 与 `routing-stress-hub-detail.png` 复核 100 条线在四侧独立进出、100 条接口 Inspector 摘要、无拥塞或遮挡。`arrangement-before.png` 与 `arrangement-after.png` 复核 1680 × 1050 下多选模块对齐前后的真实工作台：选择轮廓、卡片、端口、文字与正交线路无遮挡，线中标签保持 0；`alignment-guides.png` 与 `same-size-guides.png` 复核克制的洋红中心参考线和同宽尺寸括号；`professional-workbench.png` 复核默认工作台的文档栏、菜单、聚焦工具栏、Sources、Canvas、Inspector、Messages 和状态层级；`node-resize.png` 复核选中模块四角控制点、四边轮廓、调整后 Canvas size、端口和跟随重算的连接线，且抓手未遮挡端口；`edge-editor.png`、`edge-editor-detail.png` 与 `edge-editor-manual-detail.png` 复核 Core ↔ Tool System 密集端口之间的平行线路、虚拟线段点、小型端点抓手、真实折点和手动调整后路线，且 0 线中标签 / 大双圆环；`connection-direction.png` 与 `connection-direction-compact.png` 复核 1680 × 1050 / 1280 × 720 下 Project → Core 向上 target 箭头、中性 source 连接点、selected integration 同色和无反向箭头；`focused-toolbar.png` 复核 1280 × 720 下 12 个直接工作流动作、扩展后的层级路径和 0 全局溢出；`command-palette.png` 复核统一搜索表面、禁用原因、快捷键、画布上下文和无遮挡；`compact-workbench.png` 复核 1280 × 720 下的手工线路、Inspector、Messages、MiniMap 与固定操作区；`aio-routing-validation.png` 复核默认 AIO 7 modules / 10 interfaces 的低缩放信息收敛、端口名与完整线路；`incremental-routing.png` 复核既有复杂设计中新建模块、端口和接口后的端口外向路径、手动把手、0 中部标签与连接 Inspector；`manual-routing.png` 复核恒定命中区、键盘焦点、手动路径与连接 Inspector；`keyboard-reconnect.png` 复核端点变化后的自动路线、选中线把手、Inspector 重连入口与焦点；`hierarchy-search.png` 复核大型图的列表密度、端口、线路、MiniMap 与 Inspector |
| Cut / Paste 截图 | `cut-paste-subgraph.png` 复核从默认设计剪切 Agent UI + Rust Agent Core 后跨设计粘贴：Legacy 接口与两条片段内部接口保持三条短正交线，唯一 target 箭头、端口名、两张选中卡片、Inspector 与反馈清晰，0 穿卡、0 线中标签或面板遮挡 |
| 视口边缘截图 | `viewport-edge-auto-pan.png` 复核线路段在静止边缘指针下持续移动：live 抓手贴近指针，正式路线暂时隐藏，预览沿两张卡片右侧开放走廊保持正交，0 穿卡、0 线中标签、0 Inspector / MiniMap 遮挡 |
| 多选组吸附截图 | `group-boundary-alignment.png` 复核不同尺寸的 Compact Author / Expanded Coordinator 共同以右侧组边界对齐 Review Target：洋红 guide 只贴边界，两条接口均为短而清楚的端口法向正交线，0 穿卡、0 线中标签、0 Properties / MiniMap 遮挡 |
| 多选组缩放截图 | `group-resize.png` 复核 Compact Author / Expanded Coordinator 经统一包围框等比放大：8 个恒定屏幕尺寸控制点清楚，两条线路仅保留必要正交折点和唯一 target 箭头，端口名、三张卡片、Properties 与 MiniMap 无遮挡，0 穿卡、0 线中标签 |
| 端口轨道截图 | `port-label-rails.png`、`port-label-rails-detail.png` 与 `port-label-rails-compact.png` 分别复核 1680 总览、1680 Project / Core 局部放大和 1280 Fit：端口名与 Header / Owner 分层，dataType 常态收敛，连接点保持原几何，紧凑 MiniMap 默认收起且没有卡片遮挡 |
| 文件路径 | URL、本地文件、不可变兼容矩阵、`2.0 -> 2.1` 输入/输出 golden migration、canonical record ordering、保存后重载、无效替换保护已覆盖；本轮 Chromium / Firefox 文件旅程及 Chromium 无效替换 3 / 3，Save As / 重开与 Save / Export 2 / 2 |
| 编辑闭环 | 新建、模块、端口、模块移动 / 单卡与同父级多模块四边四角 resize、当前 Level 全选 / 仅模块 / 仅接口 / 清空、模块直接接口与直接邻域扩展、入站 / 出站接口与邻域扩展、多选原子对齐 / 分布 / 删除、Copy / Cut / Paste / Duplicate / Ctrl/⌘ 拖动完整子图克隆、选中线路完整聚焦、移动 / 尺寸辅助线与 Alt 绕过、鼠标拖线、键盘端点选择、手动路由、鼠标 / 键盘端点重连、层级绑定、Undo / Redo、Save / Save As / Export 已覆盖 |
| 浏览器范围 | Chromium 80 / 80 完整自动化；Firefox 79 / 79 产品合同，唯一排除项为 Chromium 专属 CDP heap 压力采样；WebKit 尚未验证 |

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

Iteration 66 对照 draw.io 的 vertex handler 边界，将“内容安全尺寸”“gesture 预览”和“持久几何提交”拆开：`layout/nodeGeometry` 计算四侧端口与内容共同要求的最小尺寸，选中模块显示 4 个角控制点和 4 条边命中带；视觉点保持轻量，18 CSS px 命中区在缩放后仍可操作，Port rail 位于其上避免被遮挡。pointer 松手只提交一次原子 `node/resize`，同时保存 position、width、height 与 pinned；键盘以 16 设计像素调整宽高。真实双浏览器旅程证明 resize 后线路跟随、下载 JSON、Undo / Redo、键盘焦点和 live 公告一致；未应用 Inspector 草稿会拒绝提交并恢复原尺寸。88 / 88 unit（0.457 秒）、1883-module build（6.87 秒）、完整 Chromium 41 / 41 + Firefox 40 / 40 = 81 / 81（2.3 分钟）通过；`node-resize.png` 人工复核抓手、端口、线路与 Inspector 尺寸无遮挡。Iteration 80 进一步把键盘组合键校正为官方 `Ctrl/Cmd + Shift + Arrow`，避免与 Shift pointer 等比约束混用。

Iteration 67 对照 draw.io 的 snapping / guide 职责，把“吸附几何”“gesture 候选”和“临时绘制”拆开：`layout/alignmentGuides` 只按同一父级矩形计算边缘、中心和同宽 / 同高结果；Canvas 仅在 gesture 开始时收集视口附近候选，并把 6 CSS px 容差换算到设计坐标；`AlignmentGuideLayer` 不接收 pointer，也不写 JSON、历史或 selection。Alt 只绕过当前 gesture。压力旅程首次暴露 move / resize 会被旧 geometry signature 误判为需要全图 Fit，使大图选中模块在松手后被裁出视口；现在 `layoutFrameSignature` 只对拓扑、端点、Port 与层级框架变化请求 Fit，直接几何编辑保持 viewport。93 / 93 unit（0.448 秒）、1885-module build（6.81 秒）、完整 Chromium 43 / 43 + Firefox 42 / 42 = 85 / 85（约 2.3 分钟）和 1000 / 2000 压力旅程通过；两张 1680 × 1050 截图人工复核参考线、尺寸括号、文字、端口和线路无遮挡。

Iteration 68 对照 draw.io 的 rubberband / selection handler 职责，把领域选择、框选 gesture 和 React Flow 投影拆开：`SelectionRef.multiple` 只保存 canonical node / connection 引用，普通点击 / 框选替换，Shift / Ctrl / Cmd 切换，Esc 清空；左键空白拖动完整包围模块与真实连线，中键 / 右键与滚轮平移。Sources、Canvas、Properties 共同消费一个选择，Properties 提供模块 / 接口 / Level 摘要；多选和框选期间不显示单对象 resize / route 把手。成组 pointer / Arrow 移动通过一次 `nodes/move` 原子提交，Undo 一次恢复全部；级联合同未定义的批量删除明确禁用而不猜测。96 / 96 unit（0.501 秒）、1885-module build（7.03 秒）、完整 Chromium 45 / 45 + Firefox 44 / 44 = 89 / 89（2.5 分钟）通过；200 / 400 图两模块多选为 877 ms；`box-multi-selection.png` 与 `multi-selection.png` 人工复核选区、卡片、端口、线路、Sources 与 Properties 无遮挡。

Iteration 69 对照 draw.io 的 align / distribute action 与批量 transaction 边界，把“命令前提”“纯目标几何”和“持久提交”拆开：`layout/selectionArrangement` 对至少两个同层 authored 模块完成六向包围框对齐，对至少三个模块按中心点等距分布并固定两端；`StudioCommands` 独占 eligibility 与禁用原因，Arrange 菜单和 29 项 Command Palette 只投影同一命令。执行始终复用一次 `nodes/move`，因此 selection、viewport、Undo / Redo、canonical JSON 和路由重算保持同一事实链。首次完整回归为 92 / 93，既有边框选场景在高并发 Chromium 漏选；5 次复现出现 2 次失败，源码追踪确认 React Flow 的 selection start 在首个越阈值 move 才触发。Canvas 现于空白 pane pointerdown 捕获真实起点、selection end 取真实终点并使用纯 client bounds，10-worker Chromium 压力重复 10 / 10。最终 101 / 101 unit（16 files / 0.529 秒）、1886-module build（9.00 秒）、Chromium 47 / 47 + Firefox 46 / 46 = 93 / 93（2.7 分钟）通过；`arrangement-before.png` / `arrangement-after.png` 人工复核选择轮廓、卡片、端口、文字与重新派生的线路无遮挡、0 线中标签。

Iteration 70 执行第七次十轮产品与质量复评，没有预设功能，也没有用局部视觉改动替代证据。复评重读五份权威文档，审计 47 个源文件的 model → editor → layout / routing → Canvas 单向链、`DesignOperation` 唯一持久入口、selection / Dock / viewport / gesture 临时状态、production dependencies、样式 token、循环依赖和死路径；未发现第二份设计事实、跨层直接写入、循环依赖或足以支持机械拆分大型 Studio / Canvas 文件的独立职责。11 条 headed Chromium 新用户 / 日常设计者 / Reviewer 旅程覆盖空白创建、增量接口、线路直接编辑、resize、对齐 / 分布、紧凑工作台、DRC、层级路由与 200 / 400 大图，全部通过并刷新 11 张关键截图；人工逐张复核 target 箭头、端口标签、线路净空、折点把手、卡片尺寸控制点、面板边界和低缩放信息层级。最终 101 / 101 unit（0.532 秒）、1886-module build（7.21 秒）、Chromium 47 / 47 + Firefox 46 / 46 = 93 / 93（4.8 分钟）通过，官方 npm registry production audit 为 0 known vulnerabilities。唯一实现侧优先缺口由固定 draw.io 源码对照收敛为复制 / 粘贴 / Duplicate；本轮只修正 README 遗漏 Arrange 与多选操作的文档漂移，产品代码保持不变。

Iteration 71 由用户真实截图推翻“逐线智能路由已经足够”的旧前提。旧链同时存在哈希 lane、模块对 channel、smart-edge 和渲染后偏移，无法对全场景容量、crossing、层级 Gate 或证明等级负责。现在 `RoutingScene` 是统一纯输入，adapter 只映射绝对几何，`orthogonal-scene-v1` 以版本化安全域、自适应 terminal stub、局部可见图和联合字典序目标求解，独立 verifier 重新检查每条 leg 与全部无序线对并把审计覆盖写入证书；无法满足时返回 `Unresolved`，不画重叠 fallback。交叉仍无法在绕行上限内消除时，`routeJumps` 只派生展示线桥，不改变路线或 JSON。双展开 54 / 1431、真实 UI 五层 20 / 190、100 连接 Hub / 4950、120-leg unit / 7140，以及 12 个 commodity 穿过五层 Gate 链的 72 / 2556 全部通过；109 / 109 unit（1.61 秒）、1891-module build（7.45 秒）、Chromium 49 / 49 + Firefox 48 / 48 = 97 / 97（2.9 分钟）通过。200 / 400 路由冲突扫描在大场景策略中保持显式有界，首次可交互为 1476 ms；七张 headed 截图已逐张复核端口、卡片、线桥、箭头、五层连续性与局部拥塞；官方 registry production audit 为 0 known vulnerabilities。

Iteration 72 对照 draw.io 的 copy / paste / duplicate action、内部 clipboard 与 paste offset 责任，建立带 kind / version 的 `DesignFragment`。片段只包含所选同层模块、内部连接、实际使用的接口定义和完整后代 Level；解析会逐个验证端点、Port、Hierarchy binding、父子 Level、接口精确集合与可达性。Studio 用独立纯放置函数从当前布局求最近无碰撞网格 offset，Editor 的单次 `fragment/insert` 才递增生成 ID、重写全部引用并提交完整 Schema；Duplicate 复用同一条链，系统剪贴板被拒绝时内部片段仍可继续粘贴并给出可见说明。单测对五层引用和 100 条连接 / 101 个非均匀模块逐项检查；双浏览器真实旅程覆盖 Edit、快捷键、Command Palette、保存、一次 Undo / Redo、系统剪贴板退化和 12 条粘贴后路线 / 66 线对审计。最终 117 / 117 unit（18 files / 1.57 秒）、1894-module build（7.82 秒）、Chromium 50 / 50 + Firefox 49 / 49 = 99 / 99（3.1 分钟）通过；`copy-paste-subgraph.png` 已人工复核无模块重叠、穿卡、共享路线或线中标签。复制明确排除外部连接，因此保留 required Port 的 DRC warning 属于真实人审信息，不被实现静默改写。

Iteration 73 执行第八次产品与质量复评。11 条独立 headed Chromium 旅程重新覆盖默认 / 紧凑 / 空白工作台、双层与五层 hierarchy、100 连接偏斜 Hub、200 / 400 大图、线路直接编辑、编排、复制和 resize，11 / 11 在 2.8 分钟内通过。人工逐张复核 11 张最新截图，确认没有新增穿卡、共路、文字遮挡、方向错误或线中标签；固定 draw.io 官方选择与视口命令对照把下一组无歧义缺口收敛为“当前容器全选 / 清空”和“选中线路完整聚焦”。批量删除、Paste Here、右键菜单与恢复仍涉及独立产品合同，本轮没有顺手决定。

Iteration 74 让 `src/studio/selection.ts` 的纯 `selectAllInLevel` 成为当前 Level 全选集合的唯一构造者，从 Level 的 modules + connections 产生去重、稳定排序的 canonical 选择；Edit、快捷键和 Command Palette 仍只投影 `StudioCommands`。`Ctrl/⌘ A` 全选、`Ctrl/⌘ Shift A` 清空，表单控件保留浏览器原生选择；两者都不改变 viewport、JSON 或历史。单测覆盖完整与空 Level，双浏览器真实旅程断言 7 modules + 10 interfaces = 17 objects、视口稳定、输入框不误触发和菜单路径；`select-all-level.png` 已人工复核选择轮廓、端口、文字、线路与 Inspector 无遮挡。

Iteration 75 建立纯 `canvasGeometryBounds`，把选中模块矩形、选中接口全部 route points 与两端模块上下文合并为一个 viewport bounds；Canvas 只在几何真正可用后消费一次性请求，并复用已有可中断导航协调器调用 `fitBounds`。`Ctrl/⌘ Shift H`、View 与 Command Palette 共用 Fit Selection 命令，没有选择时显示同一禁用原因；selection、自动 / 手动路线、设计坐标、JSON 和历史均不变化。最终 119 / 119 unit（18 files / 1.50 秒）、1894-module build（7.44 秒）、Chromium 52 / 52 + Firefox 51 / 51 = 103 / 103（3.0 分钟）通过；200 / 400 最新 observation-only 样本首次可交互 1564 ms、多选 928 ms、搜索 1775 ms、接口聚焦 534 ms、保存 99 ms。`fit-selection.png` 已人工复核完整折线、两端卡片、方向箭头、端口与 Inspector 可读。

Iteration 76 对照 draw.io 官方 Zoom In / Out、菜单、键盘与 Actual Size 入口，确认现有 Canvas 已有正确缩放原语和 min / max，根因是外部命令不可达且缺少可见比例，而不是缩放算法本身。现在 Studio 只发送版本化 `CanvasViewportActionRequest`，Canvas 复用可中断导航协调器执行 zoom-in / zoom-out / actual-size；View、38 项 Command Palette、`Ctrl/⌘ + / −` 和左下控件汇入同一路径。实时百分比直接消费 React Flow transform，点击回到 100%，不建立第二比例。命令 / 菜单 / WCAG / zoom 相关双浏览器 10 / 10，最终 119 / 119 unit（18 files / 1.75 秒）、1894-module build（8.17 秒）、Chromium 53 / 53 + Firefox 52 / 52 = 105 / 105（3.1 分钟）通过；200 / 400 observation-only 样本首次可交互 1490 ms、多选 905 ms、搜索 1944 ms、接口聚焦 613 ms、保存 104 ms。`viewport-zoom-controls.png` 已人工复核 100% readout、选中路线、卡片、端口、箭头和 Inspector 无遮挡。

Iteration 77 对照 draw.io 官方 Space / right / middle pan、wheel scroll 与 modifier wheel zoom，先用无代码实验在 Chromium / Firefox 测得空白画布行为都已成立；进一步从选中接口状态复现出真实缺口：Canvas 自有 Space 键盘选择在 capture 阶段 stop propagation，导致获得焦点的 node / edge 无法进入底层 Space-pan。现在明确设置 pan / zoom activation key，Space 仍完成同一选择但允许 pan activation 继续传播；按住期间只在非表单上下文显示可丢弃 PAN MODE pill。新 E2E 逐项断言左键框选不平移、Space / middle / right 改变同一 transform、普通 wheel 只平移、Control wheel 只缩放，并锁定 route `d`、selection 与 Saved。最终 119 / 119 unit（18 files / 1.55 秒）、1894-module build（7.30 秒）、Chromium 54 / 54 + Firefox 53 / 53 = 107 / 107（3.1 分钟）通过；200 / 400 observation-only 样本首次可交互 1489 ms、多选 1000 ms、搜索 1668 ms、接口聚焦 577 ms、保存 100 ms。`pan-mode.png` 已人工复核 pill、线路、卡片、百分比、MiniMap 与 Inspector 无遮挡。

Iteration 78 对照 draw.io 官方 Ctrl/⌘ + drag clone，将“拖到哪里”与“复制什么”严格拆开：Canvas 只生成同组模块的目标位置并在 gesture 结束后恢复原预览；Studio 从当前权威文档和 authored geometry 求统一位移，复用 `DesignFragment` 构造包含内部接口、实际接口定义与完整后代 Level 的引用闭包；Editor 仍只执行一次 `fragment/insert`。真实旅程把 Agent UI + Rust Agent Core 向下克隆，保存后逐项断言 9 modules、12 connections、新 `core-2` Level 与重写后的 hierarchy binding，再用一次 Undo / Redo 验证原子历史，并检查全部可见路线不穿块。最终 119 / 119 unit（18 files / 1.85 秒）、1894-module build（7.46 秒）、Chromium 55 / 55 + Firefox 54 / 54 = 109 / 109（3.1 分钟）通过；200 / 400 observation-only 样本首次可交互 1474 ms、多选 931 ms、搜索 1782 ms、接口聚焦 606 ms、保存 101 ms。`ctrl-drag-clone.png` 已人工复核新旧模块、端口、内部线路、选择轮廓、Inspector 摘要和反馈无遮挡。

Iteration 79 对照 draw.io 官方 Shift + resize 保持比例合同。首次直接动态切换第三方 `keepAspectRatio` 在 Chromium / Firefox 都让抓手完全失效；继续追踪确认 React Flow 还默认用 Shift 进入自己的 selection mode，在我们的 canonical `SelectionRef` 之外抢占同一 gesture。现在显式关闭第三方 Shift selection mode，Shift 点击 / 框选仍由唯一选择协议处理；纯 `preserveNodeAspectRatio` 按起始矩形、抓手方向和统一尺寸上下限固定对侧锚点，比例约束优先于兄弟尺寸吸附，最终仍只提交一次 `node/resize`。最终 120 / 120 unit（18 files / 1.51 秒）、1894-module build（7.16 秒）、Chromium 56 / 56 + Firefox 55 / 55 = 111 / 111（3.2 分钟）通过；Shift 多选、框选、普通 resize、Alt 绕过、保存与一次 Undo / Redo 均回归。200 / 400 observation-only 样本首次可交互 1535 ms、多选 899 ms、搜索 1549 ms、接口聚焦 516 ms、保存 100 ms。`aspect-ratio-resize.png` 已人工复核 336 × 203 卡片、端口、线路、抓手与 Inspector 无遮挡。

Iteration 80 完成第九次十轮复评。重新审计 `BlockDesignDocument → Editor → layout / routing → Studio / Canvas` 后，没有发现第二设计事实、反向依赖、按连接 id 特判或足以支持机械拆分大组件的新职责；20 张刷新截图逐张复核也没有出现穿卡、短折返、不可解释共路、反向箭头、线中标签或 Dock 遮挡。官方 draw.io 键盘尺寸合同则揭示一个明确漂移：现有 Shift + Arrow 错误承担 resize，与 Shift pointer 等比约束混用。Canvas 现在先拦截选中模块上的 Shift + Arrow，只有无 Alt 的 Ctrl/Cmd + Shift + Arrow 才调用既有 `node/resize`；Shift 单独按下既不修改文档，也不让 React Flow 建立临时位置副本。Inspector、README、架构和测试共用同一组合键合同。最终 120 / 120 unit（18 files / 1.60 秒）、1894-module build（7.07 秒）、Chromium 56 / 56 + Firefox 55 / 55 = 111 / 111（3.2 分钟）、官方 npm registry production audit 0 known vulnerabilities；额外 headed Chromium 12 / 12 覆盖默认 / 紧凑、增量连线、方向、双层、五层、100 连接 Hub、密集线路编辑、排版、复制、克隆和等比缩放。首次 headed 启动因环境缺少 X Server 未进入页面，改用现有 `xvfb-run` 后完整通过，不计作产品断言。

Iteration 81 对照 draw.io 的完整包围、Alt 强制起框、相交选择与 Alt + Shift 移出合同，删除“节点由第三方 select change、线路由 DOM 外接矩形”这两个漂移事实源。`canvasSelection` 现在统一负责模块 client bounds 与真实正交 route segments 的 full / intersecting 判定；Canvas 在 pointerdown 捕获起点与模式，React Flow 只显示 rubberband，结束时才转换为 canonical `SelectionRef`。L 形线路外接矩形中的空白不再误报命中，Controls / MiniMap / 状态提示也不会被 Alt 抢占。第一次完整回归 109 / 113 暴露 Alt 强制起框会破坏既有移动 / resize 绕过吸附；继续核对官方合同后，以时序明确正交边界：Alt 在 pointerdown 前成立时强制框选，直接 move / resize 已开始后再按 Alt 只关闭当前吸附。修正后最终 122 / 122 unit（18 files / 1.50 秒）、1894-module build（7.14 秒）、Chromium 57 / 57 + Firefox 56 / 56 = 113 / 113（3.2 分钟）通过；五层 17 modules / 20 routes、偏斜 101 modules / 100 routes 与 200 modules / 400 connections 都执行真实部分相交框选，最新大图样本首次可交互 1531 ms、多选 865 ms、搜索 1420 ms、接口聚焦 572 ms、保存 112 ms。headed `intersecting-selection.png` 已人工复核选择轮廓、端口、箭头、线路、Inspector 与 Dock 无遮挡。

Iteration 82 对照 draw.io 的 transparent click 源码合同，把 Alt 单击与 Alt 相交框选收敛为同一 pointer gesture 的阈值分支：5 client pixels 内是 point hit，超过阈值继续执行 Iteration 81 的 intersecting rubberband。`canvasSelection` 从模块真实 client bounds 和接口 `plannedRoute` 的逐段距离构造命中栈，使用显式 node z-index、稳定文档顺序和模块高于线路的层级，不读取 DOM 顺序；同一 connection 的 hierarchy legs 先按 canonical key 合并。当前 `SelectionRef` 直接充当循环游标，跳过首个命中模块的容器祖先并在栈底回绕，没有新增 hover、点击索引或 cycle store。最终 124 / 124 unit（18 files / 1.45 秒）、1894-module build（7.04 秒）、Chromium 58 / 58 + Firefox 57 / 57 = 115 / 115（3.3 分钟）通过；五层 17 modules / 20 routes 验证容器祖先不抢占，偏斜 101 modules / 100 routes 验证模块端口与线路循环，200 modules / 400 connections 的完整样本 point hit 为 241 ms；重叠模块旅程同时验证重复循环、modifier toggle 与 Inspector 草稿拒绝。最终 `alt-click-cycle.png` 人工复核为 0 errors / 0 warnings，10 条原有线路、前后卡片边界、底层选择轮廓、Inspector、Dock 与 MiniMap 均清晰无遮挡。

Iteration 83 对照 draw.io 的 Tab / Shift + Tab next / previous 与 Alt + Tab parent 选择源码，同时保留 Web 工作台必须能进入侧栏表单的焦点边界。`canvasSelectionTraversal` 从完整 LayoutResult 派生稳定深度优先 canonical 序列：模块保持布局 / 文档顺序，连接归属自己的 Level，重复 hierarchy continuation 合并；只有唯一容器投影才建立 parent map，歧义父级不猜第一项。Canvas 成为单一复合 Tab 入口，React Flow wrapper、端口、层级按钮和 route handle 全部退出原生序列；Tab / Shift + Tab 遍历对象，Enter 进入对象内部，内部 Tab 可访问全部可见控件并在末项后离开，Esc 返回对象。焦点恢复只在旧元素被重建时继续等待；若旧元素仍在而用户已进入 Properties，则立即取消，消除 Chromium 抢焦点竞态。截图复核还发现“已选线路但残留 Selection cleared 通知”，现由下一次被接受的选择统一清理过期命令反馈。最终 126 / 126 unit（18 files / 1.50 秒）、1894-module build（8.24 秒）、Chromium 59 / 59 + Firefox 58 / 58 = 117 / 117（3.3 分钟）通过；默认 17 对象、五层 parent、200 / 400 键盘往返 394 ms、线路多抓手、Inspector 原生 Tab、草稿拒绝和保存路线均有真实双浏览器证据，竞态场景另在 Chromium 5 / 5 重复通过。`keyboard-selection-traversal.png` 人工复核 0 errors / 0 warnings，选中线路的蓝色焦点晕保留橙色接口类型主线，线路、箭头、端口、卡片和 Properties 均无遮挡。

Iteration 84 对照 draw.io 的 terminal change 事务边界，把鼠标已有的端点重连补成完整键盘等价路径。`model/graph` 现在唯一拥有 source / target 候选、已存端点解析和替代配对判断；Design 菜单、Command Palette 与 Inspector 复用同一 `StudioCommand`，共享 Dialog 只持有临时端点 key。重连态预选当前 source / target，同端点时提交禁用，因此不会制造空历史或误删手工 waypoint；真正变化仍只调用既有 `connection/reconnect`，成功后一次性焦点请求落回同一 Inspector 动作。默认图从手工路线开始，双浏览器分别替换 target 与 source，并连续验证焦点、每个结果的 10 routes / 45 pairs、Undo 恢复旧端点与 waypoint、Redo 和保存 JSON；五层第 4→5 层重连并 Undo 后重新审计 20 routes / 190 pairs。最终 128 / 128 unit、1894-module build、Chromium 60 / 60 + Firefox 59 / 59 = 119 / 119 通过；`keyboard-reconnect.png` 已人工复核选中线路、端口、箭头、Inspector 和工作区无遮挡。

Iteration 85 对照 draw.io `mxConnectionHandler` / `mxEdgeHandler` 的显式 gesture、marker、合法 / 非法 preview 与 reset 边界，建立 Canvas-owned pointer connection gesture。端口节点只暴露 endpoint dataset，候选资格仍由 `model/graph` 唯一计算；右上状态面板、端口 role 与无箭头正交预览只是可丢弃投影。首次截图复核发现预览虽有目标端口外向 stub，中间段仍穿过目标卡片，因此没有作为完成证据；纯预览原语现在从两端卡片外扩边界生成有限候选，排除端点卡片内侵后再按长度、折点数和稳定签名选择，浏览器同步扫描整条预览。Escape、window blur、空白和非法目标同时清理 React Flow 手势与本地状态，cancelled guard 阻止迟到 pointerup 写入。canonical endpoint equality 下沉到 Editor 与 History，使同端点重连保留 manual waypoint、dirty、Undo 与 Redo；真实变化仍只执行一次既有 operation。最终 134 / 134 unit（18 files / 1.66 秒）、1895-module build（7.49 秒）、Chromium 61 / 61 + Firefox 60 / 60 = 121 / 121（3.4 分钟）通过；新双浏览器旅程逐项验证创建预览、候选 / 非候选、Escape、合法 / 非法 / 同端点重连、目标卡片净空、WCAG、Inspector、10 routes / 45 pairs 与 Undo / Redo，同一完整回归再次通过五层 20 / 190、偏斜 Hub 100 / 4950 和 200 / 400。最终 `pointer-connection-feedback.png` 已人工复核状态面板不遮挡画布标题、端点卡片、端口和线路，预览方向清楚且无正式箭头。

Iteration 86 对照 draw.io 当前 `LibavoidRouting` 的 live connection preview：障碍来自完整模型、端点是固定 pin、拖动期间只求一个 connector，提交后再走正式路线。布局适配现在一次产生正式 `RoutingScene` 与同源只读 preview environment；吸附端点按 `nodeId + handleId` 读取规范端口，消除了 React Flow 手柄外框带来的 5px 预览 / 提交漂移。`solveConnectionPreview` 复用完整障碍、clearance、法向、层级 domain、资源预算和 verifier，但只求一条 disposable leg、关闭多线协商；无解显示 blocked 且不画穿卡 fallback。三模块中心障碍 fixture 在 Chromium / Firefox 都证明全正交、0 穿卡、0 零长度和 preview / commit 点集相同；五层 17 obstacles 后全部 20 routes / 190 pairs、偏斜 Hub 101 obstacles 后全部 100 routes / 4950 pairs 再审计；200 / 400 的 10 步拖拽合并为 9 次求解，峰值 7.8 ms、末次 0.5 ms。最终 133 / 133 unit（18 files / 1.43 秒）、1896-module build（6.75 秒）、Chromium 62 / 62 + Firefox 61 / 61 = 123 / 123（3.5 分钟）通过；首结果状态以 gesture identity 隔离后又执行 Chromium 5 并发 × 2 场景重复 10 / 10，消除 passive reset 竞态。`scene-connection-preview.png` 已在 96% 缩放人工复核端口、整段绕障、卡片和状态面板清楚无遮挡。

Iteration 87 继续对照同一份 draw.io `LibavoidRouting` 源码并校正了“30ms throttle”的表面描述：真实 guard 只有在拖动坐标与 pinned 状态完全相同且不足 30ms 时复用结果，变化坐标仍立即求解；主要性能边界是 per-drag Router 只注册一次障碍。新增不可变 `RoutingObstacleCatalog`，把安全域外扩、id 查找和左右边界索引收敛为唯一静态编译结果；solver 与独立 verifier 共用几何目录但不共享搜索状态。`ConnectionPreviewSession` 每个 gesture 注册一次目录，只缓存最近量化请求，变化意图同步求解，销毁后目录引用与结果清空且再次调用显式失败。自由 pointer 现在通过可选 terminal 类型表达“没有终端图形”，删除伪造的临时模块障碍。单测逐项证明重复请求命中、变化坐标不延迟、30ms 后重算、销毁隔离、空间查询顺序与外来目录拒绝。1000 modules / 2000 connections 实测一次注册 1000 obstacles，13 requests / 6 solves / 7 cache hits，峰值 5.6 ms、末次 0.8 ms；200 / 400 最终完整回归为 15 / 7 / 8，峰值 3.7 ms、末次 0.5 ms。五层 20 / 190、偏斜 Hub 100 / 4950 和 preview / commit 点集继续在双浏览器逐项通过。最终 135 / 135 unit（18 files / 1.52 秒）、1897-module build（6.89 秒）、Chromium 62 / 62 + Firefox 61 / 61 = 123 / 123（3.4 分钟）通过。刷新后的 `scene-connection-preview.png` 已人工复核：源端口正常出线、整段绕过中央高障碍、目标法向进入，0 穿卡、0 回钩、0 线中标签，状态面板不挡图。

Iteration 88 对照 draw.io `scrollPointToVisible` 与 `mxPanningManager` 的持续边缘压力模型，建立一个由 generation lease 独占的 `ViewportAutoPanController`：统一 40 CSS px 激活带、最高 12 px / 参考帧速度、frame-time 上限以及 pointercancel、Escape、window blur 兜底。框选、线路段 / 折点和 NodeResizer 通过 Context 租用控制器；节点移动也关闭第三方内建 auto-pan，改为在每次 viewport frame 后向第三方 drag owner 重放同一 pointer，使单模块、多模块和 Ctrl/⌘ clone 不再因受控节点投影晚一帧而脱离屏幕锚点。连接创建 / 重连仍消费 React Flow 的 document gesture，但取消时用 guard 后的合成 mouseup 完成其 RAF 与 listener 生命周期，避免界面已清理而视口继续滑动。视口仍只有 React Flow transform 一个事实源，各工具只重算可丢弃 preview，最终设计事实仍走原有原子 operation。最终 142 / 142 unit（19 files / 1.51 秒）、1899-module build（9.06 秒）、Chromium 70 / 70 + Firefox 69 / 69 = 139 / 139（3.9 分钟）通过；八条边缘手势、五层 20 / 190、Hub 100 / 4950、200 / 400 与 1000 / 2000 压力旅程全部通过。`viewport-edge-auto-pan.png` 已人工复核 live 抓手、正交预览、两张卡片、端口、Inspector 与 MiniMap 清楚无遮挡。

Iteration 89 对照 draw.io `mxGraphHandler` 在 gesture 起点冻结 selection bounds、由 `mxGuide` 对整个 bounds 求吸附的职责边界，修正多选拖动仍把被抓节点当作 subject 的漂移。`alignmentRectBounds` 只从全部成员 absolute rect 派生一个不可变包围框，现有 `snapMovingRect` 对它求唯一 correction，Canvas 再把 correction 等量投影给每个 dragged node；同一选择从 Compact Author 或 Expanded Coordinator 起拖都精确落到 `(612,64) / (868,288)`。Alt 手势得到未吸附 `(608,64) / (864,288)`，Ctrl clone 复用同一组 correction 并一次 Undo 恢复；跨父级选择因没有共同候选空间而不猜吸附。最终 144 / 144 unit（19 files / 1.47 秒）、1899-module build（7.07 秒）、Chromium 71 / 71 + Firefox 70 / 70 = 141 / 141（4.0 分钟）通过；完整回归再次覆盖五层 20 / 190、Hub 100 / 4950、200 / 400 和 1000 / 2000。首张截图因内部接口出现无意义大绕行而未放行；调整 fixture 的端口法向和净空后重拍的 `group-boundary-alignment.png` 已人工复核，两条线路均只有必要折点，洋红 guide 不穿文字、不挡端口或 Inspector。

Iteration 90 完成第十次十轮产品、图形操作与架构复评。对照 draw.io 当前 `mxGraph.isGridEnabledEvent`、`mxGraphHandler` 和 `mxGuide` 后发现一个可复现的协议裂缝：React Flow 全局 `snapToGrid` 先改写拖动 / resize 几何，自有 Alt 只关闭后置辅助线，因此界面虽然声称自由摆放，保存结果仍被隐藏 16px 网格限制。`DESIGN_GRID_SIZE` 现成为背景点阵、pointer move / resize 与键盘几何步长的唯一事实；`snapMovingRect` / `snapResizingRect` 在每个轴上让邻近对齐优先、未命中才按父级相对网格取整，Canvas 关闭第三方全局吸附。直接手势开始后按 Alt 同时跳过网格和辅助线，预览与松手提交复用同一纯结果；普通移动保存网格坐标，Alt 移动保存明确非网格坐标，Alt resize 从旧隐藏结果 `256 × 145` 变为原始指针结果 `253 × 145`。最终 146 / 146 unit（19 files / 1.53 秒）、1899-module build（6.71 秒）、Chromium 71 / 71 + Firefox 70 / 70 = 141 / 141（6.2 分钟）通过；五层逐条 / 逐对审计 20 / 190，非均匀 100 连接 Hub 审计 100 / 4950，200 / 400 与 1000 / 2000 均完成真实交互。压力档首次可交互 4174 ms、十次编辑 3423 ms、guide drag 3328 ms、最终测量内存 82,033,471 bytes；这些是本机观测，不是正式预算。重新拍摄的 `alignment-guides.png`、`group-boundary-alignment.png` 与 `same-size-guides.png` 已逐张人工复核，参考线只占用空白或卡片边界，线路无回钩、穿卡、共线搅绕、线中标签或 Inspector 遮挡。复评确认编辑链仍是 `BlockDesignDocument → Editor → layout / routing → Canvas` 单向投影，但移动时实时等距参考线尚未具备，整体仍未达到 draw.io 同等级别。

Iteration 91 对照 draw.io `mxGuide.moveDistance` 的候选过滤、等距优先级和两段间距标记，把实时等距收进既有 `snapMovingRect`，没有增加 Canvas 状态机。纯策略只接受与移动主体在正交轴真实重叠且保持正间距的候选；每轴从最近前后邻居判断中间等距或向外延续固定间距，按 delta、关系类型和稳定 id 确定唯一结果，等距优先于冲突对齐，对齐再优先于网格。`AlignmentGuideLayer` 只画两个短括号，不画距离数字；单模块和不同尺寸选择组分别验证 244 / 288 设计单位相等，Alt 在同一手势中关闭全部吸附，保存、Undo、两种抓取入口和线路碰撞继续走原链。最终 150 / 150 unit（19 files / 1.53 秒）、1899-module build（6.69 秒）、Chromium 73 / 73 + Firefox 72 / 72 = 145 / 145（4.1 分钟）通过；五层 20 / 190、非均匀 Hub 100 / 4950、200 / 400 和 1000 / 2000 再次通过。`equal-distance-guides.png` 与 `equal-distance-group.png` 已逐张人工复核：两侧括号对称、无文字，现有 2 / 3 条正交线、端口、卡片、Properties 与 MiniMap 无遮挡。整体仍未达到 draw.io 同等级别，后续迭代继续推进。

Iteration 92 对照 draw.io selection delete 先过滤可删除对象、取消交互、一次删除再选择回退的职责边界，把此前明确禁用的批量删除闭合为 Editor-owned `objects/delete`。操作先验证非空、无重复且全部目标存在，再删除显式 connection，最后按 Level 深度由深到浅复用单 node 的连接、binding、未使用接口定义和独占后代 Level 级联；共享 child Level 保留，父级已覆盖的后代不形成第二次失败。Studio 只把 canonical `SelectionRef.multiple` 映射成一个操作，统一确认、Delete 快捷键和命令 eligibility；取消不动文档，成功后一次 Undo / Redo 并保存重载。最终 154 / 154 unit（19 files / 1.55 秒）、1899-module build（6.83 秒）、Chromium 74 / 74 + Firefox 73 / 73 = 147 / 147（4.1 分钟）通过；五层 20 / 190、Hub 100 / 4950、200 / 400 与 1000 / 2000 再次通过。`batch-delete-after.png` 人工复核剩余 5 modules / 2 interfaces 清晰，线路无穿卡、搅线或标签，删除暴露的 6 个 required-port warning 保留给人审查。整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 93 对照 draw.io `selectConnections` 将当前 cell 的边加入既有 selection 的动作边界，把模块 Properties 中已有的直接接口审查扩展成可组合图形操作。`model/graph.listDirectConnections` 现在唯一拥有“一个 Level 内哪些 connection 接触所选已有节点”的邻接查询，按文档顺序返回共享接口和自环各一次；既有 `listModuleInterfaces` 与工作区 `directInterfaceSelectionExpansion` 共用它。选择层只处理跨 Level 分组、canonical 合并和三个不可用原因，`StudioCommands` 再统一投影到 Edit 与 Command Palette；草稿拒绝、成功选择、重复执行都不写 JSON、不增加 History、不移动 viewport。最终 157 / 157 unit（19 files / 1.44 秒）、1899-module build（6.67 秒）、Chromium 75 / 75 + Firefox 74 / 74 = 149 / 149（4.3 分钟）通过；默认 Core 的 8 条接口逐条断言，100 连接 Hub 一次选中 1 module + 100 interfaces 后重跑 4,950 对审计，五层 20 / 190、200 / 400 和 1000 / 2000 再次通过。`select-direct-interfaces.png` 人工复核 8 条线方向、端口、卡片和 Inspector 清晰，0 穿卡、0 线中标签；整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 94 对照 draw.io `selectVertices / selectEdges` 的完整类型选择边界，在既有 selection Owner 中增加 `selectDiagramKindInLevel`。它只接收当前 `DesignLevel` 与 `node | connection`，把完整文档集合交给 canonical replace；Studio 不遍历当前 DOM 或 React Flow store，两个 `StudioCommand` 统一服务 Edit 与 Command Palette。空 Level 分别给出无模块 / 无接口原因，草稿取消、重复执行、成功替换都不改 JSON、History、viewport、布局或路线。最终 158 / 158 unit（19 files / 1.48 秒）、1899-module build（6.80 秒）、Chromium 76 / 76 + Firefox 75 / 75 = 151 / 151（4.3 分钟）通过；默认图验证 7 modules 与 10 interfaces 互斥替换并审计 10 / 45，五层每层 2 条稀疏线、100 线 Hub 的 101 / 0 与 0 / 100、200 / 400 全量选择均通过。1000 / 2000 单次复验中选择 2000 interfaces / 1000 modules 为 1167 / 626 ms，后续完整压力旅程继续通过。`select-interfaces-in-level.png` 人工复核 10 条线方向、端口、类型色和 Inspector 清晰，0 穿卡、0 线中标签；整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 95 把“选中直接接口”扩展为真正可操作的局部依赖子图，但没有新增图事实或隐式聚焦。`directSelectionContext` 一次按 Level 校验所选模块并复用 model-owned `listDirectConnections`，同时派生 canonical connection 与端点 module 引用；`directInterfaceSelectionExpansion` 和新的 `directNeighborhoodSelectionExpansion` 共用它。命令只把当前一跳加入既有选择，因此从默认 Core 第一次得到 5 modules / 8 interfaces，第二次再扩成完整 7 / 10，第三次才给出闭包已选原因；选区与 Fit Selection 保持正交。最终 160 / 160 unit（19 files / 1.52 秒）、1899-module build（6.75 秒）、Chromium 77 / 77 + Firefox 76 / 76 = 153 / 153（4.3 分钟）通过；默认图重跑 10 routes / 45 pairs，偏斜 Hub 从 leaf 得到 2 / 1、从 hub 得到 101 / 100，并在每一步重跑 100 routes / 4,950 pairs。200 / 400 邻域选择 647 ms；1000 / 2000 为 748 ms，总测量内存 95,412,725 bytes。`select-direct-neighborhood.png` 已人工逐线复核：5 个模块选择轮廓一致，8 条接口方向与端口清楚，无穿卡、线中标签或面板遮挡。整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 96 将代码依赖方向严格收敛到 `BlockConnection.source / target`，没有让视觉箭头或卡片位置反向定义语义。`listDirectConnections` 的 `both / incoming / outgoing` 是唯一方向过滤；接口扩选和邻域扩选只透传参数，Studio 的四个新命令只负责可用性、草稿保护与反馈。完整回归另暴露既有节点边缘平移在并发负载下 3 / 10 次超过 32px 锚点门槛：旧 policy 会把延迟帧放大到 23.04px，viewport 更新后的 React Flow 拖动投影又可能晚一帧。现在每帧严格封顶 12px，并在绘制 transform 前同步提交第三方权威拖动更新；原门槛未放宽，20 次高并发复验 20 / 20，八类边缘手势双浏览器 16 / 16。161 / 161 unit（19 files / 1.53 秒）、1899-module build（7.03 秒）和 Chromium 78 / 78 + Firefox 77 / 77 = 155 / 155（7.3 分钟）完整回归通过；默认 Core 精确得到 5 条 incoming、3 条 outgoing、5 modules / 5 interfaces 入站邻域和 3 / 3 出站邻域，随后重跑 10 routes / 45 pairs。偏斜 Hub 的两个方向各 50 条，两个邻域各 51 / 50，并在每一步重跑 100 routes / 4,950 pairs。200 / 400 outgoing 邻域为 743 ms；1000 / 2000 为 742 ms，总测量内存 98,045,522 bytes。`select-incoming-neighborhood.png` 已人工逐线复核：五条选中线全部从真实 source 指向 Core target，端口、文字、卡片和 Inspector 清晰，无穿卡、线中标签或遮挡。整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 97 对照 draw.io Cut 的“先复制、再一次删除”职责边界，在既有 `DesignFragment` 与 Editor-owned `objects/delete` 上补齐标准 `Ctrl/⌘ X`。Studio 先从当前同层模块选择构造、验证并序列化完整内部片段，内部 clipboard 成立后只删除这些片段根模块；内部接口随片段移动，附着外部接口仍由既有级联清理，选择中与片段无关的线路不会被额外删除。删除成功只形成一个历史操作，系统剪贴板随后异步镜像；浏览器拒绝权限时仍能在另一份设计中 Paste。片段或删除预检失败都不改变源文档。162 / 162 unit（19 files / 1.50 秒）、1899-module build（9.83 秒）和 Chromium 79 / 79 + Firefox 78 / 78 = 157 / 157（6.9 分钟）完整回归通过；真实旅程验证 2 modules / 2 internal interfaces / 1 child Level 的 Cut、5 modules / 2 remaining routes、一次 Undo / Redo、跨 2.0→2.1 设计 Paste、4 modules / 3 routes、保存重载和系统剪贴板退化。100 线 Hub 剪切稀疏叶后完整审计 99 routes / 4,851 pairs，Undo 后恢复 100 / 4,950。200 / 400 Cut+Undo 为 1,589 ms，1000 / 2000 为 5,672 ms；`cut-paste-subgraph.png` 已人工复核三条线路短而正交，方向、端口、卡片、选择轮廓和 Inspector 清晰，无穿卡、线中标签或遮挡。整体仍未达到 draw.io 同等级别，后续继续迭代。

Iteration 98 对照 draw.io 选择框的统一缩放语义，将不同尺寸模块的成组 resize 收敛到三个责任边界：`layout/selectionResize` 只从冻结的同父级矩形、内容上下限与手柄方向求组选区和每个成员的仿射结果；Canvas 只拥有八个恒定屏幕命中区、Shift / Alt、自动平移和实时预览；Editor-owned `nodes/resize` 先验证整个批次，再一次提交全部 position / size / pinned。顺序反转、四边四角、等比、最小尺寸与旧/超限几何由纯测试覆盖；真实浏览器验证不同尺寸组、Undo / Redo、保存重载、五层父坐标、展开/跨层禁用、100 线 Hub resize 前后各 100 routes / 4,950 pairs，以及五层 20 / 190。168 / 168 unit（20 files / 1.50 秒）、1900-module build（Vite 7.14 秒）和 Chromium 80 / 80 + Firefox 79 / 79 = 159 / 159（4.8 分钟）完整回归通过。200 / 400 组选区 resize / Undo 为 1,508 / 922 ms，1000 / 2000 为 3,369 / 2,791 ms；`group-resize.png` 已人工逐线复核：八个控制点、两条必要正交线、唯一 target 箭头、端口、卡片、Properties 与 MiniMap 清晰，0 穿卡、0 线中标签或遮挡。整体仍未达到 draw.io 同等级别，后续继续迭代。

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
- 选中且允许 authored placement 的模块必须提供四边 / 四角 resize；控制点视觉小于命中区，不能遮挡 Port。内容安全下限由统一几何 Owner 计算，pointer 与 Ctrl/Cmd + Shift + Arrow 都只通过 `node/resize` 提交位置和尺寸，拒绝时恢复原文档投影；Shift + Arrow 单独按下不得改动设计或第三方画布状态。
- 模块 move / resize 的背景网格、键盘步长和 pointer 吸附必须消费同一 `DESIGN_GRID_SIZE`；移动时每轴按“正交重叠邻居的等距 → 边缘 / 中心对齐 → 父级相对网格”确定唯一结果，等距只显示两段无文字括号；resize 沿用位置 / 同尺寸 / 网格合同。直接手势开始后按 Alt 必须同时关闭全部吸附，预览和最终 JSON 不得被第三方隐藏吸附再次改写。
- 多选必须由显式工作区协议拥有，不能把 React Flow 内部 selected 数组或框选矩形当成文档事实；成组移动只提交一次 `nodes/move`，混选删除只提交一次 `objects/delete`，均由一次 Undo 恢复。批量删除必须先验证全部目标，显式接口先删、模块按 Level 由深到浅复用单对象级联；共享子 Level、未使用接口定义和失败原子性不得由 UI 猜测。多选期间隐藏单对象编辑抓手。
- 直接接口只能由模型层对设计文档做同 Level 邻接查询，Inspector 摘要和选择扩展必须消费同一结果；共享连接、自环和跨 Level 模块选择必须 canonical 去重。扩展选择不改 JSON、History 或 viewport，未应用草稿与重复执行必须给出可验证反馈。
- 直接邻域只能从同一模型邻接事实派生接口端点，不能按视觉距离、DOM 挂载或 route 穿越猜测；命令每次只扩展当前所选模块的一跳并允许渐进达到闭包，不隐藏无关对象或创建过滤状态。选择与 Fit 必须正交，只有显式视口命令可以改变观察范围。
- 入站 / 出站依赖只能由 `BlockConnection.target / source` 判定，不得读取箭头 DOM、端口 side 或模块相对位置；both、incoming、outgoing 必须共用一个 model 查询，并对自环、多模块内部边和跨 Level 选择稳定去重。方向选择仍不得写入 JSON、History 或 viewport。
- 当前 Level 的全选、仅模块、仅接口和清空必须消费同一 canonical selection 协议；按类型选择读取完整文档集合而不是可见 DOM / 渐进窗口。空类型、草稿拒绝、重复执行和 1000 / 2000 视口裁剪都不得制造截断选择、History 或 viewport 副作用。
- 多选对齐至少需要 2 个、分布至少需要 3 个同一 Level 的 authored 模块，且每个模块只能有一个可编辑投影；接口混选、跨层、展开 hierarchy、布局未就绪或未应用草稿必须给出同源禁用原因。目标位置只能由纯几何函数计算，一条命令只提交一次 `nodes/move`；selection 与 viewport 保持稳定，布局和路由从新文档几何重算。
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
- 路由证书的 `auditedLegIds` 必须覆盖完整场景，`auditedPairCount` 必须精确等于已布通线路的 \(n(n-1)/2\)；浏览器审计同样逐线、逐对检查，不能抽样。
- 每个 strict crossing 必须由 presentation-only 线桥明确前后关系；线桥不能改变路线点、命中区、箭头、目标函数或持久 JSON，也不能在没有交点的位置孤立出现。
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

当前键盘能力已覆盖菜单、命令面板、Dialog、Hierarchy 搜索、Inspector 表单、端点选择、类型化接口创建、多选对齐 / 分布、Copy / Paste / Duplicate、删除、Undo / Redo 与保存。Iteration 23 已用一条从空白设计到下载 JSON 的连续 Chromium 旅程证明这些能力可以组合成立；Iteration 24 已在 Firefox 重跑同一旅程并验证 Apply 后焦点恢复，Iteration 38 已把菜单、Dialog、完整编辑和文件合同扩展到 Firefox 产品旅程；Iteration 55 补齐顶层与展开菜单的字符定位，Iteration 56 让禁用前提进入可见文案和辅助名称，Iteration 61 用统一命令搜索缩短跨菜单与跨面板路径并验证焦点交接，Iteration 69 让八个 Arrange 命令通过菜单与 `Ctrl/⌘ K` 共用同一可达入口和禁用说明，Iteration 72 让三项片段命令从 Edit、标准快捷键与命令面板共享同一 eligibility 和执行链。WebKit 自动化和读屏人工验证仍不得省略。

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

当前已覆盖 Schema 支持矩阵、2.0 输入 / 2.1 输出 golden migration、缺失 / 非字符串 / 未支持版本、旧版新字段拒绝，公开 `DesignOperation` 的创建 / 更新 / 单项与批量移动 / resize / 绑定 / 删除及失败原子性，内容安全最小尺寸，connection route 写入 / Reset、endpoint reconnect / 旧 route 清理 / 非法方向原子拒绝，正交线段 / 折点移动与折点删除，Undo / Redo / canonical dirty 历史状态机、compact UTF-8 history snapshot、布局 / 几何签名边界、无序 record 稳定序列化与有序数组保留、文件名与加载错误、DRC 稳定定位及正交路由纯函数。`pnpm test:performance` 独立运行大历史测量，不拖慢日常快速单测；Playwright 只组合真实浏览器压力旅程，不重新实现纯历史规则。

### 布局与路由合同测试

- 纯输入产生确定性节点、边和 hierarchy continuation。
- 祖先循环、缺失端点和路由失败行为。
- authored 与 automatic placement 边界。
- 场景适配、单连接可见图基准、多连接字典序目标、真实共享走廊 separation、反向 / 自交 / 绕行上限、层级 Gate、锁定 route、确定性证书与 `Optimal / Feasible / Unresolved / InvalidInput` 失败语义。
- 五层路由压力：逐 leg、全部无序 leg pair、1–100+ 偏斜度数、move / resize / hierarchy / manual / undo 状态、Chromium / Firefox headed 视觉证据；密集共享端口不可满足时不得伪造 Feasible。

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
