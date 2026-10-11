# 阶段2收尾、阶段3及十章验收准备交接

更新时间：2026-10-11 13:22 UTC。

## 1. 接手摘要

用户持续目标要求完成阶段2收尾、阶段3、离线验证、独立提交和交接，达到固定版本十章真实验收的准备条件。本次代码与离线工作完成；真实UI、模型、十章及文学验收未做。下一步是用户要求后受控重启旧版隔离后端，再按操作单创建新验收书。不要因读取本交接自动重启或生成。

## 2. 环境与唯一真源

- 仓库：`D:/novel/AI-Novel-Writing-Assistant`；分支：`codex/production-core-refactor`。
- 本轮接手源码 `978680800615123ff187c8a2be5640d51bb7b3af`；阶段2源页收尾提交 `17b2cab6`；阶段3源码提交 **`39ca95d365be137ddd978892ffe9f48eb0ca6dd5`**。本快照与CURRENT的后续提交仅为文档，不改变验证源码。
- 原有dirty：`StructuredChapterDetailCard.tsx`、`StructuredChapterListCard.tsx`、`StructuredOutlineWorkspace.tsx`、`docs/handoffs/WORK_LEDGER.md`，均保留且未入本轮提交。二进制差异 SHA256：`cff9f07557cf83e8d5389afe87f8ab0fc0d06d87a4bcbe6e580cab9aa82e5a07`，与接手一致。验收固定版本必须记录这份补丁，不能只记录HEAD。
- 历史未跟踪素材、脚本、数据库及`.codex-run/.playwright-cli/.transcribe_tmp`等保留；没有stash、清理、切分支或覆盖原稿。
- 13:22 UTC核验旧后端PID33384、前端PID26356仍存在，均为10月10日原启动。后端为非watch ts-node；前端5190/API3000。本轮未重启，不能称运行服务已加载新代码。
- 原隔离启动记录指定 `D:/novel/.comparison/2026-10-10/old-test.db`，不是默认 `server/dev.db`。本轮只用SQLite只读连接核验任务状态：GenerationJob queued且pendingManualRecovery=1共1项；导演命令无queued/running；creation_studio自动续跑候选0。此状态会漂移，重启前重新核验。

## 3. 用户目标与不可破坏约束

保留旧版创作能力、认可写法、质量检查、字数控制与防丢稿。已批准范围见[核心方案](../plans/2026-10-11-production-core-refactor.md)。没有更换模型/提示词或修改schema，没有操作新版 `D:/novel/ai-novelist`，没有第三版GUI。没有调用小说模型、恢复历史导演、启动十章、push或合并main/beta；历史清理单列待办。两版旧对照停点与正文继续保留，不能拿它们冒充新固定版本样本。

## 4. 关键进程时间线

1. 核验阶段2的journal、部分流稿、保存/CAS和148项既有证据，沿用已验证能力。
2. 补旧章节工作区的稿件核对/下载、原参数恢复、明确新操作；删除重写前清稿动作。阶段提交17b2cab6。
3. 收敛有效合同和StoryPlan细化视图；已有稿件审查/恢复不自动重规划；写前结构/语义/窗口门禁及两轮预算保留。
4. 故障测试发现审查异常可被转换为接受结果；删除伪造接受路径，证据/覆盖不完整暂停审查且保留稿。生产会话的未知传输结果不被底层自动重试/备用模型隐藏。
5. 最终保留稿驱动实际状态；按持久步骤缓存外部提取，在本地事务提交报告、时间线、8类资产和完成边界。质量债稿仍提取实际事件，计划义务不充当事实。
6. 交叉审计修复旧事实异步索引未清导致漏读、旧角色时间线同步旁路、资源提案失败后UI旧缓存。无效提案保留为待核对，不能直接确认；明确忽略可恢复，不用自动归档冒充用户决定。
7. 完成未知结果核对决议与原操作恢复；独立批量源页复用原job，同步预检与任务CAS阻止取消竞争和预算重置。父导演任务仍走原源页。
8. 初轮扩大回归350通过/7失败（测试依赖替身及不完整审查输入）；修正前提后相关43项通过。最终服务端417/417、客户端27/27及前后端类型检查通过，源码提交39ca95d3。

## 5. 已完成实现

- `production/reliability`：未知结果决议归档但不触发调用；保持同operationId、原请求、done结果、部分稿；任务身份固定为pipeline:job:chapter。外部未知、额度耗尽和内部可恢复失败分别处理。
- `production/preparation`、`planner/contracts`：有效合同指纹、视图约束、准备步骤缓存、合同/正文CAS。前章完成检查在缓存准备外，要求精确保留稿hash和当前操作边界。
- `runtime/acceptance/reviewCompletion.ts`、QualityGate、PipelineExecutor：审查未完成进入人工恢复，不伪装通过、不基于无效意见修文；有效局部问题仍走原质量策略，显式stop_for_replan优先于local_window。
- `production/actualState`：外部提取与本地事务分离、消费者共同提交、必要对账与提案处理后才写完成边界；资产失败保留正文。旧事实历史保留为superseded，读取/导出/RAG排除失效源；旧兼容写入受保护。
- `production/recovery`：源页独立原job恢复，核对归属/范围/当前章/未知/租约/取消/人工暂停；CAS失败不调度、不清取消、不重置预算。历史随机标识不猜归属，failed job不伪装queued。
- 客户端 `productionRecovery`、章节执行与批量源页：保留稿、失败步骤、恢复范围、未知核对、原操作与原job恢复；生成/修文/恢复失败也刷新资源提案。运行记录仍只读。

