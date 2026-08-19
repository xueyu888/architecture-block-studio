# 系统架构

## 架构原则

Architecture Block Studio 的核心不变量是：`BlockDesignDocument` 是唯一设计事实源。UI、布局、路由、DRC 和工作区状态都只能消费或通过具名操作更新它，不能建立第二份设计状态。

```text
Menu / Toolbar / Keyboard / Canvas / Inspector
                       │
                       │ DesignOperation
                       ▼
             editor：原子文档变换
                │ success      │ failure
                ▼              ▼
       BlockDesignDocument   可见错误，原文档不变
          │       │       │
          │       │       └──────────────► io：解析 / 序列化 / 下载
          │       └──────────────────────► model：Schema / DRC / 图查询
          ├────────► layout/types：纯 Flow 投影
          ├────────► routing：场景适配 / 正交多连接求解 / 独立验证
          └────────► studio/selection：工作区选择协议
                              │
                              ▼
                 components/canvasTypes ─► React Flow
                              │
                              └──────────► Tree / Inspector / Messages
```

依赖方向从稳定的文档契约指向派生能力，再由 Studio 组合成产品。布局、路由或组件不得反向拥有文档语义。

## 模块与 Owner

| 模块 | 原则与所有权 | 公开接口 | 边界与失败行为 |
| --- | --- | --- | --- |
| `src/model` | 拥有文档结构、Schema 版本与迁移、语义设计规则和无状态图查询 | `BlockDesignDocument`、`BLOCK_DESIGN_SCHEMA_VERSION`、`blockDesignSchemaCompatibility`、`parseBlockDesignDocument`、`validateBlockDesignDocument`、`listModuleInterfaces`、`normalizeConnectionEndpoints` | 不负责 UI、历史或布局；版本与结构非法时在字段路径拒绝，语义问题输出 DRC，查询与连接规范化不持有状态 |
| `src/editor` | 拥有原子文档变换、历史、dirty 判断与可移植设计片段的引用完整性 | `DesignOperation`、`DesignFragment`、`createDesignFragment`、`parseDesignFragment`、`applyDesignOperation`、`useDesignEditor`、具名工厂 | 不渲染、不路由、不持久化；片段必须自包含，失败不产生部分修改 |
| `src/io` | 拥有外部 JSON 与已校验文档之间的转换 | `loadDesignFromObject/File/Url`、`serializeDesign`、`downloadDesign` | 不解释模块业务；加载失败保留已安装文档 |
| `src/layout` | 从文档与展开状态派生纯复合节点、边和位置投影，定义布局真正消费的签名，并提供不持有交互状态的吸附与多选编排几何 | `layoutBlockDesign`、`layoutFrameSignature`、`layoutProjectionSignature`、`snapMovingRect`、`snapResizingRect`、`alignSelection`、`distributeSelection`、`LayoutResult`、`PlacementMode` | 不依赖 Studio 或 React 交互回调，不修改源文档；没有合法吸附候选时原样返回预览几何，非法编排输入或布局失败上抛给 Studio |
| `src/routing` | 从绝对布局几何和锁定 waypoint 构造 `RoutingScene`，统一拥有版本化正交多连接策略、规模资源预算、确定性求解、证明等级与独立验证；另提供不持有 UI 状态的手工路线编辑几何和由已验证路线派生的线桥 | `createRoutingSceneFromLayout`、`routingPolicyForScene`、`solveRoutingScene`、`verifyRoutingResult`、`planRouteJumps`、`RoutingScene`、`RoutingPolicy`、`RoutingResult`、`editableOrthogonalRoute`、`moveRouteSegment`、`moveRouteBend`、`removeRouteBend` | 设计坐标是路由事实；不移动模块、不改文档、不持有 gesture；规模只收紧同一策略的有界资源，不改变几何与失败语义；`planRouteJumps` 只决定交叉处的绘制表达，不反写路线。失败返回 `Unresolved` / `InvalidInput`，不调用第二套自动 fallback。完整合同见 [`ROUTING.md`](ROUTING.md) |
| `src/components` | 将纯布局投影组合为可交互 Canvas，拥有选中几何的 viewport framing 与具名缩放请求投影，并展示用户视图、发出用户意图 | `CanvasBlockNodeData`、`CanvasInterfaceEdgeData`、`CanvasViewportActionRequest`、`canvasGeometryBounds`、Canvas、Node、Edge、Tree、Inspector、Dialogs、Dock、Messages | 交互回调只存在于 Canvas 投影；viewport 只消费节点矩形、线路点集和可丢弃动作请求，不直接深改文档，局部表单草稿不得伪装成已提交事实 |
| `src/studio` | 组合公开能力，拥有工作区选择协议、临时设计剪贴板与无碰撞粘贴位置投影 | `BlockDesignStudio`、`BlockDesignStudioProps`、`SelectionRef`、`selectAllInLevel`、`findDesignFragmentPlacement` 及纯选择查询 | 不重新定义 Schema、片段引用、布局或编辑规则；系统剪贴板失败时同源退化，组合失败应可见、可恢复 |
| `src/App.tsx` | 提供独立应用的默认装配 | 默认示例 URL 与查询参数入口 | 示例不是核心依赖，不拥有设计内容 |
| `tests/performance` + `scripts/performance-baseline.mjs` | 拥有压力观测样本合同与重复聚合入口 | `performance-sample v1`、`performance-trend-report v1`、`pnpm performance:baseline` | 只验证产品合同，不被运行时代码依赖，不写回设计 JSON；环境或样本漂移时停止生成可信报告 |

`BlockDesignStudio.tsx` 当前承担较多编排职责，但它仍通过上述公开接口组合模块。后续只有在出现独立变化原因时才拆出命令协调器；不能建立囊括所有能力的全局 Service 或共享可变状态。

