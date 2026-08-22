# Architecture Block Studio v0.4.1

这是 v0.4.0 的 Windows 工作台修复版，解决 Properties 面板意外浮在画布中央、无法拖回也没有明确关闭路径的问题。

## 修复内容

- **固定工作台拓扑**：Sources 固定在左、Diagram 固定居中、Properties 固定在右、Messages / DRC 固定在下方，不再允许面板漂浮到画布上或被任意拖散。
- **旧布局自动恢复**：升级后若检测到旧版 floating / popout、面板缺失或停靠位置异常，会自动恢复标准工作台并重写本机布局缓存；无需手动清理配置。
- **保留必要自由度**：左右栏仍可调整宽度、隐藏并从窄边栏恢复，面板仍可最大化 / 还原；只移除了会破坏工作台稳定性的浮动和 Dock 拖放。
- **不影响设计文件**：迁移只处理本机工作区状态，不读取或改写 `BlockDesignDocument` JSON，不改变当前设计、Undo / Redo、dirty、选择或路线。

## 验证摘要

- 233 / 233 单元测试通过，35 个 test files。
- Chromium 93 / 93、Firefox 92 / 92 产品回归通过。
- Windows Electron 真实窗口 1 / 1 通过，包含旧浮动 Properties 自动恢复与截图核查。
- Windows x64 自动更新、安装包和 SHA-256 发布链保持不变。

## 已知边界

- 仅支持 Windows x64，不提供网页产品、macOS、Linux、手机或平板发行。
- 安装包尚未使用商业代码签名证书，Windows 可能显示“未知发布者”；请先核对 Release 中的 SHA-256。
