# Architecture Block Studio

> 面向 AI 编程时代的代码模块与接口设计工作台：先把系统边界设计清楚，再让 AI 高速实现。

Architecture Block Studio 是一款本地优先、可视化、可编辑的代码架构设计工具。它用模块块体表达职责，用具名端口表达公开能力，用类型化连线表达接口契约，并用可展开的层级表达模块内部结构。

它不是一张只能展示的架构图，也不替你生成代码或决定架构。它把架构决策和代码结构映射沉淀为一份可校验、可版本化、可交给人和 AI 共同读取的 `BlockDesignDocument` JSON：生成前约束实现，生成后可视化模块与接口，帮助人从更高层次审查代码。

`React 19` · `TypeScript` · `React Flow` · `ELK` · `Local-first` · `JSON Contract`

## 为什么是现在

AI 显著提高了代码生成速度，也同步放大了结构失控的风险：同一职责被重复实现、模块边界逐渐模糊、调用关系藏在代码细节里、接口语义在多轮修改中悄然漂移。代码产量越高，人越难只靠逐行阅读理解整体结构，审查瓶颈也从“代码写得对不对”上升为“系统是否仍然成立”。

当“写出代码”越来越容易，真正稀缺的能力变成了：

- 谁拥有这项业务事实和状态？
- 一个模块为什么存在，它明确不负责什么？
- 模块之间只能通过哪些接口组合？
- 输入、输出、失败和跨层级调用如何成立？
- AI 生成的实现是否仍然遵守既定 Owner、边界和依赖方向？

Architecture Block Studio 把这些问题放在编码之前解决。你可以先建立稳定的模块结构和接口契约，再让开发者或 AI 在明确边界内实现代码，从源头减少重复职责、隐式耦合和架构漂移。

| 常见问题 | Architecture Block Studio 的处理方式 |
| --- | --- |
| 模块只有名字，没有职责边界 | 为模块记录 Principle、Purpose、Boundary、Failure 和 Owner |
| 接口散落在实现代码与聊天记录里 | 用具名端口、类型化连接和独立接口定义形成显式契约 |
| 大系统被压扁成一张难以阅读的图 | 原位展开模块内部层级，同时保留父级上下文 |
| 图和真实设计逐渐分叉 | 以一份 `BlockDesignDocument` JSON 作为唯一设计事实源 |
| 连线密集、标签遮挡、关系难追踪 | 正交避障布线；画布只显示端口名，点击连线查看完整契约 |
| 修改不可追溯、试错成本高 | 原子编辑、撤销/重做、DRC 校验和可移植 JSON 文件 |
| AI 生成代码很多，人难以把握整体影响 | 把代码对应的模块、端口和依赖关系可视化，辅助架构级人工审查 |

## 界面预览

| 模块、端口与选中接口 | 展开层级后的跨边界布线 |
| --- | --- |
| ![本地模块设计编辑器](docs/screenshots/editor-polished-workbench.png) | ![跨层级接口布线](docs/screenshots/editor-routing-validation.png) |

画布刻意保持安静：连线中间不放标签，避免名称覆盖路径或模块。端口提供局部识别，点击任意连线后，右侧 Inspector 会显示接口名称、Owner、类型和完整合同。

## 5 分钟开始使用

运行环境：Node.js 22+、pnpm 10.7+。

```bash
git clone https://github.com/xueyu888/architecture-block-studio.git
cd architecture-block-studio
pnpm install
pnpm dev --host 127.0.0.1 --port 4317
```

浏览器打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。应用会先加载仓库自带的 AIO Agent Runtime 示例。

接着可以完成一条最小设计链：

1. 选择 **File → New Design**，创建空白设计。
2. 添加两个模块，并为每个模块填写 Purpose、Boundary、Failure 和 Owner。
3. 为模块添加 input、output 或 bidirectional 端口。
4. 从输出端口拖到输入端口，定义接口名称、类型、Owner 和合同。
5. 点击连线检查接口，观察右上角 DRC 错误与警告。
6. 使用 **Save As** 保存为 `.block-design.json`，之后可再次打开继续编辑。

如果一个模块还需要表达内部结构，选择该模块并创建 Child Design，再将父模块端口显式绑定到内部模块端口。展开后，外部调用会沿父端口连续进入内部实现。