当前依赖核查中，`model` 不依赖任何上层模块，`layout` 与 `io` 只消费模型合同，`routing` 只消费几何库类型；`editor` 只额外复用 `io` 的纯 canonical snapshot 序列化，避免 dirty、历史和文件输出出现第二套规则。组件对 `studio` 的引用仅指向无 UI 依赖的 `commands` / `selection` 叶子协议，这两个协议不反向导入组件；`BlockDesignStudio` 才负责组合具体组件。文件行数本身不是拆分依据，只有独立状态、规则或变化原因出现时才建立新 Owner。

## 工作台与视觉系统

工作台采用稳定的专业画布骨架：文档标题和校验摘要位于顶层，菜单负责完整命令发现，分组工具栏承载高频动作；Sources、Canvas、Inspector 构成主要横向工作区，Messages / DRC 与状态栏提供按需反馈。Canvas 始终是视觉主面，左右面板是上下文，只有选择、错误、dirty 和主操作使用强调色。改变面板显隐、Dock 布局或视觉样式不会改变设计事实。

`src/styles.css` 的 `:root` 是颜色、边界、控件高度、圆角、阴影、层级和动效时长的唯一视觉常量 Owner。组件只通过自身语义 class 表达“这是菜单、节点、属性面板或状态”，不得复制同一 surface、border、selection、z-index 或 control 尺寸；React Flow 的网格与 MiniMap 遮罩同样消费该 token 层。`StudioToolbar` 只依据 `StudioCommands` 投影命令，并用具名 `role="group"` 表达视觉分组，不拥有命令状态。它拥有常驻展示集合：File、History、Create 以及 Fit / Validate 表达启动、连续编辑、建模和审查直接工作流；低频全图布局与已有 Dock 上下文入口的面板动作仍由完整 Menu / Command Palette 投影。展示集合不进入命令合同，不能反向改变 execute 或 eligibility。视觉 token 只被组件消费，不依赖组件，也不进入 JSON、历史、selection 或布局结果。

`Tooltip` 只拥有 pointer 延迟、focus 即时打开、Esc / pointer down 关闭和 reduced-motion 展示，是命令提示的瞬时 UI Owner。它的公开输入只有 `label`、可选 `shortcut` / `detail` 与 placement；Toolbar 直接传入 `StudioCommands` 已拥有的名称、快捷键和 `unavailableReason`，Canvas viewport controls 传入自身公开动作名。Tooltip 不计算 eligibility、不执行命令、不让禁用按钮获得新的激活路径，也不持久化打开状态。Toolbar 与 Canvas controls 不再保留并行的原生 `title`，Menu 已有可见禁用原因也不再重复 title；事件取消或组件卸载时，待显示计时器被清理，原操作保持不变。

`CommandPalette` 是统一命令检索的瞬时 UI Owner，只拥有打开、查询和当前结果索引。它从 `StudioCommands` 实时派生命令列表，以名称、工具栏名称、快捷键和禁用原因匹配，不保存副本、不计算 eligibility；`showInPalette: false` 仅防止“打开命令面板”递归列出自身。可用项先通过共享 Dialog 焦点协议把焦点安全交还调用位置，再执行同一个 `execute`，后续 Editor Dialog 或 Messages 可以接管焦点；禁用项保持可读取但 Enter 与 pointer 都不执行。Esc、点击遮罩或无结果不会产生业务副作用，查询和焦点索引不进入历史、selection 或 JSON。

连接方向与连接点是两个正交的视觉角色。Canvas 只对非 hierarchy continuation 的真实连接投影一个 target marker，marker 的方向完全来自 `BlockConnection.source -> target` 路径末段；Port Handle 只表达“这里可以连接”，使用中性圆点，不用输入 / 输出三角形冒充数据流箭头。接口类型颜色由 edge 上的 `--interface-color` 统一提供给普通路径、React Flow 选中态和 `context-stroke` marker；第三方默认 selected stroke 不能成为第二颜色源。marker、Handle hover 和选中描边都属于可重建展示，不进入 JSON 或历史。

端口连接点几何与标签排版同样正交。`layout/nodeGeometry` 是节点安全尺寸、标签估算宽度和水平 label rail 位置的唯一计算 Owner；`BlockNode` 从同一组已排序 Port 分别投影稳定 Handle 和独立标签按钮，不能为了排文字移动 source / target。left / right 标签沿各自侧边，top / bottom 标签在 Header / Owner 之外的内部轨道分配空间；常态只显示端口名，dataType 只在可读缩放下通过 hover / focus 渐进显示，完整事实仍可由 Properties 查看。已有 authored width / height 满足标签合同时必须原样保留；只有外部 JSON 或后续 resize 小于内容安全下限时，布局投影才钳制到可读尺寸，不能把展示修正反写 JSON。

模块尺寸编辑复用同一几何 Owner。`minimumNodeDimensions` 从四侧端口和内容区计算可读下限，Canvas 只把这个纯结果投影为四边 / 四角 resize 限制；最大值与 16 设计像素键盘步长同样来自统一几何常量。Shift pointer resize 由纯 `preserveNodeAspectRatio` 以 gesture 起始矩形、抓手方向和同一尺寸上下限求解，固定对侧角或对侧边中心；比例不进入文档，并优先于兄弟尺寸吸附。React Flow 只拥有可丢弃预览，松手后只发出一次位置加尺寸意图；Editor 的 `node/resize` 才以一个原子操作写入 `node.layout.position / width / height / pinned`。左边或上边缩放会同时改变锚点和尺寸，因此不能只写 width / height，否则视觉边界与持久几何会漂移。展开的 hierarchy 容器尺寸由子图边界派生，不提供 authored resize 把手。

对齐辅助线沿用同一几何链，但不拥有设计事实。Canvas 在 move / resize 开始时只收集同一父级、当前视口附近的模块矩形，并把 6 CSS px 容差换算为设计坐标；`layout/alignmentGuides` 纯函数从这些候选派生边缘、中心与同宽 / 同高吸附结果，`AlignmentGuideLayer` 只渲染当前 gesture 的临时线和尺寸括号。松手后仍只提交既有 `node/move` 或 `node/resize`；按住 Alt 时当前 gesture 原样使用用户预览，不显示 guide。候选不存在、吸附超出尺寸上下限或 Editor 拒绝提交时，不建立补偿状态，Canvas 回到文档投影。

