# 项目覆盖率准备与通用协议

覆盖率工具选择是项目测试准备的职责。根据实际语言、框架、编译链、运行进程和测试入口选择成熟工具，在项目测试树中实现配置与调用适配，并实测其采集、零命中单位、导航/子进程和可靠收尾能力。不能因为 Skill 未附带某语言实现就结束准备；确实无法采集时保存实际尝试与具体缺口。

通用 Skill 不注册语言、工具品牌或项目类型白名单，也不推断产品入口。它验证冻结输入、目录、工具来源、执行收据、场景/版本关联与证据字节，再调用项目入口。项目适配只可调用成熟工具、管理生命周期、转换格式/路径和绑定证据；覆盖率单位识别、命中、分母、合并和统计仍由专用工具完成。具体工具和依赖、夹具导入、命令、源码分类及支持范围属于项目准备和项目知识，不写进通用 Skill。

## 准备产物

项目准备命令自行选择，输出新的 `prepared/prepared.json`，schema 为 `project-coverage-preparation-v1`：

- `entry`：项目测试树内冻结适配器的 argv；由宿主追加操作名、request JSON 路径、response JSON 路径。不使用 shell 插值。
- `adapter_files`：项目相对路径到 SHA256 的映射，包含适配器、必要夹具、配置及锁文件。入口至少包含其中一个文件。路径和实际解析目录都不得逃出项目。
- `tools`：实际验证过的 `{name, version, role}`；准备资料记录实际命令/API及官方文档依据。安装包名称或版本标签不能代替验证。
- `spec.project_root / revision / components / source_hashes`：实际执行工作区、完整冻结版本与全部源码范围。静态资源仍在清单内。
- `spec.inventory_path / inventory_sha256 / registry_path`：不可变范围清单及其摘要、持续证据索引。
- `source_dispositions`：逐一覆盖源码清单，说明 `measured / non_executable / unsupported` 及具体依据，不能删掉不支持的范围。
- `preparation_evidence`：真实工具链探针、原生零命中单位及配置等 `{path, sha256}`。合成探针仅证明工具能力，不能作为业务验收或业务覆盖率。
- `artifact_aliases`：为归档预先保存的源码、适配器及离线复算必需的构建产物副本。原绝对路径必须位于项目根目录内，映射到 workflows 内的冻结副本；值可为路径字符串，或 `{ "path": 绝对路径, "sha256": 哈希 }`。源码/适配器副本必须与冻结清单同哈希；其他构建产物必须采用带哈希描述并在归档时复核。不得复制运行依赖、密钥或业务数据库。
- 若项目工具只有其他原生口径（例如语句、块等），可在 component 中用自定指标名保存 `{ "status": "measured", "label": "口径名称", "tool_output": "原生工具输出" }`；通用视图按名称原样显示，不把这种统计换算为行或分支覆盖率。行、分支及三个范围仍按各自证据报告 `unavailable` 或 `incomplete`，不从原生百分比推导。

每次改变源码、工具、适配器、配置或统计范围都新建准备目录与 catalog，保留旧资料。prep spec 的 `coverage_test_files` 声明所有适配器及必要测试夹具；宿主冻结哈希并自动绑定到每次调试和正式执行。

激活准备前，项目还须用一个隔离的非零命中探针穿过**同一项目适配器**的 `run → finish → verify-report → summarize`，把适配器报告与专用工具对同一原生数据的直接结果逐项对照，包括源码路径、行、受支持的分支及三个范围。零命中探针单独保留；只证明采集器能启动或子进程有数据，不足以证明适配器的路径转换、合并和报告正确。探针输入、原生数据、两份结果、命令和退出码作为准备证据冻结；发现矛盾时保留首次报告，新建适配器及准备版本后复测，不发布该报告为 `measured`。这是项目准备的验证，不把探针当业务用例，也不指定语言或工具。

catalog 的 `coverage` 使用：

```json
{"policy":"required","protocol":"project-coverage-v1","prepared":"/absolute/new-prepared","prepared_sha256":"<manifest SHA256>","inventory_path":"/absolute/frozen-inventory.json"}
```

`prepare_project.py` 调用项目验证入口并激活策略。场景继承配置，旧模板不得降级或替换绑定。先结束仍使用旧准备的活动执行，再激活新准备；不修改旧 catalog 或报告。

## 项目入口操作

所有操作读取 request JSON、写 response JSON，失败返回非零退出码。请求包含 `artifact_map` 时，只读处理使用指定同哈希归档副本，不改原报告内的路径或字节。

