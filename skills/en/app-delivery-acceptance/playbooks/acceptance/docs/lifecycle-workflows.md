# Node 生命周期、历史与报告

入口均通过 [标准官方命令](native-cli-boundaries.md) 加载 `workflows/<目录>/registry.mjs`。
所有 `project_root` 为用户资料根；只读查看/导出历史不需要把该 AT 启动为当前。

| 命令／目录 | 必要输入（除 project_root、acceptance_id） | 结果与边界 |
| --- | --- | --- |
| `acceptance-current` / current | 无 acceptance_id | 只读取唯一当前指针。 |
| `acceptance-start` / start | basis | 显式启动已存在 AT，拒绝替换另一活动 AT。 |
| `acceptance-project` / project | request_id、definitions_sha256、basis、runtime、revision、source_paths、test_roots；按实际提供 binding_files、coverage_test_files、components、coverage | 冻结真实运行环境及源码/工具清单，官方项目角色产出操作指南后停止。 |
| `acceptance-knowledge` / knowledge | request_id、basis、runtime={manifest,sha256}、files=[{path,base_sha256,text}] | 发布从实际环境验证中提炼的可移植 Markdown 方法及完整分层索引；逐文件检查基线和链接，拒绝本机状态/私有路径，保留前版副本。 |
| `acceptance-change-plan` / change-plan | request_id、definitions_sha256、basis、previous_definitions、execution_intent；可有 scene_ids、change_review | `follow_history`、`complete_change_acceptance`、`design_only` 只产出选择，不执行。 |
| `acceptance-rebind` / rebind | request_id、definitions_sha256、basis、catalog、case_input、case_answer、source_checkout、revision；组件显式列出 | 保存旧候选字节，不强制覆盖地切换新修订，保留 TC，要求新 runtime/coverage/project 绑定；不直接判断产品。 |
| `acceptance-recover` / recover | request_id、attempt、action、basis；涉及未知效果时 external_effects={status:none_proved/reconciled,basis} | inspect 只检查；reconcile 采用可核验的已完成命令或角色产物；失败角色不能仅凭根会话 ID 重试。显式核查副作用后 supersede 保留资料并释放归属。活进程或进程组阻塞，缺收据不自动重跑。 |
| `acceptance-manual-execute` / manual-execute | request_id、definitions_sha256、scene_id、basis、product_version、evidence_root、operations | 冻结已实际发生的动作、原始观察/截图，独立图片复审；没有操作不宣称已执行，不制造退出码或代码覆盖率。 |
| `acceptance-delivery-judge` / delivery-judge | request_id、definitions_sha256、basis、target_ids、revision、scope_exclusions；可有 pr_reference | 独立核对选定完整需求/PR，缺必要场景/义务、同版本结论或存在设计缺口时不能整体 passed。 |
| `acceptance-risk` / risk | request_id、definitions_sha256、scene_id、finding_reference、finding_sha256、user_quote、source_reference、remaining_impact、confirmed_at | 保留已知技术发现及真实用户接受决定；不改原复审。 |
| `acceptance-source-status` / source-status | request_id、definitions_sha256、ref（requirements:R1 等）、locator、revision、status、basis、source_reference、observed_at | read_failed / deletion_confirmed 分开记录；不删原义务。 |
| `acceptance-coverage-recompute` / coverage-recompute | request_id、basis、reports=[{path,sha256}] | 成熟工具重新校验和统计兼容原生报告；记录真实命令/输出，不运行用例，不改业务结论。 |
| `acceptance-view` / view | 可选 port | 只读 Node 服务，返回本地 URL/PID；页面选择不改执行指针。 |
| `acceptance-report` / report | request_id、basis | 生成冻结 report.html、snapshot.json 和被链接的必要证据；不运行测试。 |
| `acceptance-archive` / archive | request_id、basis；显式 files、results、coverage_reports 至少一类 | 选择性共享归档，保持原字节、路径映射及哈希；原生覆盖率归档保留离线依赖和工具统计快照。 |
| `acceptance-finish` / finish | request_id、basis、unfinished_limits、allow_unfinished | 先保存完整结果/未完成限制，再清除匹配指针；本操作不新造通过。 |
| `acceptance-cleanup` / cleanup | request_id、basis、assets、archive_record、missing_attachment_limits；清工作树时 candidate_test_roots | 只清明确选定且不活动的本机资产；先校验归档与候选测试可恢复副本，不复制整份产品源码作备份，不动其他 AT。 |
| `acceptance-backfill` / backfill | request_id、definitions_sha256、basis、source_reference、selected_refs、convention、authorized_paths；默认 SPEX 还需 language、agents | 沿用现有组织；确无适用规范才真实 scaffold。官方只读角色给出文档补丁，Node 验证路径/原文/映射，实际 lint，返回单独冻结候选。 |

`operations` 每项记录 action、purpose、input、expected、observed、performed_by、performed_at、receipt_reference、outcome（observed_success / observed_failure / uncertain）及 evidence=[{path,sha256}]。
整体交付复审保留完整冻结视图作为审计资料；角色输入使用另外保存的 `prompt-input.json`，完整保留选定目标原文、所有纳入场景、实际用例、当前独立发现和覆盖率限制，去除重复视图、完整引用正文、图片路径列表及原生采集明细。不能通过截断需求、丢弃场景或隐藏失败来满足输入长度。
明确区分实际人类动作与工具执行的黑盒动作，不能把脚本测试说成人工已完成。

`convention` 包含 status（existing / none_confirmed）、basis、实际读过的 files。
回填只允许显式普通文档路径，不改产品、meta 规则或验收资料目录。
SPEX scaffold 的 LICENSE 与所选 Agent 指令属于真实锁定工具的输出，命令、stdout/stderr 和文件清单完整记录；已有内容不受无关改写。

每个修改请求使用新 request_id，重复请求核对原输入/不可变字节后复用；失败/不完整尝试保留，不覆盖为成功。

知识发布必须同时提供受影响的各级 INDEX.md（已有文件使用当前 SHA，新文件显式 null），不跳过层级。
方法应写明适用条件、真正验证的步骤和限制；旧通过收据、安装目录或秘密不能成为共享方法。
遇到知识发布活跃/不确定声明时，读取被阻止；检查本机知识尝试中的 candidate、previous、input 和声明归属后再显式处理，不删除声明盲重跑。
