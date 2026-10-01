# 完整交接：三章审读、通用工具修复与剩余状态缺陷

快照起点：2026-10-01 11:53 UTC（纽约07:53 EDT）。最新现场读取在此之前及文档验收时复核。本文接替 [Sept30完整包](2026-09-30_1317Z_quality-and-emotion_thread_handoff.md)；旧包、[Sept29完整包](2026-09-29_0105Z_full_thread_handoff.md)及更早资料保留，不再把旧书停点当当前任务。本文可独立接住主要目标、已做工作、失败、未完成承诺与授权；详证按索引进一步读取。

## 1. 接手摘要

用户要优化的是小说工具的通用能力，不是修好一本测试书。继承时需要保留第一章“有点意思，有不小改进”、补写越界、第二章前 promiseChecks 停顿与人物情绪要求。此后用户自行把旧样本三章生成完，认可情节紧凑但指出二三章重复，明确允许换书并提出三项工具修复：前章事实变更后所有自动入口复核下一章、问题及修复指令完整保存传递、证据/结论一致与逐问题补丁处理核对。

本窗口已完成五个代码阶段，当前代码HEAD 94315b5d。用户新开《外卖箱闯金庸》测试，经历第三章规划停顿、建议按钮缺失、最终方案核验覆盖错误、恢复无推进和执行归属冲突；这些阶段的修复与真实观察分开留档。

最新用户说第三章完成，要求全文检查、排查工具bug及制作完整记忆/台账。三章全文已读：交药和奖励真正兑现，二三章没有重演赶路；仍有时间、人物知识、说话人、物件状态错误。第三章由单章生成入口写成，保存为 drafted / needs_repair，不是导演恢复已验收。导演当前为通用 waiting_approval。新发现旧步骤回写机制、语义漏检/错误修复建议及Prompt版本目录漂移，均未在本次打包中修复。

## 2. 环境与唯一真源

| 项目 | 现场事实 |
| --- | --- |
| 应用仓库 | D:/novel/AI-Novel-Writing-Assistant；外层D:/novel的master不是本应用分支 |
| 分支、代码HEAD | codex/book-story-foundation；94315b5d。后续本批文档本地提交，最终HEAD需读Git |
| 改动与发布 | 打包前tracked clean；五个代码阶段已本地提交，未push、未合beta/main、未打包上传；desktop/package.json 0.4.28 |
| 必须保留的untracked | .codex-run/、.playwright-cli/、WINDOW_HANDOFF_2026-06-28_v0320.md、seed-styles.bat、server/dev-probe-node25.db、start-local.bat、stop-local.bat、第1章重写.md、第8章（金庸风格）.md、第一章.md |
| 数据库 | server/dev.db；本次用SQLite mode=ro直接查询，不调用会改变状态的GET，不写真实DB |
| 可复用运行环境 | Node24：C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe；PowerShell读取中文指定UTF8；Python输出设PYTHONIOENCODING=utf-8 |

文档不是服务现场。接手重新核对Git、DB和最新用户操作；不为验证旧快照切分支、清库或重启生产。旧备份仅历史，不是新破坏操作的备份资格。

### 当前书与导演（Oct1读取）

