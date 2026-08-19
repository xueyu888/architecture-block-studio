# 分层正交多连接布线策略

本文是 Architecture Block Studio 自动布线的权威数学合同。它定义输入、合法性、目标函数、求解边界、证明等级与失败语义；Canvas、示例 JSON 和测试只能消费或验证该合同，不能另建哈希车道、逐线偏移或渲染期补偿规则。

## 1. Owner 与边界

`src/routing` 的 Principle 是：对一组已经确定绝对几何的模块与接口，生成确定、正交、避障、可分辨且诚实标注证明等级的场景级路线。

```text
BlockDesignDocument                 LayoutResult
连接 / 端口 / 锁定 waypoint          绝对位置 / 尺寸 / 展开层级
          │                               │
          └──────────────┬────────────────┘
                         ▼
          RoutingLayoutProjectionAdapter
           坐标量化与唯一语义映射
                │                     │
                │ RoutingScene        │ read-only preview environment
                ▼                     ▼
        baseline → visibility graph → negotiated solve
                │              one disposable preview leg
                ▼                     │
             independent route verifier
                │                     │ verified points / unresolved
                └──────────┬──────────┘
                           ▼
                      Canvas renderer
```

- 路由层不移动模块，不修改文档，不持有 viewport、selection 或 pointer gesture，也不决定颜色、箭头和命中区。
- 自动路线是可重建的派生结果，不进入 JSON。唯一可持久路线输入是用户确认的 `connection.routing.waypoints`。
- 手工路线是锁定约束：求解器不得移动它，但验证器仍检查其合法性与空间占用。
- Canvas 只渲染 `RoutingResult`。求解失败时缺失路线保持缺失并显示诊断，不能调用另一套“尽量画出来”的 fallback。
- Pointer preview 只把当前端点意图交给路由层。它复用同一障碍、端口、层级域、策略和 verifier，但只求一条可丢弃 leg；不参与多连接协商，不写 JSON，也不能把临时结果安装为正式路线。

## 2. 数学输入

一次求解输入记为：

\[
S=(\Omega,O,N,G,M,\Theta)
\]

- \(\Omega\)：有限布线域；层级内部 leg 可拥有更小的局部域。
- \(O\)：模块与层级容器的闭轴对齐矩形集合。
- \(N\)：需要布线的 leg 集合。一个逻辑连接在展开层级中可以包含多个 leg，但共享同一 `commodityId`。
- \(G\)：层级 Gate 集合，记录同一 commodity 两个相邻 leg 的共同坐标与相反法向。
- \(M\)：用户锁定路线集合。
- \(\Theta\)：唯一版本化 `RoutingPolicy`，包含精度、净空、线宽、端口 stub、lane 间距、短段阈值、绕行上限和浏览器求解边界。

障碍物、手工 waypoint 和内部候选先量化到步长 \(q=1/\text{coordinateScale}\) 的固定格点，默认 \(q=1/8\) 设计像素；最终 Port anchor 再归一到视觉整像素，避免浏览器测量把同一连接点投影成 0.25px 的微短段。几何相等、签名与冲突判断都基于这些规范化值，不使用浮点 epsilon。Port anchor 的未量化几何只由 `layout/nodeGeometry.portAnchorOffset` 定义：节点边框、展开态边框和 Handle 尺寸由同一组常量同时提供给 Node 渲染与 scene adapter，不能由路由器另猜一个卡片边缘坐标。Node 的可见圆点与 React Flow 内外 Handle 也必须投影到同一物理锚点，不能因 DOM 元素居中规则形成第二坐标。

### 障碍物安全域

每个障碍物，包括当前 leg 的 source / target terminal，都按中心线净空做 \(L_\infty\) Minkowski 外扩：

\[
O_j^+=O_j\oplus B_\infty(c+w/2)
\]

其中 \(c\) 为 `clearance`，\(w\) 为 `strokeWidth`。搜索中心线不得进入 \(O_j^+\) 内部。只有连接端点与安全域外侧之间的第一段或最后一段可以穿过自己的 terminal 安全域；其余线段不得贴回、绕入或重新穿越 terminal。这样端口出线、模块净空和障碍判断使用同一安全域定义。

### 端点、stub 与 Gate

