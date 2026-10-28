# 冻结定义与增量复验

`acceptance-catalog-v2` 是一个 AT 的完整定义快照，包括 `requirements`、`reverse_rules`、`scenarios` 和 `context`。来源可以是项目 SPEC、用户口述、文档或已确认的逆向规则；保留完整原文、原身份与实际出处，不因输入来源建立重复工作流。

通过 `/acceptance-freeze` 采用明确约定，输入见[独立入口](independent-workflows.md#冻结请求)。首次基线明确为 null，后续为当前 scenarios.json 的 SHA-256。默认按 ID 增量合并；完整替换需要明确 `replace_basis`。用户未确认的逆向规则保留问题，不进入可执行义务。独立场景可以没有父需求。

每次采用生成不可覆盖的 `records/catalog-*.json`、定义版本和变更摘要，当前 scenarios.json 与对应快照字节一致。请求、范围、定义、来源与知识凭证绑定同一 AT。重复请求不重写文件；旧请求只能返回已被取代的历史，不能倒退当前定义。

场景变化由依赖闭包计算，包括完整原始目标、关联约定与共同业务约束。纯分组组织或增加无关目标不使原场景失效；真实业务/共享约束变化需复验。用例永久 TC 身份不随再次关联或重跑改变。

生成/编辑场景是 `/acceptance-scenarios` 的独立过程，只产生候选和冻结输入；需要显式采用后才成为定义。`/acceptance-assess-scenarios` 是可选独立设计意见，不能代替实际产品执行。场景生成标准见[场景工作流](scenario-workflow.md)。

用户要求代码变化后复验时，`/acceptance-rebind` 绑定新版本及已核验运行/覆盖率准备；`/acceptance-execute` 可以只重跑具体永久 TC，不重新生成断言。`/acceptance-change-plan` 支持完整变更、跟随既有执行历史或只设计；选取范围必须来自用户实际授权，不能自动扩大。旧证据保持，当前适用性与原结论分别显示。