- 小说《外卖箱闯金庸》：cmuocysv9000c4ww0dqghfyhk；导演 cmuoc448h00004ww0son4x49c。
- 三章分别为《箱开江湖急单》2901、《翻山越卡限时达》2556、《回春堂标签疑云》3529原始字符；前两章 approved/completed，第三章 drafted/needs_repair。第三章id cmuod1m7d00sz4ww0h13hsxzr，Oct1 11:30:51.902Z保存。
- 最新task waiting_approval，currentItemKey=chapter_execution，label仍“正在根据当前内容恢复章节执行”，checkpointType=null，pendingManualRecovery=0，lastError=null；11:35:11.935Z更新，说明“当前自动导演步骤需要确认后继续。”
- seed残留 isBackgroundRunning=true、pipelineStatus=queued、pipelineJobId=null；autoExecution实际范围 chapter_range / 1—3，完成2、剩1、next3；completionProfile目标80另存，不能把它当当前自动执行80章，也不能把有正文当第三章已批准。
- 原修复会话 reviewing、1/2轮，候选 cmuod8zju019o4ww07fsdrzyv，technicalError/pendingOperation为空；旧失败总结仍在。原review_existing授权 advice:cf3ccb90-7964-4cb1-9968-3bf5d18aa78f:option-a，grantedAtRound=1。
- 活跃第三章规划v3，候选v5尚未提交。第三章现在已有正文，旧“未写章修复”权限不能直接提交v5；须重新取证并保护已写内容。
- 11:22 continue、11:30/11:34/11:35 approve命令各自 succeeded，只表示命令已处理；08:56/08:57旧失败job和更早人工挂起queued job保留，无新11时导演章节job生成证据。不要直接删历史或清pending恢复。

## 3. 用户目标与不可破坏约束

目标是跨题材接近8—9分的小说框架，以书级大底、因果、人物选择、关系、阅读承诺和长线兑现为先；文笔可人工修剪。既要情节有趣，又要情绪适合处境并让人物鲜活，不能所有角色扑克脸。情绪应改变说话、行动、犹豫、误判、选择和对方反应；允许克制、嘴硬与矛盾，不按表情词数量或固定曲线验收，不强制每章搞笑/热血/泪目。

保持小人物、市井对白、宏大叙事与世界边界。金手指可以无代价直接赠予；禁止的是未经授权的临时便利，不强制苦练或多章铺垫。文学改善不应让已认可的交付/领奖退回反复跑腿。

工程边界：AI结构化理解优先；新产品提示词进Prompt Registry；写前准入仍为当前及同卷后两未写章、持久化两轮预算、来源指纹和事务提交。已写/锁定章节、未保存编辑保护不削弱。正文局部质量债不默认阻断全书，明确质量优先人工暂停与结构性重规划仍保留。运行记录只读，修复/继续/采用在有创作上下文的源页面。遵守磁盘完整AGENTS、wiki及阶段提交规则。

本次用户授权审读、排查、交接及个人记忆更新；未自动续写、改稿、调用付费模型、采用候选、真实恢复、创建聊天、push或发布。用户说测试书不重要不是删库/配置授权。

## 4. 关键进程时间线

### 继承的更早阶段

| 阶段/提交 | 已完成、证据和不能隐去的限制 |
| --- | --- |
| 1bf3ab35 / 325cd6d7 / b633528b / c6714a09 | 小说删除残留、个人写法、世界使用导演模型、第二读者按需、规划门禁与编辑草稿保护等基础；不是长篇质量验收 |
| 0ef2a675 | K3真实三章及模型重试、候选状态、factionId=null、thinking额度、sample3→80范围、部分冻结、合同覆盖、摘要污染与迟到保存等故障链；当时的模型参数不是永久设置 |
| f25a6389 / 6555dbcd | 框架质量计划、场景因果合同、八题材开发评测、1—3章暂停建议；不自动重试，长篇未验收 |
| 61641b73 / 82e4e6ff | 厨神开篇因果/状态漏检与规划建议诊断，已写正文、动作状态和原选承诺证据进入共享链 |
| c0ed9249 / d1e95c46 | 矿区章序、旧候选、稳定ID及后续路线的只读逐叶别名处理，引用不能全局近似放行 |
| f0a7f9bc | 建议上下文无损编码160427→104251字符，保留160000限制，没有加付费摘要调用或静默裁事实 |
| 0ef895af / d1d59861 | review_existing合法无修改清单、采用与stale区别、完整裁决历史、evidence_refresh、新问题basis与可选润色；149独立通过/2skip是历史阶段合计，不与本轮相加；矿区停止后没有第9轮 |

旧长篇与历史样本全部保留。更早Sept28、Sept29完整包保存原调用、备份、失败和阶段细节；不是自动执行待办。

### 上窗口继承的十四个代码阶段

