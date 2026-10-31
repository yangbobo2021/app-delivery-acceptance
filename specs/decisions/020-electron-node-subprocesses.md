# DR-020: Electron 宿主中的 Node 子脚本

## 状态

已接受，依据独立 SPEX 桌面主流程中实际出现的场景门禁超时。
补充 [DR-017](017-standard-host-player-port.md) 的标准宿主可移植性，不改变总调度、业务权限与证据边界。

## 背景

桌面端的 process.execPath 是 Electron。
工作流以它启动 Node 校验脚本却未指定 Node 模式时，脚本不能作为普通命令正常终止。
浏览器服务器和普通 Codex CLI 的 process.execPath 是 Node，因此此前两种入口没有暴露此问题。

## 决策

- 工作流只对自身的 Node 子脚本启用 Electron 既有的 ELECTRON_RUN_AS_NODE 模式；不改宿主全局环境、沙箱或项目执行器。
- 内部异步角色子进程和交给角色的确定性工具命令均携带必要模式，继续保留真实执行器、参数、退出状态与工具租约。
- 普通 Node 运行继续使用原命令及环境；父进程与其他项目命令的环境不因适配改变。
- 真实 Electron 主进程和普通 Node 的集成验证分别核对门禁、子命令退出、环境边界和工具授权；真实桌面业务主流程另存执行证据。

## 影响

SPEX 无需修改，包继续使用宿主已提供的执行器。
首次失败和任何未知效果保留，不通过删除租约或重放未知操作掩盖失败。

## 参考

- [Electron 环境变量](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)。
