# Architecture Block Studio

> 面向 AI 编程时代的代码模块与接口设计工作台：设计系统、理解代码、审查架构。

Architecture Block Studio 把代码系统表达成可编辑、可校验、可版本化的模块设计。模块说明谁拥有职责，端口说明公开能力，连线说明类型化接口，层级说明内部结构；所有设计事实最终落在一份 `BlockDesignDocument` JSON 中。

它不只是“生成代码前画一张图”。它同时服务于三件事：

- **设计**：在实现前明确 Owner、职责边界、接口方向与失败行为，为人和 AI 提供稳定约束。
- **理解**：把已有代码或外部分析结果映射成模块、端口和依赖关系，从整体上读懂系统。
- **审查**：在代码变更后检查职责漂移、隐式依赖、越界调用与接口合同变化，补足逐行 Code Review 的结构视角。

![Architecture Block Studio Windows 桌面工作台](docs/screenshots/windows-desktop-app.png)

## 为什么是现在

AI 让代码生成越来越快，也让结构退化越来越容易：同一职责被重复实现、调用关系藏进细节、模块边界在多轮修改中漂移。代码产量不再稀缺之后，真正稀缺的是人能否持续回答：

- 这项事实和状态由谁拥有？
- 模块为什么存在，又明确不负责什么？
- 模块之间只能通过哪些接口组合？
- AI 生成或修改的代码，是否仍遵守既定边界和依赖方向？

Architecture Block Studio 将这些问题变成可阅读、可编辑、可校验的设计对象，让架构意图能够进入版本控制，也能成为 AI 编程上下文和人工审查依据。

## 核心能力