端点为 \(e=(p,n,o,k)\)：规范化坐标 \(p\)、外向法向 \(n\)、terminal obstacle \(o\) 和物理端口键 \(k\)。第一段必须沿源法向离开；目标的相邻点必须位于目标法向外侧。stub 的基础值是 12 设计像素，但实际长度取基础值、最短合法线段与离开 terminal 安全域所需距离的最大值；只有其他障碍物或当前层级边界更近时才收短，且永不反向。它不是按 connection id 制造的车道，也不是渲染期补偿。

同一 commodity 的展开路径在 Gate 上满足：

\[
p_a=p_b=p_G,\qquad n_a=-n_b
\]

因此两个 leg 在边界处共点、共线且切向连续。它们可以分别受内外层布线域约束，但不能被当成无关连接做后处理偏移。

## 3. 合法路线

leg \(k\) 的路线是点序列 \(P_k=(q_0,\ldots,q_m)\)。合法路线必须同时满足：

1. \(q_0\) 与 \(q_m\) 精确等于声明的源、目标端点。
2. 相邻点不重合，且每段只有一个坐标变化。
3. 第一段和最后一段满足端口法向。
4. 所有点位于 leg 的布线域内，所有线段避开非忽略障碍物安全域。
5. 路线不自交、不重走自身线段，也不含相邻同轴反向折返。
6. 不同路线的平行投影重叠时，中心线距离至少为 `laneSpacing`。
7. 不同连接不得占用同一最终中心线；真正共享同一物理端口时，仅固定 stub 内的重合被允许。
8. 垂直相交可以存在，但计入 crossing。
9. Gate 必须共点且法向相反；锁定路线必须逐点保持不变。

无遮挡、同高的相向端口只有一条零折点最短路线。任何先反向再折回的路线会同时增加长度、折点或短段，并且相邻反向本身不合法，所以截图中的端口回钩不再可能被接受。

## 4. 候选空间与单连接下界

每个 leg 构造局部正交可见图 \(G_k=(V_k,A_k)\)：

- 基础顶点包含两端 stub、stub 两侧的有限 lane guide、两端中线 guide，以及相关外扩障碍物的四个角。
- 冲突重布线时增加距障碍物角一个 lane 间距的 guide，使线路能在既有路径外侧形成真实平行走廊。
- 任意两顶点之间的直线或一个折点的两种正交连接，只要全程在布线域内且避开安全域，就成为 arc。
- 搜索状态是 `(vertex, incomingDirection)`；立即掉头被禁止，转向、长度、短段和与已占用路线的容量/交叉代价在状态转移时精确累计。

当前图对候选顶点对建立全部合法零/一折 arc，而不是只看最近邻。它是有限候选图，不是连续平面中所有可能坐标的枚举；因此证书使用 `single-commodity-visibility-optimal`，只声明在该版本策略生成的完整局部候选图内最优。等价代价的路径再以两端直线 run 的平衡度决胜，使相向端口的小错位折点尽量位于中部，不挤在任一卡片边缘。

单连接独立基准长度为：

\[
L_k^*=\min_{P_k\in G_k}\operatorname{length}(P_k)
\]

它由无其他自动路线占用时的确定性最短路得到。最终自动路线必须满足显式绕行上限：

\[
\operatorname{length}(P_k)-L_k^*\le
\Delta_{abs}+\rho L_k^*
\]

默认 \(\Delta_{abs}=224\)，\(\rho=0.8\)。这只是允许为消除真实冲突选择有限替代通道，不是“一个 crossing 折算多少像素”的隐式权重。

## 5. 多连接联合目标

验证器从最终路线重新计算：

- \(U\)：未布通 leg 数量。
- \(Q\)：共线或小于 lane 间距的容量冲突数量。
- \(X\)：有效垂直交叉数量。
- \(D_{max}\)：单 leg 最大绝对绕行量。
- \(D_{sum}\)：总绝对绕行量。
- \(B\)：总折点数。
- \(H\)：短于 `minimumSegmentLength` 的线段数。
- \(T\)：按 leg id 排序后的规范化路线签名哈希，只负责完全同质解的稳定决胜。

唯一全局目标是字典序：

\[
J(P)=\operatorname{lexmin}(U,Q,X,D_{max},D_{sum},B,H,T)
\]

这意味着接通优先于美化，容量合法优先于少 crossing，任何 crossing 优化又受每条路线的显式绕行上限约束。connection id 不参与 lane 位置计算；它只在所有质量量度完全相同时稳定排序。

