# 最新交接入口

更新：2026-10-13 10:15 UTC（用户时区05:15 UTC-5）。

**最新停点：v15真实审查再次失败，阶段3整体收敛未完成。本轮完成只读诊断、失败样本与回归留证，未修改产品代码；不要重复点继续或运行旧重启脚本。**

## 当前事实

用户09:55继续原审查，v15两答正常stop（21.886s/19.535s），无格式修复。首答漏两场景及拳术回叙；纠正补齐后又因前章证据回叙标签、对白后句既有知识时序被拒绝。全文另确认知识主体、能力/物品/身体维度、场景因果顺序与修文依据误判。仅改两个时序标签即可机械过检但仍保留错误建议，证明阶段3语义收敛未完成。10:15只读核验两章3013/3652字hash未变，原review暂停可恢复，调用31、代理0、活跃0；本轮不改产品代码、不重启、不调用模型。

仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor。接续a115a16612f2，运行生产代码0988e0dca456/v15；旧3000/PID11680、应用启动2026-10-13T09:31:48.092Z、stale=false，前端5190/PID8500，新版未动。预存三个Structured客户端改动与台账历史964行保留。

隔离DB D:/novel/.comparison/2026-10-10/old-test.db；书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke，原job cmv5h9a64000j20w0uw4cxeo0，failed/manual1/reviewing，job2—2、导演1—3。首章3013字completed，第二章3652字drafted，两章hash与账本committed均不变；准备/合同/章计划/draft/save_draft done，原review失败。

## 本轮诊断与证据

[最新完整快照](../evals/2026-10-13-v15-review-semantic-gap.md)；上一轮[工程修复与加载](../evals/2026-10-13-review-contract-convergence.md)保留历史。2份v15原答并入统一目录，共17真实回答（16失败+1有效原稿）；21项针对性封网复现通过。仅改两个时间标签即可过机械门禁却保留错误建议的反事实测试证明语义缺口，不代表审查成功。生产代码未变，复用此前453项及编译，不叠加重复计数。

## 下一项完整范围

继续阶段3：来源/快照严格验证，故事时间与叙述位置分离；关键行动/子动作边界与前态/前提/后态/结果统一；同人物同维度判断和场景因果对齐；修文建议须核实已有正文是否真的不足。未知与审查自身错误不能被当成正文缺陷，也不能把所有问题堆成全局硬停门禁。不得只放过当前两条再交用户试。

本轮不重启、不自动模型、不修DB、不实施新的产品契约；下一步产品修复需先完成上述设计与反例，不将讨论记为已实现。原review可恢复，但目前保持现场；修好后才从第二章源页原任务审查继续。旧29调用维护脚本已过期。

## 未完成与记录链

- 两次审查的场景自由文本仍把“交代来源/木匣震动”“收钱/拍照”的顺序写反。不是本次停点，属于后续语义审查风险，不能以精准引用检查证明整个审查结论可靠。
- 实际只拆前两章，后续章纲、资源面板可理解性、任意倒叙after/transition证据、固定版本十章均待验；此前边修边测不等于固定版本通过。
- 长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。
- 前序[审查时序与加载](../evals/2026-10-12-maoshan-chapter-two-review-timing.md)、[第二章规划](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)、[资源状态](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)保留历史，不把旧恢复入口当当前步骤。
- 稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与acceptance模块README；[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍讨论未实施。新版不动、不自动模型或恢复历史书、不另建GUI、不push/合并发布，前轮备份全部保留。