| 提交 | 完成和验收限制 |
| --- | --- |
| db49bce0 | 书级大底、世界边界、人物目标/主线、候选→卷章→写作贯通；87pass/2skip，七题材14候选是人工开发材料，非盲评 |
| 4a317873 | 第三章油纸包/箱体残痕引用及义务revise；263通过，不自动批准旧稿 |
| d5d479e1 | 当前候选/拒收历史、正文/摘要分开；119通过 |
| fdb7db9c | 当前节奏板优先、历史审计与解析错误分类；68通过 |
| de75eedb | 方案独立AI核验、来源/执行绑定、建议最多两次调用；48服务+8前端，最初是替身验证 |
| 0c9c02fa | 独立核验使用第二章实际正文、同源完整凭据复验；53通过 |
| 321e1655 | 义务修订累计账本、幂等A→B→C；250独立通过，缺映射仍拒绝 |
| 28f3ecf5 | 两轮建议隔离旧稿、稳定引文与逐问题重判；三次真实建议共6调用，前两失败第三ready；65通过，当时未代用户采用/生成 |
| 47ae8b27 | 下一章范围不被sample3覆盖；20通过，用户后来第三章4230字符属于《外卖箱通金庸》 |
| 29fd8956 | 第四章从重复买饼/打听/花六文转为交药谈条件；3378→2538字符、前3章不变；160pass/2skip，用户“至少情节合理了” |
| 19337c3a | 第五章同候选复核、背景不自动升义务、单章原子保存、重复PUT；131pass/2skip，真实API成功，其他章不变 |
| 4d2f800a | 明确生成本章/继续入口，区别新增空白章；误建第9章保留 |
| b1c15506 | 局部禁令保留sceneKey、AI决定延期回报、授权即时能力统一；139pass/2skip及匿名真实奖励测试；不是所有质量问题解决 |
| 0aed0312 | 首章前拼接引用进入一次语义反馈重试；真实首轮又编第4章，补反馈第二轮通过；74pass/2skip，只读回放不写正文/恢复 |

c905387f是上窗口文档检查点。外部两个小说Skill只做静态研究，取舍见 [参考研究](../plans/novel-skill-reference-review.md)，没有安装、fork、运行或机械导入。

### 本窗口五个工程阶段与用户现场

| 提交 | 修复结果、证据与真实验收 |
| --- | --- |
| 235ee704 | 自动非manual入口共享准入，前章事实变更复核合同，不重置预算/覆盖已写章；完整问题与指令、前后章来源、逐问题补丁回执。113聚焦+3独立Store通过，共享/服务编译通过。旧独立审查合同未整体迁移；回执不等于最终修稿有效 |
| 25c03c54 | technical_failed暂停分类、running+pending兼容、自己的人工挂起无owner/lease job不误判活跃；80回归、共享/服务编译、client类型检查。用户刷新后能获取建议，随后遇覆盖错误 |
| f9307eab | 每个最终建议内部核验逐项覆盖，不能借另一方案/被删option-b的check；技术失败、历史问题目录刷新。76回归+服务编译。Oct1真实advice v11 / review v6 ready并被用户采用 |
| cd2dbd09 | 原授权从原范围恢复，不落回production_experience_required；GET不拿人工挂起旧job显示执行；源页显式幂等再派发。119回归+编译。08:56真实新job越过旧门禁，但随后遇Q22 |
| 94315b5d | 正常queued/running不改变修复归属，身份与精确CAS分离；类型化规划异常保留候选/预算并暂停、旧监督不覆盖新执行；首次登记startedAt初始化。258独立回归（212复用本轮未变覆盖，后46新跑）+编译；实际executor22补充已覆盖。未代用户真实恢复或生成 |

用户分别反馈新书第一章“又有进步，有一点好看了似乎”、优化节奏板后的第二章“可圈可点”。这些是阅读评价，不能替代状态恢复验收。随后第三章由用户单章生成，最新本批做全文、只读运行核验及3项隔离复现，**没有新增应用修复**。