多选对齐与分布复用 authored 几何，但与临时辅助线是独立能力。`layout/selectionArrangement` 只接收已解析的模块矩形：六种对齐以整个选择包围框为基准，水平 / 垂直分布按中心点等距并固定两端；项目没有隐式“主选择”，因此不会让点击顺序成为第二几何规则。`StudioCommands` 负责确认至少 2 个对齐对象或 3 个分布对象、全部是同一 Level 中具有唯一可编辑投影的 authored 模块，并为接口混选、跨层选择、展开 hierarchy 或未完成布局给出同源禁用原因。Arrange 菜单与 Command Palette 只投影这些命令；执行结果统一生成一次 `nodes/move`，Editor 原子写入各模块的 `node.layout.position / pinned`，随后布局与路由从文档重新派生。任一前提或提交失败时，原文档、历史和视口都不变。

复制链与选择链正交。`editor/designFragment` 是片段格式、引用闭包和 ID 重写的唯一 Owner：根层只收集所选模块之间的内部连接，递归包含这些模块拥有的全部子 Level，并只携带实际引用的接口定义；解析时逐级验证模块、Port、Connection、Hierarchy binding、父子 Level 和接口引用，拒绝缺失或多余事实。Studio 只从唯一可见的同层选择读取当前设计位置。Paste / Duplicate 用 `studio/fragmentPlacement` 对片段外包围框和当前可见模块矩形做 32 设计像素网格的最近无碰撞搜索；Ctrl/⌘ 拖动则把同组模块预览相对 authored geometry 的统一平移直接作为 offset。两种入口都只把明确 offset 随一次 `fragment/insert` 交给 Editor；Editor 在克隆文档上递增生成 Level、Module、Connection 与 Interface ID，重写全部引用后才通过完整 Schema 提交，所以一次插入只产生一个历史记录。

内部 `designClipboard`、系统剪贴板权限与连续粘贴序号都是可丢弃工作区状态。复制先安装内部片段，再尝试写入带 kind / version 的 JSON；写入失败只改变可见反馈，不撤销已成功的内部复制。粘贴优先使用内部片段，没有时才读取并严格解析系统剪贴板。外部连接不会被隐式扩张进片段，因此复制后仍为 required 的边界 Port 可能由 DRC 提示未连接；这是待人审查的真实合同缺口，不能通过偷偷改成 optional 来消除警告。

```text
SelectionRef + LayoutResult
          │ 同一 Level、唯一可见模块位置
          ▼
createDesignFragment ─► versioned DesignFragment ─► internal/system clipboard
          │                                        │
          │                          parse + full reference closure
          └────────────────────────────────────────┘
                              │
                              ▼
findDesignFragmentPlacement（可丢弃视觉几何）
                              │ explicit offset
                              ▼
fragment/insert ─► Editor clone / ID rewrite / Schema ─► BlockDesignDocument
                                                         │
                                                         └─► one Undo snapshot
```

```text
SelectionRef.multiple + LayoutResult
                │ 解析同一 Level / 唯一可编辑投影
                ▼
StudioCommands（enabled / unavailableReason）
        │ execute                 └── failure ─► Menu / Palette 原因；不写入
        ▼
alignSelection / distributeSelection（纯目标位置）
        ▼
nodes/move ─► editor ─► BlockDesignDocument.node.layout
                                  │
                                  └──► layout + routing ─► Canvas
```

```text
BlockDesignDocument ─► model / editor / layout / routing ─► Studio ─► UI components
StudioCommands ───────────────────────────► Menu / Keyboard / Command Palette（完整）
              └───────────────────────────► Toolbar（12 个直接工作流投影）
Canvas viewport actions ──────────────────────────────────► Canvas controls
Menu / Toolbar / Canvas controls ── label / detail ───────► Tooltip
:root visual tokens ──────────────────────────────────────► all UI components
Dock / selection / dialogs / command query ─► disposable workspace state; never design JSON
```

视觉失败与业务失败保持正交：非法编辑继续由既有命令和 Editor 给出可见错误并保留原文档；视觉回归由 WCAG computed-color、1680 × 1050 / 1280 × 720 几何合同、双浏览器旅程和 headed 截图捕获，不能通过新增文档字段或组件局部特例补偿。

## 状态分类

系统必须区分五类状态，避免事实源漂移。

| 类型 | 当前 Owner | 例子 | 是否进入 JSON |
| --- | --- | --- | --- |
| 持久设计事实 | `BlockDesignDocument` | 文档、Level、模块、端口、接口、连接、层级绑定、authored 位置 / 尺寸与手动路由 | 是 |
| 派生设计结果 | `model` / `layout` / `routing` | DRC issues、模块关联接口摘要、Flow nodes、可视边、ELK 位置、正交路径 | 否，可重建 |
| 工作区状态 | `BlockDesignStudio` / Canvas / Dockview | 当前选择、展开 Level、面板布局、缩放、Fit 请求、自动布局模式、当前 gesture 的对齐辅助线、内部设计剪贴板与连续粘贴序号 | 否 |
| 未提交编辑草稿 | 各 Inspector / Dialog 表单 | 输入框内容、待创建连接 | 否；提交后才生成 `DesignOperation` |
| 验证证据 | tests / screenshots / CI | 构建结果、几何检查、浏览器截图 | 否；只验证合同 |

关键规则：派生结果和验证证据不能反向定义文档；工作区状态不能写成架构事实；草稿必须显式提交或显式放弃，不能静默消失。

Dialog 草稿由各 Dialog 自己拥有，并在打开边界的 layout effect 中于浏览器产生可交互画面前完成初始化；同一次打开后的名称、ID、Owner、端点和合同输入只由用户交互继续更新。焦点协议随后只负责把焦点放入已经初始化的表单，不能用更晚的 passive effect 覆盖快速输入。提交仍只生成既有具名创建参数和 `DesignOperation`，取消则直接丢弃这份瞬时草稿。