- 像专业 IDE 一样新建、打开、编辑、保存、另存和导出设计。
- 创建模块、具名端口、RPC / DTO / Event / Stream 等类型化接口。
- 既可以在画布拖线，也可以通过 **Add Interface** 用键盘选择端点并创建同一类接口合同。
- 为模块和接口记录 Principle、Purpose、Boundary、Failure 与 Owner。
- 原位展开子设计，显式绑定父子端口，同时保留系统上下文。
- 选中含子设计的模块后可执行 **Enter Module** 聚焦内部 Level；使用 **Exit Module**、Esc、**Architecture Home** 或可点击 breadcrumb 一步恢复上层上下文。视图根只改变工作区投影，不改 JSON、层级关系、布局尺寸或浏览器历史。
- 在 Hierarchy 中按模块标题、id、Owner 或 Level 搜索，并直接定位画布与 Inspector。
- 选中模块即可查看直接入站 / 出站接口与对端，点击摘要进入完整接口合同。
- 使用 DRC 检查结构、引用、方向、必连端口和合同完整性，并直接查看修正方向。
- 使用 ELK 生成分层布局；自动连线由场景级正交多连接策略统一规划，以障碍净空、端口方向、真实 lane 间距、有限绕行和确定性证书保持复杂设计可读；无法消除的正交交叉用克制的线桥表达前后关系。
- 缩放到系统总览时只保留模块标题、端口名和线路，放大后自动恢复 Owner、摘要、类型等完整细节。
- 单选模块或选择多个同父级模块后，都可从四边或四角调整尺寸；多选使用一个统一包围框同步改变组内位置与大小，端口和线路实时跟随，结果进入同一份 JSON、Undo / Redo 与保存链。
- 拖动尺寸抓手时按住 **Shift** 保持模块原始宽高比例；比例约束优先于兄弟尺寸吸附，松手仍只产生一次可撤销几何编辑。
- 移动或调整模块时默认落在可见的 16px 设计网格；拖动模块或选择组接近同级邻居的等距位置时，画布优先显示两段无文字间距括号，其次才使用边缘 / 中心对齐，未命中才落网格。先从模块或尺寸抓手开始直接操作，再按住 **Alt** 可同时关闭等距、对齐与网格，进行不受隐藏栅格限制的精确摆放。Alt 若在 pointerdown 前已经按住，则明确表示强制框选，两种能力不会抢占。
- 使用普通点击、Shift / Ctrl / Cmd 与左键框选建立多选；普通框选只选择完全包围的对象，按住 **Alt** 可从模块或抓手上直接起框并选择所有真实相交的模块与线段，**Alt + Shift** 可成片移出已有选择。成组移动、成组缩放、六向对齐、水平 / 垂直等距分布和 **Delete** 批量删除都只产生一次可撤销操作；混选模块与接口时会先完整校验，模块拥有的相连接口与独占子设计按同一既有级联合同清理。
- 使用 **Ctrl/⌘ A** 一次选择当前 Level 的全部模块和接口，使用 **Ctrl/⌘ Shift A** 清空选择；输入框继续保留浏览器原生全选，不会误选画布对象。
- 选择一个或多个模块后，使用 **Edit → Select Direct Interfaces**，或按 **Ctrl/⌘ K** 搜索同名命令，即可把这些模块的全部直接入站、出站和自环接口加入选择；随后可直接聚焦、逐线审查或一次删除，JSON、Undo 与当前视口保持不变。
- 使用 **Edit → Select Direct Neighborhood** 可把所选模块、全部直接接口及其两端模块合并为一个可操作的局部子图；重复执行会逐层扩展真实依赖，配合 **Fit Selection** 即可在大图中渐进理解和审查代码边界，不会隐藏其他对象或创建第二套过滤状态。
- 使用 **Select Incoming / Outgoing Interfaces** 与对应的 **Neighborhood** 命令，可严格按 `source → target` 区分上游调用者和下游依赖；方向来自 JSON 中的连接事实，不从卡片位置或箭头朝向反推。
- 使用 **Edit → Select Modules in Level / Select Interfaces in Level** 可只选择当前层的全部模块或全部接口；这两类对象互斥替换，适合集中排布模块或逐线审查接口，不依赖当前缩放下是否挂载在 DOM 中。
- 画布获得焦点后，使用 **Tab / Shift + Tab** 按稳定顺序遍历可见模块与接口，使用 **Alt + Tab** 返回可见父模块；按 **Enter** 进入所选模块的端口或所选线路的抓手，按 **Esc** 返回对象。侧栏表单继续使用原生 Tab，不会被画布抢走焦点。
- 选中任意接口后使用 **Ctrl/⌘ Shift H** 或 **View → Fit Selection**，可把完整正交路径和两端模块一起聚焦到可读范围，便于逐线人工审查。
- 使用 **Ctrl/⌘ + / −**、View 菜单或画布左下控件缩放；百分比始终显示真实 viewport zoom，点击即可回到 **Actual Size (100%)**，不会改变设计尺寸或导出结果。
- 左键空白拖动执行完整包围框选，**Alt + 左拖**执行几何相交框选；按住 **Space** 后左拖、直接右拖或中拖平移；普通滚轮平移，Ctrl/⌘ + wheel 围绕指针缩放。Space 模式有临时状态提示，放开即回到选择，不改变任何设计事实。
- 在模块、接口或多选对象上右键短按，可打开与 Edit 菜单、工具栏和命令面板同源的对象菜单；右拖超过统一的 5px 容差后只平移画布，松手绝不误弹菜单。键盘用户可在聚焦对象后按 **Shift + F10** 打开同一菜单。
- 复制模块或完整同层子图后，在空白画布、模块或接口附近右键选择 **Paste Here**，片段会以当前 Level 的设计坐标落到指定网格点；若该位置已被占用，则选择最近的无碰撞位置。第 1～5 层、普通右键与 **Shift + F10** 共用同一坐标和 Undo 合同。
- 在空白画布右键选择 **Add Module Here**，或把工具栏的 **Add Module** 拖到画布，即可在当前 Level 的指定位置创建模块。对话框只收集名称与 Owner；提交时才以模块中心对齐落点、吸附 32px 网格并寻找最近无碰撞位置，最终只产生一次 `node/add` 和一次 Undo。若结果已完整可见，视口不会突然跳动；若被边缘、MiniMap 或控件遮住，画布才会留出安全间距将其带回视野。
- 将模块、连接预览、框选边界、线路段 / 折点或尺寸抓手拖到画布边缘后，即使指针保持不动，视口也会按同一速度持续平移，预览始终跟住指针；松手、取消、按 Esc 或窗口失焦会立即停止。
- 使用 **Ctrl/⌘ C、Ctrl/⌘ X、Ctrl/⌘ V、Ctrl/⌘ D** 或 Edit 菜单复制、剪切、粘贴和 Duplicate 同层模块子图；内部接口、接口合同和完整子设计一起进入片段，外部连接明确排除，Cut 的源图删除只形成一次 Undo。
- 选中一个或多个同层模块后按住 **Ctrl/⌘ 拖动**，可在指针落点直接克隆完整子图；原模块只作拖动预览，新模块、内部接口与后代 Level 作为一次原子编辑提交。
- 选中连线后拖动正交线段，手动路由随 JSON 保存，也可随时恢复自动布线。
- 从端口拉线或拖动既有线路端点时，画布会实时标出起点、合法候选与非法目标，并显示端口法向的正交预览；一次拖拽只注册一次静态障碍，坐标变化立即求解，完全相同的短时请求才安全复用。按 **Esc**、移出画布或落到非法端口都会完整销毁预览会话，不改 JSON、不污染 Undo / Redo。
- 选中接口后可从 **Design、命令面板或 Inspector** 打开 `Reconnect Interface`，仅用键盘重新选择源 / 目标端口；端点未变化时不会产生历史，真正变化后会清除旧端点拥有的手工路线，并完整进入 Undo / Redo 与保存链。
- 画布不显示线中标签；端口承担局部识别，点击连线后由 Inspector 展示完整合同。
- 选中模块后按 **F2**，或直接双击卡片 Header 中的标题，即可原位改名；**Enter / 失焦**提交一次可撤销文档编辑，**Escape**取消且不产生历史。Properties、Hierarchy、保存 JSON 和代码审查视图都从同一个模块标题事实重新派生。
- 通过 Undo / Redo、事务性加载和 dirty 状态保护编辑过程。

