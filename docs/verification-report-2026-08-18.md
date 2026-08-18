# Architecture Block Studio 第一版编辑器验证报告

验证日期：2026-08-18
验证环境：WSL Linux、Node.js 22、pnpm 10.7、Playwright Chromium、1680 × 1050 viewport

## 结论

第一版本地单人模块设计编辑器已经形成完整闭环：用户可以新建、打开、绘制、编辑、分层、校验、撤销、重做、保存、另存和导出设计。设计事实始终只有一份 `BlockDesignDocument`；React Flow、层级树、Inspector JSON、DRC、布局和路由均由它派生。

最终自动化结果为：类型检查通过、生产构建通过、12 个 Chromium 端到端用例全部通过。真实编辑验收设计最终为 0 errors / 0 warnings；浏览器 console error 和未捕获 page error 均为 0。

## 模块与契约链

```text
Canvas / Inspector / menu / keyboard
                |
                | named DesignOperation
                v
      editor: atomic document transform
        | success              | failure
        v                      v
BlockDesignDocument       visible command error
        |
        +--> model DRC ----------------> Messages
        +--> layout --> routing --------> React Flow
        +--> hierarchy / inspector -----> dock panels
        +--> IO serialization ----------> local JSON download
```

| Owner | 原则与公开接口 | 边界与失败行为 |
| --- | --- | --- |
| `model` | 定义、解析并语义校验 `BlockDesignDocument` | 不负责 UI 和持久化；结构错误拒绝，语义不完整进入 DRC |
| `editor` | `DesignOperation`、`applyDesignOperation`、历史、dirty | 不渲染、不保存；操作原子完成，失败不产生半状态 |
| `layout` / `routing` | 从文档派生 compound nodes 和正交路径 | 不修改文档；布局失败显式进入 DRC |
| `io` | 加载本地/远程 JSON，序列化下载 | 不理解模块规则；加载失败保留当前文档，Export 不清除 dirty |
| `studio` | 组合公开接口，管理 selection、展开层级和 workspace | UI 不直接改深层对象；命令错误可见且可恢复 |

## 需求逐项证据

| 第一版能力 | 验证操作 | 结果 |
| --- | --- | --- |
| New | 从 AIO 示例新建 `Payments Architecture` 和 `Worker Design` | 空文档成功安装并标记 Unsaved |
| 添加、移动、重命名、删除模块 | 创建 API、Worker、Handler；真实鼠标拖动；Inspector 重命名；确认删除后 Undo | 位置写入 authored layout；删除级联且可恢复 |
| 添加和编辑端口 | 创建 input/output 端口，修改 label、direction、side、dataType、required | 画布和下载 JSON 同步反映唯一文档事实 |
| 拖线创建类型化接口 | 从 Worker output 拖到 API input，填写 connection id、interface id、event、Owner | 生成一条可选连接和一个接口定义；方向非法时不能提交 |
| 子层级与端口绑定 | API 创建 child design，添加 Handler 及端口，父 requests 显式绑定 child endpoint | 展开后保持父上下文与跨边界连续路径；DRC 归零 |
| Principle / Purpose / Boundary / Failure | 在 Inspector 填写三个模块和接口合同 | 最终 0 warnings；保存文件保留合同字段 |
| Undo / Redo | 撤销和重做层级 binding、端口删除、模块删除 | 文档、DRC、画布同步恢复，没有 React Flow 第二事实源 |
| dirty 与离开保护 | 保存后修改；尝试 New 并拒绝 discard | 当前设计保留，标题和状态栏继续显示 Unsaved |
| Open | URL、本地文件、保存后重新打开；另测无效结构文件 | 合法文件恢复 2 levels / 2 root modules / 1 interface；无效文件不替换当前设计 |
| Save | 保存 `worker-design.block-design.json` | 下载成功并把当前精确 snapshot 标记 Saved |
| Save As | 另存 `payments.block-design.json` 并解析下载内容 | 文件名、模块层级、Owner、binding 与 UI 一致 |
| Export JSON | 修改后导出 `worker-design.export.block-design.json` | 下载成功且 dirty 仍为 Unsaved |
| 原子失败 | 尝试在同一 level 创建重复 `worker` id | 显示 already exists，节点数保持 1 |
| JSON 高级视图 | 选择接口后切换 Inspector JSON | 同时显示 connection 和 interface 源对象，只读且可复制 |
| 线名与契约 | 点击画布连线，查看右侧 Inspector | 画布不渲染线中标签；端口保留名称，Inspector 显示完整接口名、Owner 和合同字段 |
| 连续编辑视口 | 缩放、平移后在 Inspector 修改属性并 Apply | Canvas DOM 不重挂，viewport transform 保持不变，不发生意外 Fit 或跳屏 |

## 自动化与构建证据

执行命令：

```bash
pnpm typecheck
pnpm build
pnpm test
xvfb-run -a env CAPTURE_EDITOR_PROOF=1 pnpm exec playwright test tests/studio.spec.ts -g "authors, connects" --headed
```

最终结果：

- TypeScript project build：通过。
- Vite production build：通过；1868 modules transformed，无 `public` 目录错误导入告警。
- Playwright：12 passed（5.2m，单 worker）；覆盖原有投影回归、新编辑闭环和视口连续性。
- 原有 40 个接口逐项 cross-probe 通过。
- 两层同时展开时 32 nodes、54 edges，block collision、boundary escape、independent shared route、root sibling overlap 均为 0。
- 线中标签 DOM 数量为 0；点线选择后 Inspector 正确展示接口名与合同，端口名继续作为画布上的局部识别信息。
- 新编辑流程监听 browser console error 和 page error，结果均为空数组。

## 真实操作截图

![无中间标签的编辑工作台](screenshots/editor-polished-workbench.png)

工作台截图来自同一条 Playwright 用户流程，不是手写 fixture：新建文档 → 创建模块和端口 → 鼠标拖线 → 填写类型与 Owner → 点击选中连线。画布只显示端口名，右侧 Inspector 显示 `Payment Result Event` 和完整合同，底部 Apply / Delete 操作始终可见。

![层级边界布线验证](screenshots/editor-routing-validation.png)

层级截图继续完成：创建并展开 child design → 添加内部模块 → 绑定父子端口 → Undo → Redo → 收起左右侧栏 → Fit Design。可以看到连线从 Worker 到 Public API 边界，再连续进入 Request Handler；路径没有穿过节点，边界内模块没有压住父容器标题。

两张图均由 Xvfb 中运行的 headed Chromium 直接调用原生 screenshot API，尺寸为 1680 × 1050。生成后人工检查了端口名、无中间标签、选中态、跨层级 continuation、Inspector 合同表单、固定操作区、Unsaved 状态和 0 errors / 0 warnings。

## 边界与剩余风险

- 第一版按确认范围是本地单人编辑器；不包含后端存储、账号、多人协作、冲突合并或同步协议。
- Save / Save As 采用浏览器下载语义，不承诺绕过浏览器权限原地覆盖任意操作系统文件。
- 自动化和真实截图验证覆盖 Chromium；Safari 和 Firefox 未作为本版本验收目标。
- 自动布局和路由是派生 workspace 状态；只有用户拖动产生的 authored position 会进入文档。这是已验证的不变量，不是持久化缺口。