`DesignIssue` 是 validation rule 的派生输出，包含稳定 id、severity、code、message、remediation 和可交叉定位的目标引用。语义规则在 `model/validation` 同时定义“发生了什么”和“下一步如何修正”，Messages 只负责筛选与展示；布局运行失败由 Studio 在同一诊断合同中补充恢复方向。remediation 不进入文档，也不能自动修改设计事实。

## 性能证据链

性能 fixture 仍从公开文档结构生成 1000 / 2000 压力输入；纯历史测试与浏览器旅程各自只测量自己拥有的行为，再共同输出同一版本样本。命令脚本只负责串行编排、严格校验和统计聚合：

```text
performanceDesign fixture
       │
       ├── history test ──────┐
       │                      │ performance-sample v1
       └── browser journey ───┤ scenario / run / environment / metrics
                              ▼
                   temporary raw samples
                              │ schema / sample / environment drift -> fail
                              ▼
                 observation-only trend report
                   min / median / max / mean / spread
```

原始样本和报告都写入被 Git 忽略的 `performance-results/`，属于可重建证据。它不复用 Playwright 拥有并会在运行前清理的 `test-results/`，因此两条测试生命周期互不覆盖。`BlockDesignDocument`、编辑历史和产品运行时不依赖这些文件。报告明确保存 `thresholds: null`，避免开发机观测反向成为产品性能合同；未来只有固定 CI 执行环境和足够历史样本才有资格建立数值门禁。

历史压力中的 canonical snapshot 字节数是由文件投影直接计算的确定性事实；进程 heap、ArrayBuffer 和耗时只是环境观测。`vitest.performance.config.ts` 是 GC 执行前提的唯一 Owner：使用单 fork，并通过该 fork 的 `execArgv` 暴露 GC。测试在测量前后显式回收，若 worker 没有 GC 能力则失败；package script 和聚合器不重复声明 V8 参数。

## 文档契约

### 顶层结构

`BlockDesignDocument v2` 包含：

- `schemaVersion`：当前精确值为 `"2.1"`。
- `id`、`title`、`summary`：文档身份与说明。
- `entryLevelId`：入口 Level 的唯一引用。
- `sourceRef`：可选的外部来源标签与链接。
- `interfaceDefinitions`：按接口 id 索引的独立合同表。
- `levels`：Level 数组，每个 Level 拥有自己的模块和连接。

### Level 与模块

Level 拥有 `nodes`、`connections` 和布局偏好。模块拥有稳定 id、名称、类型、Owner、端口、合同、可选 authored position 与可选 hierarchy。

模块合同由 `principle`、`purpose`、`boundary`、`failure`、可选源码合同和自定义属性组成。合同是设计事实，不是仅用于展示的说明文字。

### 端口、接口与连接

端口属于模块，定义 label、side、direction、dataType、required 与 order。连接属于 Level，引用明确的源端点、目标端点和 `interfaceDefinitions` 中的一个接口；可选 `routing.waypoints` 记录用户确认的 Level 局部坐标。没有 `routing` 时，路径完全由路由层派生。

独立接口定义拥有 kind、title、owner、protocol 与合同字段。多个连接可以引用同一接口定义，因此接口语义不能复制到边的临时 data 中维护。

### 层级

层级模块通过 `hierarchy.childLevelId` 指向子 Level，并通过 `hierarchy.portBindings` 将父端口绑定到一个明确内部端点。跨层关系不得根据名称、端口顺序或 interface id 猜测。

## 编辑与历史

所有持久修改必须表示为 `DesignOperation`。`applyDesignOperation` 先克隆当前文档，在克隆上执行单项转换，最后通过完整 Schema 重新解析；任何异常都会使原文档保持不变。

模块尺寸变化使用单用途 `node/resize`。操作同时携带设计坐标中的 position 与 size，在一次完整 Schema 校验后提交；这样四边和四角使用同一合同，Undo / Redo 也只记录一个几何状态。Canvas 的 pointer preview、resize control 可见性和一次性焦点恢复都是 UI 状态；草稿保护或 Schema 拒绝时，Canvas 重新投影原文档几何，不产生补偿操作，也不保留局部尺寸。

模块组移动使用单用途 `nodes/move`。它携带去重后的 Level、node 与目标 position 列表，Editor 在同一克隆上逐项验证存在性，全部成立后才一次提交并生成一个历史记录；单模块继续使用 `node/move`。这样 React Flow 的成组拖动不会出现“画面移动多个、JSON 只保存一个”的双状态，任一目标失效时也不会产生部分位移。

子图插入使用单用途 `fragment/insert`。操作携带已经通过片段合同的 `DesignFragment`、目标 Level 和由视觉放置 Owner 计算的明确 offset；Editor 不读取 Canvas，也不自行猜测屏幕空位。ID 递增与引用重写在同一克隆中完成，任何缺失端点、Port、接口定义、层级父子关系或非法 offset 都拒绝整项操作。Paste、Duplicate 与 Ctrl/⌘ 拖动都复用“从当前选择构造片段，再执行一次 insert”的同一链路，不维护第二套克隆规则。

线路端点变化使用独立的 `connection/reconnect`：Editor 在同一 Level 内重新校验 source / target 端口存在性与 input / output 方向，保留连接 id、interface id 和接口合同。手动 waypoint 描述的是旧端点几何，因此重连成功时由该操作清除 `routing`，重新进入自动路由；非法目标拒绝整项操作，原端点和原路线都不变。Canvas 只负责把拖拽结果规范化成端点意图，不复制方向规则。

具名对象创建时，`editor` 的 `suggestId` 与 `uniqueId` 是合法化和当前作用域唯一性规则的唯一来源；Studio 提供已有 id，Dialog 只维护“名称仍联动建议 id / 用户已手工定制 id”的临时草稿状态。名称变化只在用户尚未定制 id 时更新建议，提交后仍通过原有创建工厂和 `DesignOperation` 进入文档，联动状态本身不进入 JSON 或历史。