![Windows 桌面画布内直接编辑模块标题](docs/screenshots/windows-inline-title-editing.png)

![双层展开后的场景级正交布线局部](docs/screenshots/scene-routing-core-detail.png)

卡片尺寸不是画布临时效果。拖动四边 / 四角或使用 **Ctrl/⌘ + Shift + 方向键** 调整后，位置、宽高、端口和线路作为一组原子几何保存；内容安全下限会避免端口文字被压坏。

![模块四边与四角尺寸编辑](docs/screenshots/node-resize.png)

![Shift 拖动保持模块原始宽高比例](docs/screenshots/aspect-ratio-resize.png)

多选模块共享一个八向缩放框。每次手势从同一父级坐标系中的完整包围框计算统一比例，再把结果投影到每个模块的位置和尺寸；Shift 保持组比例，操作开始后按 Alt 可绕过参考线和网格。不同尺寸、低缩放、五层嵌套和高连接度模块都使用同一个纯几何合同，跨层选择或展开的层级容器不会伪造可持久尺寸。

![不同尺寸模块组成的统一缩放框](docs/screenshots/group-resize.png)

拖动模块接近同级模块的等距、边缘或中心位置时，画布会用克制的洋红提示吸附。每个轴只执行一条确定规则：先检查正交方向真实重叠的最近邻等距关系，再检查边缘 / 中心，最后才落到 16px 设计网格；调整尺寸继续使用同宽 / 同高提示。等距反馈只有两段短括号，没有容易遮挡端口和线路的数字或文字。按住 Alt 后直接使用原始指针几何，辅助线、网格结果和预览都只存在于当前操作，不进入 JSON，也不会成为需要维护的第二份布局状态。

多选拖动使用整个选择组的包围框，而不是临时把鼠标按下的那张卡片当成几何主体。无论从大模块还是小模块起拖，同一目标都会给整组施加同一修正，组内相对位置、内部接口和外部接口保持一致；普通拖动以父级坐标系中的组边界对齐网格，Alt 则在当前手势中同时绕过网格与参考线。

