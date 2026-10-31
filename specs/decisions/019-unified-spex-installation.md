# DR-019: 通过 SPEX 一次安装 Skill 与 Playbook

## 状态

本决策保持已接受；[DR-026](026-portable-skill-runtime-preparation.md) 扩展了 Mac/Windows Skill 的首次运行时准备与原生 CLI 支持范围。
[DR-025](025-source-and-distribution-repositories.md) 调整了源码主干与安装仓库的组织范围，保留联合安装和托管导出约束。

已接受，依据用户要求通过 SPEX 安装测试 SKILL 后，Codex 能使用真实 Skill，SPEX 能使用原生 Playbook。
扩展 [DR-017](017-standard-host-player-port.md) 的分发范围，运行时职责与总调度所有权不变。

## 背景

SPEX 可在一个 format-2 包中安装真实 Skill 与 Playbook，并把真实 Skill 导出到 Agent 发现目录。
原生构建仅声明 Playbook，原源码包仅声明 Skill；此前两种运行验证不证明同一次安装已连通两种入口。
SPEX 会整体替换改变的 Skill 导出目录，因此其中的 CLI 依赖安装不应与受管代码目录混在一起。

## 决策

- 联合产物声明一个真实 app-delivery-acceptance Skill 和全部原生 Playbook，选择闭包同时包含两类入口。
- 两种运行产物来自同一份业务源码；Skill 保留独立 CLI、锁定依赖和 vendor 资源，原生 Playbook 仍使用 SPEX 引擎及其自身闭合资源。
- SPEX 按现有能力安装与导出 Skill，项目安装在对应项目内对 Codex 可见，不宣称自动全局可用；同名已有 Skill 保持 SPEX 原有冲突规则。
- SPEX 安装的 Skill 通过自身准备脚本，按安装清单核对代码并准备独立的内容标识 CLI 缓存，所有后续命令采用准备结果的真实包路径。
- Skill 受管导出目录不写入 node_modules 或依赖安装锁；构建及缓存核对遇到 .npmrc、.env 等凭据配置即拒绝，不将其复制或仅从清单忽略；不改变验收业务资料根、权限或证据约定。
- UI 安装、真实 Codex 加载导出的 Skill、原生 SPEX 调用及重导出后复用分别保存直接证据，不以全局预装 Skill 替代联合安装证明。

## 影响

SPEX 无需修改；首次使用 CLI 仍须满足其已声明的 Node/npm/凭据前提并准备锁定依赖。
原生 Playbook 不因联合分发而要求安装 CLI 的 SDK。
