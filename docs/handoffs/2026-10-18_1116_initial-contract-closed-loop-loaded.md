# 初始规划生成、纠正、复核与恢复闭环已加载

## 接手摘要

2026-10-18 11:16（北京时间）。用户授权按通用评估实施，不针对新书打补丁；必要模型验证、测试、推送、重载及台账/记忆同步。本轮代码完成并推送91f7fcabae1702afea2463390dab749444162ee9，服务已加载该版本。三份独立末世/修仙/武侠素材真实生成后经语义与窗口复核通过，另有单次完整响应纠正通过。新旧书仍暂停，真实恢复由用户从源工作区发起。UI与正文文学验收未通过/未执行。

## 环境与唯一真源

仓库D:/novel/AI-Novel-Writing-Assistant；分支codex/production-core-refactor；remote lyaxu。未合并main/beta。代码91f7fcab已推送且远端核对一致，随后交接文档单独提交。固定库D:/novel/.comparison/2026-10-10/old-test.db；Node24.19.0/source。11:15:30后端启动，3000/PID21984；前端5190/PID38620。11:16双端health均gitHead91f7fcabae17/stale=false。

## 用户目标与不可破坏约束

工具必须跨书跨题材跑通，不按书名/人物/金额设特例。用户已删除旧极寒原稿并直接重写，不再等待7—8章原文。旧五章书冻结回归，新极寒书保留当前暂停；代理未发任何真实书恢复POST。未迁移、改书稿、改模型配置或选择新候选。三个Structured组件与台账历史964行及本地资料保留未提交。人物/候选改名独立验收与dashboard原待办未取消。

## 关键进程时间线

- 上轮01:16仅诊断：双向声明图、纠正缺完整输出、无候选恢复缺口；0d8db5a8文档已推送。
- 本轮实施场景单一归属生成协议，完整响应纠正及单次恢复；工程测试发现/修复遗漏mock不涉及产品退化。
- 独立模型首批三份新合同均成功生成，但质量预检误用新生成格式解析保存格式，额外消耗两轮修复。9次153293 tokens全部保留，未隐去失败。
- 修复canonical校验边界，并把非明确合同诊断的程序异常直接抛出，禁止当作剧情缺陷购买修复；复用三份已付费候选继续复核，未重生成或追加轮次。
- 独立复核8次209027 tokens全部通过；缺失引用故障注入完整响应纠正4次72291 tokens通过。所有请求已结算停止。合计21次434611 tokens，另3次无效占位key401无生成输出/tokens单列。
- 代码91f7fcab推送后核对空闲及两书保护，确认进程归属后停止原服务2632/60636，经固定启动器重载21984/38620；未自动恢复。

## 已完成实现

- task_sheet v13、execution_contract v14、planning_repair v14：模型在entryClaims/actionClaims/afterClaims中只表达一次归属；顶层仅前文声明，程序投影现有保存格式，不猜剧情、不截断事实。首章入口可建立符合设定的初始处境，不冒充前文事实。
- 保真JSON信封，严格字段/关系在后处理验证，完整拒收响应及逐路径错误交给有界纠正；JSON完整返回但格式不合法也保留原文，输出上限/未知传输仍终止。执行合同不使用隐藏模型/策略/传输重试。
- bindStateClaimContract只做新生成投影；validateCanonicalStateClaims只验证保存格式；质量门只把明确合同错误作为修复依据。
- 初始无候选拒收独立retry_initial_contract恢复；绑定响应、来源、已选方向、模型/写法/指导、原job、settled回执、范围与预算；空稿、租约、未知结果、取消和漂移拒绝。初始两次上限持久化；每次显式确认最多纠正一次，重放不续赠，历史未知次数不伪填0。
- 源页提供“纠正初始规划并继续”，说明费用与原范围；没有有效候选时不提供无法执行的收费建议。运行记录只读，普通继续不能越过专用授权。

## 验证与实测结果

