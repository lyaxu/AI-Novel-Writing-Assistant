# 小说写作助手本窗口与继承工作完整交接

## 1. 接手摘要

用户要求本阶段修复告一段落后换新窗口，并把本窗口及继承内容打包。目标是把工具调教到能稳定产生跨题材、接近 8—9 分的小说框架，优先人物、因果、情节、阅读承诺和长线回收。用真实书和章节发现通用问题，不逐本人工代修，也不把模型自评分或工程测试当文学达标证据。

当前样本《女尊：流放矿区，下跪续命》第一章有戏剧效果，第二章仍停在写前规划修复。此前两轮工程修复后又暴露建议输入容量限制。本阶段修正重复上下文的无损编码，不增加预算、不放宽审查、不代用户继续生成。**工程修复可交接，真实新建议、第二章推进及小说质量仍待用户验收。**

新窗口先按 AGENTS 完整读取 PROJECT_CONTEXT、CURRENT、本文件，只读核对 Git 和实时状态，汇报接手情况；不要因旧聊天里曾有“推进”而自行触发新一轮付费操作。

## 2. 环境与唯一真源

- 实际应用仓库：`D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/fix-task-cleanup-personal-style`。父目录 `D:/novel` 是独立仓库，其 master 与应用分支无关。
- 本阶段基线：`d1e95c46`。本文件与容量修复同次本地提交，最终提交以 `git log -1` 核验；未 push、未合并 beta/main、未打包发布。desktop/package.json 当前版本 `0.4.28`，本次未调整版本。
- 数据唯一真源：`server/dev.db`（SQLite，考虑 WAL）；日志和 `.codex-run` 是时间快照，不能替代当前数据库。无本轮数据库写入或数据迁移。
- 本机前端 5173、后端 3000 的开发监听服务在交接时存在；源码由监听器重载，不能在模型在途时随意改后端触发重启。
- Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`；pnpm fallback 同父 dependencies/bin/fallback；Python `C:/Python314/python.exe`。PowerShell 中文读取用 UTF-8。
- 保留未跟踪 `.codex-run/`、`.playwright-cli/`、`WINDOW_HANDOFF_2026-06-28_v0320.md`、`seed-styles.bat`、`start-local.bat`、`stop-local.bat`、`server/dev-probe-node25.db`、三份中文旧章稿。不要清理或 `git add .`。
- 下个窗口复用同一本地 checkout；无需新 worktree。不要并发两个写作者。

## 3. 用户目标与不可破坏约束

- 主要用户是不懂结构修复的新手；AI 给具体方案、用户选方向。不能把查询字段、查日志、精简重复资料、手写专业修复指导转嫁给用户。
- 用户认可本章“有戏”是进步，强调合理引导、审查质控、出问题后有效修复；不接受无限重试或只凭字段齐全宣称有效。
- 用户补充：不介意多消耗上下文来读透作品和工具；抱怨压缩是担心新窗口接不住，不是要求节省阅读。不得以省上下文为由省略必要审读；交接必须交代判断依据并让接手者复述核对。
- 案例不进正常提示词：八题材、十六正反例是开发评测，含东方玄幻/修仙与传统武侠；不是每次创作的固定套路。
- 不机械要求每章反转、主角必赢、第一章开系统；允许受压、安静场景和代价，但须检查局面、人物、信息的实际变化。
- 保留个人写法“市井见微·细腻推进”、章节编辑稳定实例、未保存草稿保护、保存清理、离开保护、按需第二读者。
- 写前规划须语义/窗口审查，默认当前及同卷后两未写章节，持久化两轮预算；用户明确采用新修复可追加一轮。仅复核不加修复额度，不重置历史。
- 已写正文局部质量债与结构性重规划分开，遵守实际任务的 completion-first/quality-first；任务中心“运行记录”只读，恢复操作在源工作区。
- AI 结构化判断为主，不写书名或题材关键词分支；新提示使用 Prompt Registry，不能靠加字数、关闭审查或换模型掩盖问题。
- 不自动选候选、开书、生成、重试、push、合并、公开发布或新建任务。破坏性数据操作需明确授权和已验证备份。

## 4. 关键进程时间线：继承内容与本窗口

以下历史由聊天与仓库交接记录交叉整理；早期实测不等于本轮重跑，详细证据保留在链接快照中。

| 阶段 | 关键结果与边界 |
| --- | --- |
| 早期本地优化 | `1bf3ab35` 删书残留任务清理及个人写法；`325cd6d7` 世界沿用导演模型；`b633528b` 按需第二读者；`c6714a09` 写前修正复核；编辑器/草稿保护继续保留。详见旧完整交接。 |
| 候选与重试状态 | `0ef2a675` 重试沿用页面所选模型、结果轮询与失败状态同步。父仓库 master 并非应用分支丢失。 |
| K3 首本前三章 | 世界 factionId:null 合法却被拒、K3思考耗尽额度、3章试写误扩80章、partial误冻结、受审合同被覆写、摘要污染目标、迟到保存等修复；实跑完成前三章。刷新只更新UI，不修后端。 |
| 框架质量首期 `f25a6389` | 补回宏观/人物上下文；前提—选择—阻力—结果—持续限制的场景合同贯通；避免有效修稿因换标签提级被回退；八题材评测。长篇与跨题材文学质量尚未验证。 |
| 建议选择 `6555dbcd` | 规划暂停后 AI 推荐 1–3 方向，用户选择；请求/采用分开，来源绑定、幂等、无隐式重试；不是代替用户选择。 |
| 厨神第二章 `61641b73` | 修结构化引用及建议格式/失败诊断；第一章可读但关键解法的水、热源、动作与知识前提漏检。 |
| 事实/行动/承诺 `82e4e6ff` | 最近完整正文带来源，正文/计划/推测区分；核对身体、物品、能力、知识前后状态；对照原选方向的人物互动与早期回报。用户原拟武侠，实际新开女尊样本。 |
| 矿区第一轮 `c0ed9249` | 候选自带两套章序；旧问题换ID整份复核被拒；先审旧候选导致指导未执行；历史 C 宣称直接写正文不可实现。加入执行方式、先修后审、旧问题保留、延期承接状态及只读节奏。 |
| 矿区第二轮 `d1e95c46` | 真引用含 causality 层而索引扁平化，导致技术拒收；建议看不到后续实际章节。加入逐叶路径别名、基线/候选后续路线、阻塞覆盖声明；审查不能要求本章重复抄后续已有承接。 |
| 本阶段容量修复 | 用户重新建议被160000字符本地门槛拦下。只读重建输入160427字符，多份规划和历史引用重复；改为精确相同JSON内容去重引用，保留完整原文和角色来源，不提升160000门槛、不付费摘要、不让用户精简。验证结果见第6节。 |

### 实际样本与文学观察

- 《流放迷雾死地：我的打捞每日翻倍》：小说 `cmujxe1m9000aakw0f1l1mvp1`，导演 `cmujtcwa9005fr4w0ffh9hvmh`，当时 `custom_k3 / kimi-k3`。历史实测前三章 2841/3049/2559 字符完成，停在3；4–7仅路线。不能继续自动写第4章。
- 《祭品厨神：我在禁忌森林开食堂》：小说 `cmukqni0l004y9ww0usot67gs`，导演 `cmukq9vvf004m9ww0s426950e`。历史最终两章4147/2936字符完成；自动87分仍漏反绑进食、缺热源水源、异界知识、烙印部位与伤腿发力等。不能把旧“第二章空”快照当现状。
- 当前《女尊：流放矿区，下跪续命》：权力压制、符文异常、擦去血迹等细节有效；婚约缺前置关系重量、囚车受难重复、主角选择偏少。第一章自动86不等于8.6分小说。核心卖点迟到部分源于规划，不能全怪写手模型。

## 5. 已完成实现与当前代码入口

| 职责 | 入口/当前实现 |
| --- | --- |
| 建议与采用 | `server/src/services/novel/director/recovery/planningRepair/advice/`：AdviceSource来源指纹、AdviceContext只读投影、AdviceContextEncoding无损引用、AdviceFailure诊断、PlanningRepairAdviceService生成/投影/选择。 |
| 执行合同 | `shared/types/planningRepair/advice.ts`：executionMode、blockerResolution。complete且无剩余才可执行；review_existing须review_disagreement；source_edit及不完整方向不可采用。 |
| 建议Prompt | `server/src/prompting/prompts/novel/volume/recovery/planningRepairAdvice.prompts.ts`，本阶段 v5，注册表已同步，运行服务 GET 已确认。 |
| 质量引用 | `server/src/prompting/prompts/novel/volume/evidence/`：路径别名只指同一真实叶，旧问题/延期承诺核验；质检Prompt v8。 |
| 恢复编排 | `server/src/services/novel/volume/planningRepair/` 与 director/recovery/planningRepair：先回放已付费有效修复，先修后审；模式、范围、预算、幂等与来源保护。拒收响应不是通过结果。 |
| 后续视野/原方向 | `volume/planningPromises/` facade：读取导演原选候选；同卷最多24条临近已存路线+实际节奏板，只读不扩大可改范围。 |
| 已写事实 | `volume/writtenEvidence/`：最近三章最多24000字符完整正文及来源哈希，事实摘要仅辅助；更早原文检索尚待完善。 |
| 前端 | `client/src/pages/novels/components/planningRepair/`：源页获取/选择/恢复；运行记录不放操作。 |

本轮前一提交后的生产提示关键版本：候选 v4、执行合同 v7、规划修复 v6、窗口复核 v5、质检 v8；本阶段只将建议 v4→v5，不擅改其他版本。

## 6. 验证与实测结果

本阶段当前验证：

- `pnpm --dir server build` 成功，日志 `.codex-run/mining-capacity-server-build.log`。
- `node --test` 覆盖 adviceContextEncoding、planningRepairAdvice、planningRepairRecovery、prompting、promptWorkbench 及客户端 planningRepairAdvice：112项中110通过、2项原有跳过、0失败；日志 `.codex-run/mining-capacity-tests.log`。
- 只读实样投影160427 JS字符，编码后104251，减少56176（约35%）；精确 JSON.stringify 往返还原相等。保留全部当前投影信息，不改变上游既有只读范围或最近历史覆盖策略。唯一大内容仍在模型调用前被160000上限拒绝，无隐式摘要或重试。
- 运行 GET catalog 已确认 `novel.planning_repair.advice@v5`；GET/只读SQLite核对任务未自动恢复，第一章2650字符、第二三章0字符，活动job和command均0。
- 本轮未改shared或client生产代码，复用上一阶段通过的shared build/client typecheck（见`.codex-run/mining-followup-*.log`），没有重复昂贵检查。没有UI、真实模型效果、完整测试套件或发布验收。

先前验证仅作历史：c0ed9249 聚焦365通过/2跳过，最后建议专项18通过（含1新增，不能与前者直接相加）；d1e95c46 聚焦177通过/2跳过，完整真实拒收结果离线回放通过技术校验但仍repairable/unsafe。不同阶段套件有重叠，不合并为总数。

容量故障发生于模型调用前；本次点击的失败不是DeepSeek输出超长，不能据此声称供应商额度耗尽。完整上下文去重是本地确定性编码，必须用精确还原比较证明无损；不能仅凭尺寸减少宣称质量提高。UI与真实生成仍由用户验收，无浏览器/截图测试。

## 7. 当前任务、已知问题与临时绕过

- 小说 `cmukwigbj001170w0ekq4trea`，导演 `cmukwgxjg000p70w0fn8vrz80`；`cmukwqfu1014i70w0qo1xrw8z` 是手动工作区任务，不可替代 directorTaskId。
- 第一章 `cmukwlcrs00sr70w0l5jxj9u8`《大典除名》2650字符 approved；第二《残血初醒》、第三《泥中捡粮》均0字符 planned。
- 最终只读核验：导演 waiting_approval、pendingManualRecovery=true，规划 waiting_confirmation、rounds2/maxRounds5。候选 `cmuky53yc0006bww0wfcj7n91`，最新失败建议 `02eb6b2b-c33e-423a-9c6a-6abf72a49487`，保留历史容量错误；活动job/command均0。新窗口仍应再读状态确认用户有无推进。
- 没有人工改写正文、放宽门槛、清空历史或直接改数据库的绕过。修复代码后由用户明确重新获取新建议并采用；GET仍会保留旧失败历史，不会自动重跑。
- `prose_negative_flip` 仍是硬编码句式扫描，单次“没有…而是…”可判high；矿区“女卫不救人而先封锁”的有效线索被误伤风险已记录，尚未改造。

## 8. 未执行与待执行任务

| 优先/状态 | 下一步、依赖与完成标准 | 版本/范围 |
| --- | --- | --- |
| 首要：工程完成、真实待验收 | 用户明确重新获取建议；应取得可解释且能闭合问题的方向，采用后有效修改并复核，第二章能推进；若失败先查真实证据，不盲重试。 | 当前分支下一次实测；不自动付费 |
| 持续：作品质量验证 | 对照原选候选、有效规划、正文，检查人物关系、净变化、核心卖点、状态及知识来源；读第二/三章后记录误报漏检。 | 本书样本；不代写旧稿 |
| 已发现、未实现 | 语义化区分有效对比句与空泛AI句式，替代单次句式高风险误报。先保留正反例与当前行为，再小范围修改ProseQualityDetector相关链路。 | 后续独立阶段，无发布版本承诺 |
| 已同意方向、尚未整体完成 | 书/卷级主线因果、对手行动线、人物关键选择与关系持续，长篇来源检索、伏笔推进回收。见质量计划；需留出题材与独立读者盲评。 | 后续质量阶段，不宣称8—9分达标 |
| 待用户选择 | 武侠/修仙前三章真实测试，DeepSeek可沿用用户当前选择；先前“下一本武侠”已被矿区样本临时替代。 | 不自动新开书 |
| 历史待查 | 成功checkpoint可能残留lastError/isBackgroundRunning；缺章且整节拍跨执行范围的预规划策略；较早历史原文检索、角色动态相关性筛选。先查是否自然复现，不能直接改DB。 | 不混入本次容量修复 |
| 历史验证债 | 全量client旧契约失败；chapterStructuredOutputNormalization旧资源上限断言。当前窄测试不代表全套绿。 | 单独核对最新基线再修 |
| 未执行 | push、beta集成、main晋级、桌面打包/上传、完整长篇生成、付费跨题材对照、独立盲评。 | 需相应明确请求；版本0.4.28未变 |
| 交接验证未做 | 新宿主窗口是否自动依AGENTS加载，必须让新窗口回报实际读到入口，不声称已fresh-session验收。 | 用户自行新窗口 |

## 9. 关键文件与产物索引

- 长期原则：[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，[质量计划](../plans/novel-framework-quality-program.md)。
- 继承历史：[旧完整交接](2026-09-27_candidates-and-continuity_thread_handoff.md)、[提交检查点](2026-09-27_commit-checkpoint_thread_handoff.md)、[前三章实跑](2026-09-27_1852Z_first-three-chapters_thread_handoff.md)。
- 本窗口阶段：[框架首期](2026-09-28_0355Z_framework-quality-phase-one.md)、[AI建议选择](2026-09-28_0500Z_planning-repair-advice.md)、[厨神第二章](2026-09-28_0530Z_chapter-two-contract-failure.md)、[事实行动承诺](2026-09-28_0625Z_facts-actions-promises.md)、[矿区首轮](2026-09-28_0740Z_mining-planning-repair.md)、[路径复核](2026-09-28_0910Z_mining-evidence-paths.md)。
- 稳定Wiki：[规划修复](../wiki/workflows/planning-repair-loop.md)、[场景因果质量证据](../wiki/workflows/scene-causality-and-quality-evidence.md)、[结构化输出与恢复](../wiki/workflows/structured-output-budget-recovery.md)。
- 文学观察：[厨神](../evals/framework-quality/observations/2026-09-28-chef-opening.md)、[矿区](../evals/framework-quality/observations/2026-09-28-mining-opening.md)。开发集 `docs/evals/framework-quality/cases.v1.json` 和 `server/scripts/framework-quality-eval.cjs`，不注入正常创作。
- 本机私有证据：`.codex-run/mining-capacity-{seed,input,before}.json`；此前 `mining-followup-*`、`mining-repair-*`、`fact-action-promise-*`；日志 `.logs/2026-09-27/2026-09-27T22-15-17-dev.llm.jsonl`。仅按task/request ID提取所需字段，不整行输出多万字请求。
- 历史K3恢复与备份 `.codex-run/recovery-20260927/`，约1.027GB的三份历史备份曾quick_check通过；它们不是当前数据库备份，禁止重跑旧维护脚本。

## 10. 下一窗口启动顺序

1. 进入 `D:/novel/AI-Novel-Writing-Assistant`，完整读磁盘 AGENTS（注入片段可能截断）、PROJECT_CONTEXT、CURRENT和本文件。
2. `git rev-parse --show-toplevel`、`git branch --show-current`、`git log -3 --oneline`、`git status --short`。保留无关未跟踪项，不切master或新checkout。
3. 只读 GET `/api/novel-workflows/cmukwgxjg000p70w0fn8vrz80/planning-repair` 与 `/planning-repair/advice`；catalog核验建议v5。SQLite只读核对章节内容与活动generationJob/director command。
4. 向用户回报接手目标、分支、未提交项、真实卡点与下一项边界；用户未授权时不POST获取、选择、恢复或生成。
5. 若用户已实测新建议，保留请求、响应、模式、来源、容量、语义拒绝证据，再决定修哪个通用边界。日志默认先统计/筛选，避免重复输出；需要完整请求或正文才能判断时仍须读全文，不以省上下文为由遗漏证据。
6. 修复后使用窄测试，核实同路径已有验证是否仍有效；文档与阶段提交遵守AGENTS及readme-release-updater；不为交接重复全构建或付费重跑。

## 11. 待确认事项、上下文压缩与风险

- 本窗口ID `01a0e35b-9991-7c13-a822-bb36446de1f4`，本机会话记录核验模型 gpt-6-astra、有效窗口258400 tokens；模型目录context_window272000/effective95%。09:49 UTC记录7次compacted；这是本窗口当时配置和运行事实，不是所有Codex模型的统一上限。
- `C:/Users/lyaxu/.codex/config.toml` 未显式填写上下文窗口/自动压缩阈值。[官方配置说明](https://learn.chatgpt.com/docs/config-file/config-reference)将两者分开；精确自动压缩阈值本轮未取得，不能由1M宣传值或剩余额度猜测，也不能擅改为1M宣称支持。
- 此前几次大日志读取输出过量，加快上下文消耗；后续必须按task/request ID提取简短字段和统计。工具说明、继承摘要、任务资料同样占窗口；压缩次数本身不是代码丢失证据。
- 交接是工程状态与决策的完整接手包，不保证聊天逐字无损复制。历史状态与当前已验证状态明确区分，旧文件不覆盖最新指针。源文件、测试和数据库是核验依据。
- 去重上下文对真实模型的可读性仍需实测；无损编码证明信息保留，不证明模型一定正确解引用、修复或写出优秀小说。

## 12. 可直接发送给新窗口的开场提示

> 接手 ai-novel-assistant 优化。在 D:\novel\AI-Novel-Writing-Assistant 工作，完整读取磁盘 AGENTS.md，再读 docs/handoffs/PROJECT_CONTEXT.md、CURRENT.md 及其完整交接包。先只读核验分支、HEAD、未提交项和《女尊：流放矿区，下跪续命》的建议/规划状态，向我汇报接手情况。目标仍是跨题材8—9分框架，当前优先验收建议容量修复及第二章推进；不自动获取建议、选方案、生成或重试，不切分支、不push。
