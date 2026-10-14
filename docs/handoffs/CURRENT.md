# 最新交接入口

**最新现场覆盖下方恢复指引：2026-10-14 00:02（UTC05:02）**。用户23:58点击“按自定义方向修复”后，授权成功保存：原修复rounds2/maxRounds3、repair_then_review、原请求key保留。新第三章job cmv7n3mug000240w0aj5dvutf在85ms内失败，提示章节正文/执行约定/所有权变化。只读定位：旧第三章production journal仍绑定原job cmv7le2h30004qow0s4f66mfr且paused；新job生成新operation，runPipelineChapter的replaceCompletedOnly保护拒绝接替未完成journal。旧prepare.execution_contract又保存unknown（错误文本为已完成2轮规划未通过），后续修复须同时核对已确认规划门禁与真正未知调用，不能直接绕开保护。此次模型调用仍51，前两章hash不变，第三章空。页面“继续已授权修复”仅表示授权存在，不表示执行冲突消除；暂不让用户再次点击、追加新授权或改正文。本轮只读诊断/留证，无产品代码、数据库或服务变更；下一有界动作是按阶段3主线修复规划授权与原生产恢复记录的衔接并做端到端离线回归。证据补在下方同一完整快照，不能按旧“已加载即可恢复”重复验收。

更新：2026-10-13 23:52（UTC10-14 04:52），阶段3写前规划完整合同修复已加载并核验。

**运行核验通过**：代码25c77110a7bc，旧后端3000/PID39024，启动2026-10-14T04:51:57.366Z；5190代理health正常、stale=false、75项源码hash通过。旧前端41368身份不变，新版5173/8787关闭。只读规划接口确认原任务waiting_confirmation、2/2、无新授权；GET前后DB保护核验不变，51调用、活跃0、代理0。无需手动重启，从下方原书规划修复入口操作。

**最新完整快照**：[规划必达事项修订与完整合同一致性](../evals/2026-10-13-planning-required-elements.md)。接续[授权范围完整性](../evals/2026-10-13-director-range-completion.md)与[v17审查修复](../evals/2026-10-13-review-wire-v17.md)，旧“从第二章原审查继续”指引失效。

## 当前停点与根因

用户继续后原导演已推进到第3章写前规划。UTC10-14 04:13（用户时区10-13 23:13）停止：waiting_approval / step_review_required，pendingManualRecovery=true；planningRepair waiting_confirmation，已用2/2轮。第三章实体存在但正文空，第一章3013字、第二章3680字及hash不变。不是断网、保存失败或上次范围误完成。

真实两轮修复调整了场景，却受旧schema与继承逻辑限制，无法改正要求重复第二章付款/拍照的必达事项。章级及独立窗口复核最终拒绝有依据。本轮新增AI显式同章修订、原句/替换/理由/保留职责/场景的可追溯映射，同步完整合同与兼容副本；未改事项保留，语义仍由AI复核，不能靠删义务或关门禁过关。

## 验证和运行基线

server编译通过；组合封网1139项中1137通过、0失败、2项既有拆书skip，含新增13项现场/恢复回归及历次审查样本。最后补充历史场景定位与当前落实的提示词边界，重新编译并跑49项相关回归全过；其他生产逻辑未变，复用组合结果。原答回放与人工新契约模拟分开；客户端未变，复用前序12项状态测试，UI留给用户。本轮不能宣称真实模型复核、阶段3整体稳定或固定版本十章通过。

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor，接续 fdb898e3（前序代码103f19c6）。预存三个Structured客户端改动与台账历史964行独立保留，本轮不push/合并/发布。

隔离DB D:/novel/.comparison/2026-10-10/old-test.db；书 cmv3wyvw40015gow0780pycx9，原导演 cmv3wvaqm000sgow0l5or2pke。新第三章job cmv7le2h30004qow0s4f66mfr failed；第二章job仍succeeded。04:46 UTC只读保护核验：原候选/seed、两章hash、第三章空、6项资源committed、2/2预算不变；调用51（上轮42，本次用户9、代理0），活跃0。加载前旧后端42432/3000，旧前端41368/5190，新版5173/8787关闭；最终身份见本页末节。

## 用户恢复入口

修复加载核验通过后，从[原书节奏 / 拆章](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=structured&volumeId=cmv3wyvw40015gow0780pycx9-volume-aba7a8e2-4a3b-49d3-bc43-b33d4cca4a7e)刷新，在规划修复面板展开“高级：自定义修复方向（可选）”，填入：“以已写正文为准，修正所有重复已完成事件的必达事项，保留原叙事职责和回报；同步核对必达事项、场景、禁止事项与回收引用，不改已写正文，不扩大章节范围。”点击一次“按自定义方向修复”。这明确授权追加1轮修复与复核，通过后沿原任务接续；原两轮历史保留。

普通继续不能越过预算，只复核旧候选不会纠正清单；不新建导演，不重跑第二章审查，不从运行记录恢复。代理不点击、不替用户追加模型调用。

## 主线和操作边界

阶段2可靠保存与原步恢复有实现和离线证据；阶段3真实稳定性仍待验，阶段4固定版本十章未通过。保留文笔、认可写法、质量检查、防丢稿；新版不动、不恢复历史书、不新增GUI、不自动调用模型。

长期边界[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)，[恢复wiki](../wiki/workflows/chapter-review-resume.md)。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为待设计事项。
