# 独立覆盖率准备与修复

当用户只要求准备或修复采集器时，调用 `/acceptance-coverage-prepare`，在准备后停止，不启动场景设计、用例或产品测试。
注册模块为 `workflows/coverage/registry.mjs`。
先用[独立运行准备](runtime-workflow.md)获得同 AT、同版本的真实运行环境。

## 显式请求

```json
{
  "project_root": "/absolute/user-project",
  "acceptance_id": "AT-example",
  "request_id": "coverage-prepare-1",
  "definitions_sha256": "<current scenarios.json SHA-256>",
  "policy": "required",
  "basis": "用户要求准备采集链，暂不运行用例。",
  "runtime_manifest": "/absolute/this-AT/workflows/runtime/attempt/runtime/runtime.json",
  "runtime_sha256": "<runtime manifest SHA-256>",
  "inventory_path": "/absolute/this-AT/workflows/inventory.json",
  "inventory_sha256": "<complete inventory SHA-256>",
  "source_hashes": {"project/source": "<same frozen inventory digest>"},
  "test_roots": ["project/tests"],
  "expected_measured_sources": ["project/source"],
  "knowledge_paths": []
}
```

`source_hashes` 必须与完整冻结 inventory 同名字段一致。
写入目录属于运行环境已验证的测试目录；组件版本从运行环境派生，显式提供 `components` 时必须一致。
`off` 只用于用户明确关闭；`unavailable` 记录实际原因，两者均要求非空 `basis` 后停止。
已有工作区启用过必需采集时，明确 off 会在独占边界记录实际关闭策略并保存前后策略；旧必需 catalog 不能继续执行，须交接当前关闭决定。重新启用后旧 off 回执仅为历史，不表示当前仍关闭；采集失败或不可用不会隐式触发这种策略变更。
修复使用新的 `request_id`，并用 `prior_attempts` 提供同 AT 本机资料内的既有准备目录；前次资料只读。

## 执行及通过依据

1. 核对当前 AT、定义、完整源码、运行时与知识，取得本 AT 独占工作区声明。
2. Node 工具通过官方 CLI 的独立 `coverage_preparer` 角色检查项目后端、选择成熟工具并提出计划；宿主生成固定协议入口和唯一工具绑定，先实测工具名称与版本。
3. 宿主冻结项目后端与固定协议代码，用 Node 执行每路由的新零命中、非零命中探针，核对适配器与专用工具对同份只读原生资料输出一致。
4. 冻结准备并执行实际 `verify-preparation`，保存 `ready / partial / blocked` 和限制后停止。

这不代表业务覆盖率或产品通过。
同请求重入只校验已有绑定，资料变化返回 `stale` 并保留历史，不自动重跑。
更改采集器后另建准备及下游 catalog，不把旧执行改绑到新准备。
完整工具约束与激活方式见[项目覆盖率协议](../contracts/project-coverage-protocol.md)。

## 证据

`.acceptance-local/<AT>/workflows/coverage/<request_id>/` 保留请求、实际命令与输出、工作区基线、原答与 CLI 会话、每次宿主检查、探针收据、原生数据、冻结副本及准备回执。
`backend-binding.json` 和 `tool-check.*` 记录通用入口、后端命令及真实工具核验；失败诊断包含操作、路由、命令、退出码和原始异常，不将空断言当作完整原因。
核对实际退出码、原生哈希、零/非零输出、旧失败保留及业务测试未运行，不仅依据角色自报或命令成功。
Node 不自行识别覆盖单位或计算分母。
该入口的身份、知识、运行时、探针及准备协议校验已使用 Node；正式采集、原生资料复核、注册和专用工具汇总也已提供 Node 工具。项目本身的覆盖率工具仍按项目真实依赖执行，例如 Python 项目使用 coverage.py；Skill 正常业务调度与校验不依赖 Python；被测 Python 项目及 coverage.py 自身仍需要项目的 Python。
服务与标准命令的范围见[运行边界](native-cli-boundaries.md)。
