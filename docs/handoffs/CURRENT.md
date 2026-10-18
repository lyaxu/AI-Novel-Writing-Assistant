# 最新交接入口

2026-10-18 11:16（北京时间）。[完整交接](2026-10-18_1116_initial-contract-closed-loop-loaded.md)。**通用初始合同生成、完整响应纠正、语义/窗口复核及无候选恢复已完成并加载；现有新旧书均暂停，由用户发起真实恢复。**

仓库D:/novel/AI-Novel-Writing-Assistant，codex/production-core-refactor，lyaxu。代码91f7fcabae1702afea2463390dab749444162ee9已推送且远端一致；交接文档随后单独推送，不合并main/beta。Node24.19.0/source，3000/PID21984、5190/PID38620，加载91f7fcabae17/stale=false。固定D:/novel/.comparison/2026-10-10/old-test.db，无迁移。

验证：shared/server编译、client类型检查通过；631/631离线回归及随后新增1个完整组合回归通过（初始恢复文件56/56，不叠加总数）。独立末世/修仙/武侠真实生成及复核通过，故障注入单次纠正通过；21次434611 tokens，含首批9次153293通用格式边界缺陷失败，完整留档。3次无效key401无生成tokens单列。[观察报告](../evals/framework-quality/observations/2026-10-18-initial-contract-generation-recovery.md)。无真实用户正文生成，UI/文学/十章待验收。

新书《零下八十度，我买下地铁站建城》novel cmvcmyfvt000c14w05b61rm5w / task cmvcmumqq000014w0ycmxc44s，仍waiting_approval/pending1、planning waiting_confirmation/0/2，无候选、两章空稿，24调用/258227 tokens。真实GET初始纠正available=true、当前1、原范围1—3、单次纠正1，未POST。用户刷新本书→节奏 / 拆章→章节规划修复→勾选确认→纠正初始规划并继续。不要在运行记录操作，不擅扩到十章。

旧五章书cmv3wyvw40015gow0780pycx9/task cmv8d55el0033z8w0hneoiiru继续冻结；32调用/1396340 tokens，候选/五章hash/暂停不变、第6章空。重载前后两书保护一致。用户已删除极寒旧稿直接重写，不再索要原稿。start-local.bat仍固定旧库并打开旧书入口，新书用本页交接中的源页链接。

三个Structured组件、台账历史964行与本地资料保留。人物规划/候选改名独立验收及dashboard待办保留。下一步先确认用户最新执行状态再处理，不能把24/32调用当永久值，也不代点恢复。