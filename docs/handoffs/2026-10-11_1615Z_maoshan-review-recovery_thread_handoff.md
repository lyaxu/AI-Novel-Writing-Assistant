# 首章审查与原任务恢复交接

更新：2026-10-11 16:15 UTC。按[PROJECT_CONTEXT](PROJECT_CONTEXT.md)与[WORK_LEDGER](WORK_LEDGER.md)统一维护。

## 1. 接手摘要

用户批准修真实审查证据反馈、failed人工暂停原job恢复，并要求用现场离线回归，告知如何从原审查继续。代码与307项离线验证完成；旧运行服务尚未加载修复，用户需按[操作步骤](../evals/2026-10-11-maoshan-review-recovery-fix.md)重启并从本书源页继续。代理未点击恢复。

## 2. 环境与唯一真源

仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`，基线HEAD `254e93da5479b354173890eabafa75b4fc409d76`。本快照随修复提交，最新提交由git核对。原三Structured客户端dirty保留；WORK_LEDGER原964行追加保持原样，仅本轮顶部新增记录进入提交。未跟踪历史材料均保留。

隔离库 `D:/novel/.comparison/2026-10-10/old-test.db`，只读核验。旧版3000 PID33000/5190 PID34024，health stale=true。新版5173 PID3960/8787 PID21116未操作。旧启动脚本显式RAG=false、日志清理false、127.0.0.1及CORS5190。旧1GB备份早于本书开书，不得将其当作本书备份；本轮无破坏性数据库操作。

## 3. 用户目标与不可破坏约束

保留创作能力、认可写法、质量检查、防丢稿；不换writer或模型，不改新版、不恢复历史样本、不自动调用模型、不造第三GUI、不push/合并发布。记录必须与整体台账和交接相连。断网/休眠/重启续作及书内agent只是讨论，见[设想](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)。

## 4. 关键进程时间线

前序[阶段2/3交接](2026-10-11_1322Z_production-core-stage3_thread_handoff.md)交付源码39ca95d3及417项后端验证。自动启动被拦后，用户13:44自行启动并开本书；15:25只读诊断保留首章及失败响应。随后用户授权本轮修复。先旧dist复现审查失败，再修v8及原job恢复；最终编译通过，统一307通过。初轮6项测试缺替身已补，失败日志保留。

## 5. 已完成实现

审查postValidate反馈错引、缺覆盖和状态证据，使用原有一次纠正预算，失败暂停并保留原稿，not_applicable允许null。源页resume预检与任务CAS/命令创建同事务，执行侧再检并恢复同一failed暂停job；原参数、预算、journal完成步骤保留。取消竞争/人工改稿/变更范围/未知结果阻止恢复，不另起替代job。模块规则见[wiki](../wiki/workflows/chapter-review-resume.md)及production/recovery/README。

## 6. 验证与实测结果

本轮服务端tsc exit0；封网、封默认库，31文件307/307、0跳过。原始301/307的6项缺失替身修正后重跑全清单。无本轮客户端源码/UI变化，不重复UI检查。私有目录 `.codex-run/maoshan-review-recovery-fix-20261011/`含最终编译、测试清单、初失败和成功日志、原dirty备份、用户运行重启脚本及只读预检。详见[修复报告](../evals/2026-10-11-maoshan-review-recovery-fix.md)。

## 7. 已知问题与临时绕过

代码已修不等于运行生效：旧服务stale=true，需要用户重启。此前自动审批以blocked by policy拒绝启动；本轮不换通道绕过。新脚本仅语法及读取预检通过，停止/启动未执行。离线不能证明真实审查一次成功或UI恢复通过。审查证据仍严核，可能再次产生可解释暂停。

## 8. 未执行与待执行任务

| 优先级/状态 | 下一步与验收 |
| --- | --- |
| P0 代码完成、运行未载入 | 用户按报告执行一次旧服务重启，health确认新PID/stale=false；新版不动 |
| P0 原任务UI/模型恢复未验 | 源页继续自动导演，核对同job从第一章审查起、已保存稿不重复生成、最终事实提交后才进第二章 |
| P0 十章未完成 | 先本次1—3章范围，按原十章单分段验收；阅读全文与工程结果分开，不在暂停时改范围 |
| P1 断线与书内agent讨论 | 设想已接台账与PROJECT_CONTEXT，专项设计/真实设备验证未安排 |
| P1 历史清理与发布延期 | 无授权不清库、不恢复旧样本；feature→beta→main及发布另行推进 |

## 9. 关键文件与产物索引

- 书 `cmv3wyvw40015gow0780pycx9`；导演 `cmv3wvaqm000sgow0l5or2pke`；job `cmv3x3pr500r7gow0pt92xbmt`；首章 `cmv3x2mt600jsgow0e6kb0852`。
- 首章3013字符，hash `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`，16:12只读未变。job范围1—1、retryCount0/maxRetries1；导演sample3/chapter_range1—3，full_book_autopilot是推进策略。
- 现场日志 `.codex-run/production-core-restart-20261011/20261011-084400-old-server.llm.jsonl`；review request `stream-1791729009079-157`，DeepSeek deepseek-v4-flash/0.35正常stop。
- `server/tests/novelProduction/fixtures/`两份现场fixture；修正审查是离线替身，不是模型实测。
- [批准方案](../plans/2026-10-11-production-core-refactor.md)、[十章单](../evals/2026-10-11-ten-chapter-acceptance.md)、[原诊断](../evals/2026-10-11-maoshan-first-chapter-stop.md)、[修复报告](../evals/2026-10-11-maoshan-review-recovery-fix.md)。

## 10. 下一窗口启动顺序

1. 完整AGENTS→PROJECT_CONTEXT→CURRENT→本快照和修复报告，核验branch/HEAD/dirty。
2. 核验运行PID/stale与只读任务、正文、journal，不按旧PID盲杀或根据暂停自动恢复。
3. 按用户最新要求协助本书原审查继续；操作源页，运行记录只读，不单独生成第二章。
4. 验收结果同步CURRENT/台账与证据，保留历史失败和用户文笔反馈。

## 11. 待确认事项与风险

用户尚未阅读全文；53.86%人工特征为用户报告，非质量认证。服务/PID/任务会漂移，重启脚本发现变化即退出。两项设想没有实施授权。可安全交接，但恢复验收准备附带“先加载修复”的条件。

## 12. 可直接发送给新窗口的开场提示

接手旧版首章验收修复，先读AGENTS、PROJECT_CONTEXT、CURRENT和1615Z交接。两处修复与307项离线测试完成；先核验服务是否载入修复及原三客户端/台账dirty，按我的最新指令协助《外卖小哥的茅山账本》从原job第一章审查继续，原范围1—3章。不自动恢复、调用模型或改新版。新结论同步台账和CURRENT。
