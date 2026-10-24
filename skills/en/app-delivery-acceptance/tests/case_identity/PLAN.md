# 关联用例永久身份验收

目标：测试 SKILL 实际采用的已有或新增测试能够在普通源码注释中保留永久 ID，从场景关联追溯到评估、正式执行、复审和结果视图。只验收本 SKILL 已关联的项，不声称枚举任意项目所有测试。

| 场景 | 验收依据 |
| --- | --- |
| 已有用例充分 | 复用原测试，只允许宿主 ID 注释；原正文、断言和实际行为不变 |
| 已有用例不足 | 保留旧贡献；补充的独立测试获得不同 ID |
| 没有已有用例 | 新测试有真实声明、唯一 ID、实际调试与正式执行证据 |
| 静态查找 | 可以关联并标记 ID，但状态仍为未执行；无关联不制造 ID |
| 跨场景、跨次验收 | 同一声明沿用 ID；未集成的候选只能按完全一致的位置与正文复用 |
| 标题、路径、断言变化 | 保留源码标记时身份不变；复制出的新测试不能沿用同一个 ID |
| 参数化测试 | 同一业务声明一个 ID，不把每个运行数据行冒称独立用例 |
| 差量修复 | 修复器保留旧标记；确实新增的测试分配新 ID |
| 引用与证据 | 插入注释后行号、连续原文和哈希正确；旧调试凭证不改写；正式凭证绑定最终字节 |
| 重复、错位、篡改 | 重复标记、无效定位、错误引用、额外断言/权限变化和错配凭证不能交接 |
| 通用源码处理 | Python、JavaScript、Shell 的真实命令；保留 BOM、CRLF、权限、shebang；支持目录或精确测试文件范围 |
| 展示及历史 | 弹窗显示 ID 与注释位置；评估短别名映射永久 ID；归档保留身份资料；旧记录不改写 |

## 执行方式

确定性协议测试包含 `playbook/v4/test_case_identity.py`、工作区范围及现有回归。原生调用使用调用者实际的 Agent/model/effort，在隔离夹具项目中执行，评判期望与变异放在 Agent 工作区外。项目语言只用于夹具，不进入 ID 分配算法。

可重跑入口：

```sh
ACCEPTANCE_AGENT=codex ACCEPTANCE_MODEL=<实际模型> ACCEPTANCE_EFFORT=<实际推理档位> \
  PYTHONDONTWRITEBYTECODE=1 python3 tests/run_case_discovery_forward.py --output <新绝对目录> --only python-ledger javascript-web shell-cli
ACCEPTANCE_AGENT=codex ACCEPTANCE_MODEL=<实际模型> ACCEPTANCE_EFFORT=<实际推理档位> \
  PYTHONDONTWRITEBYTECODE=1 python3 tests/run_case_reuse_forward.py --output <新绝对目录> --only accounts-a accounts-c settings-a web-session-a preview-a
ACCEPTANCE_AGENT=codex ACCEPTANCE_MODEL=<实际模型> ACCEPTANCE_EFFORT=<实际推理档位> \
  PYTHONDONTWRITEBYTECODE=1 python3 tests/run_case_identity_pipeline.py --output <新绝对目录>
```

正式复审允许如实得出用例需修复等结论。身份链路验收不把命令退出成功冒称为每个用例或产品验收通过。操作系统实测仅限本次报告实际列明的环境；无原生实测的系统不声称已支持。

精确文件范围和跨场景原生复测使用 `tests/run_case_identity_root_forward.py --output <新绝对目录>`，同样传入实际调用者的运行时环境变量。