## 5. 已完成实现与当前观察

已完成能力的模块入口：书级foundation、volume/planningRepair、director/recovery/planningRepair/advice/semanticReview、planner/payoff、runtime/acceptance、runtime/selection、章节准入及生成、workflow恢复、Prompt Registry。完整文件与边界按各wiki和本节观察进入，不照搬过期Prompt版本。

当前实际版本：writer v12、acceptance_assessment v7、review.patch v6、advice v11、advice_review v6；规划版本及其他Prompt要读registry/资产。加载目录还写旧acceptance v6/patch v5，这个声明漂移留待修复。

最新全文结论：第一章接单、第二章翻山避卡并敲门、第三章交药拿甲再接新单，主线有进展；第三章掌柜有谨慎与自保，主人公靠职业话术应对。不能退回重复办同一小事。最新审查引文15/15能定位，但遗漏时间守恒、虚构狼追/盘查回忆、说话人误认、木牌/贴签动作混乱。完整理由见 [前三章质量与工具核验](../evals/framework-quality/observations/2026-10-01-chapter-three-quality-and-tool-audit.md)。

第三章单章POST generate日志与writer/acceptance调用已核对，没有后续补丁；quality_gate succeeded表示检查完成，正文仍repairable。timeline_finalization degraded、抽取失败0事件/钩子走anchor fallback，质量债保留。

## 6. 验证与实测结果

代码回归和模型/用户验收分层：

- 前五阶段测试与编译取相应观察文件，数字不跨阶段相加。最近94315已覆盖其代码，打包没有应用变动，因此不重复构建/完整测试。
- 最新隔离状态复现3/3：实际源码转译、替身DB；旧06:13等待步骤覆盖11:35新running、新授权并发后仍被id-only写回、活跃命令对照不写。证明机制，不证明本次现场哪次GET写入。
- 本次用只读DB核对任务、job、命令、报告/检查点/规划，完整读三章；没有真实模型调用、人工页操作或浏览器测试。UI由用户验收。
- 第三章保存不能证明导演链或规划v5已通过。前两章完成数仍2。已选择的补丁候选和保留原稿分开：首章回执14/14 candidate_selected；二章8/8 original_retained，不能把patched声明说成最终文本已修。
- A/B用户明确B好，但B更多定点反馈/迭代，先有额度耗尽和欠免费跑腿失败稿；阅读版还人工改2处药价/药款→跑腿酬金。A/B不是等调用盲测，不代表自动一次成稿。
- 旧全量测试债（client契约、资源变化最多8项旧断言、ComicFactService内联prompt2处）未本批重测，不能称全仓全绿。长篇/盲评、成本与延时泛化未验收。

最新三章SHA256，前两章与Q22核验时一致：

| 章 | SHA256 |
| --- | --- |
| 1 | fb066423a8cdda065b11861e8e21459a3ee7f64daa389e08746fea9bea81648a |
| 2 | 2921f45543a4afd73f30033420c21f65e5e3d4f0a999ba58739bf34d360c8a2a |
| 3 | 8256480e61dc03c13b6a0689b36f9a89881f4c19e39428ed25bc70de88324e05 |

## 7. 已知问题与临时绕过

| 状态/优先级 | 问题与下一边界 |
| --- | --- |
| 优先定位修复；隔离复现成立 | workflow的healRuntimeGateApprovalState用旧步骤回写新运行，缺时间/当前节点/执行身份和CAS。应保留真正当前门禁，不能全部忽略或清等待；现场逐写因果尚缺trace |
| 语义漏检/错误指令确认，未修 | 引文在正文不等于结论成立；掌柜未传信却被newConsequence/资产理由当因果链，潜在与事实等级不清；令狐冲见证引用不足；补丁备选“空药瓶”无持有依据；当前动作覆盖和跨结论核对不足 |
| 静态确认未修 | Prompt加载目录旧版本声明与v7/v6资产不符；真实v7已跑，不把此说成旧提示词正在运行 |
| 原问题仍独立未修 | Q09旧书promiseChecks三次stop后覆盖拒收/uncertain；后来的旧书完成不证明根因修好。Q10补写越界根因未定位，Q18邻章复核不是原补写原因修复 |
| 未专项实施 | Q11人物情绪，当前scene resistance/turn/emotionalShift与readerExperience多数空；先追上下文、prompt及验收，不堆表情/硬情绪曲线 |
| 长期未完成 | Q12卷多线因果、对手行动、长线人物/关系回归、按需事实召回、单书文风；Q13中段/高潮/终局/留出盲评 |
| 历史验证债 | Q14 prose_negative_flip误报、旧测试、prompt治理；独立requires_replan恢复界面、缺章/整节拍跨范围预规划自然复现仍待查 |

