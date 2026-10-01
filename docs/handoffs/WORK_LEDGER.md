# 本地优化工作台账

更新：2026-10-01。本表记录状态，不授权自动执行。交接起点及任务标识以 [CURRENT](CURRENT.md) 链接的快照为准；后续现场见本表关联观察记录，稳定偏好在 [PROJECT_CONTEXT](PROJECT_CONTEXT.md)。历史验证数字不可跨阶段相加。

后续进展：《外卖箱通武侠，我送一单得一门武功》后来完成三章，用户认可紧凑度但指出二三章重复，随后授权三项通用修复。该书替代导演已完成、原导演已取消，Q09停点是历史；旧 promiseChecks 根因不因此销账。用户允许换书，不再围绕这本改稿。之后新书《外卖箱闯金庸》也有三章正文，但第三章来自单章生成、仍needs_repair，当前导演waiting_approval，并未完成恢复验收。最新全文、运行及隔离复现见[三章核验](../evals/framework-quality/observations/2026-10-01-chapter-three-quality-and-tool-audit.md)。Q11情绪专项仍未实施。

**2026-10-01 新一轮（工具优化目标任务书）**：用户确认长期方向是多题材小说创作并投稿/改编漫剧，问题根因在工具而非模型，要求有序推进并留可查记录。已建立活跃任务书 [工具优化目标任务书](../plans/tool-improvement-roadmap.md)，并完成 P1 前两步：**Q26 已修并全量校验（166/166 loader 版本一致）**、**Q24 已修并隔离验证（12/12）**。两步均通过服务端编译，尚未真实导演验收，也尚未本地提交。下一步 P1-C 由用户新开一本书跑第3→4章链路验收。

