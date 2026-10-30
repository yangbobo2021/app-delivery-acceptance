# 仅创建交付测试

用于“新建一个交付测试”：创建容器后停止，不提前冻结需求或启动场景、用例、项目环境和覆盖率准备。
需求已经给出但只要求新建时，宿主后续单独安排冻结；这个入口不解释或冻结业务需求。

## 调用与输入

宿主根据当前对话确定用户项目根，把创建请求显式交给官方 Playbook CLI；该 CLI 不会自动读取宿主对话上下文。
使用独立包锁定的官方 Playbook 本地构建，版本及来源见[运行时边界](native-cli-boundaries.md)，注册模块为 `<package>/workflows/create/registry.mjs`。

在已有可用 Playbook 配置上叠加一个临时 JSON 配置，不修改全局配置：

```json
{"playbooks":{"acceptance-create":{"from":"<package绝对路径>/workflows/create/registry.mjs","roles":{}}}}
```

通过 stdin 传入一个完整 Boss 消息，命令为：

```text
<package>/node_modules/.bin/playbook run --with <overlay.json> --no-provision --json
```

stdin 示例：

```text
/acceptance-create {"project_root":"/absolute/user-project","request_id":"create-request-unique-id","user_request":"新建一个交付测试"}
```

- `project_root` 必须来自用户项目上下文，不能选隔离工作树或已有资料根的子目录。
- `request_id` 由宿主为这次创建生成一次，重试保持不变；`user_request` 保留创建依据，不包含密钥。
- `acceptance_id` 可选；未提供时由 `request_id` 稳定派生 AT ID，不要求用户手工命名。
- `title` 可选，默认“交付测试”；`owner` 可选，默认实际本机账号名，不推断业务负责人。
- 未声明的字段被拒绝；不接收 scope、场景或用例参数。

创建工作流没有 Worker/Reviewer 模型角色，文件操作由 Node 完成。
官方 CLI 仍使用已配置的 Captain，在创建结束后调用 Captain 生成回复，不能承诺完全不调用模型或离线运行。
创建及后续独立业务入口均采用 Node；分发中没有旧 Python 调度工具或对照执行入口。
先执行 `node <package>/runtime/dependencies.mjs`，按独立包的锁文件准备并核验依赖；安装位置为 `<package>/node_modules`。

## 文件与停止边界

```text
<project>/
  .gitignore                                  添加本机目录忽略规则（已有规则不重复）
  .acceptance/
    knowledge/INDEX.md                        缺失时创建，已有内容保留
    <AT-ID>/manifest.json                     身份、标题、本机账号、创建时间
    <AT-ID>/creation.json                     用户原话、请求身份、仅创建停止原因
  .acceptance-local/
    current.json                              唯一当前 AT
    <AT-ID>/creation-result.json               文件清单、身份哈希及本机回执
```

短暂的 `.acceptance-local/current.lock.d/owner.json` 由 Node 创建和生命周期入口共同遵守，正常退出时移除。
进程异常死亡遗留的锁不自动删除，先检查 owner 中的 PID 和当前资料；不凭超时猜测可以重复执行。

此时状态为“已创建，范围未定义”，不生成 `scope.json`、`records/scope-*.json`、`scenarios.json`、测试文件、工作区或执行结论。
成功依据是工作流 `created` 终态、实际文件、指针和身份哈希一致；CLI 的 `sessionId/reply` 仅是调用回执，不代替文件核对。
相同请求重入返回 `already_created`，不重写原文件；存在另一活动 AT、参数冲突、身份损坏或不完整状态均阻塞。
如果 Captain 回复生成失败，但创建文件已写完，先核对本机回执，再用同一请求重入，不另建 AT。

## 后续在同一 AT 增加真实范围

用户要求冻结或验收时，先通过 `/acceptance-current` 确认当前 ID，再调用 `/acceptance-freeze`，按[冻结输入](independent-workflows.md#冻结请求)提供真实原文、来源和首次 `base_definitions_sha256: null`。工作流为同一容器建立范围版本 1 和不可覆盖定义快照后停止，不生成场景。没有真实范围时，依赖范围的阶段继续阻塞。

## 验证入口

```sh
node <repository>/tests/acceptance_create.integration.mjs --output /absolute/evidence-directory
```

默认检查确定性创建、冲突、并发保护及当前 Node 存储合同；加 `--live-cli` 才使用真实官方 CLI 和本机已配置的 Codex/GPT-6.1-Sol Captain，保存每次调用的输入、stdout、stderr、退出码和会话记录。
验收在临时项目中执行；不触碰用户当前验收指针，也不运行产品测试。
