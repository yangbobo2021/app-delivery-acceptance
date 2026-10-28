# acceptance-storage: 验收身份、资料与恢复

## 意图

让同一项目的验收工作可持续接续、可校验和可共享，同时隔离本机状态及历史证据。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### acceptance-storage-1

当登记或接续验收时，资料存储应使用用户项目目录作为唯一资料根，在其中按稳定 AT ID 保存范围、定义和记录，拒绝在已有项目资料根之下或隔离 Git 工作树中新建另一份资料根。

### acceptance-storage-2

当同一人对某项目执行验收阶段时，宿主应核对配置 AT 与 .acceptance-local/current.json 的唯一当前 AT 一致，指针缺失或不匹配时在运行项目命令前停止该阶段。

### acceptance-storage-3

当保存验收资料时，存储应按用途区分共享定义及记录、本机运行资产和项目正式测试：

| 位置 | 用途 |
| --- | --- |
| .acceptance/<AT-ID> 及 .acceptance/knowledge | 可提交共享的范围、完整冻结定义、结果和索引知识；历史版本不可覆盖。 |
| .acceptance-local/<AT-ID> | 被Git忽略的环境、工作区、进程、原始运行及本机附件。 |
| 项目既有测试树 | 应纳入项目回归的正式测试、夹具和辅助代码；候选测试在集成前仍保留候选状态。 |

### acceptance-storage-4

当需要当前或历史定义时，资料读取应按已发布索引解析不可覆盖版本并核对内容哈希，不以文件修改时间、对话或当前浏览页面猜测有效版本。

### acceptance-storage-5

当准备、用例和复审阶段使用本次共享工作区时，宿主应串行保护 .acceptance-local/<AT-ID>/workspace 的使用归属，并在中断后保留归属记录，不能仅删除锁文件绕过恢复核对。

### acceptance-storage-6

当开始或恢复依赖项目知识的阶段时，宿主应读取分层 INDEX.md 可发现的适用资料并记录实读哈希，资料变化、索引断链或资产未登记时停止受影响交接并报告需核对项。

### acceptance-storage-7

当恢复被中断的任务时，宿主应核对存活进程、原始配置、AGENT/模型/服务与会话绑定、源码及测试修改和可能的外部副作用，仅恢复匹配的尝试，不以新会话自动重复未知效果的操作。

### acceptance-storage-8

当归档验收资料时，宿主应仅复制显式选择或结果协议要求的必要文件，保存原路径映射、内容哈希、归档时间和真实版本，不递归打包环境或全部会话。

### acceptance-storage-9

当持久化或共享验收资料时，流程应排除真实凭据、登录态及未经授权的业务私有数据；记录证据本身不授予上传、发送或全量复制业务数据库的权限。

### acceptance-storage-10

当整项验收结束时，宿主应先保存需求、范围、场景用例关系、实际版本、最近确认结论及未完成限制，再仅清除匹配 AT 的当前指针；结束操作本身不生成通过结论。

### acceptance-storage-11

当用户授权清理本机资产时，清理应先核对候选代码和必要结论已有可恢复副本，再删除所选本机资产，保留历史记录并标注缺失附件和不可复算范围，不破坏其他 AT 或共享 Git 对象。

### acceptance-storage-12

当读取旧协议历史产物时，读取流程应保留原字节、来源及原结论，对缺少的身份、审查和执行证据标明未记录，不自动补造或将其重新解释为新协议通过。

### acceptance-storage-13

当同一次验收增加或减少范围、涉及多个 PR、产品换版、补测或修复时，身份管理应保留同一 AT 并追加范围、版本和阶段尝试，不用新身份抹去已有事实。

### acceptance-storage-14

当一个场景开始实际运行时，执行环境应按准备记录为它建立隔离的可变业务状态，不能使用上个场景遗留的数据、会话或产物冒充本次前置条件。

### acceptance-storage-15

当完成单个场景、关闭对话或临时停放部分批次时，生命周期管理应保留整项验收的当前指针，直到满足整项验收结束条件 [[acceptance-storage-10](#acceptance-storage-10)]。

### acceptance-storage-16

当显式初始化或启动某个 AT 时，生命周期管理应拒绝替换另一活动 AT；指针为空时也只能使用明确指定的新建或既有身份，不按最近文件或浏览选择自动启动。

### acceptance-storage-17

当测试在隔离候选工作区中新增或扩展用例及 ID 注释时，宿主应将变更保留为可检查的候选代码，不在未经集成操作时静默写回原开发目录或声称已合入主干。

### acceptance-storage-18

当用户仅要求新建交付测试时，创建流程应通过独立入口在用户项目根保存稳定身份、真实创建依据、共享及本机目录和当前指针后停止，不要求预先提供业务范围，也不生成范围快照、冻结定义、场景、用例或执行结论。

### acceptance-storage-19

当同一创建请求被再次提交时，创建流程应仅在请求身份、参数、已有创建产物及当前指针均一致时返回原验收身份和可核对回执，冲突或不完整状态应明确阻塞而不覆盖已有文件。

## 验证

以下验证分别覆盖创建、存储及生命周期路径，不代表任一历史验收已全部完成。
历史测试报告不作为本包当前需求已经通过的证明。

### acceptance-storage-20

当验证仅创建交付测试时，集成测试应通过真实官方 CLI 核对仅创建产物及停止边界 [[acceptance-storage-18](#acceptance-storage-18)]、同请求重入和冲突拒绝 [[acceptance-storage-19](#acceptance-storage-19)]、不替换活动验收 [[acceptance-storage-16](#acceptance-storage-16)]、资料根限制 [[acceptance-storage-1](#acceptance-storage-1)] 及在同一身份中后续增加范围的兼容性 [[acceptance-storage-13](#acceptance-storage-13)]。

### acceptance-storage-21

当验证 Node 公共存储校验时，集成测试应读取真实旧协议目录并核对身份及当前指针 [[acceptance-storage-2](#acceptance-storage-2)]、冻结历史和归档字节 [[acceptance-storage-4](#acceptance-storage-4)]、分层知识实读与过期拦截 [[acceptance-storage-6](#acceptance-storage-6)]，并证明不通过 Python 执行校验。

### acceptance-storage-22

当验证 Node 归档与收尾时，集成测试应通过真实文件及官方入口核对选择性归档原字节 [[acceptance-storage-4](#acceptance-storage-4)]、先保存结束状态再清除匹配指针 [[acceptance-storage-10](#acceptance-storage-10)]、候选测试可恢复及其他 AT 不受清理影响 [[acceptance-storage-17](#acceptance-storage-17)] [acceptance_archive_view_lifecycle.integration.mjs](../../tests/acceptance_archive_view_lifecycle.integration.mjs)。

### acceptance-storage-23

当验证可复用知识发布时，集成测试应核对完整分层索引、文件基线冲突和可核验读取 [[acceptance-storage-6](#acceptance-storage-6)] [acceptance_knowledge.integration.mjs](../../tests/acceptance_knowledge.integration.mjs)。
