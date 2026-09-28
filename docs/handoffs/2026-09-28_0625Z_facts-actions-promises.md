# 已写事实、行动状态与原选方向闭环

## 本阶段授权与仓库

用户要求修复工具的三类通用问题，完成后由用户新开武侠测试：后续规划/审查区分正文、计划与推测；核对关键行动前后身体、物品、能力、知识；对照原选方向保留人物互动、早期回报和核心卖点。不是重写《祭品厨神》，也没有授权自动开书或继续生成。

仓库 `D:/novel/AI-Novel-Writing-Assistant`；分支 `codex/fix-task-cleanup-personal-style`；接手基线 `61641b73`。本阶段代码、文档与此快照同次本地提交，完成后的 HEAD 用 `git log -2 --oneline` 核验。未 push、合并、部署或建立新任务。

## 样本与诊断依据

小说《祭品厨神：我在禁忌森林开食堂》`cmukqni0l004y9ww0usot67gs`；导演 `cmukq9vvf004m9ww0s426950e`。本阶段结束只读查库：导演 succeeded，第一章 `cmukqpxr700w09ww0oaj8kg0w` 4147字符，第二章 `cmukqpxr900w19ww0jsh0kgyg` 2936字符，均 completed / approved。上一快照的“第二章无正文、waiting_confirmation”已过时；用户在本阶段前自行完成第二章。本阶段没有模型调用或数据库写入。

真实漏检包括：反绑状态下进食，缺水/容器/热源的制汤机制，厨艺等同异界知识；第二章胸口烙印移到手心、麻木左腿承担发力、搜身后隐匿刀火石缺来源。原选开篇中的伤口处理与人物互动在细化中变为纯逃生。问题不能只归因于模型：规划复核缺前章原文，正文上下文资源块被软预算丢弃，审查偏重规划节点，原选方向缺独立追踪。

来源日志 `.logs/2026-09-27/2026-09-27T22-15-17-dev.llm.jsonl`，第二章复核/正文在115、121–122行附近；活跃规划v7 `cmuksd3ia003aw0w0hqjx0zou`，原选候选 `f2feaa70-7a41-46be-adbf-7c8ae90c0ce0`。日志属于私有运行证据，不提交。旧 `.codex-run/new-book-*.json` 中第二章为空，不能作为当前正文等值基线。

## 实现边界

1. `volume/writtenEvidence` 只读装配最近三章、最多24000字符完整正文，带章节ID、序号、哈希和覆盖缺口。压缩事实独立标为 secondary_not_proof。章节细化、规划修复/复核与正文链共用；writer/分段/review/repair保留正文证据与有界资源限制，不机械截断。窗口外未知不代表不存在。
2. 规划 Store 绑定正文来源与原选候选版本。正常写完前章后，已保存下一章合同进入新事实复核，保留修复预算，不重新生成初始合同；历史意见以 evidence_refresh 分界。源变更并发保护与已写章节保护继续有效。非托管完整合同复用入口也需复核，带实际只读开篇路线，托管入口不重复审查。
3. 接收输出 actionStateChecks，逐场选择关键动作，核对相关前后状态与先发生的过渡。代码验证准确引用、来源与结构化判定一致性，计划不充当事实；确证局部矛盾进入既有修复/质量债，证据不足保留风险，不新增全局停写。旧报告兼容。
4. `volume/planningPromises` 从对应导演 seed.candidate 读取用户原选方向。规划 promiseChecks 覆盖当前及过去开篇承诺，允许等效改编；延期须有实际承接。未来节点不提前要求完成，开篇不能降为全书目标绕过。缺口进入既有修复与方向确认，不增轮次。
5. 新提示仍在 Registry，资产及相关审查/修复版本同步；单次输出容量有界增加。没有新增独立固定审查阶段，输入成本和耗时仍需真实样本测量。

模块 README 和 wiki 记录长期规则：[质量证据](../wiki/workflows/scene-causality-and-quality-evidence.md)、[质量计划](../plans/novel-framework-quality-program.md)。更新说明同步到 README 与 releases。

## 已验证与未验证

- 本分支本轮 `shared build`、最终 `server build`、`client typecheck` 通过。
- 25个聚焦测试文件：374项，372通过、0失败、2项原有拆书测试标记跳过；包括来源失效/预算保护、原选承诺证据、反绑/热源/伤势/烙印与合理武侠修仙正例、缓存、上下文保留、Registry版本、非托管合同复用。
- 证据 `.codex-run/fact-action-promise-tests.log`、`fact-action-promise-server-build.log`、`fact-action-promise-client-typecheck.log`。最初4处旧测试fixture不匹配已修正，最终结果以上述汇总为准。
- 运行服务只读 GET catalog 确认 writer v9、acceptance v4、execution_contract v6、task_sheet_quality v6、audit.full v3 已加载；3000/5173监听正常。后端由本地开发监听器重载，不手动重启或恢复任务。
- 没有浏览器/截图/UI验收，没有真实模型质量实测；测试使用离线数据与mock，只证明传递和消费契约，不证明模型必然识别所有硬伤，也不证明8—9分或长篇能力达标。

## 下一步

由用户新开武侠，仍可用其选择的 DeepSeek，先写前三章后审读。对照原选方向、实际规划和正文，优先看关系是否推进、早期回报是否可见、伤势/兵器/武功/知识是否支撑行动，同时记录误报、修复轨迹与耗时。不自动新建书、选候选、生成、重试或改旧书。

保留原有未跟踪 `.codex-run/`、`.playwright-cli/`、启动脚本、probe数据库及旧书稿，不纳入阶段提交。接手仍先读完整AGENTS、PROJECT_CONTEXT、CURRENT，核验实际分支和dirty files，不切外层master。