## 核心能力

### 像专业设计工具一样编辑

- 新建、打开、保存、另存和导出设计。
- 添加、移动、重命名和删除模块。
- 添加和编辑端口、数据类型、方向与必连约束。
- 拖线创建 RPC、DTO、Event、Stream、Integration 等类型化接口。
- 编辑模块与接口的 Principle、Purpose、Boundary、Failure、Owner 和源码引用。
- 使用 Undo / Redo 安全试错；未保存离开时提供明确保护。

### 面向代码架构，而不是通用绘图

- 模块是拥有职责和边界的结构单元，不是任意矩形。
- 端口是模块对外公开的能力，不是装饰性锚点。
- 连线引用独立的接口定义，表达方向、类型、Owner 和失败语义。
- 层级端口必须显式绑定内部端点，不根据名称猜测调用关系。
- DRC 同时校验文档结构、引用完整性、端口方向和设计语义。

### 为复杂系统保持清晰

- ELK 负责分层与复合节点布局。
- 正交路由绕开无关模块和层级容器。
- 密集线路使用稳定的独立轨道与白色衬底，交叉关系仍可辨认。
- **Regenerate Layout** 重新生成模块布局和路由。
- **Optimize Routing** 只优化派生路径，不移动已设计的模块位置。
- 属性编辑不会重挂画布或强制 Fit，缩放和视口保持连续。

## AI 编程中的设计与审查闭环

Architecture Block Studio 最适合作为“架构意图与审查层”：它既位于自然语言需求与代码实现之间，也位于代码变更与人工验收之间，把容易歧义的讨论和难以通读的实现变成可检查的结构。

### 生成前：把设计约束交给 AI

```text
业务目标
   │
   ▼
模块设计：Owner / Principle / Purpose / Boundary / Failure
   │
   ▼
接口设计：Port / Direction / Type / Contract / Failure
   │
   ▼
BlockDesignDocument JSON
   │
   ├── 人工架构评审
   ├── AI 编程上下文
   └── 代码实现与测试拆分
```

建议先让每个模块回答四个问题：

1. **Principle**：它为什么存在，拥有什么核心事实？
2. **Purpose**：它向系统提供什么能力？
3. **Boundary**：它明确不负责什么，只能依赖哪些外部接口？
4. **Failure**：输入无效、依赖不可用或执行失败时，如何暴露问题？

然后再定义模块之间的端口与接口。这样交给 AI 的不是一段模糊需求，而是一组有 Owner、有边界、有输入输出、有失败行为的实现约束。

### 生成后：可视化代码结构，帮助人审查

AI 或开发者完成实现后，可以把代码对应的模块、公开端口和跨模块调用同步到设计文档，再通过画布进行结构审查：

```text
代码 / Pull Request
        │
        │ 映射并同步模块、端口、接口事实
        ▼
BlockDesignDocument
        │
        ▼
可视化模块层级与依赖方向
        │
        ▼
人工审查 ──► 设计问题 / 实现问题 / 合同漂移
        │
        └────► 修正设计或代码，再次验证
```

相比只查看文件列表和逐行 Diff，可视化审查更适合回答结构问题：

- 新代码是否放进了正确的 Owner 模块？
- 是否绕过公开端口，形成了隐式跨模块依赖？
- 一个模块是否同时承担了多个变化原因？
- 接口方向、数据类型和失败行为是否与实现一致？
- 内部能力是否意外泄漏成了外部契约？
- 代码已经变化，但架构合同是否仍停留在旧版本？

它不会取代逐行 Code Review、测试和静态分析，而是补上它们不擅长表达的“模块结构与接口关系”视角，让人能更快发现局部代码正确、整体架构却正在退化的问题。

## 数据来源与文件

设计内容始终来自一份 `BlockDesignDocument v2`：

- **内置示例**：[`public/examples/aio-agent-runtime.block-design.json`](public/examples/aio-agent-runtime.block-design.json) 只是默认演示数据，不是运行时依赖。
- **本地文件**：通过 **File → Open Design** 选择任意符合契约的 `.json` 文件。
- **远程 URL**：在 Open Design 中加载同源或允许 CORS 的 HTTP(S) JSON。
- **启动链接**：使用 `?design=<encoded-url>` 替换默认启动数据源。
- **组件嵌入**：向 `BlockDesignStudio` 传入 `initialDocument` 或 `initialDesignUrl`。