![模块移动对齐辅助线](docs/screenshots/alignment-guides.png)

![不同尺寸模块组成的选择组边界吸附](docs/screenshots/group-boundary-alignment.png)

![单模块拖动时的实时等距参考线](docs/screenshots/equal-distance-guides.png)

![不同尺寸选择组的实时等距参考线](docs/screenshots/equal-distance-group.png)

![模块同尺寸辅助线](docs/screenshots/same-size-guides.png)

复制不是把画面像素拍成一张图。Studio 会从当前选择构造可校验的设计片段，重写模块、连接、接口定义和子 Level 的全部引用，再把整组放到最近的无碰撞网格位置。系统剪贴板不可用时仍可在当前工作台继续粘贴，并给出可见反馈。

![同层模块子图的无碰撞复制与粘贴](docs/screenshots/copy-paste-subgraph.png)

Paste Here 不是把屏幕像素误写成设计坐标。Canvas 先把 Windows 指针转换到真实所属 Level，片段 Owner 再对齐模块组边界并统一处理碰撞、引用重写与一次 Undo；右键位置、菜单状态和视口缩放都不会进入 JSON。

![空白画布指定位置粘贴模块](docs/screenshots/paste-here.png)

![Windows 桌面对象附近 Paste Here](docs/screenshots/windows-paste-here.png)

指定位置新建与 Paste Here 共用同一个纯几何放置 Owner，但模块创建不伪装成片段粘贴。Canvas 只把 Windows 指针换算为当前 Level 设计坐标并显示可丢弃预览；对话框确认后，Editor 才把唯一最终位置与模块事实一起原子写入文档。取消拖放、关闭对话框、非法坐标或未应用的 Inspector 草稿都不会留下半成品。

![空白画布或工具栏拖放指定位置新建模块](docs/screenshots/add-module-here.png)

![五层边界内拖放新建模块](docs/screenshots/add-module-here-level-five.png)

![Windows 桌面工具栏拖放新建模块](docs/screenshots/windows-add-module-here.png)

Cut 也不是先删再赌剪贴板可用。Studio 会先建立完整内部片段，再用一个 Editor 操作删除源模块及其附着接口；系统剪贴板拒绝权限时仍能跨设计粘贴。片段构造或删除预检失败都不会留下半删状态，Undo / Redo 只跨越一次源图变化。

![剪切完整层级后跨设计粘贴](docs/screenshots/cut-paste-subgraph.png)

Ctrl/⌘ 拖动复用同一份可校验片段合同，但由指针明确给出目标位移；画布松手后立即恢复原模块投影，Editor 只插入一次完整子图。因此克隆不会丢失内部接口或子 Level，也不会出现原图被移动、JSON 却另存一套位置的双状态。

![在指针落点原子克隆完整模块子图](docs/screenshots/ctrl-drag-clone.png)

当前 Level 的全选与清空选择沿用同一选择协议，因此 Canvas、Sources、Inspector、菜单、快捷键和命令面板看到的是同一组对象；选择本身不会改变 JSON、历史或用户正在观察的视口。

![当前 Level 的模块与接口全选](docs/screenshots/select-all-level.png)

直接接口扩展不是按画面距离猜测“附近的线”。模型层只从同一份设计文档查询所选模块真实相连的接口，共享连接和自环只出现一次；工作区再把它们合并到既有选择。没有模块、没有直接接口或已经全部选中时，Edit 菜单和命令面板会显示明确原因。

![从 Core 模块一次选择全部 8 条直接接口](docs/screenshots/select-direct-interfaces.png)

直接依赖邻域在同一份邻接事实之上补齐接口两端模块。第一次从 Core 展开得到 5 个模块与 8 条接口；再次执行会从新增模块继续扩展下一层。选择命令本身不抢走当前视野，只有显式执行 Fit Selection 才聚焦局部子图，因此“选择什么”和“看向哪里”不会互相绑死。

