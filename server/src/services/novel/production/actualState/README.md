# 最终保留稿的实际状态提交

## 所有权与恢复

`ChapterActualStateService` 只在当前章 production session 中运行。保存正文、完成审查、提交实际状态是不同事实；资产失败不能把正文标成未生成，也不能把旧状态带入下一章。`ChapterContentFinalizationService` 对质量债保留稿同样同步真实状态，`mustHitNow` 计划义务不作为生产路径的事实来源。

外部 timeline / artifact delta / 必要的 payoff reconcile 分别先持久保存结构化结果，再进行本地写入。外部结果未知由 journal 暂停，不自动补发。8 类 delta 消费者（摘要事实、状态快照、资源、伏笔、角色关系、知识、心智、对话影响）共享同一事务；任一写入失败全部回滚，提取结果仍可恢复。timeline 事件、锚点、钩子与其检查点共享事务。质量检查不通过不会把时间线提取降成空锚点；其真实事件照常提交并保留质量债。

完成 boundary 在必要对账和关键提案核对之后写入，与 journal 完成步骤同事务。源工作区收到状态提交失败后显示已保存正文，不得继续下一章或重新写稿。

## 事务适配图

`transactionContext.ts` 仅供下面这组资产适配器使用，不替换全局 Prisma：

- runtime delta / timeline finalizer，timeline repository；
- StateService / OpenConflictService；
- StateCommitService / CanonicalStateService / StateVersionLog；
- NovelFactService、CharacterResourceLedgerService / StaleScan / Validation；
- CharacterMindService、PayoffLedgerSyncService。

进入 `session.commitState` 后，`runInActualStateTransaction(tx, callback)` 把这些适配器的本地事务复用为当前 tx，不另起事务。模型、RAG排队及网络调用不得放入 callback。外部模块只从本目录 index.ts 使用端口；工厂延迟加载避免资产模块之间初始化循环。

旧后台入口发现当前章有 production journal 时拒绝自行同步。兼容资产消费者的写事务还会检查 journal，阻止早于章级执行启动的旧任务迟到写入。

角色时间线手动同步只处理未受 journal 管理的章节；初始筛选与写事务复核共同保护已管理章节，旧名字匹配入口不能新增或覆盖其实际事实。同正文 hash 的显式新操作使用新的资源提案 operationId，不能继承旧操作的自动归档或待核对结果。

## 质量债与人工核对

`sourceQuality=debt` 是正文质量来源，不能证明该稿中的实际物品变化没有发生。已保留稿的结构化低风险资源变化可提交，同时保留 debt 来源。高风险、低置信度等既有提案检查继续保留；提案在资产事务中落盘，而不是因暂停被回滚。自动校验拒绝的提案也保留为 pending_review，附无效抽取原因，不许直接确认非法载荷。提案带操作标识与正文 hash；只要本次操作仍有待核对或仅被自动归档的提案，就不写完成 boundary。用户明确忽略会记录独立标记，允许原操作恢复。用户在现有状态工作区明确确认后，原操作恢复复用已完成抽取和消费者，只重查核对状态并完成边界。

## 验证边界

`server/tests/novelProduction/actualStateCommit.test.js` 用真实 journal/实际编排及事务替身注入落盘、未知输出、人工改稿、质量债和待核对错误；全程默认数据库与网络禁用。它不证明真实UI、模型文学质量或十章连续成功。真实验收必须固定提交并由用户执行。

## 正文换版与检索投影

显式新操作更换保留稿时，旧自动事实标记 `source=superseded`，历史行保留，空事实结果也会撤销旧版本事实的有效性；上下文读取只取有效 auto/manual。旧抽取 timeline event 标记 superseded，旧本章 hook 标记 dropped，再写本次真实事件。旧角色时间线同样保留为 superseded；有效角色时间线由 AI 结构化角色状态生成，不靠人物名字命中句子证明事实。

资产提交后排队刷新正文、摘要、小说、有效角色时间线和一致性事实的 RAG 投影，并移除旧版本的派生向量。排队在事务外；排队失败保留本地已提交事实并记录待处理步骤，不能回滚正文或重新生成。

检索候选在融合、截断和重排前回查事实/角色时间线源行的有效性。索引删除队列延迟或失败时，superseded 或已删除源行仍不能进入模型上下文；有效性查询失败不返回未经核验的旧事实。
