# 证据、成本与维护操作指南

本页仅供定位，不是批量执行脚本。所有本机路径以 `D:/novel/AI-Novel-Writing-Assistant` 为根，除非另列绝对路径。最新状态见[主交接](../2026-10-18_1130_deepseek-harness-handoff.md)。

## 一、需要保留的证据层

| 路径 | 内容/边界 |
| --- | --- |
| `.codex-run/harness-handoff-20261018/` | 本轮readOnly现场live-state.json、runtime.json、交接前完整台账、tracked dirty patch、status、逐提交历史、manifest；不是数据库备份 |
| `D:/novel/.comparison/2026-10-10/` | 两版同想法对照原稿/DB/日志/最终报告/冻结补丁；含隐私，不上传 |
| `.codex-run/mainline-20261016/` | 3A—3D1352回归、构建/类型检查、保护、临时迁移与真实副本证据 |
| `.codex-run/mainline-load-20261017/` | 真实备份、migration-receipt、源码清单、加载/保护；原库人物字段SQL已执行，不重复 |
| `.codex-run/planning-closed-loop-20261017/` | 520回归、13次模型账和成功/失败、服务加载与保护 |
| `.codex-run/initial-contract-20261018/` | 631回归、后续组合测试记录/构建、真实只读恢复资格、protected-before、post-reload-protection、loaded-api |
| `.codex-run/initial-contract-validation/` | 实际生产编排的独立模型run.cjs、3个run目录，JSON隔离持久化 |
| `.logs/local-test/` | 固定启动器进程身份、日志、启动前预检；日志可能含模型内容，先精确提取不要整文件复制 |
| `docs/evals/framework-quality/observations/2026-10-18-initial-contract-generation-recovery.md` | 可提交的验证概述与费用/边界，不含密钥和完整用户资料 |
| `docs/evals/framework-quality/observations/2026-10-17-planning-closed-loop-verification.md` | 4组语义样例、13次费用及失败，非全开书链 |
| `docs/evals/2026-10-16-mainline-stage3-integration.md` | 3A—3D模块/迁移/测试边界 |
| `docs/evals/2026-10-16-five-chapters-usage-and-cast.md` | 26调用/第6章前的历史用量及人物根因，不是当前32调用快照 |

本轮archive-manifest保存每个冻结本地文档的字节数与SHA256。源码/文档在Git中，原始模型结果与数据库在本机，不要误以为推送后就拥有完整现场。更换机器时先制作含必要本地证据的私有迁移清单，不公开上传APIKey表或带授权信息的请求。

## 二、数据库与备份

- 唯一当前测试库：`D:/novel/.comparison/2026-10-10/old-test.db`。SQLite须readOnly打开检查；不通过Prisma默认环境猜库。
- 2026-10-17真实迁移备份：`.codex-run/mainline-load-20261017/pre-migration-backup.db`，1027043328字节；当时online backup、integrity_check=ok、原162表17227行逐列hash相等。它早于后来的调用与新书，不是当前快照。
- 迁移仅 `20261017010000_character_cast_coverage_identity`，7字段+1唯一索引；SQL SHA256 `22909b3687b10df96d1279010b8bcf8716e8fb7b85bdae2e1cbbb65d3f3f8f49`，独立回执；原库没有 `_prisma_migrations`，没有伪造历史。
- 不直接 `migrate deploy`、`db push`、`reset`，不重跑已应用SQL。后续若需迁移先实际schema比对、在线一致性备份/副本验证和明确范围；DB有WAL时普通复制单文件不能冒称一致快照。
- 更早 `old-baseline.db`/`new-baseline.db`、`old-before-minimal-repair.db`、`old-controlled-ch1.db`、`new-before-repair.db` 是不同实验时点，不混用。旧隔离首章不在原网页库是预期隔离，不是丢稿。
- 本轮无迁移/破坏性动作，未再复制1GB全库；已有备份保留、不自动清理。

### 旧五章保护指纹

| 章 | 字符数 | SHA256 |
| --- | ---: | --- |
| 1 | 3013 | d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6 |
| 2 | 3680 | 4704d2b0170166b28e798971db8c2b6aa295a04db03c9141bf16686330da309a |
| 3 | 3729 | 2260cac78879bfbd562ae19fd1363e0fd816a9b971c70236200a7981e66d172b |
| 4 | 3916 | e0b6d1a575df3ff1c668a6d7c92eb5be1fd991dffef387e4339846ba0464377b |
| 5 | 5808 | f1ab36068aa3c61026e0cc3ebd5850306e2569d9cb122270ad2ec9477f391fdc |