![选择并聚焦 Core 的完整一跳依赖邻域](docs/screenshots/select-direct-neighborhood.png)

代码审查经常只关心一个方向：谁正在调用这个模块，或这个模块又依赖谁。方向化选择保留同一份局部子图协议，自环和多模块内部连接不会重复；命令只改变选择，显式 Fit 后才改变观察范围。

![从 Core 选择 5 条入站接口及其上游模块](docs/screenshots/select-incoming-neighborhood.png)

需要把模块和线路分开处理时，按类型选择会从当前 Level 的完整文档集合重建选择，而不是遍历屏幕上看得见的元素。因此即使压力图只挂载视口附近对象，1000 个模块或 2000 条接口也不会被截断；选择仍可用 Clear、Fit、Inspector 和原子 Delete 继续处理。

![一次选择当前 Level 的全部 10 条接口](docs/screenshots/select-interfaces-in-level.png)

批量删除不是对每个选中对象循环触发按钮。Studio 会先验证全部模块和接口仍存在，再删除显式接口，并按层级由深到浅处理模块；这样父模块级联清理子设计时，不会把同一次选择中的子对象误判成中途丢失。混选、共享子 Level 和接口定义去重最终只进入一次历史提交，取消确认则完全不动文档。

![批量删除模块与接口后的清晰剩余拓扑](docs/screenshots/batch-delete-after.png)

相交框选不是用折线外接矩形猜测命中。模块按实际渲染边界判断，接口按每一段真实正交路径判断，因此不会把 L 形线路中间的空白区域误当成线路；结果仍只转换成同一份工作区选择，不写入设计 JSON。

![Alt 相交框选后的模块选择](docs/screenshots/intersecting-selection.png)

当模块、容器或线路在同一点重叠时，按住 Alt 单击即可按真实视觉层级逐项选择下方对象；当前选择本身就是循环游标，不另存隐藏状态。拖动超过阈值仍是上面的相交框选，Shift / Ctrl / ⌘ 只切换最上层命中对象。

![Alt 单击循环选择重叠对象](docs/screenshots/alt-click-cycle.png)

键盘遍历与鼠标选择使用同一份对象顺序和 `SelectionRef`，不会让 React Flow 的 DOM 焦点另建一套“看似选中”。画布对外只有一个 Tab 入口；内部模块、接口、端口和路线抓手由画布统一协调，Tab / Shift + Tab 可遍历同一对象的全部控件，从最后一项继续前进才会离开 Canvas，因此进入 Properties 时仍保留正在审查的连接上下文。

![键盘遍历模块与接口](docs/screenshots/keyboard-selection-traversal.png)

接口聚焦不是只放大某个端口。画布会合并选中线路的全部折点、两端模块矩形和必要留白，再执行一次可中断的 viewport 导航；线路方向、手动 waypoint、selection 和设计坐标保持不变。

![选中接口及两端模块的完整聚焦](docs/screenshots/fit-selection.png)

缩放入口不各自维护比例。工具按钮、百分比、View 菜单、命令面板和键盘都发出同一类 viewport 请求，由 Canvas 的导航协调器执行；用户开始直接操作时仍可立即中断动画。

![统一缩放命令与 100% 画布](docs/screenshots/viewport-zoom-controls.png)

即使模块或连线已经获得键盘焦点，Space 也不会再被选择处理截断；按住后可直接平移审查上下文，选中线路和 Inspector 保持不变。

![选中接口时的临时 Space 平移模式](docs/screenshots/pan-mode.png)

右键不是两套互相抢占的操作：一次手势先经过同一个 5px 移动判定，短按才选择命中对象并打开菜单，超过阈值则整段只归 Canvas 平移。菜单只按对象类型筛选既有 `StudioCommands`，命令名称、快捷键、可用性、禁用原因和实际执行仍由统一命令合同拥有；菜单位置、焦点和锚点都只是可丢弃界面状态，不进入 JSON、History 或 Selection 事实。

