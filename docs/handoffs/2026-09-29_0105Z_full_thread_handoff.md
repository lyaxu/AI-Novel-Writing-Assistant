# 本窗口完整交接：规划反复根因、停止矿区样本与外卖新书前三章

时间：2026-09-29 01:05 UTC起核验（America/New_York为2026-09-28晚间）。本文覆盖继承工作、本窗口两次修复及用户最新三章审读请求。上下文曾压缩，以下以磁盘、数据库、日志及已保存决策交叉核对，不声称逐字保留聊天。

## 1. 接手摘要

**最新用户意图是阅读新书并完整交接，旧矿区书已明确停止测试。** 用户原话：“这部书改不好就不较劲。重开。这部书已经验证大模型能写出合格的戏就达到目的。”随后用户自行开了《差评变强：外卖小哥闯金庸》，表示前三章基本没卡住、情节有进步、文笔差一点，要求读透并更新交接。

本窗口完成两阶段工程修复：建议格式/已采用状态/复核历史（0ef895af），以及第8轮暴露的历史截断和可选润色冒充阻塞（d1d59861）。代码窄回归通过，未替用户调用真实模型验证矿区第9轮。新书三章当前确实completed，主代理已读全部10412字符及原选方向；具体判断见[完整阅读观察](../evals/framework-quality/observations/2026-09-28-delivery-opening.md)。此次收尾只改文档。

新窗口先只读核验，复述“目标、现状、已停样本、证据边界、下一步”；不要拿旧包的“继续矿区第二章”当当前任务。用户尚未授权新一轮文笔改造、自动改稿或第4章生成。

## 2. 环境与唯一真源