加载是事务性的：新文档只有在结构解析成功后才会替换当前设计；失败时当前内容保持不变，并显示具体错误。

**Save** 下载当前文件并将该快照标记为已保存；**Save As** 使用新文件名下载；**Export JSON** 只导出副本，不改变 dirty 状态。由于采用浏览器文件语义，保存不会直接覆盖仓库里的示例文件。

## 单一事实源与系统结构

`BlockDesignDocument` 是唯一的设计事实源。画布节点、连线、层级树、Inspector、JSON 视图、DRC、布局和路由都由它单向派生。

```text
Canvas / Inspector / Menu / Keyboard
                  │
                  │ DesignOperation
                  ▼
        editor：原子变换与历史记录
                  │
                  ▼
          BlockDesignDocument
             │           │
             │           └──────────────► IO：加载 / 序列化 / 下载
             │
             ├──► model：结构解析与语义 DRC ──► Messages
             ├──► hierarchy / inspector ──────► Dock panels
             └──► layout ─► routing ──────────► React Flow

失败行为：无效操作不产生半状态；无效加载不替换当前文档；
布局与路由只产生可恢复的派生状态，不反向修改设计事实。
```

用户拖动模块时，位置通过一个具名编辑操作写入 `node.layout.position`。面板宽度、折叠状态、层级展开、当前选择、缩放比例、自动布局和路由几何属于工作区状态，不会伪装成架构事实写回文档。

### 模块责任边界

| 模块 | 原则与所有权 | 公开接口 | 边界与失败行为 |
| --- | --- | --- | --- |
| `model` | 拥有文档结构和语义设计规则 | `parseBlockDesignDocument`、`validateBlockDesignDocument` | 不负责 UI 和布局；结构非法时拒绝，语义问题进入 DRC |
| `editor` | 拥有原子文档变换、Undo / Redo 和 dirty 状态 | `DesignOperation`、`applyDesignOperation`、`useDesignEditor` | 不渲染、不路由、不持久化；失败不产生部分修改 |
| `layout` | 组合展开层级并派生复合节点位置 | `layoutBlockDesign` | 不解释业务语义，不修改源文档；失败向 Studio 显式报告 |
| `routing` | 根据节点和端口派生正交避障路径 | `absoluteRoutingObstacles`、`routeOrthogonalInterface` | 不移动模块，不改写连接事实 |
| `io` | 在 JSON 与已校验文档之间转换 | `loadDesignFromFile`、`loadDesignFromUrl`、`downloadDesign` | 不拥有设计事实和历史；加载失败保留当前文档 |
| `studio` | 组合编辑器、IO、画布、Inspector 和工作区状态 | `BlockDesignStudio` | UI 不直接修改深层对象；命令失败保持可见、可恢复 |

### 布局与布线不变量

- 路径只从具名源端口开始，并在具名目标端口结束。
- 路径不会进入非端点模块或无关层级容器的边界框。
- 跨层级路径只通过 `hierarchy.portBindings` 指定的父端口，不根据名称或接口 id 推断。
- 连线中间不显示标签；端口负责画布识别，Inspector 负责展示完整接口合同。
- 自动布局和路由都是派生状态，只有用户明确拖动产生的位置才进入文档。

## 文档模型

下面是一份最小的双模块设计。完整可执行 Schema 位于 [`src/model/design.ts`](src/model/design.ts)，语义 DRC 位于 [`src/model/validation.ts`](src/model/validation.ts)。

<details>
<summary>查看最小 BlockDesignDocument v2 JSON</summary>

