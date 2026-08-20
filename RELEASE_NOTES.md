# Architecture Block Studio v0.2.0

首个 Windows 桌面版本。Architecture Block Studio 现在可以作为独立 Windows x64 应用安装和运行，并继续以一份可版本控制的 `BlockDesignDocument` JSON 作为模块、端口、接口与层级设计的唯一事实源。

## 本版亮点

- Windows 原生 Open、Save、Save As 与 Export JSON。
- 已打开文件可原位保存；新设计首次保存使用原生文件对话框。
- Open 只有在 JSON 解析和 Schema 校验成功后才替换当前设计与文件绑定。
- Save 采用临时文件、flush 与 rename 的原子写入链；磁盘成功前不会清除未保存状态。
- 关闭窗口时保护未保存文档与尚未 Apply 的 Inspector 草稿。
- Electron renderer 启用 sandbox 与 context isolation，不暴露 Node、系统路径、任意 IPC 或通用文件系统。
- 提供 Windows x64 NSIS 安装程序、开始菜单 / 桌面快捷方式和 SHA-256 校验文件。
- 新增正式应用图标与 Windows 桌面真实启动截图。

## 既有专业图形能力

- 自动正交避障、多线分道、线桥与逐线 / 逐对路线审计。
- 线段、折点和端点直接编辑，手工路线随 JSON 保存。
- 模块和多模块统一 resize、吸附、对齐、分布、框选与依赖邻域审查。
- 五层层级 Enter / Exit / Home 与 breadcrumb 聚焦。
- 画布不显示容易遮挡路线的线中标签；点击线路后在 Inspector 查看完整接口合同。
- 由真实 TypeScript import 生成五层源码架构示例，用于代码可视化与人工架构审查。

## 验证摘要

- 180 / 180 单元测试通过。
- production build 与五层自架构一致性门禁通过。
- Electron 真实启动、sandbox 隔离、7 模块 / 10 接口渲染通过。
- 原生 Open → 校验确认 → Save As 端到端字节一致性通过。
- Windows 安装包由 GitHub Actions 的 Windows runner 构建并附带 SHA-256。

## 已知边界

- 本版本仅支持 Windows x64，不提供网页产品、macOS、Linux 或移动端发行。
- 安装包尚未使用商业代码签名证书，Windows 可能显示“未知发布者”；请在运行前核对 Release 中的 SHA-256。
- 尚无异常崩溃后的自动恢复副本。
- 图形化能力仍在持续对照 draw.io 迭代，本版不宣称已经达到 draw.io 的整体同等水平。
