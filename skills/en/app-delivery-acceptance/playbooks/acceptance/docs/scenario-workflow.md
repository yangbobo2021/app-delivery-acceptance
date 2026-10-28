# 独立场景设计入口

`/acceptance-scenarios` 为一个冻结需求或有独立依据的规则生成/增量修订场景，输出经门禁校验的设计候选后停止。
场景角色由官方 Playbook CLI 调用、绑定和管理会话；本入口不调用 Skill 自建的模型 SDK runner。
它不是用例生成、运行准备、产品执行或独立 Reviewer。

## 配置与显式输入

```json
{
  "players": {
    "acceptance.designer": {
      "adapter": "codex", "model": "<实际选用的模型>",
      "permissions": {"fileWrite":"deny","shellExecute":"deny","networkAccess":"deny"}
    }
  },
  "playbooks": {
    "acceptance-scenarios": {
      "from": "<skill绝对路径>/workflows/scenarios/registry.mjs",
      "roles": {"designer":"acceptance.designer"}
    }
  }
}
```

这是示例绑定，不授权替换用户的 Agent、模型或服务；宿主使用当前任务明确选用的设置。
不同角色可绑定不同 player ID；相同 ID 在同一 Captain 会话中共享会话，不应将后续独立评估者绑定为 Designer 同一 ID。
官方 CLI 的只读仓库效果核对要求有效 Git 项目；在其实际项目目录中调用。
无源码/非 Git 的实际人工操作使用 `/acceptance-manual-execute`，不为启动源码设计入口而虚构 Git 来源。

通过官方 `playbook run --with overlay.json --no-provision --json` 的 stdin 交接：

```text
/acceptance-scenarios {"project_root":"/absolute/user-project","acceptance_id":"AT-example","request_id":"design-r1-once","definitions_sha256":"当前scenarios.json的SHA-256","target_id":"R1","mode":"create"}
```

- 宿主指定一个 `target_id`，工具从当前冻结集合物化全部需求、共同约束、分组和已有场景；不能只给孤立一句需求冒充完整上下文。
- `mode: create` 只用于尚无主目标场景的目标；已有场景时拒绝覆盖，改用 `edit`。
- `mode: edit` 还需 `previous_definitions: {path,sha256}`，指向变化前的不可覆盖定义记录；当前人工场景作为编辑基线，旧快照解释变化，不用于覆盖当前人工修改。
- `source_checkout` 可选，记录白盒依据的实际源码位置；白盒继续核对冻结代码版本和文件哈希。
- `knowledge_paths` 可选，选择已索引知识，工具保存真实读取凭证；知识是操作参考而非业务 oracle。
- `request_id` 对同一次设计固定；输入或提示协议实质变化使用新 ID，保留旧尝试。

## 工作流与结果

```text
当前 AT/冻结版本校验
  → 物化完整设计上下文、保存输入与提示
  → 官方运行时调用 Designer
  → 原场景结构/自检/修订门禁
  → 保存设计候选与可选的后续冻结消息
  → 停止
```

角色只读，提交完整 JSON 或场景差量，不写业务源码、不运行测试或应用。
`edit` 的 `change_reasons` 是 `{场景ID:原因字符串}` 对象，键恰好对应新增、修改和退役项；未改场景不重写。
角色原答、完整自检、差量、候选和原始定义依据均保留；内部自检及结构门禁不称作独立复审。
UI 场景把实际视觉判据原文绑定到描述与自检；此时只是设计要求，不代表已经操作 UI 或验收通过。
无可信判据的义务保留设计缺口，许可条款不被强行变成唯一通过结果。

产物位于 `.acceptance-local/<AT-ID>/workflows/scenarios/<request_id>/`：

| 文件 | 内容 |
| --- | --- |
| `input.json`、`request.frozen.json` | 本次调用及物化后的完整冻结输入。 |
| `prompt.txt`、`prepared.json` | 实际提示、输入及知识绑定摘要。 |
| `answer.txt`、`draft.candidate.json` | 角色原答和解析后的候选，原答不被手工补造。 |
| `scenarios.current.json`、`selfcheck.current.json` | 经门禁的本目标场景与同角色自检。 |
| `terminal.json`、`result.json` | 设计状态、真实摘要及 `not_independent` 审查级别。 |
| `candidate-definitions.json` | 保留其他目标的完整候选定义。 |
| `freeze-command.txt` | 宿主可另行发送给官方 CLI 的完整冻结请求。 |

设计完成不会自动采用候选、生成用例或执行测试。
用户要求采用或完整继续验收时，宿主把 `freeze-command.txt` 精确传给 `/acceptance-freeze`，再选择下一独立过程；只要求查看设计时停在候选即可。
完成请求重入先核对不可变产物，不再调用 Designer；原定义后来变化时保留设计的真实来源，不倒退当前定义。
官方 CLI 的 Captain 仍会生成回复，因此“不重调 Designer”不等于零模型调用。

失败时保存原答与原因，不用格式失败触发无上限模型重跑。
有已保存原答且原绑定仍匹配时可重验同一原答；完整失败/提示改版使用新尝试，不修改旧回答或 frozen 文件。
`active.lock.d` 正常结束移除，崩溃遗留锁先核查 owner/PID 与官方会话，不自动抢占。

## 兼容依赖及验证

完整定义、当前场景基线、差量合并与场景自检门禁均为 Node。
原入口仅保留历史协议参考；新设计通过独立 CLI 调用，保留原冻结、追踪和后续用例绑定。

```sh
node <repository>/tests/acceptance_scenarios.integration.mjs --live-cli --output /absolute/evidence-directory
node <repository>/tests/acceptance_scenarios_edit.integration.mjs --live-cli --output /absolute/edit-evidence-directory
```

第一组区分协议夹具与真实模型调用，验证完整上下文、门禁、候选采用、停止边界、重复请求和无关场景保留。
第二组使用真实 Designer 执行 edit，核对旧身份、人工内容、无关目标、采用后的版本及不重复模型调用。
模型验证中实际使用的 Agent、模型、配置及原始回执均随测试证据保存；当前前向验证使用 Codex/gpt-6.1-sol，不将其扩称其他 Agent 已通过。
