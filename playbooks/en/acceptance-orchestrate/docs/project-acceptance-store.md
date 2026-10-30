# 验收资料与存储边界

使用用户项目目录作为唯一资料根。项目 A 与项目 B 各自保存定义与执行数据，不共享当前 ID、工作区或机器就绪收据。

```text
<user-project>/
├── .acceptance/
│   ├── knowledge/INDEX.md       # 项目内跨验收的已审查方法
│   └── <AT-ID>/
│       ├── manifest.json       # 稳定验收身份
│       ├── creation.json       # 用户创建依据
│       ├── scope.json          # 当前范围指针
│       ├── scenarios.json      # 当前完整冻结定义
│       ├── tests.json          # 实际永久 TC 与场景关联
│       └── records/            # 不可覆盖版本、筛选归档和决定
├── .acceptance-local/          # 必须实际被 Git 忽略
│   ├── current.json            # 唯一当前验收指针
│   └── <AT-ID>/
│       ├── knowledge-reads/    # 带哈希的知识读取凭证
│       ├── workspace/          # 本 AT 唯一可变隔离源码工作区
│       └── workflows/          # 各过程的新请求、执行和证据目录
└── <existing test tree>/       # 项目正式测试；候选变更先留在隔离工作区
```

仅创建时没有 scope、scenarios、records 或 workspace；后续由冻结和实际准备逐步建立。不要预造空需求，也不以打包 Skill 的安装目录承载项目数据。

生命周期经官方 CLI 的 `acceptance-create/current/start/freeze/knowledge/archive/finish/cleanup` 执行，具体输入见[创建](create-acceptance.md)、[独立入口](independent-workflows.md)及[生命周期](lifecycle-workflows.md)。没有隐式旧工具退路。

共享存储实现位于 `workflows/shared/store.mjs`，严格门禁为 `validation.mjs`；冻结入口在 `workflows/freeze/`。所有依赖范围的阶段核验当前 AT、不可变范围链、完整定义版本、知识索引/凭证、来源目录和当前工作区租约。符号链接、跨 AT 输出、状态不明的锁、过期基线或失配证据必须阻塞，不能自动覆盖恢复。

共享知识使用分层 INDEX，全部资产有索引和实际哈希，支持 `project:` 关联项目工具。知识只保存可复用方法，不保存本机环境、令牌、业务数据库或本轮结果。新电脑仍须重新准备环境并实际 smoke。

归档按显式清单筛选、保存原路径映射及文件哈希；报告与视图独立读取当前记录和已有历史记录，不运行旧引擎，也不为缺失证据补造通过。结束当前 AT 只清除匹配指针；清理是另一个需明确范围的过程，不由场景完成或关闭对话触发。
