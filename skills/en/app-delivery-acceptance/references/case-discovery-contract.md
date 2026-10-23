# 已有用例查找契约

目标是找到能为**当前场景**提供实际验证的已有业务测试，说明关联贡献和边界。上层需求和相邻场景只帮助理解，不扩大查找目标。查找不替代独立用例评估，也不产生正式通过结论。

查找与生成共用 [场景用例查找与复用标准](case-search-guidance.md)。模型调用必须同时提供该标准的正文；下列结构只描述实际已有测试，不包含之后计划新增的测试。

在原用例结果 JSON 内增加 `case_discovery`，与统一的 `case_descriptions` 一起返回；不要另写说明文件：

```json
{
  "case_descriptions": [{
    "id": "C1",
    "name": "跟随用户和视图语言，用人话说明实际测什么",
    "method": "实际输入和操作，包含必要参数范围",
    "assertions": "代码真正检查什么以及如何检查",
    "boundary": "层次、关键替身、隔离方式和未验证部分",
    "source": {"origin":"existing", "file":"相对源码工作区的路径", "title":"直接摘录源码中连续出现的真实测试标题或声明标识，不补全限定名；无命名测试项时用脚本文件名", "line_start":1, "line_end":10}
  }],
  "case_discovery": {
    "schema": "existing-case-discovery-v1",
    "summary": "简洁说明找到的主要支持和主要限制",
    "search_scope": [{"path":".", "kind":"manifest|tests|source", "summary":"实际查阅或检索的范围及方式"}],
    "obligations": [{"id":"O1", "quote":"当前场景的一段连续原文", "status":"found|not_found|uncertain", "case_ids":["C1"], "reason":"实际找到的关联支持，或尚未找到/确认的范围"}],
    "associations": [{"case_id":"C1", "obligation_ids":["O1"], "contribution":"这个用例实际支持该场景的哪部分", "availability":"active|skipped|conditional|unknown", "availability_note":"跳过/条件启用时必填：默认行为及已有运行方式或限制；active可留空", "evidence_ids":["E1"]}],
    "excluded_candidates": [{"file":"候选测试相对路径", "title":"连续摘录源码中的候选标题或声明标识，不补全限定名；无命名项时用脚本文件名", "reason":"排除的实际原因", "evidence_ids":["E2"]}],
    "limitations": ["尚未查明的范围、依赖或覆盖边界"],
    "evidence": [{"id":"E1", "file":"相对路径", "line_start":1, "line_end":5, "quote":"对应行范围内的连续源码原文"}]
  }
}
```

`found` 只表示找到实际关联，不等于充分覆盖或默认会执行。默认跳过且有实质断言的关联在用例说明的边界中明确标注；建议命令不得暗示默认执行已包含该项，不修改源码去解除跳过。义务引用只能摘自当前场景的条件、操作、预期或显式视觉判据；每项用例与对应义务双向一致。每项关联引用自身测试正文，依赖参数表或辅助断言时同时引用对应代码。引用要能支持贡献与边界，不只引用标题。不得改写引文、伪造行号、从产品代码推断测试已有断言。宿主核对相对路径、行号、连续原文、文件哈希及内部引用，不能代替语义复核。无需列出所有无关测试；只解释容易混淆或重要的排除候选。

文字面向用户：摘要不超过180字，贡献与逐义务说明不超过180字；每项用例的标题不超过120字，方法/断言/边界各不超过600字；限制最多5项，每项180字。引用保留原语言，单条不超过30行、1800字。标识用英文字母开头的字母、数字、下划线或短横线。没有关联时，`case_descriptions`、`associations` 为空，如实写明实际检索范围；不能将有限检索声称为整个项目不存在测试。

普通 `existing_only` 模式仍须按统一调试入口实际运行，并保留既有结果字段和收据。显式 `existing_case_mode: discover_only` 只进行静态查找，使用同一选择契约，返回 `status: not_executed`，`observations`、`evidence_paths` 为空；`test_command` 可给出已有入口作为建议，也可为空，绝不构成实际执行。只读模式不能由模型自行切换到执行，不进入正式场景执行状态机。不存在用例、无法执行和已执行失败是不同事实。