11:27任务hash旧 `dbd81f172cad4483b51a57381cc42d23dd4d0570838edb027a2ba83629442da4`、新 `571c9b70a04f216a14f387dc45a541d4702293934ed1394bd7845f7a72626259`。完整关联GenerationJob/VolumePlanVersion/DirectorRunCommand哈希见live-state.json；哈希是保护，不是允许用旧快照强行覆盖新用户操作。

## 三、源码与Prompt定位

前缀 `server/src/`，避免在已有大文件里继续堆helper；模块README为边界依据：

| 责任 | 入口 |
| --- | --- |
| 单章准备/执行 | `services/novel/production/preparation/ChapterExecutionPreparationService.ts`；`services/novel/runtime/ChapterRuntimeCoordinator.ts`、`ChapterPipelineRuntimeAdapter.ts`、`ChapterStreamGenerationOrchestrator.ts`、`chapterRuntimePipeline.ts` |
| 原导演恢复 | `services/novel/director/recovery/`，尤其 `planningRepair/application/PlanningRepairInitialContractService.ts`、`domain/initialContractAcknowledgement.ts`；同模块index/facade |
| 原策略恢复/候选 | 同planningRepair的应用服务、store、授权指纹、coordinator；先读README再搜resume-policy/retry_initial_contract |
| 新生成协议 | `prompting/prompts/novel/volume/contracts/sceneOwnershipProtocol.ts`；`volume/evidence/stateClaimBinding.ts` |
| 合同生成 | `services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts`；实际位置以rg结果核验 |
| 语义质量门 | `ChapterTaskSheetQualityGate`及其评估模块；明确contract诊断可纠正，TypeError等程序错误不可买AI修复 |
| Registry/JSON运行 | `prompting/README.md`、`prompting/registry.ts`/loader entries、`llm/structuredInvoke.ts`；业务Prompt不得临时内联 |
| 用量/范围 | `services/novel/director/automation/`、`runtime/`、`services/planner/`；按类名DirectorUsageTelemetryQueryService/DirectorCircuitBreakerService定位 |
| 人物 | `services/novel/characterPrep/{domain,application,infrastructure}`、`characters/identity`、`dynamics/commands` |
| 客户端 | `client/src/pages/novels/components/`，搜索InitialContractActions、characterPrep、chapterInsights/ResourceRiskPanel；保留已有3文件dirty |
| 固定启动 | 根start-local.bat、scripts/local-test/{start.ps1,entry.cjs}及配置/测试 |
| 迁移 | `prisma/migrations/20261017010000_character_cast_coverage_identity/`及`migrations.sqlite/`，不要重复应用 |

当前Prompt版本：task_sheet v13、execution_contract v14、planning_repair v14；10月17闭环quality v19。接手以资产/loader实际声明核验，不能把旧版本号硬写入新测试。

长期规则优先读 `docs/wiki/architecture/production-core-boundary.md`、`docs/wiki/workflows/scene-causality-and-quality-evidence.md`、`planning-repair-loop.md`、`structured-output-budget-recovery.md`、`book-cast-identity.md`、`director-usage-and-book-scope.md`、`resource-confirmation-questions.md`、`chapter-review-resume.md`。更早文学规则有book-story-foundation/narrative-progression-review/narrative-constraint-scope-and-payoff。

## 四、可复用的验证与边界

| 阶段 | 工程证据 | 实际覆盖 / 未覆盖 |
| --- | --- | --- |
| 旧最小反馈补丁8814525d | continuity18/18及server类型检查，副本首章真实 | 不覆盖原网页导演和连续章 |
| 阶段2/3各次 | 148、307、453等见各独立报告 | 不加总；实际入口后来曾揭露缺口 |
| 3A—3D | 119文件1352通过/0失败/8既有skip，3包检查 | 真实迁移另验；人物UI/模型尚欠 |
| b3705bd4 | 30文件520/520 + shared/server/client | 4组真实质量审查，未运行初始全生成链 |
| 91f7fcab | 32文件631/631，后加1组合回归（56/56文件包含此前55），唯一632；3包检查 | 组合覆盖grant→原job→seed→真实生成服务/后处理→canonical质量预检→窗口→commit；模型/持久适配有替身 |
| 10月18真实独立 | 三题材生产编排生成/复核，故障注入单次纠正 | 隔离JSON会话、实际模型；非真实用户DB恢复事务/UI/正文/十章 |

本轮纯文档不重新运行以上构建/套件。代码未变，证据仍可复用；后续改相关路径再选最窄足够检查。AGENTS已要求默认不做浏览器截图/Playwright/UI自动操作，由用户验收；不能从旧Q36“每次全量”覆盖现行按变更范围复用规则。

需要重编译时，使用确认过的Node24（下列为示例命令，**不是接手必跑**）：

