# 初审通过后候选复审再次中止

现场：2026-10-12 00:35—00:36 UTC-5（05:35—05:36 UTC）。修复记录更新00:45 UTC-5。用户在v9加载后继续，约一分钟再次停；原job仍为cmv3x3pr500r7gow0pt92xbmt，首章cmv3x2mt600jsgow0e6kb0852。

## 真实调用与数据

一次用户继续产生四次正常stop调用：v9原稿审查→v6局部补丁→v9候选复审→v9一次语义纠正。原稿初审已通过证据核验，上轮状态字段修正生效；不是重新遇到同一初审故障。

模型初审accepted，但既有正文检测标出破折号与短句问题，运行时另记录伏笔1—3章窗口推进提醒，进入原有一次局部修订。原稿评估meta repairable/repair_once、义务satisfied，原稿问题未消失。候选3265字因复审失败未选用；Chapter.content仍3013字，SHA256 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`。候选SHA256 `dbd24c04c577d67e5a2e70681d06b230b3642fb3c0f139a0365568535c5fcd6b`保存在journal。

journal已完成pipeline.review:0、pipeline.repair_budget、pipeline.repair；pipeline.review:1和候选evaluation失败。重启不应丢失原稿评估、候选或预算。第一章未正式定稿、第二章为空；原范围1—3，当前数据库只有前两章条目，后续规划及十章验收未完成。

05:44只读预检：原任务/原稿/候选hash/暂停均匹配，活跃job/command/director/sideEffect为0；本导演10-11 17:00后模型记录6条（上次用户2条+本次4条），原job总调用12。代理模型调用0，未写实际数据库。

## 分类与根因

主因4（功能闭环不完整）：候选复审抛CHAPTER_REVIEW_INCOMPLETE发生在择稿之前，原稿虽已有有效评估，保留原稿的分支仍无法运行，局部修订失败变成全任务审查暂停。

次因5（实现缺陷）：首章三个跨章比较明确not_applicable且无比较主张，校验仍要求currentEvidence。另有模型因素6：两条beforeEvidence实际位于所选行动之后，两次回答都未纠正。不能放宽这两条时序错误，也不能将候选标为审查通过。

原始证据：`.codex-run/maoshan-review-contract-20261011/20261012-001515-old-server.llm.jsonl`。真实候选正文及两次复审、有效原稿回答已脱敏ID固化为`server/tests/novelProduction/fixtures/firstChapterCandidateReview.json`。必须用候选3265字回放候选复审，不能误用3013字原稿而制造来源错误。

## 最小修复与边界

- 接收资产v10允许没有比较主张的not_applicable空引文；仍查提供的引文、实际推进/停滞主张、后章缺前文。beforeEvidence错误反馈精确字段和行动/引文边界。
- 仅已有有效原稿评估且候选复审明确返回CHAPTER_REVIEW_INCOMPLETE时，持久化候选拒绝结果及原始无效回答，保留原稿/原评估/原债。候选未认证、未覆盖，patch回执仅留在原尝试记录，不计为原稿已修复。
- 既有质量闭环负责继续或暂停：完成优先保留债务继续，质量优先仍人工暂停，原稿明确重规划仍停。不捕获网络未知、output_limit、取消、存储和所有权错误，原稿初审未完成仍暂停。
- 下游提交失败恢复不重新修文/复审候选、不重新消耗预算。操作完成时清除顶层未完成错误，失败步骤证据保留。

## 验证

服务端tsc通过；15文件179/179封网组合通过，包含真实原稿与两份候选回答经实际Prompt Runner/校验/完成闸门进入管线、真实journal步骤、候选拒绝、旧输出兼容、下游提交故障重入、初审失败及六类终止反例、质量优先/完成优先/原稿重规划分流。其余外部写入/模型为替身，不能当作正式模型或文学验收。

证据目录`.codex-run/maoshan-candidate-review-20261012/`：tsc-final.log、final-tests.log、live-preflight.json。原三Structured客户端改动与台账历史964行未提交追加保持原样。本次依仓库规则更新wiki/模块边界、发布说明/README、CURRENT及台账；不push/合并。

## 加载与下一步

旧后端3000仍PID25564/HEAD623ff6c05967，尚未加载本轮；新旧端口隔离不变，新版5173/8787 PID3960/21116未动。新入口`.codex-run/maoshan-candidate-review-20261012/restart-old-candidate.cmd`按当前旧后端PID/启动时间、10个源码hash、原稿/候选/原任务/预算/暂停核验，沿原隔离配置启动，不发送continue。05:44 CheckOnly已通过。

代理随后实际运行在管理员身份检查处停止，未停启任何进程；agent-restart.log保留结果。这是Windows管理员身份边界，非磁盘权限不足或自动审批拒绝，仍须用户管理员运行后核验。

待管理员加载后，由代理看restart-last.log/health/只读预检，再指导用户从原第一章源页继续。恢复应复用原稿评估和补丁，进入候选复审及选稿/保留原稿处理，不重生成第一章、不再领取修订预算。真实候选审查、后续资产状态提交、下一章规划和十章验收仍未完成。统一入口[CURRENT](../handoffs/CURRENT.md)，上一轮[v9初审修复](2026-10-11-maoshan-review-state-contract.md)。
