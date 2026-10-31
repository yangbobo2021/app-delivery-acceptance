# DR-027: 原生 Windows 受限角色的命令执行

## 状态

已接受（2026-10-31），扩展 [DR-026](026-portable-skill-runtime-preparation.md)。

## 背景

真实 Windows Codex 验证中，项目指南角色只读访问 package.json 被策略拒绝，父流程正确保留 Source basis missing 而未宣称测试通过。
同机的原生 MXC 探针允许读取且拒绝写入；选择 MXC 后，Windows PowerShell 5.1 在受限环境初始化失败，而 cmd.exe 的真实读取成功。仅验证模型回复或可执行文件存在不能证明角色可以工作。

## 决策

- 通过锁定的 Cligent 依赖采用 Codex 官方原生沙箱选择能力；受限 Windows 调用优先使用兼容的 MXC，继续服从宿主能力及管理策略，不关闭沙箱或修改系统配置。
- 通过 Codex 的原生 developer_instructions 配置提供 Windows 命令行能力说明，使角色选择可运行的 cmd.exe，并明确命令失败不能被解释成空文件。
- 现有文件、shell、网络权限和审批策略保持原值；该适配不授予额外读写目录，不创建业务权限规则或 SPEX 业务内置实现。
- Mac 及其他平台不注入该 Windows 配置。历史失败、归属和证据保留；修复版本须重新完成从 GitHub 安装到正式执行及独立复审。

## 影响

原生 Windows 需要可用且受宿主管理策略允许的 Codex 沙箱；不满足前提时继续保留真实拒绝，不自动扩权。首次修复版本需要重新安装和执行，已有失败不改写为成功。

## 依据与验证

采用 [Codex 原生 Windows 沙箱配置](https://learn.chatgpt.com/docs/windows/windows-sandbox) 和 [权限配置](https://learn.chatgpt.com/docs/permissions)；不自建跨平台权限抽象。
真实 Windows 角色读取及拒绝写入由 [集成测试](../../tests/windows_codex_permissions.integration.mjs) 验证，业务四模式结果另存，不由该探针代替。