## 6. 浏览器求解器

整数多商品正交布线在一般情形下不能在交互预算内保证全局最优。当前 `orthogonal-scene-v1` 使用确定且有界的 negotiated routing：

1. 为每个自动 leg 求独立基准路线；锁定路线预先占用空间。
2. 按基准难度、空间位置和稳定 id 生成有限个确定顺序；奇数轮反向，后续轮旋转起点。
3. 逐 leg 求路时，先最小化与已占用路线的容量冲突和 crossing，再选择较短、较少折点和短段的路径。
4. 对全部候选场景使用全局 \(J\) 比较，保留最好结果。
5. 对仍有容量冲突的自动 leg 执行有限、确定性的冲突扫描与 rip-up/reroute；只有独立验证后的诊断数或 \(J\) 严格改善才接受。
6. `negotiatedIterations`、`conflictSweepIterations`、相关障碍物和图顶点上限保证浏览器求解终止。

当前实现没有全局多商品 Branch-and-Bound，所以不会把多连接结果标成全局最优，也不会输出 `Infeasible`。大场景只收紧同一策略的候选上限和迭代数，不切换为另一套低质量算法。

## 7. 独立验证与结果语义

`routeVerifier` 不读取搜索队列或其代价缓存，而从 `RoutingScene + routes + policy` 重新验证端点、法向、正交性、反向折返、自交、层级域、障碍净空、Gate、锁定路线、lane 间距、crossing、绕行、折点、短段和目标签名。

结果状态只能是：

| 状态 | 含义 |
| --- | --- |
| `Optimal` | 全部合法，且自动部分至多一个 leg；证书只声明当前完整局部可见图最优 |
| `Feasible` | 全部硬约束合法并满足绕行上限；多连接只声明确定性有界合法解 |
| `Unresolved` | 在版本化资源边界内未找到合法联合解，不声称数学不可行 |
| `InvalidInput` | 场景、Gate 或锁定路线不成立；锁定几何不被自动改写 |
| `Infeasible` | 仅为未来精确求解器保留；只有不可行证明才能使用，当前实现不返回 |

证书还包含 policy version、坐标精度、规范化输入签名、验证结果、完整目标向量和审计覆盖：`auditedLegIds` 必须精确等于场景 leg 集合，`auditedPairCount` 必须等于已布通 leg 的无序对数量 \(n(n-1)/2\)。相同量化输入、策略和代码版本必须产生完全相同的 routes 与 certificate。

### 五层压力验收

路由质量不能只靠总览截图或几条代表线路判断，持续回归必须逐层闭环：

1. **逐条线**：对每个 leg 检查端点、方向、有限坐标、非零正交段、最短段、反向折返、自交、routing domain、障碍净空和锁定路线不变。
2. **逐线对**：枚举全部无序线对，检查平行重叠、lane 间距、共享物理端口的唯一豁免和每个严格交叉的线桥覆盖；断言实际审计数等于 \(n(n-1)/2\)，不能抽样。
3. **偏斜密度与层级深度**：同时覆盖 1–2 条稀疏模块、普通模块和单模块 100+ 条连接；当前 fixture 包含双展开 54 legs / 1431 pairs、真实 100 连接 Hub / 4950 pairs、120 legs / 7140 pairs 的纯路由压力场景、真实 UI 五层展开的 20 routes / 190 pairs，以及 12 个 commodity 穿过五层 Gate 链形成的 72 legs / 2556 pairs。
4. **交互状态**：move、resize、展开 / 收起、Optimize Routing、自动线物化、手工线段 / 折点调整、Reset Auto、Undo / Redo 后重新执行同一审计，焦点只在新投影几何出现后恢复。
5. **真实渲染**：Chromium 与 Firefox 运行同一产品合同；headed 截图逐图检查箭头方向、端口可读性、卡片遮挡、线桥、局部拥塞和低缩放轮廓。数学上无法满足 lane 容量的极端共享端口场景必须返回 `Unresolved`，不能通过重叠画线伪造 `Feasible`。

这五层分别验证单线、关系、分布、状态和最终人眼结果。任何一层失败都不能由另一层的绿灯替代。

## 8. 交互一致性