`useDesignEditor` 的当前文档始终是结构化对象；Undo / Redo 历史则保存 canonical compact JSON 的 UTF-8 `Uint8Array` 快照，恢复时重新经过 `parseBlockDesignDocument`。它没有建立第二种文件语义：人类可读下载与 compact history 都复用 `src/io` 的同一个 canonical 投影，区别只有空白格式。saved baseline 仍使用 canonical 字符串，dirty 比较在文档或 saved baseline 真正变化时才计算，普通 Studio 重渲染不重复序列化。

压力基线证明该表示在 1000 modules / 2000 connections 下，单份 compact snapshot 为 1,639,002 bytes，20 次操作连同当前文档共保留 34,419,093 bytes；历史仍没有容量上限。步数上限、按字节淘汰还是持久恢复属于产品语义，在明确前不由实现层擅自选择。

删除操作负责维护引用完整性：删除模块、端口、连接或子层级时，同一编辑 Owner 内完成必要级联并清理不再使用的接口定义。UI 不应自行拼接级联规则。

## 加载、保存与失败语义

- `loadDesignFromObject` 是所有加载路径的共同结构校验入口。
- URL、本地文件和嵌入对象只有解析成功后才会调用安装逻辑。
- 解析失败返回 `DesignLoadError` 与字段路径，当前设计保持不变。
- `serializeDesign` 使用两空格缩进和结尾换行；`interfaceDefinitions` 与模块 / 接口 `attributes` 按稳定 key 顺序写出，Level、模块、Port、连接与 waypoint 数组保留设计顺序。
- canonicalization 只生成临时 IO 投影，不修改 `BlockDesignDocument`；Save、Save As、Export 和 dirty baseline 共用这一个序列化合同。
- Save / Save As 通过浏览器下载文件；Save 会把精确当前快照标记为 saved。
- Export JSON 只导出副本，不改变 dirty 状态。

当前没有浏览器 File System Access 原地写回，也没有崩溃后的自动恢复。它们必须以独立文件安全设计引入，不能绕过浏览器权限或把 localStorage 当作正式设计事实源。

## 布局与布线不变量

