# 第一章审读与第二章规划格式故障

## 目标与范围

用户已自行采用 AI 推荐方向，第一章完成；继续第二章时返回节奏拆章并报错。本轮要求仔细读第一章并排查错误。只修通用接口与诊断机制，不改写样书、不调用真实模型、不替用户获取建议、选择方向或续写。

仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/fix-task-cleanup-personal-style`，接手 HEAD `6555dbcd`。本轮本地阶段提交，不 push、不合并 beta/main。前期背景见 [建议流程快照](2026-09-28_0500Z_planning-repair-advice.md)。

## 当前样本状态（05:30 UTC 只读核验）

- 《祭品厨神：我在禁忌森林开食堂》，小说 `cmukqni0l004y9ww0usot67gs`，导演任务 `cmukq9vvf004m9ww0s426950e`。
- 第一章 `cmukqpxr700w09ww0oaj8kg0w`《祭坛骨汤》：4147 字符，completed / approved；正文与本轮开始导出逐字相同。
- 第二章 `cmukqpxr900w19ww0jsh0kgyg`《林缘拒斥》：0 字符，unplanned / planned。导演 waiting_approval / 结构化大纲，pendingManualRecovery=true；planningRepair 章序2、waiting_confirmation、rounds=1/maxRounds=2。
- 当前候选 `cmuksd3ia003aw0w0hqjx0zou`；规划章 ID `cmukqni0l004y9ww0usot67gs-chapter-c8ea10e2-0bc8-4593-9f12-0671bbc42891`。第二章任务 `cmuksc7q80034w0w0t4dv4g02` 已 failed，非仍在生成。本书任务共 failed=2、succeeded=1，无活动任务。
- 建议 `361e7176-988a-41d5-94e4-4affe6e5dbc5` / 请求 `0684f8ae-3e33-4f2d-a25b-a019427a83a2` 已 failed。运行中 GET 返回简短可操作提示；私有原始错误仍保留。本轮始末导演 seedPayloadJson 完全一致；没有 POST 或数据库写入。
- 手动工作区任务 `cmukqu5c201609ww0xra93ub2` 不是导演任务。

## 故障原因与修复边界

1. 第二章规划复核已经返回 usable / safeToSync，但8条引用带来源标签。其中7条是准确叶字段引用，1条是同一前提对象的 condition/sourceKind/reference 序列化。旧校验把标签也当原文，误报 evidence absent。
2. 后续 AI 建议完整正常 stop 返回，但列表数量和 diagnosis 枚举不满足契约；旧提示没有明确展示全部枚举和数组上限。不是用户操作错误，也不是网络仍在等待。
3. 复核 Prompt v5 分开 sourcePath 与 quote；新输出只接收准确叶字段引用。旧格式仅严格核对实际路径与同对象序列化，不宽泛去标签、不跨对象拼接、不忽略标点。支持8个原始问题加1个职责过载问题。
4. 建议 Prompt v2 展示完整共享契约与格式示例；解释列表最多8项，仍保留指导总长4000、最多3章与原有授权边界。严格合同禁止静默裁数组，也不把非法枚举自动改成另一个创作判断。
5. 失败按类型投影短提示；确认收到而校验拒绝的完整响应保存私有诊断，不出现在 GET，不成为可采用方案，不触发重试。旧失败记录仅改读取展示，不写回历史数据。

本次保存的复核响应离线通过旧 schema 加新严格证据校验；但旧历史未保存请求时来源版本与上下文绑定，不能据当前候选 hash 相同就自动放行或复用。现有任务继续等待用户显式操作。

## 文学质量观察

第一章大节奏与回报成立，但核心解法有反绑进食、无水成汤、热源不到位及职业知识直接变异界知识等缺口。自动报告 overall=87/coherence=88 漏检了这些决定性条件，不能当8–9分框架达标证据。完整审读见 [真实样本报告](../evals/framework-quality/observations/2026-09-28-chef-opening.md)。

本轮没有修改文学审查提示以宣称解决漏检；质量计划新增优先项：解法资源与动作可行性、前后状态约束、作者与人物知识边界，并要求奇幻合理反例控制误报。引用真实性与语义合理性是两条独立验收线。

## 验证与后续

- shared build、server build、client typecheck 通过。
- 11个定向测试文件共292项：290通过、2原有书籍分析提示测试跳过、0失败。涵盖真实拒绝响应、严格引用、建议私有诊断、无自动重试、恢复边界、结构化解析兼容。记录 `.codex-run/chef-contract-regression.log`。
- 只读 API 与 SQLite 核验本轮前后数据不变；未运行浏览器验收，未发真实模型请求。用户下一步在节奏拆章刷新状态、显式重新获取建议并选择方向；无需重开书。真实模型与 UI 验收仍由用户完成。
- 已同步 Wiki、README 最新更新、日期发布记录。保留全部原有未跟踪脚本、probe db、旧稿、`.codex-run/` 与 `.playwright-cli/`，不纳入提交。

接手先重新核验用户是否已推进；不要依据此快照自动续跑。下一轮重点是验证流程恢复及将已记录的文学因果漏检转成跨题材评测和机制改进。
