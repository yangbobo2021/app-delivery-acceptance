# 项目覆盖率准备

目标是构建可供实际测试用例采集覆盖率的执行环境，或说明不能支持的具体原因和范围。
项目检查、必要运行准备、工具选择、适配代码、验证与内部修复都属于此工作流。
它不生成业务需求、场景或用例，也不产生产品通过结论。

## 普通调用

通过官方 `playbook run --with overlay.json --no-provision --json` 的 stdin 输入：

```text
/acceptance-coverage-prepare {"project_root":"/absolute/project"}
```

当前目录就是目标项目时，也可只输入 `/acceptance-coverage-prepare`。
角色、实际 Agent、模型及认证按[官方配置](independent-workflows.md#注册与调用)准备，不将凭据放入业务输入。

项目文档不能说明真实用例启动方式时，可补充 `execution_entry`，例如实际命令、工作目录或测试父进程启动产品子进程的关系。
`request_id` 可用于明确复用本次请求，省略时创建新准备。
`acceptance_id` 默认复用当前验收，没有时建立纯技术准备上下文，不虚构业务需求。
可提供 `source_checkout`、`revision` 指定实际版本，否则检查项目所属 Git checkout 和 HEAD。
当前实现使用 Git 隔离工作树，非 Git 项目会报告该运行前提缺失。
“完整验收”“一个场景”“发现实现问题后先不改代码”等由宿主选择和组合入口，不成为采集环境内部禁止修复的条件，见[职责边界](intent-inputs.md)。

## 工作流承担的工作

- 检查真实依赖、源码和测试入口，形成采集范围及运行方案，实际验证环境。
- 自主复用、安装或配置工具，生成必要适配器，按真实进程路径验证原生采集、读取及收尾。
- 将实际环境错误或程序核验失败的诊断交回内部 Agent 继续修复，不以修复次数决定是否允许处理。
- 返回实际验证的 `ready`、部分能力及限制的 `partial`，或有具体原因的 `unavailable`；认证、取消、资源预算等执行阻塞单独说明，不说成项目本身不支持。

准备数字来自成熟工具，零命中、没有采集及工具不支持的指标保持区别。
中间命令失败属于准备历史，不直接等于最终失败；成功仍需真实核验，不以 Agent 自述代替可用性。
适配及探针写入隔离工作树的测试目录，失败和修复资料各自保留。
项目输入默认总预算为 1800 秒，包含发现、运行资料及采集器核验；已有完整显式绑定的采集准备默认 900 秒。
实际需要时可显式提供 `preparation_timeout_seconds`（1–3600 秒）。
这是调用的资源边界，不是修复次数限制；停止时说明实际未解决原因。

## 已有验收的精确绑定

组合流程已有运行资料时，仍可显式提供 `project_root`、`acceptance_id`、`request_id`、`definitions_sha256`、`runtime_manifest/runtime_sha256`、`inventory_path/inventory_sha256`、`source_hashes`、`test_roots` 和 `policy:required`。
可补充实际进程事实 `preparation_instructions`、`expected_measured_sources` 或只读 `prior_attempts`，不重复发现仍有效的资料。
这些是机器交接能力，不是普通用户输入要求。
显式关闭使用 `policy:off` 及真实依据，不在准备失败后自动改为 off。

## 结果与记录

项目发现资料位于 `.acceptance-local/<AT>/workflows/coverage-inputs/<request>/`，运行记录由同 AT 的运行准备模块保存。
采集准备位于 `workflows/coverage/<request>/`，保留请求、`attempts.json`、命令、原答、原生数据及核验。
首个尝试在 `preparation/`，后续内部修复在 `repairs/<序号>/`；结果 `preparation_directory` 指向最终交接来源，不覆盖旧尝试。
成功的 `coverage.prepared/prepared_sha256` 交给项目及执行工作流使用。
同请求复用核对已有不可变资料；只提供项目时，也可重新核验当前验收中仍适用的就绪配置，避免重复发现和生成。
显式提供新 `request_id` 可发起新准备；源码或工具变更使旧环境失效时继续准备，不改写历史。
协议细节见[项目覆盖率协议](../contracts/project-coverage-protocol.md)。