![模块对象的右键上下文菜单](docs/screenshots/object-context-menu.png)

边缘自动平移不是五种工具各自实现的滚屏特例。共享 controller 只拥有当前 gesture 的临时 lease 和边缘压力，真正 viewport 仍由 Canvas 的同一 transform 管理；线路与 resize 在每一帧后用新视口重新换算指针位置。因此可以一口气把模块、框选范围、手工线路或卡片边界拖出当前屏幕，同时不会把中间预览写入 JSON 或 Undo 历史。

![线路段拖到视口边缘后的持续自动平移](docs/screenshots/viewport-edge-auto-pan.png)

选中连线后，画布显示可拖动的正交线段把手，Inspector 同步显示手动路由状态和恢复自动布线入口。

![手动正交布线与连接 Inspector](docs/screenshots/manual-routing.png)

鼠标创建和改接接口使用同一套候选资格。拖动时只有合法端口获得明确提示，预览保持正交且不提前画语义箭头；成功后才由正式连接的 target 表达方向。取消、非法目标和原端点落点都会恢复原设计，并给出不遮挡图形的短反馈。

![鼠标端点改接的候选端口与正交预览](docs/screenshots/pointer-connection-feedback.png)

预览不是一条只顾首尾的装饰折线。拖动经过复杂画布时，它会读取与正式路由相同的模块障碍、端口锚点和层级边界，实时寻找一条可验证的单线通路；无解时明确提示，不用穿卡片的直线掩盖问题。静态障碍安全域在一次手势中只编译一次，变化坐标不被节流成滞后画面；端口吸附后的预览点集与松手提交后的正式单线几何一致，而 JSON 仍只保存模块、端口、接口和用户确认的手动折点。

![实时连接预览绕开完整场景障碍](docs/screenshots/scene-connection-preview.png)

端点重连不是键盘入口另造的一套连接规则。Dialog 只持有临时选择，合法端口仍由 model 统一给出，鼠标拖拽和键盘确认最终都只提交一次 `connection/reconnect`；完成后焦点回到同一接口的 Inspector，设计者可以连续审查。

![键盘端点重连后的接口与自动路线](docs/screenshots/keyboard-reconnect.png)

在既有复杂设计中继续新增模块和接口时，线路仍从正确端口侧进出，并避开其他模块；自动路径可直接选中，再用鼠标或方向键调整，最终随同一份 JSON 保存。

![既有复杂设计中的增量布线](docs/screenshots/incremental-routing.png)

路由质量使用五层合同持续检查：逐条线、全部无序线对、稀疏到单模块 100+ 连接的偏斜密度、移动 / 调整 / 展开 / 手动布线 / 实时拖线状态，以及 Chromium / Firefox 真实渲染。真实 UI 场景会同时展开五层边界并审计全部 20 条可见线与 190 组线对；偏斜压力场景中的 100 条连接与 4950 组线对也全部审计，不靠抽样，更不会只修某一张截图中的特例。1000 模块 / 2000 接口场景还验证一次手势只注册 1000 个障碍，并记录请求、实际求解、缓存命中与峰值耗时，确保完整避障不会以卡顿换正确性。

![五层展开的稀疏跨层布线](docs/screenshots/routing-five-level-overview.png)

![单模块 100 连接压力场景](docs/screenshots/routing-stress-overview.png)

面对陌生或大型设计，可以直接搜索模块、Owner 或所属 Level；结果仍使用同一选择语义，不会制造脱离画布的第二份结构。

![Hierarchy 模块搜索与交叉定位](docs/screenshots/hierarchy-search.png)

模块的直接依赖从同一份设计文档实时派生，按入站与出站收敛在 Inspector 中；画布继续保持安静，不增加常驻标签。

不便使用鼠标或处理密集画布时，可以从统一命令入口选择源端口和目标端口，再进入同一个类型化接口合同流程。

![紧凑工作区中的接口审查与 DRC](docs/screenshots/compact-workbench.png)