本次没有以DB清理、手改pending、提交旧v5、换模型、跳门禁、关闭审查或多加轮次绕过问题。第三章单章生成是用户实际选择的路径，不宣传为已验证的导演恢复方案。

### 继承首章、第二章停点与情绪线索（不要丢）

《外卖箱通武侠，我送一单得一门武功》首章原始4144字符，writer输出2410+1732+2换行逐字拼接；合同禁止本章取药，补写却完成取药。用户认可其进步，不能简单删后段再把故事推回原地。旧第二章合同重复取药，审查正确指出重复，随后在 promiseChecks source coverage严格校验停住。三个问题分开：补写职责、邻章事实承接、覆盖校验技术失败；还另有情绪单一/NPC工具化。第一章全文与原调用见 [首章观察](../evals/framework-quality/observations/2026-09-30-new-book-chapter-one-emotion.md)。

该书后来第二2874、第三3973，重复首单交付/奖励/新单被用户指出；这两章各一次writer，不是新一次补写越界。旧导演已取消，替代导演已完成，用户说不用再抠这部书，可新开书配合通用修复。

## 8. 未执行与待执行任务

- 新窗口先只读复述，若用户选择继续修工具，优先Q24旧门禁回写，随后Q25语义结论/指令前提/最终选稿效果，Q26Prompt目录一致性；按真实范围做窄回归，不围绕本书人物写分支。
- Q18—Q22工程已完成但真实导演全链未验收；当前第三章有正文后恢复必须重新判定规划候选权限，继续已写保护、原预算和历史，不擅提交v5。
- Q09/Q10/Q11保留，不因新书进步或三章保存销账；其他Q01—Q17见台账，部分完成/待测/取消明确。
- 不自动第四章、旧样本改稿、免费或付费重跑、更多候选/评测、新书创建；长期专项需按用户选定范围推进。
- 未执行push、beta集成、main晋级、桌面发布、长篇生成、独立盲评或新窗口自动读取实测。

### 各样本状态与停止决定

| 样本 | 历史事实与边界 |
| --- | --- |
| 《女尊：流放矿区，下跪续命》 | book cmukwigbj001170w0ekq4trea、director cmukwgxjg000p70w0fn8vrz80；用户8轮后明确停，不第9轮/不第2章恢复，不删除。曾有擦血/符文异常等好戏，失败不抹掉价值 |
| 《祭品厨神：我在禁忌森林开食堂》 | cmukqni0l004y9ww0usot67gs、cmukq9vvf004m9ww0s426950e；两章4147/2936；87分漏绑手进食、水/热源、知识与伤腿动作，不自动续写 |
| 《流放迷雾死地：我的打捞每日翻倍》 | cmujxe1m9000aakw0f1l1mvp1、cmujtcwa9005fr4w0ffh9hvmh；3章2841/3049/2559，4—7只有路线；历史K3，不自动第4章 |
| 《差评变强：外卖小哥闯金庸》 | cmuld5c3u000cfgw0wottax89、cmulcyhz00000fgw07usqxsmg；3章2774/2812/4826，10412字符全文已读；第二章先失败后成功，托盘/工资/临时能力/未交付标送达等缺点不隐藏 |
| 《外卖箱通金庸》 | 历史1—8及误建空白9保留；上窗口第4/5章和A/B的对象，不与新书混淆 |
| 《外卖箱通武侠，我送一单得一门武功》 | cmunqtu1i000crow0t50zaw8b；原导演 cmunqrh820000row0hl6wwn2l 已取消，替代 cmuo85bo4008kkww0sfo2t2kn 已完成。用户不再抠这本，Q09/Q10机制证据保留 |
| 《外卖箱闯金庸》 | 本次当前样本，ID见第2节；三章有正文不等于导演已完成，没有明确自动第4章授权 |