- 仓库绝对路径：`D:/novel/AI-Novel-Writing-Assistant`；外层 `D:/novel` 独立仓库的master无关。
- 分支：`codex/fix-task-cleanup-personal-style`。打包前代码HEAD：`d1d598618de980c13391ee80ec42663550fcbb06`；随后本批交接文档单独本地提交，最终HEAD须用Git核验，不把文档提交当新增代码修复。未push、未合并beta/main、未打包发布。
- `desktop/package.json`实读版本0.4.28；不改版本。产品说明仍按日期记更新，桌面公开上传遵守AGENTS精确版本/tag规则。
- `server/dev.db`为当前SQLite唯一数据源，本次用Python `mode=ro`连接读取；`.codex-run`和日志只是快照。未改数据库、正文、候选或用户配置；不删旧书。
- 本次实查监听：3000进程9628，5173进程11968。端口/PID会变；不需要为文档交接重启服务。
- Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`；Python `C:/Python314/python.exe`。默认Node25.2.1与better-sqlite3 ABI不匹配，不为测试随意重装依赖。SQLite相关测试可在独立进程设`SQLITE_ENABLE_WAL=false`避免导入时写PRAGMA。
- 打包前tracked工作树干净。原有untracked全部保留：`.codex-run/`、`.playwright-cli/`、`WINDOW_HANDOFF_2026-06-28_v0320.md`、`seed-styles.bat`、`server/dev-probe-node25.db`、`start-local.bat`、`stop-local.bat`、`第1章重写.md`、`第8章（金庸风格）.md`、`第一章.md`。不要`git add .`或清理。
- 复用同一本地checkout可读未跟踪证据；新worktree不自动包含它们。一个checkout只保留一个活跃写作者。没有创建新聊天或安排自动任务。

## 3. 用户目标与不可破坏约束

- 长期目标：跨题材接近8—9分的框架，先因果、情节、人物关系、选择及长线承诺，文笔次之。不是模型86分就等于小说8.6分。
- 用户重视完整审读，不介意上下文消耗，担心换窗口后丢掉判断。不能只看摘要评价文章，也不能把有价值的失败历史删成“已修”。
- 工具面向写作新手；通用机制应给具体可执行方向，不能要求新手手写专业结构修复意见。案例只作评测，不硬编码题材、书名或剧情。
- 停止单本不代表放弃框架能力，也不授权删除数据；已经证明能写出合格的戏即可保留样本转向新验证。
- 保留个人写法“市井见微·细腻推进”、编辑器稳定实例、未保存稿保护、本地恢复和按需第二读者。
- 写前规划必须审核，当前及同卷后两未写章、持久化两轮默认预算；用户明确追加与普通继续不同。正文质量债不能绕过未通过的计划。
- completion-first与quality-first按任务实际策略；运行记录只读，操作在源页。手动workspaceTaskId不是directorTaskId。
- AI结构化判断为主，代码只做合同/证据定位/安全校验；不能用关键词强行判剧情。不自动付费、选方案、续写、恢复旧书、push或发布。
- 本批按AGENTS阶段提交规则做文档本地提交；交接技能“不仅为打包自动提交”的默认被该明确仓库规则覆盖。仅接收交接仍不授权新窗口提交业务改动。

## 4. 关键进程时间线

早期细节证据保留在[上一个完整包](2026-09-28_0950Z_full_thread_handoff.md)，这里保留结论和未完事项，不要求把旧下一步继续执行。

| 阶段/提交 | 结果与边界 |
| --- | --- |
| 1bf3ab35 / 325cd6d7 / b633528b / c6714a09 | 删除残留、个人写法、世界使用导演模型、按需第二读者、写前修正复核；编辑草稿保护必须保留。 |
| 0ef2a675与K3实跑 | 重试沿用所选模型、候选状态同步；K3 factionId:null、思考耗尽、sample3误扩80章、partial冻结、受审合同覆写、摘要污染及迟到保存等经过修复，历史前三章完成。 |
| f25a6389 / 6555dbcd | 框架质量首期、场景因果合同、八题材评测；规划暂停AI给1–3方向，由用户选择，不自动重试。长篇能力未验证。 |
| 61641b73 / 82e4e6ff | 厨神结构引用及建议失败诊断；完整已写正文与来源、行动状态、原选承诺进入链路。真实作品仍能漏物品/身体/知识前提。 |
| c0ed9249 / d1e95c46 | 矿区候选章序冲突、先审旧稿、换ID拒收等；后续真实计划只读视野与逐叶路径别名，不扩大允许修改范围。 |
| f0a7f9bc（本窗口继承） | 输入160427字符超过160000。无损重复资料引用缩至104251，精确还原；不提高上限、不付费摘要。 |
| 0ef895af（本窗口） | 用户第7轮仍遇“格式不完整”“范围变化”。真实review_existing方案changes空数组被min1拒整份；采用后被误投影stale；修复历史仅保留未解决项。修合同/已采用投影/历史传递。第一次历史修复仍有最近8项上限。 |
| d1d59861（本窗口） | 第8轮再次证明：旧轮按审查建议改好并判resolved，后来同一句未退化却换ID重提。8项截断恰好丢掉原裁决。取消上限、全链传历史、新阻塞须事实依据、可选润色分栏。 |
| 用户停止矿区 | 不再第9轮实跑，不清记录，不给旧书继续打补丁。代码保存，效果缺口明确。 |
| 新书与本批交接 | 用户自行完成外卖新书三章。全文阅读并只读核验；记录情节进步、文笔及连续性缺口，更新四层交接入口及文学观察。 |

### 必须保留的诊断纠正

第一次一度怀疑响应含多个JSON是格式故障根因；实际解析器会取首个JSON，真实失败是`review_existing.changes=[]`违反min1。不要拿已撤回猜测继续改全局解析器。

第8轮不是简单“模型差”。第0轮`awaken_must_advance_conflict`要求改成“获得可短暂越级反杀的潜力，但当前伤势与代价使其无法立即使用”；第3轮按该文字并加禁止兑现后判resolved；第8轮原文未退化却新建`awaken_potential_conflict`，以可能误导为由要求重复禁令。工程只传最近8项已解决历史促成标准漂移，第一次修复不充分，不能隐去这点。

## 5. 已完成实现

### 0ef895af：建议合同、采用状态、首轮历史补齐

- `shared/types/planningRepair/advice.ts`：仅review_existing可空changes，其他执行模式仍要求修改；complete且无残留才可运行。真实返回第二项partial/0changes依旧不可选，不为放行删除阻塞。
- `server/src/services/novel/director/recovery/planningRepair/advice/PlanningRepairAdviceService.ts`：依据修复key及固定advice/option ID识别applied；已采用不同于过期，也不等于执行成功。来源指纹不再因生产体验切换误失效，真正计划/范围变更仍保护。
- 初版将已解决历史传入质量gate，但最近8项截断是此提交的已知不足，下一提交修正。

### d1d59861：完整裁决历史与新阻塞证据

- `server/src/services/novel/volume/planningRepair/domain/reviewIssueHistory.ts`：每问题保留首次范围和最新裁决，所有历史issue均可见，不截最近8项；evidence_refresh隔离来源变动，历史通过不能认证变更后的新证据。兼容计数omittedResolvedIssueCount为0。
- `PlanningRepairCoordinator.ts`：按允许章节生成issueHistoryByChapter并送修复器、窗口复核和章节gate，避免只有一条分支能看到历史。
- `server/src/prompting/prompts/novel/volume/evidence/newIssueEvidence.ts`：新问题basis包含类型、1–3候选引用、0–3反证、执行影响及为何已有约束不够；核验真实叶与冲突双方不同叶，别名不是不同证据。历史兼容可缺，新输出必需。
- 可选措辞/润色放refinements，与必须解决的issues分开。未来潜力不等于本章立即行动，计划不等于人物已有知识；不能仅以“写手也许忽视明确约束”阻塞。但代码不替AI判语义、不自动改safe/verdict，新阻塞与use_as_is/usable矛盾仍拒收。
- Prompt版本：`novel.planning_repair.advice@v7`、`novel.volume.chapter_task_sheet_quality@v10`、`novel.volume.planning_repair@v7`、`novel.volume.planning_repair_review@v6`。注册入口`server/src/prompting/registry/promptAssetLoaderEntries.ts`；恢复提示目录`server/src/prompting/prompts/novel/volume/recovery/`。
- [规划修复wiki](../wiki/workflows/planning-repair-loop.md)、模块README、当日发布说明和README已随代码阶段更新。本次交接新增稳定证据分层说明；具体小说问题只留观察，不把wiki写成变更清单。

## 6. 验证与实测结果

### 工程验证（本窗口先前已执行，本批仅核对日志，不重复构建）

- 0ef895af阶段166项独立通过、2原有跳过。`.codex-run/advice-state-tests.log`34、`advice-continuity-regression.log`21通过部分、Node24补跑`advice-prompt-regression-node24.log`59通过/2跳过、`planning-review-continuity-tests.log`52；`advice-client-final.log`8为重叠子集。最初Node25两套导入失败是ABI环境问题，已用Node24重跑，不说最初全绿。
- 真实10:53:06.770Z响应request `stream-1790592772454-13`离线回放：2选项通过结构，第一repair complete/5changes，第二review partial/0changes不可执行；`.codex-run/advice-contract-replay.json`。离线回放无付费、无DB写。
- d1d59861：`.codex-run/round8-focused-tests.log`149测试，147pass/2skip；随后增加2项gate测试，`.codex-run/round8-gate-final-tests.log`17pass（15重叠），合计本阶段149个独立通过/2skip。`round8-review-history-tests.log`39也是重叠子集。不能把两个阶段或子集相加成总成绩。
- 两阶段shared build、server build、client typecheck成功；本阶段日志`round8-server-build.log`、`round8-client-typecheck.log`，前阶段`advice-continuity-server-build.log`、`advice-client-typecheck.log`。本批只改文档，这些代码验证未被新代码改变失效。
- `round8-review-history-evidence.json`：第8轮前11问题/9裁决，下一上下文12/11，遗漏0，原觉醒resolved仍可见。`round8-current-task.json`、`round8-candidate.json`保留真实失败快照。
- 没有浏览器、UI交互、矿区新模型轮次、完整全套或发布验收。代码检查不是文学质量证明。

### 外卖新书：本批当前只读实测

小说`cmuld5c3u000cfgw0wottax89`；导演`cmulcyhz00000fgw07usqxsmg`，auto_director、waiting_approval、pendingManualRecovery=false；currentStage仍显示“质量修复”，但currentItemLabel是“第1–3章正文已完成，等待续拆下一段”。不能只凭stage误认仍卡在修复。手动工作区`cmuldar4700zkfgw0b2382zz3`是manual_create，正在查看第3章执行面板，不可混用ID。

配置：`deepseek / deepseek-v4-flash`、productionScope=sample3、productionExperience=professional、styleProfileId=`cmugh26y40000vkw0i94nzwam`。第三章planningRepair=committed，rounds1/max2。默认章长与每章targetWordCount均2800。

| 章/ID | 状态/字符 | 正文SHA256 |
| --- | --- | --- |
| 1 侧门绊脚 `cmuld7ytr00pbfgw001gpzxxk` | completed / 2774 | a1ef23be6b4ea2c00934e759769f659f027cb104a3be2d9749565f7bdecaee47 |
| 2 天字号房扣工钱 `cmuld7ytt00pcfgw059vplzpb` | completed / 2812 | d81c80f83043241f31c8886179616bcb75ea24098040639bb0dc3e11c8ae4df3 |
| 3 十二块碎片 `cmuld7ytu00pdfgw00f7mtil9` | completed / 4826 | 54d7e26943385a1e145f96daefac741361490c345fe97f22fb9facc638b3552f |

三章updatedAt分别2026-09-28T14:52:41.804Z、14:58:35.049Z、15:01:58.681Z。本批再读哈希相同。

三个成功job：`cmuld7zfv00wqfgw0mce4tmvm`、`cmulde8pb0155fgw0b1hdlo4a`、`cmuldhmhs018cfgw0hf72270g`。第二章此前job `cmuld9u8u00zffgw0py6uc4ix`于14:53:38.792Z失败，报规划格式/合同校验；随后成功。所以用户“基本顺畅”可信，不能写零失败。该书无在途generationJob；DirectorRunCommand两条均succeeded，DirectorRuntimeCommand无记录。

全文阅读结论：求活和饭碗让主角忍让/出头有动机；轻功脱身、内功保店、残剑救人逐章兑现能力，伤势与手臂麻木限制仍在。文笔重复解释、重复旁观反应、表情动作泛用；人物关系还薄。真实漏项包括第二章托盘放下又在手中、日薪变整月钱未交代；第三章树枝临用补来历、没有交付事件却订单送达。第三章长到4826字符。细项和推断边界全部在文学观察，不能把建议变成已批准修复。

## 7. 已知问题与临时绕过

- **矿区已停止**：小说`cmukwigbj001170w0ekq4trea`；导演`cmukwgxjg000p70w0fn8vrz80`；manual workspace `cmukwqfu1014i70w0qo1xrw8z`。停止时本窗口核验waiting_confirmation、8/8，候选`cmul5uf7b0004gsw09smaiuwu`。第一章《大典除名》2650字符，其余两章空是当时事实，本批不为恢复旧任务再查或改它。旧包2/5状态已过时。
- 没有人工绕过规划、增加无限预算、清历史、直接改DB或代写正文。停止样本是用户选择，不是工程根因不存在。
- 新书第二章旧失败根因尚未深入逐字段复盘，本次没修；三章成功证明最终结果可用，不证明此失败完全消除。
- 新书文学漏项是观察，尚未追到写手/审查/选稿哪一层。不能看一段就断定现有规则从未执行；后续应对照实际调用和保存结果。
- `prose_negative_flip`仍用固定句式扫描，合法单次“没有…而是…”可能high，矿区女卫先封锁而不救人曾被误伤。没有在本窗口改造。
- Node25测试ABI问题用现成Node24解决，无需破坏依赖；这不是生产模型问题。

## 8. 未执行与待执行任务

| 优先级/状态 | 内容、依赖与验收 | 入口/版本目标 |
| --- | --- | --- |
| 立即：已完成，可交接 | 三章全文阅读、现状核验、交接入口更新；新窗口只读复述即可接手，不默认开始实施。 | 本批文档，无发布版本 |
| 已取消样本推进 | 矿区建议获取、采用、第二章/第9轮推进。用户停止决定覆盖旧批准/旧待办；除非用户明确重开此样本。 | 不执行 |
| 讨论/观察，未获实施指令 | 新书语言压缩、关系表现、重复反应、动作/交付闭合和第三章篇幅。先查正文接受与选稿证据，不为一本书写分支；验收应保留情节进步并减少有证据的漏项。 | 既有runtime/acceptance、selection、写法/长度链，待用户选范围 |
| 已发现，未实现 | prose_negative_flip语义化误报治理；保留有效对比与空泛句式正反例，不能只删检测或用更多关键词。 | ProseQualityDetector相关链，独立后续阶段 |
| 长期方向，部分完成 | 书/卷主线、对手行动线、关系持续、关键选择、伏笔回收；更早原文检索与角色动态相关性。当前仅近3章24000字符完整窗口等已落地。需留出集和独立读者验证。 | 质量计划、writtenEvidence、宏观规划，未承诺版本 |
| 旧待办已被新实样部分覆盖 | 原“武侠/修仙前三章”中武侠聚合/系统新书已实测3章；不能仍写等待选武侠题材。纯传统武侠、修仙留出对照尚未做。 | 不自动开书或付费对照 |
| 历史待查 | checkpoint成功后lastError/isBackgroundRunning残留；缺章与整节拍跨范围预规划。仅自然复现才定位，不直接改DB。 | 相应状态投影/预规划模块 |
| 验证债 | 全量client旧契约失败、chapterStructuredOutputNormalization资源上限旧断言；窄回归不覆盖全量。 | 先核对当前基线，再单独修 |
| 未执行 | push、beta集成、main晋级、桌面打包上传、全书长篇生成、独立盲评。 | 相应明确请求，桌面仍0.4.28 |
| 待用户新窗口实证 | AGENTS自动发现并读取CURRENT，尚未fresh-session验收，不保证聊天逐字无损。 | 新窗口回报实际读取结果 |

### 其他样本不要丢失

- 《流放迷雾死地：我的打捞每日翻倍》：小说`cmujxe1m9000aakw0f1l1mvp1`、导演`cmujtcwa9005fr4w0ffh9hvmh`，历史custom_k3/kimi-k3，3章2841/3049/2559字符，4–7只有路线；不自动第4章。
- 《祭品厨神：我在禁忌森林开食堂》：小说`cmukqni0l004y9ww0usot67gs`、导演`cmukq9vvf004m9ww0s426950e`，历史两章4147/2936。87分漏绑手进食、水/热源、异界知识和伤腿动作。不能拿更早第二章空的快照覆盖最终历史。
- 矿区第一章有权力压制、擦血、符文异常的戏；婚约关系重量、重复受难、选择不足仍是观察。测试停止不抹掉其正面价值。

## 9. 关键文件与产物索引

- 入口：仓库`AGENTS.md` → [PROJECT_CONTEXT](PROJECT_CONTEXT.md) → [CURRENT](CURRENT.md) → 本文。
- [框架质量计划](../plans/novel-framework-quality-program.md)、[场景因果质量证据wiki](../wiki/workflows/scene-causality-and-quality-evidence.md)、[规划修复wiki](../wiki/workflows/planning-repair-loop.md)、[结构输出预算恢复](../wiki/workflows/structured-output-budget-recovery.md)。
- 本文是最新；[0950Z旧全包](2026-09-28_0950Z_full_thread_handoff.md)保留更早时间线及链接。其下一步和状态已被本文替代。
- [早期完整包](2026-09-27_candidates-and-continuity_thread_handoff.md)、[提交检查点](2026-09-27_commit-checkpoint_thread_handoff.md)、[K3三章](2026-09-27_1852Z_first-three-chapters_thread_handoff.md)。
- 阶段记录：`2026-09-28_0355Z_framework-quality-phase-one.md`、`0500Z_planning-repair-advice.md`、`0530Z_chapter-two-contract-failure.md`、`0625Z_facts-actions-promises.md`、`0740Z_mining-planning-repair.md`、`0910Z_mining-evidence-paths.md`（后五者同日期前缀，均在此目录）。
- [新书观察](../evals/framework-quality/observations/2026-09-28-delivery-opening.md)、[厨神观察](../evals/framework-quality/observations/2026-09-28-chef-opening.md)、[矿区观察](../evals/framework-quality/observations/2026-09-28-mining-opening.md)。开发集`docs/evals/framework-quality/cases.v1.json`和`server/scripts/framework-quality-eval.cjs`不进入正常写书上下文。
- 本机`.codex-run/delivery-three-chapters/`：chapter-1/2/3.txt全文、chapter-metadata.json、director-seed.json。目录不入Git；不把整个seed公开输出或提交。本文仅保存必要非秘密标识与哈希。
- `.codex-run/advice-*`、`planning-review-continuity-tests.log`、`round8-*`本窗口证据；前期`mining-capacity-*`、`mining-followup-*`等仍留存。真实模型日志`.logs/2026-09-27/2026-09-27T22-15-17-dev.llm.jsonl`，按request/task抽取，勿反复输出大请求。
- `.codex-run/recovery-20260927/`旧备份曾quick_check通过，仅历史，不是最新备份；不得据此执行新破坏操作或重跑旧维护脚本。

## 10. 下一窗口启动顺序

1. 在本应用目录完整读取磁盘AGENTS，再PROJECT_CONTEXT、CURRENT与本文；需要了解具体文学判断读新书观察，评价新版本正文则再取全文。
2. 只读`git rev-parse --show-toplevel`、`git branch --show-current`、`git log -4 --oneline`、`git status --short`；区分代码HEAD d1d59861与之后文档提交。不切master、不清未跟踪项。
3. 若用户已经继续新书，只读查询该小说和导演/工作区，更新事实；不用旧矿区接口代替新书。不POST、不调用模型来“检查状态”。
4. 向用户复述：目前已能产出有戏的三章；流程仍有一次失败记录、文笔/少量因果漏项；矿区停止；最新任务只是审读与交接。然后按新请求选一个有边界的动作。
5. 用户若批准改进，先追真实源数据与调用证据，区分模型判断、合同校验、状态投影、小说内容问题。窄验证、wiki与阶段提交依AGENTS；不要为了交接复跑构建/付费生成。

## 11. 待确认事项与风险

- 交接就绪：本批没有在途模型调用或数据写入，该书job/command无在途记录；只改文档即可换窗口。其他用户未来操作会让快照过时，接手仍须核验。
- 用户新书跑通是正面证据，但题材、具体候选与模型行为不同，不能归因某一补丁单独“完全解决”矿区审查震荡。
- 第三章长度需区分字符与项目净字数统计；郭芙蓉/同福混搭来自候选而原idea指定金庸15部，边界是否被用户接受未确认。此次不擅自纠正创意设定。
- 新问题basis校验只能证明结构与引文存在，不能保证AI语义判断正确。所有历史保留提高上下文长度；大历史仍受输入容量边界，不能承诺无限承载。
- 老窗口曾记录gpt-6-astra有效258400、7次压缩等，只属于那个窗口当时配置；不是当前窗口精确计数或所有模型上限。不要因用户说快满而猜剩余token，不擅改配置为1M。
- 本批文档没有运行时用户可见功能变更，按readme-release-updater跳过README/发布说明噪音更新；之前两个代码阶段的发布说明保留。稳定证据分层原则补wiki，单书审读放观察。

## 12. 可直接发送给新窗口的开场提示

> 接手 D:\novel\AI-Novel-Writing-Assistant。完整读取磁盘AGENTS.md、docs/handoffs/PROJECT_CONTEXT.md、CURRENT.md及最新完整交接包，先只读核对Git与当前状态并复述接手情况。矿区旧书我已决定停止，不再恢复；最新样本《差评变强：外卖小哥闯金庸》前三章已完成，情节有进步、文笔及局部连续性仍有问题，阅读依据在交接链接的完整观察。保留既有改动和所有书稿，不自动改稿、生成第4章、调用付费模型、切分支或push。先告诉我你接住了哪些结论和未完成事项，再按我的新要求推进。