- shared/server TypeScript构建、client类型检查通过。32文件631/631离线回归通过；随后新增1个同fixture组合回归，所在初始恢复文件56/56通过，不重复叠加计数（唯一用例总632）。
- 组合回归覆盖grant→原job reconnect→同seed Coordinator→真实生成服务/资产后处理/保存格式→真实质量来源预检→窗口→commit；仅模型与持久化适配替身，原job/空正文/轮次保持。
- 三题材实际模型生产生成/复核与一次纠正的结果、失败和费用见[观察报告](../evals/framework-quality/observations/2026-10-18-initial-contract-generation-recovery.md)。持久层为隔离JSON，不冒充真实数据库恢复或正文验收。
- 新版本真实只读GET /api/novel-workflows/cmvcmumqq000014w0ycmxc44s/planning-repair/initial-contract：available=true，第1章，范围1—3，remainingRounds2，correctionCalls1；未POST。旧书对应初始入口false，候选复核与原策略入口保持可用但不执行。
- 浏览器、截图及人工交互按仓库规则留给用户；无需重跑完整客户端打包或桌面安装包。

## 已知问题与临时处理

真实模型审查仍可能首次引用不合法，当前有界纠正通过；不能承诺所有书永不暂停。首批隔离脚本缺外部停止门导致余下固定批次结算后才停，现脚本增加call前STOP及失败即停，原失败未丢。保护脚本原比较含undefined导致JSON基线假差异，使用protect-normalized.cjs规范化后完整保护一致，无业务数据差异。

## 未执行与待执行任务

1. 用户刷新新书源工作区→“节奏 / 拆章”→“章节规划修复”→勾选一次纠正及后续费用确认→“纠正初始规划并继续”。核对界面范围第1—3章，按钮只点一次。通过后继续原范围；失败保留响应，先刷新状态再调查。
2. 新书三章正文完成后用户审读节奏、人物选择与连续性；固定版本十章另行安排，不扩大原范围。
3. 旧五章书继续冻结，不为验证功能再恢复。人物规划/候选更名另用独立样本。

## 关键文件与产物索引

- 新书cmvcmyfvt000c14w05b61rm5w，task cmvcmumqq000014w0ycmxc44s，job cmvcn253t00my14w0b4wzmngo。waiting_approval/pending1，planning waiting_confirmation/0/2，无candidate，第1/2章空；调用24/258227 tokens。
- 旧书cmv3wyvw40015gow0780pycx9，task cmv8d55el0033z8w0hneoiiru。原candidate cmvc62qaf0007mww08k8tpvlv、waiting_approval/pending1/0/2；32调用/1396340 tokens。前5章hash不变，第6章空。
- 完整保护哈希：.codex-run/initial-contract-20261018/protected-before.json与post-reload-protection.json。两任务、正文、GenerationJob/VolumePlanVersion/DirectorRunCommand哈希保持。
- .codex-run/initial-contract-20261018/：shared-build.log、server-build-final.log、client-typecheck.log、regression-final.log、loaded-api.json、initial-readonly-preflight.json、protect-normalized.cjs。日志/库/原始响应不提交。
- 新恢复实现：director/recovery/planningRepair/application/PlanningRepairInitialContractService.ts和domain/initialContractAcknowledgement.ts；UI InitialContractActions.tsx。
- 通用协议：prompting/prompts/novel/volume/contracts/sceneOwnershipProtocol.ts、evidence/stateClaimBinding.ts、volume/chapterDetail/chapterExecutionContractGeneration.ts。

## 下一窗口启动顺序

AGENTS全文→PROJECT_CONTEXT→CURRENT→本页，核对dirty与实际服务。先确认用户是否已经点击恢复及最新调用/任务状态；24/32是本次交付时事实，不是永久值。未获用户新的明确操作，不代点恢复。恢复后的问题先看通用链路与完整原始响应，不按书补剧情。

## 待确认事项与风险

代码完成、已推送、已加载均已验证；真实新书恢复、UI操作、正文文学与固定版本十章尚未验收。现固定start-local.bat仍打开旧回归书入口，数据库正确；本次新书请使用下面准确链接或从书库选择，不把旧书继续当新书继续。

## 可直接发送给新窗口的开场提示

读CURRENT及11:16闭环交接。通用初始合同生成/纠正/复核/恢复已实现并加载91f7fcab，独立多题材和一次纠正真实模型验证完成。先只读确认用户的新书是否已经继续；保护旧五章暂停，不重复付费、不按单书补丁。

新书源页：http://127.0.0.1:5190/novels/cmvcmyfvt000c14w05b61rm5w/edit?directorTaskId=cmvcmumqq000014w0ycmxc44s