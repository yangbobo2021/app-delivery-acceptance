# 冻结定义与增量复验

`acceptance-catalog-v2` 是一个 AT 的完整定义快照，包括 `requirements`、`reverse_rules`、`scenarios` 和 `context`。来源可以是项目 SPEC、用户口述、文档或已确认的逆向规则；保留完整原文、原身份与实际出处，不因输入来源建立重复工作流。

通过 `/acceptance-freeze` 采用明确约定，输入见[独立入口](independent-workflows.md#冻结请求)。首次基线明确为 null，后续为当前 scenarios.json 的 SHA-256。默认按 ID 增量合并；完整替换需要明确 `replace_basis`。用户未确认的逆向规则保留问题，不进入可执行义务。独立场景可以没有父需求。

每次采用生成不可覆盖的 `records/catalog-*.json`、定义版本和变更摘要，当前 scenarios.json 与对应快照字节一致。请求、范围、定义、来源与知识凭证绑定同一 AT。重复请求不重写文件；旧请求只能返回已被取代的历史，不能倒退当前定义。

场景变化由依赖闭包计算，包括完整原始目标、关联约定与共同业务约束。纯分组组织或增加无关目标不使原场景失效；真实业务/共享约束变化需复验。用例永久 TC 身份不随再次关联或重跑改变。

生成/编辑场景是 `/acceptance-scenarios` 的独立过程，只产生候选和冻结输入；需要显式采用后才成为定义。`/acceptance-assess-scenarios` 是可选独立设计意见，不能代替实际产品执行。场景生成标准见[场景工作流](scenario-workflow.md)。

用户要求代码变化后复验时，`/acceptance-rebind` 绑定新版本及已核验运行/覆盖率准备；`/acceptance-execute` 可以只重跑具体永久 TC，不重新生成断言。`/acceptance-change-plan` 支持完整变更、跟随既有执行历史或只设计；选取范围必须来自用户实际授权，不能自动扩大。旧证据保持，当前适用性与原结论分别显示。

## 输入质量检查

Skill/宿主负责理解对话并列出本次必需的来源与运行背景。Playbook 不继承对话，也不能推断宿主从清单和请求中同时遗漏的资料。冻结入口负责验证交接的项目内文件，不解析特定 SPEC 格式，不替用户选择需求。

文件来源在首次冻结时提供 `source_inputs`，完整文本应由实际文件读取，SHA-256 对原始 UTF-8 文件字节计算：

```json
{
  "source_inputs": {
    "required_documents": ["docs/requirements.md", "README.md"],
    "documents": [
      {"path": "docs/requirements.md", "sha256": "<actual SHA-256>", "text": "<complete exact file text>", "purpose": "原始需求及合法输入背景"},
      {"path": "README.md", "sha256": "<actual SHA-256>", "text": "<complete exact file text>", "purpose": "实际运行命令"}
    ]
  }
}
```

- `required_documents` 是宿主从用户要求整理的输入清单；每个声明文件必须有完整快照，不接受仅文件名、摘要或截断正文。`documents` 也不能包含清单外文件。
- `origin.file` 可明确提供 `{ "path": "docs/requirements.md", "start_line": 6, "end_line": 6 }`；兼容清晰的 `docs/requirements.md:6@revision` 定位。行号从 1 开始且包含末行，所选范围必须包含该定义的准确原文，人工引用中的行号/哈希不能与结构化来源冲突。
- 路径相对项目根，拒绝项目外路径和逃逸符号链接；外部系统的约定继续使用现有 `external_refs` 的定位、不可变版本和完整原文合同。
- 通过后，工作流将已核验文档写入冻结的 `context.source_documents`，清单写入 `context.required_source_documents`；后续角色经 `execution_context` 接收全部原文。必要背景不增加目标需求和测试范围。
- 不能直接向上下文注入新的未经核验文档；后续增量请求可保留相同的已冻结背景或通过 `source_inputs` 提供更新。旧请求重入仍返回原历史，不因为现文件后来变化而改写旧事实。
- 任一检查失败即阻塞本次冻结，在写入范围、版本和工作区之前停止，保留已有定义。重新采用发生变化的文件时，应重新读取并显式交接原文及哈希。
- 口述约定仍可直接冻结真实消息原话与出处，不强制创建 README 或转换成 SPEC。
