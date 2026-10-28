# 独立交付测试入口

宿主使用完整用户对话选择入口、准备显式输入并决定后续调用；Playbook 不自动读取宿主会话。
每次只执行本次授权的过程，单个入口完成不代表整项验收结束。
这些模块由锁定的官方 Playbook 本地固定构建 CLI 加载。
先核对 [官方 CLI 的服务、写入和图片边界](native-cli-boundaries.md)；使用标准官方命令和公开 Player 端口。
新业务仅使用本页独立入口；分发源码不包含旧协调器或旧路径转发入口。完整迁移的验收状态见项目追踪记录，不以入口数量代替通过。

## 已实现入口

| 命令 | 注册模块（相对独立工作流包） | 输入与停止点 |
| --- | --- | --- |
| `/acceptance-create` | `workflows/create/registry.mjs` | [仅创建](create-acceptance.md)，创建空容器即停止。 |
| `/acceptance-freeze` | `workflows/freeze/registry.mjs` | 以下冻结请求，保存明确约定后停止，不生成场景。 |
| `/acceptance-analyze` | `workflows/analyze/registry.mjs` | [完整需求分析](analysis-workflow.md)，输出目标、范围和分组候选后停止。 |
| `/acceptance-scenarios` | `workflows/scenarios/registry.mjs` | [单目标 create/edit 设计](scenario-workflow.md)，由官方 Designer 角色生成经门禁的候选后停止。 |
| `/acceptance-assess-cases` | `workflows/assess-cases/registry.mjs` | [只读用例设计评估](case-assessment-workflow.md)，仅评估已有实际关联组，不选用、运行或修补测试。 |
| `/acceptance-reverse` | `workflows/reverse/registry.mjs` | [提交／PR 逆向分析](reverse-workflow.md)，物化完整清单、规则候选和待确认问题后停止。 |
| `/acceptance-runtime` | `workflows/runtime/registry.mjs` | [独立运行准备](runtime-workflow.md)，角色提出计划、宿主真实安装并复验 smoke 后停止。 |
| `/acceptance-find-cases` | `workflows/find-cases/registry.mjs` | [静态查找与关联](find-cases-workflow.md)，只读查找、宿主核验 ID 并发布未执行关联。 |
| `/acceptance-coverage-prepare` | `workflows/coverage/registry.mjs` | [独立覆盖率准备及修复](coverage-workflow.md)，执行新探针并冻结准备后停止，不运行业务用例。 |
| `/acceptance-cases` | `workflows/cases/registry.mjs` | [动态查找／复用／生成](cases-workflow.md)，实际调试并独立评估后停止，不正式执行。 |
| `/acceptance-execute` | `workflows/execute/registry.mjs` | [正式执行及指定 TC 重跑](execute-workflow.md)，冻结真实证据并独立复审，保留完整场景与部分重跑的结论边界。 |

其余 Node 入口及输入见 [生命周期、变更、恢复、报告、回填和整体验收](lifecycle-workflows.md)。
显式要求独立场景复审时使用 `workflows/assess-scenarios/registry.mjs`，角色 `scenario_reviewer`，命令 `/acceptance-assess-scenarios`；输入为 project_root、acceptance_id、request_id、definitions_sha256、target_id、basis。

## 注册与调用

先准备锁定依赖，再用实际选择的 Agent 和模型生成临时 overlay（不修改全局配置、不调用模型）：

```sh
node <package>/runtime/dependencies.mjs
node <package>/bin/configure.mjs --agent codex --model <实际模型> --output /absolute/new-overlay.json
<package>/node_modules/.bin/playbook run --with /absolute/new-overlay.json --no-provision --json
```

最后一条命令的 stdin 是精确 `/acceptance-命令 JSON`。
配置工具读取实际已分发 registry，不代替宿主选择或组合业务流程。
`--roles` 可读取显式 `{role_id:{agent,model,effort?}}`，用于全部直接及内部角色的差异绑定；不再使用独立环境变量角色表。
新输出文件不可覆盖旧配置；其中不写凭据。

使用 `--with` 临时叠加配置，不改用户全局配置：

```json
{"playbooks":{"acceptance-freeze":{"from":"<package绝对路径>/workflows/freeze/registry.mjs","roles":{}}}}
```

运行 `<package>/node_modules/.bin/playbook run --with overlay.json --no-provision --json`，通过 stdin 传入精确的 `/命令 JSON` 消息。
确定性冻结没有模型角色，但官方 CLI 的 Captain 会生成用户回复；核对真实终态和文件回执，不用 exit 0 或回复文字代替结果。

## 冻结请求

```json
{
  "project_root": "/absolute/user-project",
  "acceptance_id": "AT-example",
  "request_id": "freeze-once-unique-id",
  "base_definitions_sha256": null,
  "basis": "用户明确要求：冻结以下需求，暂不设计场景。",
  "definitions": {
    "context": {"business_goal": "来自用户原话的真实目标。"},
    "requirements": [{
      "id": "R1", "text": "用户提供的完整原文。",
      "origin": {"kind": "conversation", "reference": "实际用户消息定位或快照"},
      "external_refs": []
    }]
  }
}
```

- 首次冻结基线明确为 `null`；已有定义时必须使用当前 `scenarios.json` 文件的 SHA-256。
- `definitions` 由宿主读懂实际来源后整理，保留原文和定位；本工具不抓取 SPEC、解析网页或替用户发明业务目标。
- 默认 `mode: append` 按 ID 合并，保留旧需求、规则、场景和上下文；只提供新对象不会删除其他对象。
- `mode: replace` 表示明确采用完整集合，必须有 `replace_basis`，用于已确认的删除或完整场景替换。
- 完整定义使用现有 `acceptance-catalog-v2` 校验；可以直接采用来源明确的既有场景，也可以只冻结需求，场景集合保持空。
- 原先未定义范围时，以明确纳入的身份建立 `kind: definition-targets` 范围；后续增量同步这类范围。既有用户自定义范围保留，改变它须显式传 `scope`。
- 可传现有协议的 `assessment` 记录有依据的等价性及影响判断；无依据不自行推定语义等价。
- 不接收伪造的 publication/version 字段；版本和内容哈希由原协议工具生成。

## 产物及恢复边界

共享产物保留 `records/scope-NNNN.json`、`scope.json`、`records/catalog-*.json` 和完整 `scenarios.json`。
本机保存 `.acceptance-local/<ID>/workflows/freeze/<request_id>/request.frozen.json` 与 `result.json`，回执绑定请求、范围和不可覆盖定义快照的摘要。
同请求重入不重写文件；若原冻结后来已被取代，返回 `applicability: superseded`，不倒退当前版本。
冻结前核对当前 AT、项目根、知识索引、已有历史与工作区锁；当前阶段运行中、基线过期或参数冲突即停止。
进程硬中断遗留锁或不完整尝试需先核查，不能删除锁后盲目重复。

冻结入口由 Node 维护校验、哈希及版本历史协议；没有 Python 调度器或兼容执行入口。
完整需求冻结与场景生成是独立过程，冻结不会启动运行准备、用例或产品测试。

## 验证

```sh
node <repository>/tests/acceptance_freeze.integration.mjs --live-cli --output /absolute/evidence-directory
```

实际调用官方 CLI、当前 Node 存储工具和文件系统，检查原文、增量、不可覆盖历史、同请求重入、过期基线、场景影响、工作区互斥及创建→冻结后停止。
`--live-cli` 使用测试中明确记录的 Codex/gpt-6.1-sol Captain；省略则仅执行确定性协议集成检查。