| 编号 | 事项与状态 | 已完成及证据 | 下一步与验收边界 |
| --- | --- | --- | --- |
| Q01 | 书级大底、世界边界、人物主线：工程完成，文学未全面验收 | db49bce0；book-story-foundation wiki；七题材14候选为人工开发材料 | 多题材真实构思/留出盲评；字段存在不等于大底好。不得强制所有题材用同一情节模板 |
| Q02 | 第3章规划/建议修复：多轮工程修复，旧书后来完成 | 4a317873—28f3ecf5；当前候选隔离、准确正文、独立核验、义务修订幂等与历史 | 泛化质量仍需自然复现；不重跑旧候选，不把两轮失败隐去 |
| Q03 | 下一章范围/入口：工程完成，用户跑过5—8章 | 47ae8b27、4d2f800a；正文生成与新增空白章区分 | 保留误建空白第9章，不自动删除；继续观察范围/路由投影 |
| Q04 | 第4章原地踏步与跨章承接：通用规则及一次实稿修订完成 | 29fd8956；3378→2538字符，前3章不变；用户“至少情节合理了” | 跨章净变化、重复事件/认知、前章行动兑现要继续验收，不能认定寡淡已解决 |
| Q05 | 第5章连续细化：工程与真实API验证完成 | 19337c3a；同候选复核、单章原子保存、背景不自动变义务 | 不自动重写已完成规划；UI总体可用性仍由用户观察 |
| Q06 | 场景禁令扩大/回报持续延期：工程完成、部分实测 | b1c15506；139通过2跳过；即时奖励匿名实测；局部禁止保留sceneKey，AI回报决定 | 旧5—8章没有被改写；无需训练/代价的授权金手指合法。全书持续兑现尚未验收 |
| Q07 | A/B阅读对照：完成，用户明确B更好 | reader-pull-comparison观察；B交付拿钱，A只改善句子。B更多迭代及两处人工术语校对均留档 | B方向进入后续质量目标，不能宣称自动单轮质量达到样本；不覆盖旧书 |
| Q08 | 新书第一章前引用停顿：修复完成，并被随后用户实际续写覆盖 | 0aed0312；74通过2跳过；第二轮真实只读回放通过；正式日志第一章planner v4随后成功 | 旧Payoff错误不再是当前停点；旧queued job仍残留，禁止直接清库 |
| Q09 | 新书第一章后/第2章前停顿：只读确认，未修 | promiseChecks覆盖校验失败；planningRepair uncertain/0 of2；3次模型stop响应在本机日志 | 先比对实际选定来源与返回清单，修严格校验反馈/恢复语义，保留真重复问题；原稿及已写章保护，不能清pending绕过 |
| Q10 | 第一章补写越过职责：证据确认，未定位实现根因 | 两次writer输出2410+1732+2换行=4144保存正文；合同禁止取药但后段取药 | 追补写目标/合同注入、验收修复及接受质量债；不得删掉用户认可的推进，邻章应承接事实而非重演 |
| Q11 | 情绪与人物鲜活：**情绪规则已覆盖写作、验收、审查、修复四条链路** | `context/emotionPresence.ts` 定义 `CHAPTER_EMOTION_RULES`（写作向4条）与 `CHAPTER_EMOTION_AUDIT_RULES`（审查向4条）；注入 `chapterWriter.prompts.ts`（【情绪落地要求】）、`chapterAcceptance.prompts.ts`（【情绪落地审查】）、`review.prompts.ts` 两个入口（chapterReviewPrompt【情绪落地审查】/ chapterRepairPrompt【情绪落地要求】）。服务端编译通过；离线 17/17 通过（模块、四条 prompt 渲染、规则逐条出现、无题材硬编码、克制情绪获准、acceptance 前后章推进审查无回归）。证据 `.codex-run/tool-roadmap-20261001/q11-verify.log` | 规则层已完备；真实效果需用户读稿判断，不以规则存在代替文学验收 |
| Q12 | 卷级多线因果、长线人物/关系回归、按需事实召回、单书文风校准：部分既有基础，专项未完成 | 两参考项目静态研究及质量计划 | 先书→卷→正文，AI优先，跨七题材；需用户安排下一阶段，不机械导入外部Skill |
| Q13 | 长篇质量验收：未做 | 开篇和局部片段证据仅支持局部进步 | 中段、高潮、终局、多读者盲评、误报漏检、成本延时；不把模型高分当好故事 |
| Q14 | 历史误报/验证债：未全部解决 | prose_negative_flip固定句式；旧全量测试契约/资源上限；comic内联prompt治理违规（`prompting-governance.test.js` 一项失败，`ComicFactService.ts:39/48`）；**新增确认**：`novelWorkflowRuntime.test.js` 的 "stale running auto director healing does not recurse through markTaskFailed" 失败，根因是该测试只 stub 了 `novelWorkflowTask.findUnique`，但 `healStaleAutoDirectorRunningTask`→`updateWorkflowTaskWithNotifications`→`updateWorkflowTaskWithPlanningRepairGuard` 调用的是 `findUniqueOrThrow`，未被 stub 覆盖。该守卫引入于 `6555dbcd`，早于本轮；本轮提交未触及 `healStaleDirectorRunning`/`updateWorkflowTaskWithNotifications`（已用 `git diff 94315b5d..HEAD` 核实为空）。**是预先存在的测试缺陷，不是本轮回归** | 各自先复现基线再修；不扩大为当前阻塞，不声称全套全绿。修法：测试补 stub `findUniqueOrThrow`，或让守卫在该路径改用 `findUnique` |
| Q15 | 《女尊：流放矿区，下跪续命》：用户停止 | 历史8轮修复及停止决定保留在旧完整包 | 不恢复第9轮，不付费重试，不删除数据。另两历史样本厨神/打捞不自动续写 |
| Q16 | 发布：未执行 | 本地feature分支，desktop0.4.28，未push/beta/main晋级 | 依明确发布请求和AGENTS流程；不因交接发布或升级 |
| Q17 | 窗口连续性：完整更新，个人记忆注记已获授权 | PROJECT_CONTEXT、CURRENT、Oct1完整快照、台账、最新全文观察与个人记忆小型入口注记；继承/五阶段/新缺陷分层 | 新窗口同checkout只读复述；未实测自动读取，不承诺聊天逐字或注记自动注入 |
| Q18 | 自动续写跨章重复：三项通用修复工程完成，样本局部验证 | 235ee704；自动入口复核前章事实、完整问题及指令、来源一致性与逐问题补丁回执；共享/服务编译、113聚焦+3独立Store通过。最新样本二三章不重演、审查15/15引文定位正确 | 文学/语义仍漏检；首章候选被选、二章original_retained，不能把patched回执当已写正文修复。第三章活跃v3/未提交v5需新事实重新取证；旧Q09/Q10/Q11不销账 |
| Q19 | 新书技术暂停后恢复入口缺失：工程完成，用户已操作建议入口 | 《外卖箱闯金庸》前两章完成，第三章规划复核引用旧候选被拒；technical_failed遗漏暂停归类、running+pending隐藏按钮、挂起job被误认活跃均修复；80项回归、共享/服务端编译及前端类型检查通过，见[恢复入口记录](../evals/framework-quality/observations/2026-09-30-planning-recovery-entry.md) | 用户刷新后获取建议到达模型核验，但被Q20合同错误拒收；保留第一章正向反馈及正文，不宣称规划或恢复已通过 |
| Q20 | 修复建议最终方案与核验覆盖不一致：工程完成，真实建议已ready并被用户采用 | 新合同每个最终方案内嵌check，76项回归与编译通过；Oct1日志v11/v6正常stop，建议cf3ccb90-7964-4cb1-9968-3bf5d18aa78f ready且原授权已保存，见[建议核验记录](../evals/framework-quality/observations/2026-09-30-advice-review-coverage.md)与Q21现场 | 一次真实建议成功不等于规划/正文验收完成；旧不合格结果不能删项放行，人物情绪专项仍未实施 |
| Q21 | 规划恢复无推进却显示执行：工程完成，用户继续已越过原门禁 | cd2dbd09；原授权误到production_experience_required、GET用人工挂起job覆盖停点已修；119回归+编译，见[运行停顿记录](../evals/framework-quality/observations/2026-10-01-director-resume-phantom-running.md)。08:56新job越过旧门禁后遇Q22 | 用户认可二章“可圈可点”。最新三章已由单章入口生成，导演仍等确认；新Q24是旧步骤投影路径，不冒充原job修复无效或全链通过 |
| Q22 | 正常进度误报归属：工程完成，导演真实恢复仍待验收 | 94315b5d；归属与精确CAS分离，类型化规划异常、候选/预算暂停、旧监督及首次登记保护；编译+258独立回归（212复用同轮未变覆盖），见[执行归属记录](../evals/framework-quality/observations/2026-10-01-planning-repair-execution-ownership.md) | 最新第三章有正文，但POST单章生成，不是v5提交/导演恢复证据；当前waiting_approval、pending=0、原授权/1 of2/v5保留。先新事实取证，不能覆盖已写章或清预算 |
| Q23 | 新书三章质量与实际生成：全文核验完成，局部接收仍有质量债 | 第一/二章2901/2556 approved，三章3529 drafted/needs_repair；交药、拿甲、新单有进展，无二三章重复赶路。writer v12/acceptance v7各一次，无第三章patch；timeline抽取degraded | 保存不等于批准/事实资产齐全；不自动改书/续写。时间、回忆、说话人、物件及情绪问题见最新观察，模型83分不作文学评级 |
| Q24 | 旧等待步骤覆盖新执行：**已修，隔离验证通过** | `healRuntimeGateApprovalState` 增加三重通用保护：以最新 `run_resumed` 事件为执行代次新鲜度边界（旧 step 不再产生恢复决定）、本任务活跃 `DirectorRuntimeExecution` 判定、写入前重读软 CAS。服务编译通过；离线隔离 12/12 通过（旧步骤零写入、合法步骤仍可 heal、并发批准拦截、活跃命令/执行/pendingManualRecovery/非running 各自拦截）。证据 `.codex-run/tool-roadmap-20261001/` | 现场逐写因果仍缺 trace；不宣称已捕获那一次因果。真实全链由新书第3→4章验收。禁止直接改DB、清pending或忽略全部等待 |
| Q25 | 语义结论/修复前提核对：**两阶段修复完成** | **第一阶段**（b0563f7b）：`progressionEvidence.ts` 新增 `progressed_but_consequence_denied` 门禁，8/8 隔离验证通过。**第二阶段**（本次）：`chapterPatchRepair.prompts.ts` 新增规则 4f：解决 `action_state_unearned_*`/`action_state_contradicted_*` 类问题时，补丁必须先核查并建立行动前提（持有/在场/知晓），不能只替换行动结果；无法定位前提时输出 `plan_conflict`。服务端编译通过；8/8 离线验证通过（4f 渲染/action_state 词/前提词/plan_conflict/无题材硬编码/4e 无回归）。证据 `.codex-run/tool-roadmap-20261001/q25-2-verify.log` | `actionStateEvidence.ts` 已有完整结构化前提检查（`transitionStatus`/`enablingTransitionRequired`/时序验证），acceptance 层已将失败投影为 `blockingIssues`。4f 确保修复侧遵守同一约束。深层语义质量（LLM 实际执行力）需通过真实跑书验证 |
| Q26 | Prompt加载目录版本声明漂移：**已修，全量校验通过** | loader 声明 `acceptance_assessment@v7`、`review.patch@v6`（原 v6/v5），与资产实际版本一致。服务编译通过；离线遍历全部 166 条 loader entry 逐条比对声明与资产 `version`：0 错位、0 加载失败，两个焦点键经 `getRegisteredPromptAsset(id, version)` 正确解析。证据 `.codex-run/tool-roadmap-20261001/` | `prompting-governance.test.js` 仍有 `ComicFactService.ts:39/48` 内联 prompt 一项失败，属 Q14 历史债，本次未触碰该文件 |