```jsonc
{
  "schemaVersion": "2.0",
  "id": "example.system",
  "title": "Example System",
  "summary": "A minimal two-module design.",
  "entryLevelId": "system",
  "interfaceDefinitions": {
    "session.command": {
      "kind": "rpc",
      "title": "Session Command RPC",
      "owner": "Core",
      "principle": "Commands cross the Core boundary through one protocol.",
      "purpose": "Submit a validated user command.",
      "boundary": "The UI cannot mutate Core state directly.",
      "failure": "Invalid commands are rejected atomically.",
      "codeLanguage": "jsonc",
      "code": "{ \"method\": \"turn/start\", \"params\": {} }"
    }
  },
  "levels": [
    {
      "id": "system",
      "title": "System",
      "description": "Public module boundary.",
      "nodes": [
        {
          "id": "ui",
          "title": "UI",
          "owner": "Experience Team",
          "ports": [
            {
              "id": "command",
              "label": "command",
              "side": "right",
              "direction": "output",
              "dataType": "TurnStartParams"
            }
          ],
          "inspector": {
            "principle": "Display state stays outside Core.",
            "purpose": "Capture and submit user intent.",
            "boundary": "Does not own session execution.",
            "failure": "Rejected commands remain visible."
          }
        },
        {
          "id": "core",
          "title": "Core",
          "owner": "Runtime Team",
          "ports": [
            {
              "id": "command",
              "label": "command",
              "side": "left",
              "direction": "input",
              "dataType": "TurnStartParams"
            }
          ],
          "inspector": {
            "principle": "Core owns session execution.",
            "purpose": "Validate and execute commands.",
            "boundary": "Accepts commands only through named ports.",
            "failure": "Invalid commands do not mutate state."
          }
        }
      ],
      "connections": [
        {
          "id": "ui-to-core",
          "interfaceId": "session.command",
          "source": { "nodeId": "ui", "portId": "command" },
          "target": { "nodeId": "core", "portId": "command" }
        }
      ]
    }
  ]
}
```

</details>

层级模块通过 `hierarchy.childLevelId` 指向子设计，并用 `hierarchy.portBindings` 将每个父端口绑定到一个明确的内部端点。父端口拥有跨边界方向；内部端点可以是实现端口，也可以是显式的边界适配端口。

## 验证与质量证据

当前版本已经通过：

- TypeScript 类型检查。
- Vite 生产构建。
- 12 个 Chromium Playwright 端到端用例。
- 完整的新建、编辑、拖线、层级绑定、撤销、重做、保存与重新加载流程。
- 32 个节点、54 条边同时展开时的几何验证：无模块碰撞、边界逃逸、独立线路重叠和根级兄弟节点重叠。
- 1680 × 1050 headed Chromium 原生截图检查；浏览器 console error 和未捕获 page error 均为 0。

详见 [`docs/verification-report-2026-08-18.md`](docs/verification-report-2026-08-18.md)。

## 开发与验证

```bash
pnpm install
pnpm exec playwright install chromium

pnpm dev --host 127.0.0.1 --port 4317
pnpm typecheck
pnpm build
pnpm test
```

生产构建预览：

```bash
pnpm preview --host 127.0.0.1 --port 4317
```

## 当前边界

- 当前版本是本地单人编辑器，不包含账号、服务端存储、多人协作或冲突合并。
- 当前文件契约是 `BlockDesignDocument v2` JSON，不直接导入 Draw.io XML 或任意流程图格式。
- Save / Save As 使用浏览器下载语义，不绕过浏览器权限覆盖任意操作系统文件。
- AIO Agent Runtime 仅是随仓库提供的示例；Studio 没有 AIO 运行时依赖。
- 当前版本不会自动扫描或逆向解析源码；需要由人或外部工具将代码结构同步为 `BlockDesignDocument`。
- 可视化结果提供架构级评审视角，但不会取代逐行 Code Review、测试、静态分析，也不会自动证明实现已经遵守合同。

## 技术实现与参考

- [React Flow](https://reactflow.dev/learn)：交互、选择与视口行为。
- [Eclipse Layout Kernel](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)：分层与复合节点布局。
- [React Flow Smart Edge](https://github.com/tisoap/react-flow-smart-edge)：网格化正交避障路由。
- [Dockview](https://dockview.dev/)：可调整、折叠、最大化和移动的 IDE 面板。
- [AMD Vivado IP Integrator](https://docs.amd.com/r/2022.1-English/ug994-vivado-ip-subsystems/Designing-with-IP-Integrator)：模块块体与端口化设计参考。

Architecture Block Studio 自己拥有文档模型、视觉语言、校验规则、编辑历史和应用外壳。第三方依赖许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
