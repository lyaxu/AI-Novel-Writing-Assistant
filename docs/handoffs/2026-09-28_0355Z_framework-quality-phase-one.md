# 小说框架质量首期交接

## 用户目标与最新偏好

用户明确要求：以具体书和章节发现工具的问题，不把精力放在修好这本样书；目标是跨题材接近8—9分的框架，优先合理性、情节、人物及长篇关键环节，文笔次之。后续补充要求评测覆盖东方玄幻／修仙和传统武侠。

题材样例不自动进入正常写书提示词；进入工作流的是通用合同和证据核验。开发集含八类题材十六例，正例允许越级破局、失败、拒绝和有限回报。详见 [质量计划](../plans/novel-framework-quality-program.md)。不要回到单书润色，也不要宣称一次工程修复已实现8—9分。

## 已核验环境与范围

- 仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/fix-task-cleanup-personal-style`，接手HEAD `2bbb6d83`。
- 本快照与首期实现同次本地提交；最终HEAD使用 `git log -3 --oneline` 核验。未push、未合并beta/main、未新建任务或worktree。
- 数据库以只读URI查询，未写入本书。2026-09-28约03:55 UTC再次核验原任务 `cmujtcwa9005fr4w0ffh9hvmh` 仍 succeeded/workflow_completed/lastError=null；范围仍sample3。
- 样本小说 `cmujxe1m9000aakw0f1l1mvp1` 前三章仍为2841/3049/2559字符，approved/completed；4—7章仍仅零正文路线。最新两条job为succeeded。
- 本轮未发起模型生成、重试或新书。`.codex-run/`、`.playwright-cli/`、probe db、bat、旧交接及旧中文书稿保留且不纳入提交。

## 已完成的通用修改

1. 规划投影补回宏观expansion/major_payoffs与真实查询中的人物动机、底线、禁忌等字段。关键规划块不可机械截断；详细人物12个、简名册24个，结构化主角/对立位优先，超额明示。仍未实现按卷动态相关性筛选。
2. 新场景要求AI生成因果结构，包含前提来源、选择动机、阻力回应、结果机制和持续限制。旧sceneCards兼容读取；normalize/serialize保留新字段。writer/review/repair共用必需不可裁的scene_causality块，broker与Prompt Registry版本同步。
3. 接收结果逐场给证据与earned/unearned/contradicted/insufficient_evidence，机械校验覆盖范围；服务把失败结论投影成现有局部修复/风险，全部证据进报告元数据。缓存与调用共享场景范围输入和输出额度：3200基础+每场512，最多8场7296，路由仍可按模型调整。
4. 修稿选取核对严重问题的原文证据位置，避免仅换code/提级而回退已修稿。新增/改写风险或证据未知仍保守保留原稿，风险不被删除。
5. 八题材开发集及离线导出/评分脚本，答案不进入问题包；统计缺项、引用定位、召回与误报。脚本不连接DB或模型，已知答案测试不是模型成绩。

相关稳定边界见 [场景因果与质量证据](../wiki/workflows/scene-causality-and-quality-evidence.md)。没有改变写前两轮窗口预算、已完成正文的质量债策略、质量优先人工暂停规则。

## 样本证据与诊断

- 原前三章全文：`.codex-run/recovery-20260927/first-three-chapters.md`。
- 原请求日志：`.logs/2026-09-27/2026-09-27T12-20-46-dev.llm.jsonl`。第一章379/380初审、381/382patch、383/384复审：茶盏在修稿消失，但两稿都存在的“雾比他想的冷，湿意顺着衣领往骨头里钻”被重新判为严重越界，旧选稿器整稿回退。DB repairSelection=original_retained_new_severe_issue，原稿88/候选87。
- 第二章402/403、406/407；第三章418/419。半掌罗盘含嘴三天、重伤搬尸等问题有的已在完整当前正文或状态中，并非全由裁剪造成。短刃有“今晨打捞”的事后陈述，但缺可信取得与衔接，不能误说正文完全未提来源。
- 接收上下文只含前章有限尾段，部分世界/历史材料被裁掉；新合同尚不解决所有历史事实检索和物理常识判断。需在后续阶段补证据检索，不能用字段齐全宣称根治。

## 验证与缺口

- shared build、server build、client typecheck均通过；最后一次server build在输出额度共用函数修改后通过。
- 18个针对性测试文件，218个唯一用例：215通过、2原有跳过、1原有失败。重复运行不累加。
- 原有失败：`server/tests/chapterStructuredOutputNormalization.test.js:103` 断言章节资源提取不允许9项，而HEAD的 `chapterArtifactDelta.prompts.ts` 已无max(8)。该生产文件本轮无diff，未扩大修复范围。不是本轮新增schema失败。
- 主代理覆盖54例（7文件），因果合同代理覆盖156例（10文件），验收缓存8例（1文件）；选稿9例和流水线14例已包含在主代理54例内。
- 新增真实作品质量改善尚未验证；没有做付费跨题材调用、独立盲评、整本生成或UI验收。开发集完美答案仅用于验证统计器，不计模型成绩。
- 必需上下文变多会增加输入量，逐场证据也增加输出；实际时延、费用与供应商格式稳定性须后续实测。

## 下一步

按质量计划推进书级/卷级因果、对手行动与人物关键选择的持续性，以及长篇来源检索和伏笔回收验证。先选小批固定框架输入做旧版/新版对照，保留模型、参数、Prompt版本和上下文；用留出题材及独立读者复核，不把开发集背熟当作通用能力。

新的窗口先读PROJECT_CONTEXT、CURRENT及本快照，核对branch/HEAD/dirty；默认不自动新开书、续写第四章或重新生成已有三章。此前运行恢复历史见 [前三章实跑交接](2026-09-27_1852Z_first-three-chapters_thread_handoff.md)。