```powershell
$novelNode = 'C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $novelNode node_modules/typescript/bin/tsc -p shared/tsconfig.json
& $novelNode node_modules/typescript/bin/tsc -p server/tsconfig.json
& $novelNode node_modules/typescript/bin/tsc -p client/tsconfig.json --noEmit
```

离线生产测试使用 `server/tests/novelProduction/offlineBootstrap.cjs` 阻断真实DB/网络，然后明确列出选中的测试文件运行。测试可能加载dist，改源码后须更新受影响编译产物再验；不能拿旧dist的通过证明新代码。不要以文件名前缀筛选结果声称全套。实际32文件的用例与终结统计见regression-final.log，不因接手重跑。

## 五、token与费用账目：三个口径不能混用

1. **开发代理账户额度（Codex）**：用户自述本工作已耗尽并重置约2—3次。本仓库没有该账户跨所有窗口/模型/时间段的完整账目。本包不估算美元/人民币，也不把工具日志token当成Codex开发用量。
2. **真实用户书生产调用**：11:27旧任务32次/1396340 tokens，新任务24次/258227 tokens。只含这两个task的DirectorLlmUsageRecord，不是全书或全库永久总数；部分历史调用归属不完整。用户后续继续会变化。
3. **独立开发模型验证**：10月17日13次/183147；10月18日21次/434611；两批可核对合计34次/617758。只覆盖这两份已记账验证，不含更早工程试验/用户调用/Codex，不据此声称全项目总量。

10月18细账：首批9次153293（失败，fresh/canonical混用）；复用候选8次209027（三题材通过）；缺失引用注入4次72291（合同1次11582、质量2次48380、窗口1次12329）。另3次占位key401无生成输出/tokens，不冒充模型验收。没有把失败从费用中扣掉。

原始三目录：

- `.codex-run/initial-contract-validation/run-2026-10-18T03-04-27-511Z/`
- `.codex-run/initial-contract-validation/run-2026-10-18T03-09-11-061Z/`
- `.codex-run/initial-contract-validation/run-2026-10-18T03-11-08-765Z/`

各有model.jsonl/usage.jsonl/results.json/会话JSON。不要整份写入公共文档。后续评测建议先读摘要和需诊断的具体响应；已有调用不为补日志重复执行；选择少量串行样本，失败停下诊断，已成功生成与待审查分开恢复。未知账单结果不得默认重试。

## 六、只读核验与受控运维

接手可以执行：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git log -3 --oneline
git status --short
git diff --numstat
git ls-remote lyaxu refs/heads/codex/production-core-refactor
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:5190/api/health
Get-Content .logs/local-test/processes.json
```

新书初始恢复资格只读GET路径 `/api/novel-workflows/cmvcmumqq000014w0ycmxc44s/planning-repair/initial-contract`；不要持久公开返回的授权token或把GET直接升级成POST。其它普通任务GET可能heal写入，应优先SQLite readOnly。

库核验要取实际任务状态、seed摘要、正文hash、调用、jobs/commands/sideEffects、owner/lease。旧 `protect-normalized.cjs` 把32/24写为快照断言，用户继续后预期不再通过；它不能作为恢复旧数据的工具。不要反复运行本轮capture.cjs覆盖交接前归档，下一次建新日期目录。

服务已在线且stale=false时不重载。后续产品代码确需重载，先只读核对库/全局队列/暂停保护，核实监听PID、命令行、启动时间、Node路径及processes记录，然后只处理已核对的两个旧服务。启动器可用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-test/start.ps1 -NoBrowser`。不要仅凭本页PID杀进程；不用旧stop-local.bat、comparison/launch.ps1或pnpm dev（可能进入默认库/初始化路径）。

## 七、文档与提交操作

- 用户已要求需要推送则完成推送；目标lyaxu当前开发分支。代码/文档分别提交，先检查完整未推送范围与发布说明。
- `readme-release-updater`技能在 `C:/Users/lyaxu/.codex/skills/readme-release-updater/SKILL.md`。若Harness不自动加载Codex技能，可直接阅读文件；纯内部文档不更新README/发布说明，功能变更则按最新日期合并。
- WORK_LEDGER已有964行历史未提交。不能整文件git add：只stage本轮新段。可从HEAD原字节+新段构造index blob，再hash-object/update-index，保留working原文件历史；提交前确认unstaged仍964行且三个组件diff不变。
- 交接更新CURRENT应先写好新快照并查链接，不能让指针悬空；不要改旧快照的原时态，只在新记录说明哪项被覆盖。
- Codex个人记忆只能按用户明确要求在extensions/ad_hoc/notes追加小文件；本包提供项目内完整等价入口，Harness不需要自动读Codex主记忆。不要为交接改D:/deepseek-harness的设置或将含密钥数据复制过去。
