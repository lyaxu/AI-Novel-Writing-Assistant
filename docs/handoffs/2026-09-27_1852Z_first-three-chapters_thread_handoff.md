# 前三章试写修复与实跑交接

## 接手摘要

- 记录时间：2026-09-27，UTC；最终实跑状态见下文“完成时核验”。
- 用户先要求只读接手，之后明确授权：“那就推进呀，你自己找到问题了就执行呀！”本轮目标是修通选定书的前三章试写，不启动80章全书。
- 19:10:49Z最终核验：前三章完成，任务succeeded，无活动job或command。下一步是用户阅读与UI验收，不自动续写。
- 用户关心正文何时可见、收到结果为什么重发、重试为何仍显示失败、刷新是否有用。刷新仅同步界面，不能修复后端；不要让用户反复点击重试。
- 上游完整交接：[2026-09-27提交检查点](2026-09-27_commit-checkpoint_thread_handoff.md)，其中保留本轮之前的个人写法、编辑器等优化背景；本记录不取代那些既有约束。

## 环境与唯一真源

- 仓库：`D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/fix-task-cleanup-personal-style`。
- 代码 HEAD：`f644c795`，仅本地提交，未 push。后续文档提交以 git log 为准。
- 数据库 `server/dev.db`；后端3000，前端5173；Node24来自 `C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。
- 任务 `cmujtcwa9005fr4w0ffh9hvmh`，小说 `cmujxe1m9000aakw0f1l1mvp1`：《流放迷雾死地：我的打捞每日翻倍》。模型 `custom_k3` / `kimi-k3`，官方Moonshot，temperature1。
- 源页面 `http://localhost:5173/novels/cmujxe1m9000aakw0f1l1mvp1/simple`。
- 保留原有未跟踪 `.codex-run/`、`.playwright-cli/`、旧交接、bat脚本、probe db和中文旧书稿；没有混入提交。

## 用户目标与不可破坏约束

- 当前仅前三章。用户后来的执行授权取代初始只读限制，但不等于授权新选候选、全书生成或push。
- 不用换模型、删除数据、关闭审查或重置两轮预算掩盖问题。
- 写前规划仍须语义/窗口审查；当前1—3章真实通过，消耗1/2轮。正文局部质量债务按completion-first继续，不能误作规划失败。
- 运行记录只读，工作流操作在小说源工作台。UI验收留给用户；本轮没有浏览器/截图验收。
- 服务watch源码；有模型在途时不要改server/src导致重启。必须修复时先取消并确认状态，保存可复用结果。

## 关键进程时间线

1. 接手核对旧HEAD `9c9d9f12` 和脏文件，按项目上下文处理，未切分支。
2. 世界结果因合法 `factionId:null` 被schema拒绝，触发不必要重发；世界主题300秒时限与重试旧错误投影一并修复。保存过的有效世界结果由日志重放，未再付费生成。
3. K3结构化拆章额度1680被思考耗尽。官方K3总输出下限32768；规划使用低思考，输出额度耗尽不走兼容重试。
4. 恢复路径绕过体验选择及底层executor把sample3扩至预计80章；已修选择断点、状态绑定与执行范围。取消旧80章job后重放已完成初始任务单，仅进入审查，不直接批准。
5. partial:active被误认为冻结、体验选择updatedAt误判来源变化、取消标记不清导致恢复失败，均修复。规划真实审查修正一轮，17:55Z全部三章通过并保存。
6. 正文6000额度全耗于K3思考，空正文又fallback重写；正文同样提高总额度、快速写作低思考，额度耗尽和取消不再额外AI诊断。
7. StoryPlan覆写受审任务单/场景卡、五场景把2800预算变成3000；保护既有合同。用精确受审响应/历史重建候选hash，恢复原合同，补稳定审查指纹；143项回归通过。
8. 18:20Z开始首章正文，18:21Z初稿2841字符保存；补字数请求是正常续写。首章局部修文后仍有结尾越界质量债务，按策略完成。事实抽取高思考耗时近6分钟，之后改低思考并加300秒完整操作时限。
9. 首章后JIT固定min3/target5越界规划4—7章，一次返回退化为重复标点，取消；取消后第二次迟到结果仍保存了4—7章。范围参数在旧policy中缺失，补Executor实际job范围下传；取消校验进入所有持久化事务。
10. 首章实际摘要覆写Chapter.expectation，工作区读取又污染active plan.summary；自动/手动摘要服务都已移除覆盖。保留正文和ChapterSummary，仅凭精确摘要等值与受审证据恢复目标。
11. 严格技术恢复保留新增4—7路线；剔除新增项后旧文档和旧source hash必须精确相同。仅更新3个比较hash，不扩大受审范围、不改轮次。18:47:58Z成功。
12. 18:48Z恢复直接进入第2章Planner/Writer，没有重拆路线；18:49:54Z第2章3043字符正文保存。
13. 第2章经一次局部修文后3049字符，18:59Z完成并直接进入第3章，未再出现规划冲突。
14. 第3章19:01Z保存2559字符；审查continue_with_risk后完成事实与伏笔同步，19:10Z任务succeeded、workflow_completed。

## 已完成实现

- 本地提交顺序：`20283e04` 世界/状态；`9bd6bb50` K3规划预算；`06f0b599` 试写范围/规划恢复；`58eb1810` 正文额度/取消；`ee29e678` 受审合同复用；`7254606e` 路线窗口/事实提取时限；`f644c795` 实际范围传递/摘要目标分离/迟到写入保护。
- 核心边界见 [输出与恢复wiki](../wiki/workflows/structured-output-budget-recovery.md)、[卷写入归属](../../server/src/services/novel/volume/infrastructure/README.md)。
- 技术恢复API在PlanningRepairStore内部，仅有严格证据/CAS校验入口，没有产品硬编码本书剧情或任务ID。