## 授权台账

- 旧书第四章修订、第五章细化保存此前由用户明确授权DeepSeek，相关动作已完成，不自动延展为旧书更多章节改写。
- 新书同一上下文的只读DeepSeek回放：先一次，后用户说“回放十次都可以”“次数不限制”。这是核验范围授权，不是生成正文/恢复导演或无限调用指令。通过后已经停止，本轮交接没有调用模型。
- 自动审批曾因“仅旧书授权”和“一次已用完”拒绝外发，后由用户明确追加授权；不要隐去记录，也不要重复问已明确授权的同一核验范围。
- 上次交接仅授权只读核验与记录情绪要求。本轮用户明确追加三项通用工具修复，并允许另开新书配合验收；已完成代码与离线验证，不恢复旧导演、不改样本正文、不新建任务、不push。
- 最新用户要求审读第三章、排查工具bug、把继承和本窗口工作做成记忆/台账。本批只读三章/运行、隔离机制复现、内部交接文档与小型个人记忆注记；没有新应用修复、真实DB写入、付费调用或自动续写。按磁盘AGENTS要求本地文档阶段提交，不push。

## 不再采用的做法

不把局部禁令摊平到整章；不把所有逾期改成pressure；不靠秘密名字符串重合禁止整个奖励；不强制金手指苦练付代价；不以关闭审查/直接改DB/清历史/不断加轮次掩盖失败；不把emoji式表情、频繁皱眉或大段内心解释当情绪能力。