## 9. 关键文件与产物索引

- 启动：磁盘AGENTS.md → [PROJECT_CONTEXT](PROJECT_CONTEXT.md) → [CURRENT](CURRENT.md) → 本完整包 → [WORK_LEDGER](WORK_LEDGER.md)。项目文档不是内置个人记忆。
- 旧全包：[Sept30质量/情绪](2026-09-30_1317Z_quality-and-emotion_thread_handoff.md)、[Sept29全包](2026-09-29_0105Z_full_thread_handoff.md)、[Sept28全包](2026-09-28_0950Z_full_thread_handoff.md)；更早及阶段索引沿旧包进入，不复活旧恢复待办。
- 稳定计划：[框架质量计划](../plans/novel-framework-quality-program.md)、[外部Skill取舍](../plans/novel-skill-reference-review.md)。开发集cases.v1.json/eval脚本不混入正常写作。
- 稳定wiki：[场景因果/证据](../wiki/workflows/scene-causality-and-quality-evidence.md)、[规划修复](../wiki/workflows/planning-repair-loop.md)、[跨章推进](../wiki/workflows/narrative-progression-review.md)、[书级大底](../wiki/workflows/book-story-foundation.md)、[约束/回报](../wiki/workflows/narrative-constraint-scope-and-payoff.md)、[结构预算/恢复](../wiki/workflows/structured-output-budget-recovery.md)、[旧门禁投影诊断](../wiki/debugging/runtime-gate-freshness.md)。
- 本窗口阶段观察：[跨章重复修复](../evals/framework-quality/observations/2026-09-30-cross-chapter-repeat-repair.md)、[恢复建议入口](../evals/framework-quality/observations/2026-09-30-planning-recovery-entry.md)、[建议核验](../evals/framework-quality/observations/2026-09-30-advice-review-coverage.md)、[假运行](../evals/framework-quality/observations/2026-10-01-director-resume-phantom-running.md)、[执行归属](../evals/framework-quality/observations/2026-10-01-planning-repair-execution-ownership.md)、[最新三章全文/工具](../evals/framework-quality/observations/2026-10-01-chapter-three-quality-and-tool-audit.md)。
- 历史文学依据：[A/B](../evals/framework-quality/observations/2026-09-30-reader-pull-comparison.md)、[首章/情绪](../evals/framework-quality/observations/2026-09-30-new-book-chapter-one-emotion.md)、[首章引用回放](../evals/framework-quality/observations/2026-09-30-new-book-payoff-citation-recovery.md)、[更早开篇](../evals/framework-quality/observations/2026-09-28-delivery-opening.md)。
- 私有工程证据：.codex-run/cross-chapter-repair/targeted-tests.txt；recovery-entry-20260930/seed.json及targeted-tests.txt；advice-coverage-20260930/请求/响应/来源/建议/测试；director-pause-20261001/task/jobs/commands/chapter-hashes.json及测试；repair-ownership-20261001/原始任务、jobs、commands、tests、server-build、final-readonly-integrity。
- 最新私有证据：.codex-run/chapter3-acceptance-20261001/ 下 chapter-1/2/3.md，novel/task/chapters/jobs/commands.json、AuditReport、ChapterArtifactSyncCheckpoint、ChapterAutomaticAttempt、ChapterSummary、VolumeChapterPlan、DirectorStepRun.json，隔离reproduce-stale-gate.cjs与stale-gate-reproduction-result.json；原始 .logs 文件按请求/事件抽取，不反复输出全请求。
- 新缺陷的准确入口：server/src/services/novel/workflow/NovelWorkflowHealingService.ts；server/src/prompting/prompts/novel/acceptance/progressionEvidence.ts；server/src/prompting/registry/promptAssetLoaderEntries.ts；server/src/prompting/prompts/novel/chapterAcceptance.prompts.ts及chapterPatchRepair.prompts.ts。服务修复先读模块README与wiki，不扩张已有超长文件。
- 个人记忆更新：C:/Users/lyaxu/.codex/memories/extensions/ad_hoc/notes/20261001T1153Z-novel-three-chapter-handoff.md，仅小型入口索引与长期边界；没有直接改MEMORY.md，不宣称新窗口已自动加载。详细证据仍在项目包和台账。