- 布局输入只有文档、展开 Level、placement mode 和 revision；输出是可重建的 `LayoutResult`。
- `layoutProjectionSignature` 由布局 Owner 枚举布局与 Canvas 真正消费的模块可见字段、端口、拓扑、接口类型和手工路由；文档 / Level 说明和 Inspector 合同正文不在该投影中。只有投影变化才重建 React Flow 图。
- `layoutFrameSignature` 只包含会改变拓扑、端点、Port 或层级边界的框架事实，用于决定是否重新 Fit；直接 move / resize 已由用户指定当前视野，不能再次 Fit 并把选中模块移出 viewport，可见标题变化同样不能冒充框架变化。
- Level 标题覆盖层与重型 React Flow 图分开渲染；工作区命令回调通过稳定边界读取最新事实，普通属性编辑不能因 callback identity 变化重映射全部节点和边。
- Canvas selection 只在受影响的前后节点 / 边对象上投影 `selected`，未受影响的 Flow 元素保持引用稳定；React Flow 事件、配置对象和静态控件同样保持稳定，选择不能借回调或 JSX identity 触发全图协调。
- Canvas detail level 只从 React Flow viewport 的 zoom 派生，并以根节点展示属性投影给 CSS；低缩放隐藏不可读的 process、摘要、Owner 和 data type，但始终保留模块标题、端口名、端口把手与线路。节点不分别订阅 viewport，这个展示策略不进入文档、历史或布局结果。
- MiniMap 是可丢弃的 viewport 导航，不是设计事实。宽屏工作台常驻显示；紧凑桌面默认收起并在 Canvas controls 提供显式 Show / Hide overview map，避免覆盖模块或线路。开关状态不进入 JSON、历史、selection 或 Dock 布局。
- 布线资源边界与 Canvas 视口裁剪是两个独立策略：大型场景只减少同一 `orthogonal-scene-v1` 策略的候选顶点、相关障碍物和迭代数，后者只减少压力图的 DOM 挂载。两者都不得删减 `LayoutResult`、React Flow store、MiniMap、图中总数或保存输出；200 / 400 档继续全量挂载以执行每条路径的几何门禁。
- 视口导航同样与设计事实正交：默认和 200 / 400 图使用 280 ms 平滑定位；启用视口裁剪的压力图使用单次直接定位，避免插值途中持续换挂载。React Flow MiniMap 会保留首次 `onNodeClick` 闭包，因此 Canvas 暴露稳定回调并从 ref 读取最新规模策略；不能让第三方回调生命周期冻结空布局时期的配置。
- 用户拖动期间的 position 只是 React Flow 预览；松手时 Canvas 按选中模块数量请求一次 `node/move` 或 `nodes/move`。成组移动保留各模块相对位置并共同接受参考线修正；多选对齐 / 分布同样只生成一次 `nodes/move`，不能按节点拆成多次提交。只有 Editor 接受后，各自的 `node.layout.position` 才成为新位置。若草稿保护、对象存在性或可编辑性规则拒绝操作，Canvas 一次恢复全部 base node 文档投影，不创建补偿操作、不覆盖错误提示或未应用草稿。ELK 自动位置不写回文档。
- 用户拖动四边 / 四角期间的 position 与 dimensions 同样只是 React Flow 预览；松手只提交一次 `node/resize`。被接受后，布局、端口和线路都从新的文档几何重算；被拒绝后，节点与线路恢复原投影。选中模块上的 Shift + Arrow 按 16 设计像素调整宽或高，并通过一次性 `NodeFocusRequest` 恢复焦点；公告只从被接受的新尺寸派生。
- 展开子设计时，子节点使用 compound parent 与相对位置，父模块继续提供上下文和边界。
- 路径从具名源端口开始，在具名目标端口结束。
- 每条可见逻辑连接只在真实 target 显示一个语义箭头；内部 hierarchy continuation 不重复显示箭头，Port Handle 不承担方向表达。
- 路径不得穿过无关模块或无关层级容器。
- 跨层路径只通过 hierarchy binding 生成 continuation。
- `RoutingSceneAdapter` 把绝对节点矩形、量化端口、层级布线域、commodity / Gate 和锁定 waypoint 映射为纯 `RoutingScene`。adapter 不求路，Canvas 不再为单条 Edge 收集障碍物或按模块对生成 channel。
- `solveRoutingScene` 先在外扩安全域上建立单连接基准，再以 `U → Q → X → Dmax → Dsum → bends → short segments → signature` 的字典序目标协调当前全部可见 leg。只有真实共线或小于 lane 间距的投影才形成容量冲突；connection id 不生成 lane 偏移。
- 单连接在版本化完整局部候选可见图中求最优；多连接执行有界 negotiated solve 并由独立 verifier 复算合法性和目标。证书必须列出逐 leg 审计 id 和全部已布通无序线对数量；`Optimal`、`Feasible`、`Unresolved`、`InvalidInput` 与保留的 `Infeasible` 具有不同证明含义，不能把找到路线等同于全局最优。
- 相邻同轴反向、路径自交、端口法向错误、穿过安全域、Gate 不连续、超出显式绕行上限和小于 lane 间距都不能作为合法结果。唯一允许的共线是同一物理端口的固定短 stub。
- Port anchor 的边框、展开态边框和 Handle 尺寸由 `layout/nodeGeometry.portAnchorOffset` 与同一组 CSS 变量共同拥有；可见圆点与 React Flow 内外 Handle 使用同一物理坐标。障碍物和 authored 几何按 1 / `coordinateScale` 量化，端点再归一到视觉整像素；小于 1 设计像素的浏览器测量误差继续投影该 anchor，真正的 move / resize 预览才让首尾相邻 leg 随当前端点平移，不能生成亚像素补偿折点。Fit、缩放和设备像素比不能反向改写路径事实。完整数学定义、策略默认值和证书见 [`ROUTING.md`](ROUTING.md)。
- `planRouteJumps` 只从已验证 `PlannedRoute.points` 派生交叉处的 SVG 线桥：水平线跨过垂直线，相邻交点可合并，端点附近不画桥。它不改变路线、交叉目标、marker、命中几何或 JSON；浏览器逐线对审计必须确认每个严格交叉都有桥且不存在孤立桥。
- 线路编辑器区分三种职责：空心菱形是从自动 / 手动路径派生的虚拟线段抓手，拖动会移动整段并物化手动 route；实心方点只投影已确认手动路线的真实折点，可拖动、Arrow 微调、Delete 或双击删除；小实心端点只提示可重连，真正的透明命中圆由 React Flow 管理。它们都不是新的设计事实。
- 用户拖动线段或折点时，预览是临时 UI 状态；只有坐标真正改变，松手才提交一次 `connection/route`。拖动端点只提交一次 `connection/reconnect`。单击抓手、取消拖动或非法目标不得把自动路径误写成手动事实。
- React Flow viewport 的 zoom 还派生一个根级 inverse-zoom CSS 变量；线段与折点抓手保持 20–24 CSS px 命中区，内部菱形 / 方点更小；重连仍保留 20 设计像素透明命中圆，但视觉只显示 10 设计像素实心点，避免与真实 Port 形成第二个大圆环。该变量和命中几何只参与交互展示，不改变 waypoint、端点或路由计算。
- 键盘移动抓手时，每次 Arrow 只提交一个 8 设计像素的 `connection/route` 操作；因为受控 Edge 会在文档投影更新时重建，Canvas 用一次性 `RouteHandleFocusRequest` 按 edge、抓手类型、索引和新坐标等待完全匹配的几何后恢复焦点，不能提前命中旧 DOM。该请求只负责连续输入，不进入设计、历史或路由算法。
- 手动路由提交与端点位置恢复都复用同一个正交化函数；相邻 waypoints 必须共享 x 或 y，Schema 同样校验这一不变量，外部 JSON 不能产生斜线。
- 手动 waypoints 属于连接所在 Level；hierarchy continuation 仍是自动投影，不复制手动事实。
- 白色衬底保证线与网格、容器和相邻路径可区分。
- 接口类型颜色在普通态、选中态和 target marker 中保持一致；选择只能增强线宽、阴影和把手，不能抹掉接口类型。
- 线中不渲染标签；端口名提供局部识别，Inspector 提供完整接口语义。
- Optimize Routing 只请求重新派生路线；确定性输入不会因 revision 本身跳线。Regenerate Layout 才请求重新放置模块。

## 选择与交叉定位

`SelectionRef` 是 `src/studio/selection.ts` 拥有的单一工作区选择协议，区分 document、level、node、port、connection 与显式 `multiple`。多选只包含 canonical、去重的 `DiagramSelectionRef`，因此只允许可共同直接操作的 node / connection；document、level 与 port 仍保持单选语义。`diagramSelectionItems`、replace、toggle、`selectAllInLevel`、contains、exists、key 与上下文查询都由该纯协议拥有，Tree、接口列表、Canvas、DRC 和 Inspector 不各自维护选择集合。

普通点击和框选替换集合，Shift / Ctrl / Cmd 点击或框选切换成员，Esc 回到当前对象所属 Level。左键空白拖动专用于完整包围框选，中键 / 右键拖动和滚轮负责平移；框选起点由 Canvas 捕获阶段记录、终点取自 gesture 结束事件，完整包围判断不依赖第三方临时矩形的渲染时序。React Flow 的默认 Shift selection mode 被显式关闭，避免它在 resize 抓手之前抢占同一 modifier；Shift toggle 仍由 `SelectionRef` 入口处理。框选矩形与第三方候选只存在于 gesture，结束后立即转换为领域引用。Canvas 只投影选中状态，Sources 同步高亮，Inspector 显示模块、接口和 Level 摘要；多选时隐藏单对象 resize / route 把手，并提示从 Arrange 或 `Ctrl/⌘ K` 进入同一对齐 / 分布命令。任何选择变化仍先经过 Inspector 草稿保护，被拒绝时恢复权威选择投影。

