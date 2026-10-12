# 原任务恢复后的审查状态契约失败

现场：2026-10-11 18:20:24—18:20:54 UTC。更新：2026-10-11 23:41 UTC-5（10-12 04:41 UTC）。用户点击继续后运行数十秒再次中止；本轮代理只读现场、离线修复，不发起模型或恢复。

## 事实与根因

- 源页POST已返回202，命令cmv45ezlc0000l4w0in4uc9xj成功。原job cmv3x3pr500r7gow0pt92xbmt从第一章审查继续，模型次数6→8，没有重建job或重写第一章。
- 两次DeepSeek审查均正常stop，没有输出额度、网络或JSON失败；acceptance v8第一次回答和一次语义纠正都重复同样五处状态错误。模型自报accepted/87分不是验证通过。
- scene_1/scene_3/scene_4把stateChanged=true与transitionStatus=not_needed、空过渡证据同时提交；scene_1/scene_4以行动前认知引文证明行动后状态。此次引文原文本身及三项progression检查均通过。不要沿用首次失败“造假引文”的诊断。
- 主因分类6：模型结构化审查不自洽。次要因素4：纠正反馈只有场景级英文码，缺states字段下标与具体冲突值；模型纠正后基本照抄。正常产品路径可再次产生。
- 另发现分类5实现缺陷：提示允许unknown且证据数组空，校验却无条件要求afterEvidence定位，诚实未知会被反复当无效回答。这不是本次五错直接原因，但会堵住提示推荐的纠正出口。

原始日志：`.codex-run/maoshan-full-entry-recovery-20261011/20261011-130618-old-server.llm.jsonl`，两次响应已脱敏ID固化为`server/tests/novelProduction/fixtures/resumedFirstChapterReview.json`。复现须使用一致chapterId；旧fixture为chapter-1、日志为实际ID，混用会制造虚假的引用来源错误。已核对现场请求包含与旧fixture完全一致的3013字正文。

## 修复范围

接收提示升v9。行动状态校验输出字段级纠正说明，包括states下标、冲突值、action/after引文与时序要求；添加动作自身导致变化的中性示例。未改变AI负责语义判断的边界，未自动更正模型布尔值、放松逐字引文检查或增加纠正预算。

仅在afterEvidence为空、动作insufficient_evidence、状态unknown三者同时成立时允许缺失的after证据作为诚实未知；仍投影为风险与质量债，不认证earned、不据此修文。已提供却无效的证据、earned缺证据仍拒绝。

离线测试覆盖两次真实响应重复失败、具体纠正反馈、手工构造的一致回答、纠正耗尽继续暂停、网络/额度终止；明确未知经过postValidate/完成闸门/服务投影及五类反例。手工修正只在测试内，未写回小说，不是新的模型成功证据。

最终验证：服务端`tsc -p tsconfig.json`通过；封网组合7文件71/71通过（actionStateAcceptance、chapterProgressionAcceptance、chapterAcceptanceAssessmentService、acceptanceIssueRetention、causalAcceptanceProjection、firstChapterReviewRecovery、acceptanceCache）。日志位于`.codex-run/maoshan-review-contract-20261011/tsc.log`及`offline-tests.log`。未重复整套352项恢复测试，本轮未改恢复路由、job/journal或数据写入；用户UI及真实模型仍待验收。

## 数据与加载边界

04:41 UTC只读预检：首章3013字符、SHA256 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`未变；仍原job、1—3范围、人工暂停；可自动执行的job/command/director/sideEffect均0。本导演17:00后模型记录2条，均为用户18:20触发，代理0次。

旧后端3000 PID51304仍运行旧提示v8，health stale=true；旧前端5190 PID45328，新版5173/8787仍3960/21116。数据库未写入、新版未动、历史误建job保留。

新重启入口仅针对核验过的旧后端PID/启动时间，检查稿件hash、原job/暂停/范围和无待运行工作，再沿原隔离配置启动；不触发continue。路径`.codex-run/maoshan-review-contract-20261011/restart-old-review.cmd`。不要重跑上一版固定旧PID的脚本。加载与最终测试结果见[CURRENT](../handoffs/CURRENT.md)。

源码提交c16169dd。04:44 UTC新脚本Windows PowerShell CheckOnly通过；实际尝试在管理员身份检查停止，未停止或启动服务，agent-restart.log保留证据。此处是Windows管理员进程权限要求，不是磁盘授权或自动审批策略拦截。待用户管理员运行新cmd，固定日志restart-last.log，加载后再核验。本段与CURRENT为内部运行事实补记，无额外用户能力，发布说明不重复追加。

运行提示v9后，再由用户从[本书第一章原工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)继续原审查。真实模型、后续章节与十章验收未完成，不能承诺一次通过。规则见[接收证据模块](../../server/src/prompting/prompts/novel/acceptance/README.md)，历史入口故障及维护时间故障保留在[上一轮证据](2026-10-11-maoshan-recovery-cas-timestamp.md)。
