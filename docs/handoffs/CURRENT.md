# 最新交接入口

更新：2026-10-13，阶段3 v17审查传输与失败留证整体收敛中。

**最新事实**：用户16:31 UTC继续原第二章审查后再次暂停。v16四次正常返回；合法长JSON被格式修复截去中段，丢失付款场景，后续重写又改变状态维度。完整枚举/数组示例未送到初审也是契约缺口。不是用户刷新操作错误，旧的“v16已可继续”记录仅为历史加载证据。

**最新完整快照**：[v17诊断、实施与最终核验](../evals/2026-10-13-review-wire-v17.md)。前序[v16](../evals/2026-10-13-review-semantic-v16.md)和[v15诊断](../evals/2026-10-13-v15-review-semantic-gap.md)保留，不代替本轮状态。

本轮统一处理合法回答无损、详细契约与传输分层、一次全文纠正、格式与独立语义问题同轮反馈、完整失败留证及恢复缓存边界；保留时序/主体/维度/来源/修文依据检查。最终server编译和55文件565项封网回归通过；21份真实回答原样回放。待受控加载核验，不让用户逐点重试。

仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，接续b57ba37a。预存三个Structured客户端改动与台账历史964行独立保留。

16:54 UTC只读核验：隔离DB D:/novel/.comparison/2026-10-10/old-test.db；书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke，原job cmv5h9a64000j20w0uw4cxeo0。首章3013字、第二章3652字hash不变，原review人工暂停、prepareDirector通过，范围/预算/账本不变。调用35均用户触发，本轮代理0，活跃工作0。旧3000/PID40152仍v16，5190/PID41368；新版5173/8787关闭。之后加载结果以v17快照为准，旧PID及31调用脚本不可复用。

## 主线和恢复边界

阶段2可靠保存与原步恢复已有实现和离线证据；阶段3审查真实稳定性尚未通过；阶段4固定版本十章仍未通过。保留文笔、写法、质量检查、防丢稿。新版不动、不恢复历史书、不新增GUI、不自动调用模型、不push/发布。

最终核验后才从第二章原源页刷新并点一次“继续自动导演”，沿用原job的审查步骤。链接见v17快照。不得新建任务、重写原稿或从运行记录页执行恢复。

长期边界[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)，[恢复wiki](../wiki/workflows/chapter-review-resume.md)。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为已记录、未实施设计。
