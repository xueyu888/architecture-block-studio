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
          ├────────► routing：车道规划 / 正交避障
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
| `src/editor` | 拥有原子文档变换、历史与 dirty 判断 | `DesignOperation`、`applyDesignOperation`、`useDesignEditor`、具名工厂 | 不渲染、不路由、不持久化；失败不产生部分修改 |
| `src/io` | 拥有外部 JSON 与已校验文档之间的转换 | `loadDesignFromObject/File/Url`、`serializeDesign`、`downloadDesign` | 不解释模块业务；加载失败保留已安装文档 |
| `src/layout` | 从文档与展开状态派生纯复合节点、边和位置投影，并定义布局真正消费的签名 | `layoutBlockDesign`、`layoutGeometrySignature`、`layoutProjectionSignature`、`LayoutResult`、`PlacementMode` | 不依赖 Studio 或 React 交互回调，不修改源文档；失败上抛给 Studio |
| `src/routing` | 从绝对几何、端口冲突组和连接 id 派生正交避障路径与确定性车道 | `absoluteRoutingObstacles`、`planRouteLaneOffsets`、`routeOrthogonalInterface`、`separateOrthogonalRoute`、`orthogonalizeRoutePoints` | 设计坐标是路由事实；视口缩放不得改变路径，不移动模块，不改写接口事实 |
| `src/components` | 将纯布局投影组合为可交互 Canvas，并展示用户视图、发出用户意图 | `CanvasBlockNodeData`、`CanvasInterfaceEdgeData`、Canvas、Node、Edge、Tree、Inspector、Dialogs、Dock、Messages | 交互回调只存在于 Canvas 投影；不直接深改文档，局部表单草稿不得伪装成已提交事实 |
| `src/studio` | 组合公开能力，拥有工作区选择协议与其他临时工作区状态 | `BlockDesignStudio`、`BlockDesignStudioProps`、`SelectionRef` 及纯选择查询 | 不重新定义 Schema、布局投影或编辑规则；组合失败应可见、可恢复 |
| `src/App.tsx` | 提供独立应用的默认装配 | 默认示例 URL 与查询参数入口 | 示例不是核心依赖，不拥有设计内容 |
| `tests/performance` + `scripts/performance-baseline.mjs` | 拥有压力观测样本合同与重复聚合入口 | `performance-sample v1`、`performance-trend-report v1`、`pnpm performance:baseline` | 只验证产品合同，不被运行时代码依赖，不写回设计 JSON；环境或样本漂移时停止生成可信报告 |

`BlockDesignStudio.tsx` 当前承担较多编排职责，但它仍通过上述公开接口组合模块。后续只有在出现独立变化原因时才拆出命令协调器；不能建立囊括所有能力的全局 Service 或共享可变状态。

当前依赖核查中，`model` 不依赖任何上层模块，`layout` 与 `io` 只消费模型合同，`routing` 只消费几何库类型；`editor` 只额外复用 `io` 的纯 canonical snapshot 序列化，避免 dirty、历史和文件输出出现第二套规则。组件对 `studio` 的引用仅指向无 UI 依赖的 `commands` / `selection` 叶子协议，这两个协议不反向导入组件；`BlockDesignStudio` 才负责组合具体组件。文件行数本身不是拆分依据，只有独立状态、规则或变化原因出现时才建立新 Owner。

## 状态分类

系统必须区分五类状态，避免事实源漂移。

| 类型 | 当前 Owner | 例子 | 是否进入 JSON |
| --- | --- | --- | --- |
| 持久设计事实 | `BlockDesignDocument` | 文档、Level、模块、端口、接口、连接、层级绑定、用户拖动位置与手动路由 | 是 |
| 派生设计结果 | `model` / `layout` / `routing` | DRC issues、模块关联接口摘要、Flow nodes、可视边、ELK 位置、正交路径 | 否，可重建 |
| 工作区状态 | `BlockDesignStudio` / Dockview | 当前选择、展开 Level、面板布局、缩放、Fit 请求、自动布局模式 | 否 |
| 未提交编辑草稿 | 各 Inspector / Dialog 表单 | 输入框内容、待创建连接 | 否；提交后才生成 `DesignOperation` |
| 验证证据 | tests / screenshots / CI | 构建结果、几何检查、浏览器截图 | 否；只验证合同 |