常驻工具栏只保留文件、撤销 / 重做、创建、适应窗口和校验等直接工作流；重新布局、布线优化与面板管理仍完整保留在菜单和命令面板中，减少图标噪声而不减少能力。

在工作台任意位置按 **Ctrl/⌘ K** 即可打开命令面板。输入动作名、工具栏中文名称或快捷键就能筛选全部命令；方向键选择、Enter 执行、Esc 返回原位置。暂不可用的动作不会消失，面板会直接说明还缺少哪个前提，因此不必记住命令位于哪一层菜单。

![统一命令面板](docs/screenshots/command-palette.png)

菜单获得焦点后，可以直接输入 **F / E / D / A / V** 定位 File、Edit、Design、Arrange 或 View；菜单展开后，输入命令首字母会跳到下一个同首字母项并支持环绕。例如在 Design 中重复按 **A** 可依次检查 Add Module、Add Port、Add Interface，用 **C** 直达 Create Child Design；多选模块后可在 Arrange 中完成对齐与分布。暂不可用的命令仍可由方向键或首字母聚焦，菜单会直接说明成立条件；Enter、Space 和鼠标点击都不会误执行。工具栏图标在 hover 或键盘 focus 时显示同一命令的名称、快捷键和禁用原因，按 Esc 即可收起。

![工具栏命令名称与成立条件提示](docs/screenshots/command-tooltip.png)

## 5 分钟开始使用

### Windows 用户

