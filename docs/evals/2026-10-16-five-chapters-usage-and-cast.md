# 阶段3：第五章完成后的用量暂停与人物能力待办

## 接手摘要

用户报告第4、5章写完后暂停，怀疑token过多，要求判断此类控制是否应停；同时明确提醒主线不能遗漏按篇幅规划人物和规划阶段修改人名。此次完成只读诊断、策略判断与主线记录，不修改产品阈值或真实任务，不调用模型。当前保持原任务暂停，上一快照“选择完整工作台”指引已执行、失效。

## 环境与实测

2026-10-16 10:35 UTC核验，仓库D:/novel/AI-Novel-Writing-Assistant，codex/production-core-refactor，接续9da855be。运行后端19224加载78b9f92873c4，health stale=false；5190可访问。DB D:/novel/.comparison/2026-10-10/old-test.db。保留三个Structured组件和WORK_LEDGER历史964行未提交改动。

书cmv3wyvw40015gow0780pycx9，原1—3导演成功，新4—10导演cmv8d55el0033z8w0hneoiiru仍为running但pendingManualRecovery=1，实际已暂停，活跃jobs/commands/sideEffects均0。新任务completed=2、remaining=5、nextOrder=6，剩余6—10尚无Chapter行。

第4章《木匣纹路》3916字符，第5章《第三个摊位》5808字符，均approved/completed，对应job均succeeded。前三章hash与之前相同；第4章hash e0b6d1a575df3ff1c668a6d7c92eb5be1fd991dffef387e4339846ba0464377b，第5章hash f1ab36068aa3c61026e0cc3ebd5850306e2569d9cb122270ad2ec9477f391fdc。用户认可节奏、文笔；这是用户反馈，不是代理全文文学审读。当前new task调用26（前轮1+用户本轮25），旧任务all-time90；统一自2026-10-11T17:00窗口为90（旧64+新26）。代理调用0。

## 暂停根因与判断

主因分类：实现缺陷与预算策略失配；不是已证实的模型输出截断、额度耗尽或正文生成失败。

- DirectorCircuitBreakerService.chapterTotalTokenLimit固定80000，原注释按单章约55000—60000估算；本轮真实上下文规模已远高于此，不能把跨阈值直接等同循环失控。
- DirectorUsageTelemetryQueryService.buildChapterUsage按metadata.chapterId分组。规划用VolumeChapter虚拟ID，正文用持久Chapter ID，同一章被拆成两组；planner.chapter.plan等调用还有chapterId=null。展示和控制口径尚不完整。
- 报错246741恰为第5章规划4次调用累计：输入236904、输出9837；并非一次输出24万字/Token。四次分别30796、82055、81678、52212。真实第5章正文/审查/时间线/资源组为171436；第4章规划241566，正文相关222310。
- 第5章完成后第6章未物化，activeBudgetChapterIds为空；resolveUsageCircuitBreaker的空集合分支允许用任务内历史最大规划组触发暂停。原停点nodeKey是planning_repair_review，chapterOrder=null，非当前待写第6章的执行故障。
- 大量输入重复发送确实需要优化，不能仅升高阈值或关闭安全保护。应分清本书/本任务/本章/本次恢复及规划/正文/审查成本，补规范章节映射、未归属调用、已完成章和缺章边界、同一用量事件幂等与明确恢复基线。

策略判断：正常有效写作和审查的累计量高可提醒并记录；明确用户预算上限、配额/输出额度终止、无进展重复调用和数据完整性风险仍应停止。执行中额度保护应在可恢复的安全边界停下，保留稿件和原任务；不能用已完成章的旧消耗反复阻挡下一章。此次保持暂停，先修正口径与恢复规则，不指导用户反复继续或自动重置计数。

## 同链发现：全书规模与本批范围混淆

seed.completionProfile是100章serial_book，directorInput预计100章，但autoExecution.completionProfile成为7章compact_book/endingRequiredBy=7。novelDirectorAutoExecutionScopeRuntime在缺少profile时用range.totalChapterCount=7派生全书规模；prepareNextAutoExecutionChapter会把该profile传给ChapterRouteWindowService。此为已确认状态契约缺陷，可能影响后续规划和收束判断；尚无第6章产物，不能宣称已发生提前结局。必须在第6章继续前与预算问题一起处理，不以停用熔断掩盖。

## 人物两项：明确主线，未实现的新要求不能写成完成

1. **按篇幅分层规划人物：待实施。** 旧版开书核心阵容schema和prompt约束3—6人，不是整书角色上限。本书当前10条角色记录，说明正文同步会补人，但不等于已有完整长篇人物布局。新版按篇幅分档3—6/8—12/20—35/40—60，分批8人生成，可借鉴规模规划与分批持久化；旧版应由AI按篇幅、题材、卷和情节职责确定阵容，核心人物先深入，后续人物按阶段完善。不得简单把6改成几十或要求所有人开头出场，也不能固定模板代替AI规划。
2. **规划阶段修改人名：待实施。** 旧版已落库人物可从角色资产控制台→档案→角色名称→保存角色资产修改；开书候选阵容只展示姓名，缺应用前改名。普通更新没有全书正文、章纲及候选方案文字的完整传播。需要稳定人物ID、名字锁定/别名、受影响引用范围与预览；已写正文的批量修改必须显式确认并遵守备份保护，不能静默全书替换。
3. **同一人物多称呼：关联验收项。** 当前有“城西二手市场摊主”“周姓摊主”“周麻子”三条相近描述，疑似身份重复，未做全文判别，不自动合并。正文同步先按姓名匹配、待定角色自动确认直接创建，旧方案重新应用又按精确名匹配，均需纳入稳定ID/别名设计与回归。

## 验收边界与下一步

优先级P0为用量归属/异常停点/安全恢复及100章整书与7章本批范围隔离，使用本次26条调用与历次失败样本离线回归，再核验加载；不得自动调用模型或恢复。本轮没有实施代码修复，未跑新产品测试或重启。五章已真实完成，但仍非固定版本连续十章通过。

人物数量和命名列为主线能力验收，不能因生产bug不断后移而丢失；在不扰动本次五章原稿的前提下独立设计验证。未来断线续作和书内agent仍保留既有记录。

证据：.codex-run/usage-cast-20261016/state.json；.codex-run/production-choice-range-20261016/20261016-020744-old-server.log；DirectorCircuitBreakerService.ts、DirectorUsageTelemetryQueryService.ts、novelDirectorAutoExecutionCircuitBreakerRuntime.ts、novelDirectorAutoExecutionScopeRuntime.ts及人物模块审计。后续窗口按AGENTS→PROJECT_CONTEXT→CURRENT→本页接手，重新核验实时状态，不能照旧选择界面指引发重复任务。