- move / resize pointer 期间不在每一帧重算全场景；Edge 只让已提交路线的首尾固定 leg 随 React Flow 当前端点一起移动，保持正交和拖动流畅。小于 1 设计像素的浏览器测量误差继续使用量化 scene anchor；真正的 gesture 位移才平移相邻 leg，因此不能插入亚像素补偿折点。
- connection pointer preview 与 move / resize 的局部适配不同：用户正在决定一条新连接，所以必须在 pointermove 中对当前完整障碍场景求一个 single-leg 结果。吸附端点按 `nodeId + handleId` 从 layout projection 读取与正式路线相同的规范 anchor、法向和 physical key；React Flow 的可点击 Handle 外框坐标只负责命中，不能定义路由端点。未吸附的自由端使用当前 pointer 位置和一个唯一临时 terminal。
- preview leg 继承两端祖先忽略集合；两端属于同一父容器时继承同一 routing domain。它使用正式 `RoutingPolicy` 的坐标精度、净空、stub、相关障碍和搜索顶点预算，只把 `negotiatedIterations` 收敛到一次并关闭 `conflictSweepIterations`，因为场景中没有第二条临时路线可协商。多个自由端方向候选按长度、折点数和稳定点签名选择。
- 只有独立 verifier 接受的 preview 才能绘制。无解、预算耗尽、缺失节点 / Handle 或端点重合都返回空点集；Canvas 显示 blocked / invalid 状态，禁止退回穿障碍直线。吸附到合法端口时，单线 preview 与提交后仅含该连接的正式 solve 必须得到相同点集。
- preview environment、点集、耗时、障碍数和求解次数全部是可丢弃验证 / 展示状态。Escape、blur、非法落点或 gesture 结束后立即清理；正式提交仍只把 source / target 意图送入 Studio → Editor，之后从新文档和完整多连接场景重新求解。
- gesture 松手后，文档几何经 layout 重新投影，场景求解一次并替换派生路线。
- 拖动虚拟线段点会通过 `connection/route` 将明确 waypoint 写入文档；此后该路线被锁定，直到 Reset Auto 删除这份持久输入。
- 键盘调整折点时，一次性焦点请求同时携带目标索引与新坐标；只有完全匹配的新路径 DOM 出现后才能恢复焦点，不能命中被替换前的旧折点。
- 自动路线不因 `Optimize Routing` revision、缩放、Fit、设备像素比或无关属性变化而随机跳线。

## 9. 交叉线的展示桥

联合目标优先消除容量冲突并减少 crossing，但一般正交图中并非所有 crossing 都能在有限绕行上限内消除。`routeJumps` 从已经提交且验证过的路线派生展示线桥：严格相交时由水平线跨过垂直线，相邻交点合并为一个更宽的桥；端点附近不画桥。候选通过按 x 排序的垂直线段扫描生成，避免以线路对做全量渲染期搜索。

线桥只改变 SVG path 的绘制命令，不改变 `RoutingScene`、`PlannedRoute.points`、目标向量、命中区、箭头或 JSON。浏览器审计要求每个严格交叉都恰好可被某个线桥解释，并拒绝无对应交点的孤立桥；因此“可以相交”和“看不清哪条线穿过哪条线”不是同一件事。

## 10. 与 draw.io 和研究实现的关系

draw.io 的新 `LibavoidRouting` 绑定同样把编辑器适配与路由核心分开，收集全部 vertex 障碍物、固定端点约束和 jetty，再把 bends 写回 geometry；手工 waypoint 会接管自动路线。当前 `dev` 实现还在一次连接拖拽中注册场景障碍、只更新临时端点并求一个 connector，提交后再由正式路径接管；它也明确记录了 multi-edge nudging 与 independent deterministic solve 的取舍，而不是宣称两者同时成立（[`LibavoidRouting.js`](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/diagramly/LibavoidRouting.js)）。本项目吸收 Owner 分离、固定端点、live single-connector preview 和手工优先原则，但使用自己的场景、层级 Gate、目标向量、确定性协调与证书，不复制 draw.io 文件格式、WASM 绑定或编辑器 glue。gesture-lifetime session 与刷新合并仍是下一轮性能边界，不能提前写成已完成能力。

正交候选图、共享路径与 nudging 的理论背景参考 Wybrow、Marriott、Stuckey 的 [Orthogonal Connector Routing](https://users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf)；有限 rip-up/reroute 的思想参考 [PathFinder](https://janders.eecg.utoronto.ca/1387/readings/pathfinder.pdf)。这些资料解释算法来源，不替代本文的产品合同与独立验证。