1. 前往 [Releases](https://github.com/xueyu888/architecture-block-studio/releases/latest) 下载 `Architecture-Block-Studio-*-windows-x64-setup.exe`。
2. 运行安装程序并从开始菜单启动 Architecture Block Studio。
3. 选择 **File → Open Design** 加载任意合法 `.json` / `.block-design.json`，或直接从内置示例开始探索。
4. 编辑完成后使用 **Save** 原位保存，使用 **Save As** 保留新副本；磁盘写入成功前不会清除未保存状态。

当前仅发布 Windows x64 桌面版，不提供网页产品或移动端。安装包暂未使用商业代码签名证书；若 Windows SmartScreen 提示“未知发布者”，请先核对 Release 页面提供的 SHA-256，再决定是否运行。

### 源码开发

需要 Node.js 22+ 与 pnpm 10.7+。

```bash
git clone https://github.com/xueyu888/architecture-block-studio.git
cd architecture-block-studio
pnpm install
pnpm dev --host 127.0.0.1 --port 4317
```

打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。这个地址只用于开发与自动化测试；正式产品使用 Windows 桌面壳。应用会先展示仓库内置的 AIO Agent Runtime 示例，它只是演示数据，不是运行时依赖。

最短设计路径：

1. 选择 **File → New Design** 创建空白设计。
2. 添加模块，并填写 Owner、Purpose、Boundary 与 Failure。
3. 为模块添加 input、output 或 bidirectional 端口。
4. 从输出端口拖向输入端口，或选择 **Design → Add Interface** 用键盘选择端点，然后补全类型化接口合同。
5. 点击连线，在右侧 Inspector 审查名称、方向、Owner 与失败行为。
6. 运行 DRC，使用 **Save** 或 **Save As** 写入 `.block-design.json` 文件。

## 加载自己的设计

当前设计内容来自一份 `BlockDesignDocument v2` JSON。Windows 桌面版通过原生文件对话框加载和保存：

- **本地文件**：在 **File → Open Design** 中选择任意合法 JSON。
- **原位保存**：已打开文件使用 **Save** 原子替换；新设计首次保存会打开原生保存对话框。
- **副本与导出**：**Save As** 绑定新文件，**Export JSON** 只输出副本，不改变当前文件绑定或 dirty 基线。

开发渲染器仍保留 URL、`?design=<encoded-url>` 与 `initialDocument` / `initialDesignUrl` 入口，供自动化、嵌入实验和适配器验证使用；它们不是另一套正式产品文件模型。

内置示例位于 [`public/examples/aio-agent-runtime.block-design.json`](public/examples/aio-agent-runtime.block-design.json)，可以复制、修改或换成自己的文档。加载是事务性的：新文件只有在解析成功后才会替换当前设计；无效文件不会破坏正在编辑的内容。

仓库还提供一份由当前源码生成的五层架构示例：[`public/examples/architecture-block-studio.block-design.json`](public/examples/architecture-block-studio.block-design.json)。启动开发服务器后，可以直接打开：

```text
http://127.0.0.1:4317/?design=%2Fexamples%2Farchitecture-block-studio.block-design.json
```

这份示例不是手绘宣传图。生成器会遍历 `src` 中的 TypeScript、TSX 与 CSS 文件，要求每个文件恰好属于一个责任模块，并把所有可解析的跨模块相对 import 投影为接口；当前示例覆盖 66 个源码文件、12 个责任模块、27 条跨模块依赖和 5 层上下文。缺失归属、虚构依赖、无法解析的引用或模块环都会使验证失败。

```bash
pnpm generate:self-architecture  # 源码结构变化后重新生成示例
pnpm verify:self-architecture    # 检查示例与当前源码是否一致
```

浏览器运行时不会自行扫描仓库，源码仍是依赖事实源，JSON 只是可加载、可替换、可版本化的生成投影。其他语言或仓库可以由人、脚本或 AI 输出同一个 `BlockDesignDocument` 公开契约，再用 Studio 理解、编辑和审查结构。

![Architecture Block Studio 五层源码架构总览](docs/screenshots/source-architecture-overview.png)

面对五层源码图时，不必把所有父级容器都挤在一个缩放视图里。连续进入模块后，第五层 12 个真实源码模块和 27 条依赖可以独占画布；顶部 breadcrumb 始终保留完整来路，退出时还会重新选中拥有该子设计的父模块。

![聚焦第五层源码模块与依赖](docs/screenshots/hierarchy-focused-source-architecture.png)

选择 `Studio Orchestrator` 后执行 **Select Direct Neighborhood**，可以一次审查真实的一跳依赖；再选择任意线路，即可在 Inspector 查看依赖名称、方向、接口合同和源码归属，画布中央不放置遮挡路线的标签。

![真实源码依赖邻域审查](docs/screenshots/source-architecture-review.png)

![单条源码依赖与接口合同审查](docs/screenshots/source-architecture-interface-review.png)

## 文档

- [产品定义](docs/PRODUCT.md)：用户、核心旅程、产品边界与演进方向。
- [系统架构](docs/ARCHITECTURE.md)：Owner、状态分类、依赖方向、公开接口与 Schema 兼容策略。
- [布线策略](docs/ROUTING.md)：分层正交多连接的数学合同、目标函数、求解边界、验证器与证明等级。
- [质量标准](docs/QUALITY.md)：生产级 Definition of Done、测试矩阵、文件安全与发布门槛。
- [演进路线](docs/ROADMAP.md)：当前成熟度、问题优先级与真实迭代记录。
- [第三方许可](THIRD_PARTY_NOTICES.md)：依赖与许可证信息。

## 开发与验证

```bash
pnpm exec playwright install chromium firefox
pnpm verify:self-architecture
pnpm typecheck
pnpm typecheck:desktop
pnpm build
pnpm test
pnpm test:e2e:firefox
pnpm desktop:test
pnpm desktop:package:win
```

## 当前边界

- 当前是本地单人工作台，不包含账号、服务端存储、多人协作或冲突合并。
- 产品只支持 Windows x64 桌面端；浏览器只作为渲染内核与开发测试入口，不规划移动端。
- Windows Save / Save As 只经受限 preload 与原生对话框访问 `.json` 文件；文件路径属于窗口会话，不进入设计 JSON。
- 当前写出 `BlockDesignDocument 2.1`，可显式读取并迁移 `2.0`；尚未提供 v1 或 Draw.io 导入器。
- 当前安装包未签名；代码签名证书与 SmartScreen 信誉仍是后续发行基础设施事项。
- 可视化审查补充模块与接口视角，不替代逐行 Code Review、测试、静态分析或安全审计。

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