## 验证与实测结果

- 本轮多次server build通过；最后代码build通过后，`final-boundary-tests.log` 139/139通过，覆盖Store恢复、真实旧policy缺范围、摘要不改目标、取消后不能内部保存/物化。
- 之前独立阶段143/143、36/36通过；这些是重叠套件，不得相加为独立总数。
- `.codex-run/recovery-20260927/`：approved-contract-tests.log、scope-timeout-tests.log、final-boundary-tests.log。
- 初次scope-timeout测试误在build未结束时读取旧dist而失败，等待build完成后重跑36/36通过；不是首次就通过。
- DB/接口和真实付费链路已验证到下方实时结果。没有全量测试、浏览器验收、beta集成或发布。

## 已知问题与临时绕过

- 第1章结尾越过雾口边界的局部质量债务被保留；completed不等于无写作问题，不能宣称所有质量检查无问题。
- 4—7章仅是迟到保存的未审路线，没有正文，不在本次写作范围；未删除。
- 路线窗口修复保证已齐备的授权路线不再为凑3/5章越界预取；缺章且完整节拍跨越授权范围的生成/保存语义未重写，不能宣称所有未来情形都严格裁剪路线。
- 全规划指纹仍严格：未来合法追加路线若改变已提交来源，不能自动随意重置hash。当前技术恢复只批准精确证据下的卷末未写路线追加，不是自动恢复旁路。
- 第2、3章事实提取已实跑完成，第三章该调用19:07:29—19:09:13，约105秒。完整超时中断仅离线验证；不承诺服务端费用撤回，不把timeout误报成功。

## 未执行与待执行任务

- 已完成：前三章正文真实保存，director停止在3，活动job/command均为0。
- 下一步：用户阅读正文和UI验收；针对实际质量反馈修通用流程。不得自行续写第4章。
- 后续可单独研究整节拍跨执行范围时的预规划策略、正文局部修复效果及辅助步骤时延，不在本轮自动扩展。
- 未push、未beta/main合并、未发布；待用户后续要求。

## 关键文件与产物索引

- 三章id：`cmuk36v4h001lbww0f2ookhlk`、`cmuk36v4j001mbww0lau0yks9`、`cmuk36v4k001nbww0lz0f5wr3`。
- 受审active version `cmuk45ip30007x8w0t670ljjf`；planningRepair committed，rounds1/max2，affected只1—3。
- `.codex-run/recovery-20260927/` 保留证据、恢复脚本、审计与三份sqlite backup，每份约1.027GB且quick_check=ok：before-world-recovery.db、before-reviewed-contract-restore.db、before-summary-and-route-recovery.db。
- 原受审证据 committed-evidence-document.json，原candidate hash `1c016e97cca2449a2619249629a360873441b66baf6d5eabb30f67c4bb090104`。路线追加恢复后candidate hash已更新，不能重复使用旧恢复脚本。
- 审计：world-recovery-audit.json、partial-correction-audit.json、initial-replay-audit.json、reviewed-contract-restore-audit.json、summary-contract-restore-audit.json、route-append-recovery-audit.json。
- `progress.py`、`status.py`、`live.py` 只读诊断；SSE先读首个data后关闭。日志 `.logs/2026-09-27/2026-09-27T12-20-46-dev.llm.jsonl`。避免输出prompt全文或密钥。

## 下一窗口启动顺序

1. 读取完整AGENTS、PROJECT_CONTEXT、CURRENT及本快照；重新核验分支HEAD和dirty。
2. 先只读查DB的任务/章节/最新job及SSE；不要假定本记录是实时状态。
3. 若前三章完成，等待阅读反馈；若仍在运行，不改watch源码、不重复retry。
4. 若失败，定位本次最新错误与保存成果；禁止重放本目录历史恢复脚本或把其当幂等通用按钮。

## 待确认事项与风险

- 页面刷新一次可同步当前结果；真正的按钮状态、编辑器展示和用户阅读体验仍待用户验收。
- 历史部分在上下文压缩后依据提交、审计与日志复核；不是完整聊天逐字记录。
- 最终可交接判定须以本轮模型/任务全部停稳为准，不在活动调用中切换写入者。

## 可直接发送给新窗口的开场提示

按项目AGENTS读取最新CURRENT，先只读核验分支、未跟踪文件、前三章正文和任务状态。接手本地小说助手修复，保留既有正文和审查预算，不自动续写或重试；先汇报当前结果和下一步。

## 完成时核验

- 时间：2026-09-27 19:10:49 UTC。数据库与director GET接口成功读取，任务succeeded，checkpoint=workflow_completed，lastError=null。
- 三章状态均approved/completed：第1章《宗祠毁婚》2841字符；第2章《雾底捞出生机》3049字符；第3章《一枚令牌掀开局》2559字符。共8449字符，含标点/空白。
- 第4—7章均0正文字符；仅保留未审路线。活动GenerationJob=0，活动DirectorRunCommand=0。
- 第1章仍有结尾边界质量债务；第3章continue_with_risk提示听觉误导转折力度、藏物翻倍验证顺延及目标变化暗示，未触发重规划。不宣称无质量问题。
- 最终证据 `.codex-run/recovery-20260927/final-runtime-evidence.json`；正文快照 `.codex-run/recovery-20260927/first-three-chapters.md`，已重新导出最终保存内容。
- 本轮后半段实测确认三章受审目标/任务单/场景卡/预算等全部保持一致；预算committed 1/2，受审范围只1—3。
- 可交接：无活动模型/任务，源代码已提交；文档提交后以git log为准。下一窗口只读核验后等用户正文与UI反馈。