## 6. 验证与实测结果

详见[阶段3报告](../evals/2026-10-11-production-core-stage3.md)。主代理最终以bundled Node执行 `tsc -p server/tsconfig.json`，exit0；预加载offlineBootstrap，对46个文件运行417个测试，全部通过、无跳过。默认数据库及网络在导入前禁用，SQLite仅内存库。

客户端复用同轮recovery_ui子代理最后代码冻结后的检查：`tsc -p client/tsconfig.json --noEmit` session69313/output a3f532，exit0；四文件测试27/27/output23006a。之后无客户端修改，主代理另做前后端接口只读对齐及源码指纹。记录明确区分复用摘要与原始日志，不重复跑同一昂贵检查。

私有证据：`D:/novel/AI-Novel-Writing-Assistant/.codex-run/production-core-stage3-20261011/`，含最终日志/测试文件清单/源码指纹/原dirty补丁和最初失败记录。提交前仅清除新增格式模块文件尾空白，未改变逻辑，不重跑编译。`git diff --cached --check`通过。

没有浏览器、截图、真实模型或文学实测。防丢稿机制与原编辑器改动被保留，不等于已经重新通过UI防丢稿操作验收。

## 7. 已知问题与临时绕过

- 原非watch后端仍是旧进程：先按[十章操作单](../evals/2026-10-11-ten-chapter-acceptance.md)受控重启，不能直接点网页就宣称测到新实现。
- 历史随机操作ID缺少可靠job归属：保留记录、不自动迁移、不自动恢复；新验收用新书。迁移需另行明确范围。
- 外部调用未知无法证明收费恰好一次；用户核对决定与真正恢复分开，可能重复的风险必须显式接受。
- 关键无效提案会要求用户明确忽略；这属于人工干预，验收须记录。服务端阻止直接确认无效事实。
- 事务是各步骤的本地数据+完成标记原子提交，不是一笔涵盖所有外部调用的长事务。RAG清理异步，但读时有效性过滤独立保护旧事实。

## 8. 未执行与待执行任务

| 优先级 | 状态/范围 | 下一步、依赖与验收 |
|---|---|---|
| P0 | 代码/离线完成，UI未验 | 用户受控加载本次代码后，在旧源页验证稿件对照、断流、刷新、未知核对、提案确认/忽略和原任务恢复；记录真实操作，不用单测代替 |
| P0 | 十章操作单就绪，未执行 | 用户固定新书、模型、认可写法、费用上限及质量策略；1→3→5→10停点阅读全文，工程成功和文学判断分别记录；目标版本39ca95d3加原dirty补丁 |
| P1 | 历史迁移/清理延期 | 保留旧任务/数据库/对照证据；明确范围、备份与授权后另做，不混入验收准备 |
| P1 | beta集成/桌面打包/发布未执行 | 本地功能分支尚未晋级；未来按AGENTS feature→beta→main流程，不因本交接自行push或发布 |

## 9. 关键文件与产物索引

- [批准方案](../plans/2026-10-11-production-core-refactor.md)、[架构wiki](../wiki/architecture/production-core-boundary.md)、[阶段3报告](../evals/2026-10-11-production-core-stage3.md)、[十章操作单](../evals/2026-10-11-ten-chapter-acceptance.md)。
- 后端模块：`server/src/services/novel/production/{reliability,preparation,actualState,recovery}/README.md`；测试：`server/tests/novelProduction/`。
- 客户端：`client/src/pages/novels/productionRecovery/README.md`；相关策略测试命令记录在阶段报告私有证据摘要。
- 前序快照：[阶段2后端](2026-10-11_1155Z_production-core-stage2_thread_handoff.md)、[源页收尾](2026-10-11_1255Z_production-recovery-ui_thread_handoff.md)。
- 历史对照：`D:/novel/.comparison/2026-10-10/`；其中launch.ps1是一次性准备脚本，不得重放作为重启。

## 10. 下一窗口启动顺序

1. 完整AGENTS→PROJECT_CONTEXT→CURRENT→本快照及已批准方案。
2. 核验root/branch/HEAD/dirty，确认源码仍为39ca95d3内容，四份原改动与历史未跟踪文件保留；不重复重写已完成机制。
3. 若用户要求开始验收，先核验旧服务PID/数据源/排队状态，再按原隔离环境仅重启旧后端、刷新5190；不碰新版和历史导演，不执行恢复全部。
4. 固定新样本与费用范围后，由用户从旧源页启动第1章，按操作单逐段读。没有新授权则仅回答状态，不自动调用。

## 11. 待确认事项与风险

真实验收的novelId、模型具体名称、费用上限与阅读结论尚无，不能填造；服务状态及排队状态是本次只读快照，启动前须重验。准备交付完成，可安全换窗口；真实运行验收有加载代码与用户操作的边界。本轮子代理只处理各自明确模块，主代理已审diff、整合测试和保护dirty；没有把子代理单项成功直接当作整体验收。

## 12. 可直接发送给新窗口的开场提示

接手旧版核心架构重构的真实验收准备。先完整读AGENTS、PROJECT_CONTEXT、CURRENT和2026-10-11_1322Z快照，核验分支、源码39ca95d3和原dirty补丁；阶段2/3已提交且417项后端、27项客户端离线检查通过。先汇报当前服务是否加载新代码，按我的最新要求仅受控重启旧版或开始新书验收；不恢复历史导演、不改新版、不自动调用模型、不push/main/beta。十章与文学质量尚未验收。