节点拖动预览与克隆事实同样分离。普通拖动把同组目标位置提交为一次 `nodes/move`；Ctrl/⌘ 拖动只从同一组目标位置求一个统一平移，Studio 据当前 `BlockDesignDocument` 构造完整 `DesignFragment` 并提交一次 `fragment/insert`。无论插入成功或被草稿 / Schema 拒绝，Canvas 都恢复原节点预览；成功后选择切换到新模块。gesture、modifier 和 React Flow 临时坐标不进入 JSON，外部连接仍遵守片段边界被排除。

`Ctrl/⌘ A` 与 Edit → Select All 只把当前 Level 的全部 module / connection 交给 `selectAllInLevel` 构造 canonical 选择；`Ctrl/⌘ Shift A` 与 Clear Selection 清空图形对象并回到当前 Level 上下文。两者都复用 `StudioCommands` 的可用性与执行链，不修改 viewport、文档或历史；当事件来自 input、textarea、select 或可编辑元素时，Studio 不拦截浏览器原生全选。

多选删除没有复用单对象级联规则：模块、接口与跨层对象混合删除的保留 / 级联合同尚未定义，因此统一命令明确禁用并解释原因，要求先收敛到一个对象。该限制防止 UI 顺手拼接多个 delete operation，造成顺序依赖或多个 Undo 记录。

选择事实与视口导航正交：Canvas 内点击只更新 `SelectionRef`，不改变用户正在观察的 viewport；Sources、Messages、Inspector 和 MiniMap 属于交叉定位入口，在选择被草稿保护规则接受后才发出一次性 `revealSelectionRequest`。Fit Selection 则从既有选择读取选中模块绝对矩形、选中接口的全部 route points 及两端模块上下文，由纯 `canvasGeometryBounds` 求并集后调用 `fitBounds`；几何未测量完成时请求保持待处理，真正得到 bounds 后才消费。两类计数都是可丢弃 UI 请求，不进入文档、历史或保存文件。MiniMap 节点直接点击复用相同的选择保护，并聚焦到可读尺寸。

Zoom In、Zoom Out 与 Actual Size 由 Studio 发送具名、递增 revision 的 `CanvasViewportActionRequest`；View 菜单、Command Palette 和 `Ctrl/⌘ + / −` 不直接调用第三方图实例。Canvas 是 viewport 变换的唯一执行者，左下控件复用同一 `zoomInViewport` / `zoomOutViewport` / `actualSizeViewport`，百分比直接订阅 React Flow transform 并只作展示。Actual Size 以当前视口中心回到 1:1，不改变节点设计坐标、模块 width / height、selection、历史或导出。

Canvas 明确声明互不重叠的 gesture：左键空白拖动为 selection，`panOnDrag=[middle,right]`，`panActivationKeyCode=Space` 让 Space + 左拖平移，`panOnScroll` 让普通滚轮平移，`zoomActivationKeyCode=[Control,Meta]` 让 modifier + wheel 缩放。节点 / 连线的 Space 键盘选择只阻止默认浏览器行为，不再截断事件传播，因此对象有焦点时仍可进入 Space-pan。`spacePanActive` 与 PAN MODE pill 只是按键期间的可丢弃反馈；表单、按钮、链接、Dialog 与 Menu 不进入该模式，keyup、窗口失焦或卸载都会清理。

平滑定位同样必须服从新的直接操作。Studio Fit、Sources / Messages / Inspector 交叉定位、MiniMap 和 Canvas 缩放 / Fit 控件都调用同一个 Canvas 导航协调器；它以 generation 标识自己发起的动画。只要 pointer 在动画期间进入画布，当前 transform 就以零时长固定，旧动画的异步完成不能重新宣称导航仍在进行。这样鼠标按下时命中的是用户眼前的模块，而不是动画继续移动后暴露的 pane。中断只结束可丢弃 viewport 动画，不改变 `SelectionRef`、设计坐标、布局或历史。

React Flow 的 Node / Edge wrapper 虽然提供原生 Tab 焦点与 Enter、Space、Escape 键，但库内 selection 不是工作区事实。Canvas 在捕获阶段把这些键转换成同一 `SelectionRef` 请求，并阻止库内平行选择；Enter / Space 选择对象，Escape 回到对象所属 Level。多选模块的 Arrow 作为一组提交，读屏公告从同一成功结果派生；Delete 随后继续调用统一 Studio command，因此键盘选择、Inspector、路由把手和删除看到同一选择合同。

选中且允许 authored placement 的模块收到 Arrow 时，Canvas 同样阻止 React Flow 只修改临时 position，按 16 × 16 设计网格提交一个 `node/move` 或 `nodes/move`。Editor 写入各自 `node.layout.position` 与 pinned，布局再从文档投影画布；一次性 `NodeFocusRequest` 只等待焦点模块的目标设计坐标出现，让连续移动、Undo、保存和重新投影使用同一几何事实。

React Flow 的库内键盘位移被阻止后，其内建 aria-live 不再拥有真实移动结果。Canvas 只在 `node/move` 被 Editor 接受时，从同一个目标设计坐标派生 polite 公告；公告表达模块、方向与 x / y，不查询 DOM 反推位置，也不进入文档或历史。

面板焦点同样是可丢弃工作区意图：Studio 在用户显式打开 Messages 或运行 Validate 时递增一次 `messageFocusRequest`，Messages 只负责把该请求落实到自己的筛选输入。菜单、工具栏和校验命令不直接查询面板 DOM，焦点请求不改变 `SelectionRef`、诊断结果或设计文档。

`StudioCommandAvailability` 是命令可用性的唯一公开合同：命令要么 `enabled: true`，要么 `enabled: false` 且必须携带 `unavailableReason`，类型层不允许产生“禁用但无解释”的状态。Studio 从当前 document、history、selection、hierarchy 和 connectable pair 一次派生该联合类型；Menu 与 Toolbar 只投影同一结果，不重新计算 eligibility。禁用命令保持不可执行，原因只用于可见菜单文案、toolbar title 与 accessible name，不进入 JSON、历史或工作区事实。