关键规则：派生结果和验证证据不能反向定义文档；工作区状态不能写成架构事实；草稿必须显式提交或显式放弃，不能静默消失。

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
- `layoutGeometrySignature` 只包含会改变位置、尺寸、拓扑或层级边界的事实，用于决定是否 Fit；可见标题变化不能冒充几何变化。
- Level 标题覆盖层与重型 React Flow 图分开渲染；工作区命令回调通过稳定边界读取最新事实，普通属性编辑不能因 callback identity 变化重映射全部节点和边。
- Canvas selection 只在受影响的前后节点 / 边对象上投影 `selected`，未受影响的 Flow 元素保持引用稳定；React Flow 事件、配置对象和静态控件同样保持稳定，选择不能借回调或 JSX identity 触发全图协调。
- Canvas detail level 只从 React Flow viewport 的 zoom 派生，并以根节点展示属性投影给 CSS；低缩放隐藏不可读的 process、摘要、Owner 和 data type，但始终保留模块标题、端口名、端口把手与线路。节点不分别订阅 viewport，这个展示策略不进入文档、历史或布局结果。
- 路由快路径与 Canvas 视口裁剪是两个独立策略：前者改变派生路径算法，后者只减少压力图的 DOM 挂载。裁剪不得删减 `LayoutResult`、React Flow store、MiniMap、图中总数或保存输出；200 / 400 档继续全量挂载以执行每条路径的几何门禁。
- 视口导航同样与设计事实正交：默认和 200 / 400 图使用 280 ms 平滑定位；启用视口裁剪的压力图使用单次直接定位，避免插值途中持续换挂载。React Flow MiniMap 会保留首次 `onNodeClick` 闭包，因此 Canvas 暴露稳定回调并从 ref 读取最新规模策略；不能让第三方回调生命周期冻结空布局时期的配置。
- 用户拖动期间的 position 只是 React Flow 预览；松手时 Canvas 向 Editor 请求一次 `node/move`。只有 Editor 接受后，`node.layout.position` 才成为新位置；若草稿保护或可编辑性规则拒绝操作，Canvas 立即恢复同一 base node 的文档投影，不创建补偿操作、不覆盖错误提示或未应用草稿。ELK 自动位置不写回文档。
- 展开子设计时，子节点使用 compound parent 与相对位置，父模块继续提供上下文和边界。
- 路径从具名源端口开始，在具名目标端口结束。
- 路径不得穿过无关模块或无关层级容器。
- 跨层路径只通过 hierarchy binding 生成 continuation。
- 自动路由先依端口和障碍物生成最小正交路径；若智能路径已从正确端口侧出入则保持原路径，只有端口侧被违反时才从两端 40 设计像素外向 stub 之间重新寻路。网格寻路和车道偏移留下的微小对角段统一由 `orthogonalizeRoutePoints` 转成显式直角，压缩路径时保留为避开模块所需的同轴折返。
- 不同连接共享物理端口或模块通道时，`planRouteLaneOffsets` 对冲突图做确定性分道，互不冲突的连接可以复用车道；分道后重新按原路径首尾方向补齐直角，不能为了车道偏移产生斜线或从模块内部接近端口。
- 路由和车道间距以设计坐标计算；Fit、缩放和设备像素比只改变投影，不能反向改写路径几何。
- 用户拖动选中线的正交线段时，预览是临时 UI 状态；只有线段坐标真正改变，松手才提交一次 `connection/route` 操作。单击线路或把手不能把自动路径误写成手动事实。
- React Flow viewport 的 zoom 还派生一个根级 inverse-zoom CSS 变量；选中线路的拖动把手用它保持 24 CSS px 命中区，内部视觉方块保持 14 CSS px。该变量只参与命中与展示，不改变 waypoint、设计坐标或路由计算。
- 键盘移动把手时，每次 Arrow 只提交一个 8 设计像素的 `connection/route` 操作；因为受控 Edge 会在文档投影更新时重建，Canvas 用一次性 `RouteHandleFocusRequest` 按 edge、轴、线段与新坐标恢复焦点。该请求只负责连续输入，不进入设计、历史或路由算法。
- 手动路由提交与端点位置恢复都复用同一个正交化函数；相邻 waypoints 必须共享 x 或 y，Schema 同样校验这一不变量，外部 JSON 不能产生斜线。
- 手动 waypoints 属于连接所在 Level；hierarchy continuation 仍是自动投影，不复制手动事实。
- 白色衬底保证线与网格、容器和相邻路径可区分。
- 线中不渲染标签；端口名提供局部识别，Inspector 提供完整接口语义。
- Optimize Routing 只修改路由派生 revision；Regenerate Layout 才请求重新放置模块。

