# 项目运行环境准备：独立 Agent 与冻结交接

运行环境先于覆盖率准备，也独立于业务场景生成和执行。运行环境 Agent 可读取项目现有依赖清单、已有测试入口和已索引知识，自主选择最小安装与 smoke 命令；通用 Skill 不预设语言、包管理器或产品入口。它不执行业务场景、不判断产品行为，也不选择覆盖率工具。覆盖率关闭时，本阶段仍可单独完成。

## 启动与职责

先按 `acceptance_store.py current` 确认本次 ID；用 `read-knowledge` 读取 `.acceptance/knowledge/INDEX.md` 及相关分层知识，并保存真实读取凭证。新机器或新 ID 必须重新建立本机运行环境，不能复制旧 ID 的安装路径、探针通过结论或原始收据。接受项目来源和冻结 Git revision 的请求 schema 为 `project-runtime-agent-request-v1`，包含 `acceptance`、`source_checkout`、`revision`、`test_roots`（项目相对路径数组），可选 `components` / `component_sources`。声明测试目录让后续覆盖率 Agent 能在此处生成适配器，而运行环境复核继续阻止产品源码变化。宿主通过 `acceptanceGuard` 验证绑定，使用 `acceptance_workspace.ensure_workspace` 在本 ID 建立/复用唯一的 `.acceptance-local/<ID>/workspace`；此时尚不运行项目测试。

独立 Agent 入口：

```sh
node <skill>/playbook/v4/run_runtime_preparation.mjs \
  <runtime-agent-request.json> \
  <project>/.acceptance-local/<ID>/workflows/<new-attempt>
```

`run_runtime_preparation.mjs` 启动当前调用 Agent（Codex 或 Claude Code）的独立会话，复用显式选择的模型与服务配置，在冻结工作树内只读检查项目，并向 Agent 提供实际读取的知识上下文。它保存 `prompt.txt`、`agent.jsonl`、`answer.txt`、`draft.json`、`metrics.json`。Agent 仅返回声明式计划：`dependency_files`、`knowledge_used`、`setup_commands`、`executables`、`smoke`、非空 Markdown 字符串 `recipe_candidate`；用户或宿主不需要在通用 Skill 中编写项目命令。宿主注入可信的验收绑定、来源和 revision，保存 `agent-spec.json`，再调用 `runtime_preparation.py prepare` 执行安装与轻量 smoke。Agent 阶段不得安装或修改文件；原项目可跟踪文件有变动则阻断。项目命令使用 argv 数组，不使用 shell 字符串或隐式环境变量展开；仅 `{workspace}` 与 `{runtime_root}` 是宿主支持的路径占位符。

如需人工构造或复测已冻结的 Agent 计划，低层入口是：

```sh
python3 <skill>/scripts/runtime_preparation.py prepare <agent-spec.json> <new-workflow-output>/runtime
python3 <skill>/scripts/runtime_preparation.py verify <new-workflow-output>/runtime/runtime.json
```

低层入口仍执行当前 ID、知识读取、项目来源和 workflow 输出守卫，不是绕过 Agent 的常规验收流程。首次失败保留 `failure.json` 与已生成的命令日志；修复计划后使用新 attempt，不覆盖旧资料。

## 准备证据与后续绑定

准备成功产生 `runtime/runtime.json`，schema `project-runtime-preparation-v1`，状态 `ready`。清单冻结：

- 当前验收绑定、唯一 workspace 与 ID 内 `runtime_root`、Git revision、操作系统与架构。
- 项目依赖文件的项目相对路径及 SHA256；Agent 已读知识路径、读取凭证路径与哈希。
- 实际可执行文件路径、解析后的路径、文件哈希、版本命令与版本原始输出。
- 安装命令与 smoke 的 argv、cwd、环境变量、退出码、日志路径及哈希；smoke 必须使用后续测试将采用的运行路径，能重复执行且不含业务断言。
- `recipe-candidate.md` 及其哈希。此文件只是待发布知识候选，不能在运行环境验证前写入共享知识并使本次读取凭证失效。

固定验证器 `validate_runtime(path, expected_acceptance=None, resmoke=True)` 检查当前 ID、项目 revision、依赖字节、平台、可执行文件路径/哈希/版本、全部命令收据与 smoke 再执行。返回 `runtime_manifest` 的绝对路径和 `runtime_sha256`。后续覆盖率准备只消费这个路径与哈希，并再次验证；旧 ID、另一电脑、源码/依赖/工具变化或 smoke 失效都必须产生新的准备，不准沿用旧 `ready`。首次准备的安装、版本和 smoke 日志保留在本 ID 内；后续只读复验捕获输出并核对，不写回冻结的 runtime 目录，调用阶段自行保存失败收据。

宿主在通过验证后审查 `recipe-candidate.md`：只把跨验收可复用的依赖来源、目录约定、安装步骤、测试入口、新电脑重建方法和故障原因复制到 `.acceptance/knowledge`，更新相应分层 `INDEX.md`。不要把本机绝对路径、已安装环境、日志、探针结果或秘密写入共享知识。更新知识后重新调用 `read-knowledge`，为覆盖率 Agent 提供新读取凭证；旧运行环境清单记录原始读取凭证，不因知识更新而改写。

## 两轮验收方式

第一轮以新 ID 执行运行环境 Agent 后，检查 Agent 的知识读取、命令计划、实际安装目录、可执行文件、版本、依赖哈希、smoke 与失败收据；再由宿主独立运行 `verify`。完成知识索引后结束该 ID。第二轮在同一冻结项目版本建立另一 ID 与全新 local 工作树，读取上一轮发布的知识再启动同一 Agent；检查 `knowledge_used` 和读取凭证包含共享 recipe、命令复用依据、探索/错误尝试与用时，并确认新清单只引用第二轮 runtime、依赖和 smoke 证据。安装耗时未必下降，衡量重点是少做重复选型和排错且准备质量不降。两轮的首次异常与复测都保留在各自 ID 的 workflow 中。

运行准备 Agent 的输入保留冻结工作区的组件、源码范围及 test_roots；多项目仓库按这些目标目录选择依赖和 smoke，不因仓库根目录存在其他项目而切换目标。OpenCode JSON 结果通过原生结构化提交传给宿主，参见 [运行时合同](agent-runtime.md#opencode-json-result-delivery)。