`MenuBar` 只拥有桌面复合菜单的焦点、导航和激活门禁，不拥有命令 eligibility 或行为。顶层按钮和已展开菜单都支持无修饰 printable character 定位；搜索从当前焦点之后开始并环绕一次，方向键、Home / End 与字符导航都经过实际渲染的菜单项，包括 `aria-disabled` 项。禁用项因此可获得可见焦点并让辅助技术读取同一 `unavailableReason`，但 Enter、Space 与 pointer 激活都由 MenuBar 拒绝，菜单和焦点保持原位。可用项最终仍只调用 `StudioCommands.execute`；Toolbar 普通按钮继续使用原生 `disabled`，两种交互语义不互相套用。

`useDialogFocus` 是模态焦点循环、Esc 关闭和默认恢复的共享协议。命令面板执行动作时调用其 `prepareFocusHandoff`：先恢复原调用位置，再禁止卸载清理重复抢焦点，最后让被执行动作决定是否把焦点交给新 Dialog、Messages 或继续留在原位置。普通 Esc / 遮罩关闭仍走默认恢复，不需要每个 Dialog 各自查询 DOM 或复制延时逻辑。

默认 Hierarchy 先由 `projectHierarchyRows` 按文档顺序和当前展开集合生成完整的 document / level / node 行投影；搜索和接口浏览器同样始终从完整文档派生有序结果与总数。三类列表只按 40 行批次把结果渐进挂入 DOM，接近滚动底部时继续加载。批次窗口是可丢弃展示状态，不截断结果、不改变排序、不重置选择，也不生成第二份模块或接口事实；展开只改变完整行投影，不能把已经滚动加载的窗口弹回顶部。

模块关联摘要由 `listModuleInterfaces(document, levelId, nodeId)` 按 Level 中的声明连接顺序派生，只表达直接入站、出站或自环连接。它不计算传递依赖、不复制接口合同，也不写回文档；语义引用暂缺时用稳定 id 降级显示，让 DRC 与审查界面仍可共同定位问题。

鼠标拖线和键盘端点选择都调用 `normalizeConnectionEndpoints`：只允许同一 Level 中不同端口的 `output / bidirectional -> input / bidirectional` 组合，并把反向拖动规范化为相同方向。两种入口随后共同进入 `CreateConnectionDialog` 和唯一的 `connection/add` 原子操作，不各自实现连接 id、接口合同或写入规则。

选择不是持久设计事实。删除对象后，Studio 必须验证选择是否仍存在，并回退到有效 Level 或 Document。跨层 DRC 和接口定位先展开所需祖先路径，再安装选择。

## 公开嵌入接口

```ts
export interface BlockDesignStudioProps {
  initialDocument?: unknown;
  initialDesignUrl?: string;
  initialSourceLabel?: string;
}
```

- `initialDocument` 和 `initialDesignUrl` 至少提供一个。
- 两者都存在时，当前实现优先使用 `initialDesignUrl`。
- `initialSourceLabel` 只影响来源展示和建议文件名，不是设计事实。
- 外部对象一律作为 `unknown` 输入并在安装前解析，调用方不能绕过 Schema。

查询参数 `?design=<url>` 是独立应用的启动适配层，不属于 `BlockDesignStudio` 的内部状态协议。

## Schema 兼容策略

当前写出版本由 `BLOCK_DESIGN_SCHEMA_VERSION` 唯一定义为 `2.1`。`parseBlockDesignDocument` 先交给 `model/migrations` 读取版本并逐步迁移，再用当前 Schema 做最终校验；IO 和 Studio 不判断版本。公开的不可变 `blockDesignSchemaCompatibility` 是支持矩阵：`2.0 -> 2.1` 为迁移，`2.1 -> 2.1` 为当前版本，其他版本不猜测兼容。

```text
unknown JSON
    │ schemaVersion 缺失 / 类型错误
    ├──────────────────────────────► Zod issue，path = schemaVersion
    ▼
model/migrations
    │ 2.0 版本 Schema 校验 ─► migrateV20ToV21
    │ 未注册版本 ──────────────────► unsupported version issue
    ▼
model/parseDesign
    │ 当前 2.1 Schema 最终校验失败 ─► 不返回部分文档
    ▼
BlockDesignDocument 2.1
```

`legacy-v2.0.block-design.json` 与 `migrated-v2.1.block-design.json` 分别是迁移输入和精确输出 golden fixture。2.0 文件若伪装包含 2.1 才出现的 `routing`，旧版 Schema 会拒绝，而不是静默删除数据。

当前 Zod object 对未声明字段默认执行剥离；除 2.0 `routing` 已明确拒绝外，2.1 及其他嵌套对象的未知字段应“严格拒绝”还是“保留后原样写回”仍是兼容与数据保留决策。确定该策略前不能宣称前向兼容，也不能在局部 Schema 中零散切换行为。

后续兼容能力必须遵守：

1. 文件中的 `schemaVersion` 是唯一版本判断来源。
2. 每个旧版本由注册表中的独立、纯函数迁移到下一个版本，不在 UI 或 IO 中兼容字段。当前链路为 `2.0 -> 2.1`。
3. 迁移前保留原始输入；迁移失败不能安装部分文档。
4. 每条迁移使用 golden fixtures 验证输入、输出、幂等或明确的单向性。
5. 破坏性字段、语义或引用变化提升主版本；向后兼容的可选字段提升次版本。
6. 序列化顺序、默认值和删除规则必须成为可回归合同。

不能宣称支持 v1、未来 v2.x 或未经 golden fixture 验证的版本。

## 依赖选择

- React Flow：节点、端口、边交互和视口。
- ELK：分层与复合节点布局。
- React Flow Smart Edge：网格化正交寻路基础。
- Dockview：IDE 式面板布局。
- Zod：运行时文件契约解析。

这些依赖各自拥有单一基础能力。没有可验证收益时，不替换 React Flow、ELK 或 Dockview，也不把其内部对象升级为产品事实源。
