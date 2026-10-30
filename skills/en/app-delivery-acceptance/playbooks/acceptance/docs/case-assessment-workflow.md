# 独立用例设计评估

`/acceptance-assess-cases` 通过官方 Playbook CLI 调用独立 `evaluator` 角色，只评估当前场景已提供的实际关联组，不查找、生成、运行或修补用例，不给产品结论，也不阻止后续执行。
适用于查找后、生成后或单独评估，无需走完整流水线。

## 输入与调用

按 [独立入口](independent-workflows.md) 注册 `<package>/workflows/assess-cases/registry.mjs`，将 `roles.evaluator` 映射到单独 Player，可独立选择 Agent/模型。
目前真实测试为 Codex/gpt-6.1-sol，只读权限，不代表其他 Agent 已验证。
通过 stdin 传入 `/acceptance-assess-cases JSON`：

```json
{
  "project_root":"/absolute/project",
  "acceptance_id":"AT-example",
  "request_id":"assess-once",
  "definitions_sha256":"当前 scenarios.json 的 SHA-256",
  "scene_id":"S1",
  "case_answer":{"case_descriptions":[{
    "id":"已有 TC-ID 或尚未编号的候选别名",
    "source":{"file":"test/example.test.mjs","title":"真实测试标题","line_start":6,"line_end":8,"file_sha256":"完整文件摘要"}
  }]},
  "supporting_files":[{"file":"src/example.mjs","sha256":"必要依赖摘要"}]
}
```

也支持同结构的 `associated_tests`。必须提供实际声明，文件列表不足以证明用例存在；空关联不从 `test_files` 推断用例，也不代表整个仓库无测试。
`source_checkout` 默认为项目根，须有实际 Git HEAD；文件路径相对源码目录，拒绝越界和软链接。
`supporting_files` 仅列实际必要的 UTF-8 源码；不要直接复制包含编译产物的 `test_files` 清单。非 UTF-8 或含 NUL 字节的文件在调用 Evaluator 前返回 `unavailable`，不宽松解码或截短。
已有正式 `case_identity` 时核验原凭证；候选缺少永久编号只记录限制，不在此补造或写入 ID。
明确 `enabled:false` 时走 `off` 终态，不调用 Evaluator。

## 产物与判断

本机 `.acceptance-local/<AT>/workflows/case-assessment/<request>/` 保存输入、冻结场景/源码、提示词、真实原答及其摘要、候选、JSON/Markdown 评估和工具回执。
复用 [原评估契约](../contracts/case-evaluation-contract.md)，核对原文义务、逐目标反例、真实行号与连续引用；身份、真实声明和引用校验均使用 Node。
引用门禁只证明可追溯，不能等同于语义正确或执行通过。
回答无效、角色失败、引用或源码漂移时保存 `unavailable`，不自动重试、不给分数或产品通过/缺陷判断。
评估提示提供宿主生成的实际行号，冻结资料仍保留原始源码及摘要；引用校验继续核对原始字节，不因提示增加行号而放宽原文与长度要求。
同请求重入不再调用 Evaluator；重新检查定义、Git 和源码摘要。变化时返回当前不可用并保留历史原报告；评估最新代码须使用新请求 ID 和实际摘要。
当前 Node 视图展示与实际用例组匹配的独立意见；用例组改变时保留原意见并标记待更新。单独重评更新设计意见，不改产品判断或执行列表。

## 验证

```sh
node <repository>/tests/acceptance_case_assessment.integration.mjs --live-cli --output /absolute/evidence
```

协议夹具与真实模型分开。真实 Evaluator 检查 4/6 样本是否遗漏合法边界 5，并引用实际代码；同时核验无代码/场景改动、重入、关闭、错误引用、空组和旧评估适用性。