## 选择与交叉定位

`SelectionRef` 是 `src/studio/selection.ts` 拥有的单一工作区选择协议，区分 document、level、node、port 与 connection。Tree、模块关联接口摘要、接口列表、Canvas、DRC 和 Inspector 通过它同步上下文；`selectionExists`、`selectionForIssue`、`levelForSelection` 和 `hierarchyLevelPath` 等纯查询不封闭在 React 编排组件内。

选择事实与视口导航正交：Canvas 内点击只更新 `SelectionRef`，不改变用户正在观察的 viewport；Sources、Messages、Inspector 和 MiniMap 属于交叉定位入口，在选择被草稿保护规则接受后才发出一次性 `revealSelectionRequest`。Canvas 从当前完整布局解析目标节点或接口两端，通过 `fitView` 平滑聚焦；该计数是可丢弃 UI 请求，不进入文档、历史或保存文件。MiniMap 节点直接点击复用相同的选择保护，并聚焦到可读尺寸。

React Flow 的 Node / Edge wrapper 虽然提供原生 Tab 焦点与 Enter、Space、Escape 键，但库内 selection 不是工作区事实。Canvas 在捕获阶段把这些键转换成同一 `SelectionRef` 请求，并阻止库内平行选择；Enter / Space 选择对象，Escape 回到对象所属 Level。Delete 随后继续调用统一 Studio command，因此键盘选择、Inspector、路由把手和删除看到同一对象。

选中且允许 authored placement 的模块收到 Arrow 时，Canvas 同样阻止 React Flow 只修改临时 position，按 16 × 16 设计网格直接提交一个 `node/move`。Editor 写入 `node.layout.position` 与 pinned，布局再从文档投影画布；一次性 `NodeFocusRequest` 只等待目标设计坐标出现并恢复模块焦点，让连续移动、Undo、保存和重新投影使用同一几何事实。

React Flow 的库内键盘位移被阻止后，其内建 aria-live 不再拥有真实移动结果。Canvas 只在 `node/move` 被 Editor 接受时，从同一个目标设计坐标派生 polite 公告；公告表达模块、方向与 x / y，不查询 DOM 反推位置，也不进入文档或历史。

面板焦点同样是可丢弃工作区意图：Studio 在用户显式打开 Messages 或运行 Validate 时递增一次 `messageFocusRequest`，Messages 只负责把该请求落实到自己的筛选输入。菜单、工具栏和校验命令不直接查询面板 DOM，焦点请求不改变 `SelectionRef`、诊断结果或设计文档。

`StudioCommandAvailability` 是命令可用性的唯一公开合同：命令要么 `enabled: true`，要么 `enabled: false` 且必须携带 `unavailableReason`，类型层不允许产生“禁用但无解释”的状态。Studio 从当前 document、history、selection、hierarchy 和 connectable pair 一次派生该联合类型；Menu 与 Toolbar 只投影同一结果，不重新计算 eligibility。禁用命令保持不可执行，原因只用于可见菜单文案、toolbar title 与 accessible name，不进入 JSON、历史或工作区事实。

`MenuBar` 只拥有桌面菜单的导航语义，不拥有命令行为。顶层按钮和已展开菜单都支持无修饰 printable character 定位；搜索从当前焦点之后开始、环绕一次，只匹配可用命令的可见名称。重复字符循环同首字母项，无匹配或只有禁用匹配时保持原焦点。最终执行仍调用 `StudioCommands` 的 `execute`，因此菜单键入定位不会复制 enabled 规则、创建流程或文档写入。

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
