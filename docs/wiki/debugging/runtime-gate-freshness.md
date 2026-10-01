# 运行门禁投影的新鲜度与并发边界

## 背景

自动导演同时持久化任务、命令、章节job、步骤审查和恢复授权。读取阶段的healing会尝试修正失配状态；如果把历史等待步骤当成当前门禁，新批准任务在命令完成后可能又回到等待，且界面只有通用“确认后继续”。章节有正文或命令succeeded都不能证明导演范围完成。

## 当前规则与实现缺口

有效门禁必须属于当前阶段和执行代次。不能仅以本任务最新步骤的waiting_approval/blocked_scope覆盖运行任务；历史步骤可以保留，但没有新鲜度、节点、授权及执行身份凭据时不应产生新的恢复决定。真实规划确认与质量优先人工暂停仍须保留，不能为解决假等待统一改running。

当前 NovelWorkflowHealingService.healRuntimeGateApprovalState 仅选择step状态、标签与policyDecisionJson，缺少上述凭据；updateTaskWithRetry的where仅id，查询后并发批准仍可能被覆盖。该路径是待修缺口，本页不表示已落地新鲜度/CAS保护。

## 推荐诊断顺序

1. 用SQLite只读连接核对task、命令、job及step的实际状态、时间和节点，不先通过有healing副作用的GET追状态。
2. 区分命令处理成功、job实际启动、正文保存、接收批准、资产同步与导演范围完成。seed内isBackgroundRunning/pipelineStatus可能陈旧，不能单独判运行。
3. 用隔离依赖复现实际源码方法：旧等待step与新批准running、查询间并发新授权、有活跃命令的对照。保存源码哈希和读写条件；这证明机制，现场具体写入因果还需trace。
4. 修复应核对当前有效门禁并用精确CAS保护状态/执行身份。冲突后重新读取，不覆盖新授权、取消或人工暂停；不靠小说名、报错文案或章节序号路由。

## 关联边界

单章入口与导演恢复是不同执行来源。未提交的未写章候选在正文产生后不能按旧权限提交；恢复要刷新创作事实和保护状态，预算与历史不重置。章节局部needs_repair按既有质量策略处理，不因状态投影修复变成全局重规划。

具体样本和复现材料见[三章核验](../../evals/framework-quality/observations/2026-10-01-chapter-three-quality-and-tool-audit.md)，长期恢复边界见[规划修复](../workflows/planning-repair-loop.md)。运行记录只提供状态和源页导航，修复/继续操作仍在源工作区。
