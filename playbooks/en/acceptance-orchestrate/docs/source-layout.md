# 源码组织与职责

```text
Skill/
├── SKILL.md                       # 对话理解、授权、来源；只委托总调度
├── scripts/setup.mjs              # 可选接入便利，只调用包的依赖准备
└── playbooks/acceptance/           # 可单独 npm pack/install 的完整包
    ├── bin/configure.mjs          # 全部注册与角色配置生成
    ├── workflows/orchestrate/    # 总调度公开入口、角色及持久化任务委托
    ├── workflows/<workflow>/     # 独立子入口、stage、角色、合同和专用工具
    ├── workflows/shared/         # 实际跨工作流共用的业务基础机制
    ├── tools/                    # 多工作流共用确定性工具入口
    ├── contracts/                # 多工作流共用的输出、证据合同
    ├── runtime/                  # 官方端口交接、依赖核对、服务身份
    ├── docs/                     # 全部公开输入、停止点和业务规则
    ├── vendor/                   # 本地官方运行时构建、源码补丁及版本依据
    ├── package.json
    └── npm-shrinkwrap.json
repository/tests/                  # 开发验证；不随 Skill/运行包分发
```

包内无对 Skill 外层资源的反向读取，没有按历史版本并存的调度器或必需的私有 CLI 包装器。角色经官方 Player 端口，工作流通过标准 Playbook CLI 完整调用。runtime 是可跨被测项目复用的已安装实现；每个项目产生自己的 AT、工作区、运行环境和证据。
