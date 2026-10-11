# 《外卖小哥的茅山账本》第一章验收停点

后续：用户已批准两处修复，代码与307项离线回归完成，见[修复与原任务继续操作](2026-10-11-maoshan-review-recovery-fix.md)。原范围已从持久seed核实为1—3章试写；下文保留15:25诊断时的判断，当前状态以[CURRENT](../handoffs/CURRENT.md)为准。

核验时间：2026-10-11 15:25 UTC。范围：截图、隔离库只读查询、原调用日志、恢复代码阅读及纯校验函数离线回放。没有点击继续、发送模型请求、修改小说数据或应用源码。

## 用户观察

用户使用近日在新版反复使用的同一主题想法创建本书，反馈开书到首章生成顺畅，前几百字文笔不错。用户将该片段送朱雀检测，报告53.86%人工特征；这是用户报告的局部结果，不是全文文学评价或工具通用质量证明。用户尚未细读首章。截图为 `C:/Users/lyaxu/Pictures/Screenshots/屏幕截图 2026-10-11 100745.png`。

## 实际运行证据

- 分支 `codex/production-core-refactor`，核验HEAD `0efb8fe423159b1a8cb8b07d7716ca8a1c33dcbb`；原4份dirty文件保留。源码未改。
- 用户后续已执行旧版启动脚本。启动记录时间13:44 UTC，后端PID33000、前端PID34024。5190代理health成功，后端runtime为source、stale=false，加载HEAD `0efb8fe42315`。
- 原隔离数据源 `D:/novel/.comparison/2026-10-10/old-test.db`。新版5173/8787仍为PID3960/21116，本轮未操作。
- novelId `cmv3wyvw40015gow0780pycx9`；导演 `cmv3wvaqm000sgow0l5or2pke`；pipeline job `cmv3x3pr500r7gow0pt92xbmt`。
- 第1章 `cmv3x2mt600jsgow0e6kb0852`《差评与旧账本》已保存3013字符；正文SHA256 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`。第2章 `cmv3x2mt800jtgow0la32yn38`《八极拳压不住阴气》正文为空。
- journal操作 `pipeline:cmv3x3pr500r7gow0pt92xbmt:cmv3x2mt600jsgow0e6kb0852` 为paused；prepare、pipeline.draft、pipeline.save_draft为done；pipeline.review:0和evaluation为failed。正文生成完成不等于审查/实际状态提交完成。
- job为failed且pendingManualRecovery=1，currentStage=reviewing；导演queued且pendingManualRecovery=1。没有执行租约或活动导演命令。当前范围任务1—1章，导演界面文字1—3章，控制策略full_book_autopilot；不得把“继续”误认为自动只停到第3章或第10章，恢复前应重新明确范围。
- 原writer模型deepseek-v4-flash，温度0.7；审查同模型温度0.35，正常finishReason=stop、未触及输出额度。最后一次已记录模型响应14:33:20 UTC，是此前发起的MiniMax-M3.1-Flash-Preview伏笔同步；并非所有子任务都使用顶栏模型。未修改路由或配置，费用上限仍待用户固定。

## 根因与置信度

主因分类：实现缺陷（人工暂停与原任务恢复不衔接）；触发因素：模型审查引文不精确，校验对不适用/缺失状态证据的处理也有需修正处。不是当前证据支持的第二章节奏板问题，也不是断网或输出额度耗尽。

1. 原审查响应为accepted，但postValidate产生多个validationIssues，assertReviewCompleted因此抛CHAPTER_REVIEW_INCOMPLETE。正文保护生效，没有据未经核实意见改稿。
2. 引文确有不一致：模型引用“他把册子塞进外卖箱最底层”，正文是“劳梓凡站起来，把册子塞进外卖箱最底层”；另将原文逗号截成句号。不可通过放弃来源核验掩盖问题。
3. 首章三个progressionChecks都是not_applicable、语义布尔值null；现有校验仍报semantic_findings_unknown。actionState还有缺transitionEvidence和行动/转移时序冲突；应区分审查格式/范围缺陷与真实剧情问题，不可让全部核验异常都成为改正文理由。
4. `production/NovelPipelineExecutor.ts`的安全错误分支写failed + pendingManualRecovery=true；`novelCorePipelineService.ts`的resumePipelineJob仅接受queued/running，对failed直接返回。`director/automation/novelDirectorAutoExecutionRuntime.ts`在原job仍failed时清空其ID，可能进入新job；新操作不能替换旧paused journal，故不能保证页面“继续自动导演”从原审查步恢复。这由当前数据与代码链确认，未用真实模型重试来试错。

推荐当前操作：保留现场，阅读全文和下载首章；不继续导演、不另起第二章、不手改节奏板、不换模型、不关闭审查。下一阶段应通用修复审查校验与原failed暂停任务的显式恢复，先用本次保存响应和journal离线回归，再由用户从本书源页恢复。不得改库硬置queued或替换operationId。修复后属于新的验收版本，需要记录此次失败与人工干预，不能拼成旧固定版本十章无故障通过。

## 可复核产物

- 私有诊断 `.codex-run/maoshan-first-chapter-20261011/diagnosis.json`、首章副本 `chapter-1-saved.txt`。
- 原日志 `.codex-run/production-core-restart-20261011/20261011-084400-old-server.llm.jsonl`；审查requestId `stream-1791729009079-157`。
- 离线回放使用既有dist的validateActionStateEvidence、validateProgressionEvidence及offlineBootstrap（阻止默认数据库和网络）；输入为只读库正文/场景键和保存的审查响应。各场景覆盖完整；四场景均有证据或时序核验问题，三个progression检查均含semantic_findings_unknown。不是新模型审查，也不代表已完成通用修复。
- 尚未阅读全文做文学评价；没有真实恢复验证。

这是一份本次验收记录，未形成新的稳定架构决定；不更新wiki或用户发布说明。