## 10. 下一窗口启动顺序

1. 完整读磁盘AGENTS、PROJECT_CONTEXT、CURRENT、本包与WORK_LEDGER，当前文学问题再读最新三章观察；不要只读旧Sept30入口。
2. 只读核验实际root、branch、HEAD、dirty与最近提交；保留10项untracked及本机证据，不切外层master、清理或新开checkout。
3. 若用户已操作新书，只读DB核对最新正文/哈希、规划/候选、导演、jobs/commands及审查。GET存在healing写入风险，排查时优先SQLite mode=ro，不POST、不调用模型来检查状态。
4. 复述三类证据：代码五阶段已修；用户三章进步；当前第三章手动生成且needs_repair、导演等待与新缺陷仍未修。保留首章进步、旧第二章promiseChecks、补写越界和Q11情绪要求。
5. 待用户新指令选择一个通用修复范围；若修恢复，先做旧步骤新鲜度/CAS，严格区分当前规划暂停、质量优先暂停和历史等待；书稿与已写保护不碰。

## 11. 待确认事项与风险

交接资料就绪；本代理没有在途模型、真实DB写入或应用改动，可换窗口。工具尚有未修缺陷，不称全链验收就绪。用户后续操作可能使快照过时。

本批是内部文档与私有隔离诊断，未新增产品功能；依readme-release-updater检查范围后跳过README/发布说明，保留之前代码阶段的既有发布记录。依仓库AGENTS阶段完成规则做本地文档提交，不push。文档链接与状态/哈希再次核验，应用未改，复用94315工程检查；没有无关全量构建或浏览器验收。

旧“Unlimited只读回放”只授权同范围核验，不授权无限付费调用、写书或恢复。旧自动审批拒绝及后来追加授权留在台账，不重复问同一已授权范围，也不偷偷扩大。

12:07Z文档验收：52个内部链接均存在，完整包12节、台账Q01—Q26连续；个人记忆注记存在，三章正文/更新时间与初次快照一致，导演仍11:35通用等待。结果在私有handoff-integrity.json。CURRENT将在本包存在并审计后更新，随后再审计入口和Git范围。

所有测试数、模型分数、调用时间和当前配置只描述当时范围。完整引文定位不等于语义正确；候选回执不等于选稿后事实；检查点succeeded不等于章节批准。新窗口必须先核验当前状态才能实施。

## 12. 可直接发送给新窗口的开场提示

> 接手 D:\novel\AI-Novel-Writing-Assistant。完整读取磁盘AGENTS.md、docs/handoffs/PROJECT_CONTEXT.md、CURRENT.md、其链接的完整交接包和WORK_LEDGER.md。先只读核验并复述：继承与本窗口五阶段修复、第一章进步、旧第二章promiseChecks停点、补写越界及情绪要求；最新《外卖箱闯金庸》三章有正文但第三章needs_repair，来自单章生成，导演等待和新发现的旧门禁回写/语义漏检/Prompt目录漂移仍待修。保留所有书稿、失败历史、候选、预算及未提交文件；不自动恢复导演、采用旧v5、改稿、生成第4章、调用模型、切分支或push。先告诉我接住了哪些已完成、未完成与验收边界，再按我的新要求推进。
