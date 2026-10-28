# 独立运行环境准备

`/acceptance-runtime` 通过官方 Playbook CLI 的独立 `preparer` 角色提出声明式计划，由宿主实际执行安装、执行器版本和可重复的轻量 smoke，验证后停止。
入口：`workflows/runtime/registry.mjs`；注册见 [独立入口](independent-workflows.md)。
它不执行业务用例、不判断产品、不选覆盖率工具，也不自动发布知识。

## 显式交接

除当前项目、AT、请求 ID 和定义摘要外，提供实际 `source_checkout`、不可变 `revision`、项目 `test_roots`，以及 `inspection_files` 中的真实依赖清单、已有测试入口及准备说明。
`available_executables` 可列 `{name,path}`，路径须为实际绝对可执行文件；角色据项目资料选择，不预设语言。
可交接原协议的 `components`、`component_sources` 和已索引 `knowledge_paths`。
本次 AT 唯一工作树创建在 `.acceptance-local/<AT>/workspace`；不会在用户原源码树安装依赖。
必要项目资料完整交给角色，当前上限 500000 字符；缺少实际资料或超限时明确报告限制，保留原入口。
选择实际业务测试入口及必要依赖；旧覆盖率适配器的机器绑定配置由后续覆盖率准备负责重新绑定，不应代替本阶段的真实业务入口。
尚无既有测试时，先依据真实产品入口和依赖准备运行环境，以导入、版本、帮助、构建或无业务断言的启动检查验证实际路径；不要求先生成用例，也不猜测测试框架。产品入口或依赖本身不明时仍须明确报告缺口。

角色返回 `dependency_files`、`knowledge_used`、`setup_commands`、`executables`、`smoke` 和非空 Markdown `recipe_candidate`。
命令为 argv，路径仅支持 `{workspace}`、`{runtime_root}` 占位。参考 [原运行准备规约](project-runtime-preparation.md)。
角色不自行执行命令；Node 宿主保留原答，核对工作树字节和权限未变，再实际执行计划，失败保留首次日志，不将命令退出成功当作环境就绪。

## 产物与复用

`.acceptance-local/<AT>/workflows/runtime/<request>/` 包含冻结绑定、实际资料／知识、提示词、原答及摘要、计划、工具命令输出和 `runtime/runtime.json`。
运行清单绑定实际 workspace、依赖字节、平台、执行器路径／哈希／版本、setup/smoke 退出码及日志、recipe 候选。
源码和非忽略文件变化、依赖或执行器失配、smoke 失败时不发布流程就绪结果。
相同请求复用时不再调用角色或安装；实际复验版本和 smoke，并在工具命令日志追加本次复核回执，原 runtime 清单和首次日志字节不变。
复验失败返回 `stale` 并保留历史 ready 事实，不能将其作为当前环境就绪。
该入口的工作树准备、知识及定义守卫、实际 setup、版本、smoke 和运行验证已迁为 Node；项目自身需要什么解释器由项目真实依赖决定。业务入口、执行、归档和报告均使用 Node；Python 项目夹具的解释器属于项目测试依赖。

```sh
node <repository>/tests/acceptance_runtime.integration.mjs --live-cli --output /absolute/evidence
```

已测试真实项目 setup 和 smoke、实际执行器、隔离安装、失败日志、源码保护、不同 AT、复用与真实官方角色调用；这是 macOS 的 Codex/gpt-6.1-sol 前向测试，不代表其他 Agent／平台全部验证。