| 操作 | 请求与响应 |
| --- | --- |
| `verify-preparation` | 请求 `prepared` 指向 manifest 文件；实测准备能力、版本与冻结资料，响应 `status: valid`。 |
| `run` | 请求为宿主冻结的执行会话，含 `cwd, output, scene_id, command, env, files, coverage, prepared, prepared_sha256`。以成熟工具运行原业务命令，保持业务断言和退出码，在本轮输出内保存原生数据并可靠收尾。 |
| `finish` | 请求 `request, receipt, output`，分别指冻结会话、真实收据与输出目录。生成下面的规范化报告。不能把测试失败变成成功。 |
| `verify-report` | 请求 `report`；从绑定原生资料用相同专用工具重算并核对报告，响应 `status: valid`。不能只检查汇总 JSON 自身。 |
| `summarize` | 请求 `reports, inventory`。检查兼容性后由专用工具合并和筛选，响应 `tools, scopes`；三个 scope 为 `project, changed_files, changed_lines`。 |

宿主入口始终为 `run_evidence_v2.py --coverage-config <配置> ... -- <业务命令>`，本地调试也走同一链路。直接补采可使用 `run_coverage.py <request.json>`；仍须 acceptance、同一工作区、实际场景、测试文件与输出绑定。每次使用新输出目录。业务失败的可靠计数仍可登记；没有执行收据、版本不符或来源错误不能登记。

## 报告与统计

`coverage-report.json` schema 为 `project-tool-coverage-report-v1`，protocol 为 `project-coverage-v1`。必需 `prepared, prepared_sha256, scene_id, revision, source_hashes, tools, collection_relation: same_run, status, receipt_path, execution_sha256, raw_evidence, components`。收据必须绑定实际覆盖率会话及其 SHA256，场景、版本、准备和执行 argv 必须一致。原生数据逐一记录 `{path, sha256}`；适配器可增加原生数据角色等元数据。

每个 component 包含 `id, label, source_paths, line, branch`，源路径必须属于冻结清单。行和分支分别保存工具给出的 `status, covered, total, pct`；不能计算的指标保存 `status: unavailable` 和具体 `reason`。禁止通用脚本或 UI 自行构造覆盖率单位与统计数字。混合语言保留各自 component 和分支口径，无法可靠合并时不制造总百分比。数据缺失、强制终止或收尾丢失必须明确 `incomplete`，保留真实已采部分及缺口。

`summarize` 返回每个 scope 的 `status` 及工具汇总的 `components` 或 `line/branch`。不支持某范围时返回具体原因，不用全项目数字充当修改行统计。范围来源必须与准备的 inventory 一致。首个提交的全部源码确实均为新增时，可记录该依据并使用原生全文件统计；这是项目适配决定，通用 Skill 不作此假设。

持续索引对同一准备按场景选最新有效采集，保留旧条目。采集不新增业务结论，不改变场景分母，不把旧 `unavailable` 记录改成实测。视图每次验证来源，统计缓存不能绕过收据、探针或范围变更校验。

## 归档与展示验证

`acceptance_store.py archive <项目> <ID> --source <本ID/workflows下共同父目录> --coverage-report <报告相对路径> --basis <已筛选脱敏依据>` 是显式覆盖率发布配置，可重复指定报告。程序验证后只选取报告、manifest、原生数据、准备证据、真实收据/日志、会话、inventory 和同哈希冻结源码/适配器；不扫描运行目录。索引快照和其他已审阅资料使用 `--files` 明确列出。依赖越出 source 或缺少冻结适配器副本时先拒绝，再修正准备/发布目录，不能扩大成递归打包。

正常 v4 验收可用 `archive <项目> <ID> --source <共同workflows父目录> --v4-scene <场景相对目录> --basis <已筛选脱敏依据>` 一次发布最终复审元数据及其同次原生覆盖率。程序从 summary → 最终 review/input → 对应 coverage wrapper 自动确定返工后的真实报告，并核对报告和收据哈希，不按目录名猜轮次，也不误选首次执行。旧 `--v4-result` 仍只发布固定元数据；独立补采使用 `--coverage-report`。两种新选项均不递归打包所有调试或业务状态。旧验收/原生资料字节、哈希、时间和业务结论均保留。

覆盖率补采不需要伪造 trace。现有 `project-context.json` 的 `acceptance` 与 `coverage_registries` 可登记补采索引，视图只把通过来源校验的真实采集附到同场景、同版本业务行。完整场景清单仍是统计分母。验证包括实际浏览器页面、三个范围、行/分支、工具版本、旧业务结论保留，以及暂移原采集目录后从归档同哈希依赖读取；验证后恢复目录，不删除旧证据。

旧 `istanbul-source-v1` 的实现与报告保留在明确的 legacy 路径，仅用于已存在的准备/历史读取。新项目使用本协议，不把旧示例当作工具选择白名单或必备运行时。
