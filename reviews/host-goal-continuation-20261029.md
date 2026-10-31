# 宿主推动工作流接续：真实单场景验证

本次更新 Skill 接续指引、公开调用说明和规约，保留独立工作流入口；没有新增 Skill 业务调度脚本或修改 Playbook 执行引擎。

起点是实际返回 blocked 的验收 `AT-coverage-3cdd05a0-78a1-4ec1-8f83-a6e2bee5ec84`：真实 CLI 用例已通过本地业务断言，但原采集器没有跟踪产品子进程。
同一源码修订 `be952659c7d93018e26793daf2e58fa8321601f4`、同一场景 `INV-03-S01` 和永久用例 `TC-cdea252f-0d77-43db-ab8b-ab5c0223ddbf` 在 macOS 上以 Codex、gpt-6-sol、high 继续执行。

| 公开调用 | 实际结果 | CLI 用时 |
| --- | --- | --- |
| recover inspect → supersede | 原进程均结束，保留旧尝试并释放场景归属 | 17.7 + 18.8 秒 |
| coverage-prepare | 复用原 runtime，修复父→子进程采集；完整生命周期核验 passed | 416.9 秒 |
| project | 绑定新 profile，保留同一源码和运行环境 | 113.3 秒 |
| cases existing_only | 复用原 TC，真实调试和独立设计评估完成 | 328.5 秒 |
| execute | 真实业务和覆盖率通过；独立复审提出额外顶层字段断言偏严，repair_required | 101.8 秒 |
| cases implement | 根据明确复审反馈仅修补一行断言，原 TC 保留，真实调试通过 | 233.0 秒 |
| execute | 新的正式运行和独立复审 passed | 120.9 秒 |
| report → archive | 保存实际结果、首次复审及原生覆盖率依赖 | 25.1 + 21.1 秒 |

用例修补阶段未重复静态设计评估；其真实调试后由新的正式 Reviewer 独立检查。
最终业务输出为 `totals={A:35,B:7}`、`row_count=3`，退出码 0，stderr 为空。
本次运行包含父、子两份原生覆盖率快照，产品行命中 34/44、分支命中 7/14。
产品源码与冻结定义不变，原 blocked 回执、旧 profile、首次 repair_required 和修补前测试字节均保留。

可复核原始资料目录：`/Users/boboyang/Documents/Codex/2026-10-26/opencode-opencode-glm-5-3-flash/outputs/host-continuation-20261029-01/`。
该目录包含逐调用输入、官方命令与 stdin、stdout/stderr、原生会话读取记录、开始结束和回执，以及分四步展示的 `report.html`。

核验命令：

```sh
node tests/host_goal_continuation.audit.mjs --evidence /absolute/host-continuation-20261029-01
```

12 项实证核验通过，覆盖公开 CLI、恢复、修复交接、重绑定、身份保留、正式复审、原生资料哈希、产品与原始资料不变和实际角色会话隔离。
Skill quick_validate、SPEX lint、JavaScript 语法检查和 git diff --check 通过。
验证范围仅为此宿主实际推动的一条真实单场景链路，不代表所有项目、Agent 或未来宿主决策已全面验证。
