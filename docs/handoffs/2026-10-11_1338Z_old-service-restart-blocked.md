# 旧隔离服务重启核验（启动被拦截）

时间：2026-10-11 13:38 UTC。本记录补充[完整阶段交接](2026-10-11_1322Z_production-core-stage3_thread_handoff.md)，不改变已批准方案和离线证据。

## 用户授权与结果

用户授权按原隔离配置核验并重启旧版，以便其开始UI和十章验收；新版不动，不恢复历史导演，不自动调用模型。

已核验并停止旧后端PID33384和前端PID26356。自动审批拒绝了组合启动命令和单独旧后端启动命令，只给出 `blocked by policy`，未给出更具体原因。未通过其他通道绕过。最后核验3000/5190无监听，故不能宣称服务可用或验收已就绪。

新版5173 PID3960（2026-10-10T21:43:00.60843-05:00）和8787 PID21116（2026-10-10T21:41:03.961579-05:00）未变，命令行未变；未停止、启动或修改新版。

## 仓库与数据

- 分支 `codex/production-core-refactor`，重启核验时HEAD `49be0b2e2be46295a8fb1703765b7267a04912a9`；此后仅提交本运行交接。固定源码仍为 `39ca95d365be137ddd978892ffe9f48eb0ca6dd5` 加原三客户端dirty文件。
- 原四份dirty文件（含WORK_LEDGER）binary diff SHA256仍为 `cff9f07557cf83e8d5389afe87f8ab0fc0d06d87a4bcbe6e580cab9aa82e5a07`。
- 原配置来自 `D:/novel/.comparison/2026-10-10/launch.ps1`；没有执行该会操作新版的一次性脚本。
- 数据源 `file:D:/novel/.comparison/2026-10-10/old-test.db`，127.0.0.1:3000，CORS 5190，前端5190。禁用日志清理，保留LLM日志。
- 只读SQLite在线备份：`.codex-run/production-core-restart-20261011/old-test-before-restart.db`，1,027,043,328字节，`PRAGMA quick_check`为ok。未重置、迁移或清理数据库。
- RAG在server/.env和AppSetting中均false；12487个queued索引中7个已到期，但worker按原禁用配置不会执行。启动脚本显式继承此false配置，不修改数据库设置。
- 无queued/running导演命令，无短篇自动恢复项，无待执行章节副作用。历史GenerationJob queued1且pendingManualRecovery=1；NovelWorkflowTask failed1/waiting_approval3。DirectorLlmUsageRecord为35条，最新2026-10-10T14:47:59.334+00:00。未发送生成、恢复或探测模型请求。

## 继续操作

已准备供用户在本机PowerShell执行的脚本：

```powershell
& 'D:\novel\AI-Novel-Writing-Assistant\.codex-run\production-core-restart-20261011\start-old-only.ps1'
```

脚本仅启动旧版两个进程，不杀任何进程，不操作新版；端口被占用则退出；保留时间戳日志，检查5190代理的health及后端runtime.stale。脚本经过PowerShell语法检查，**尚未执行成功或验证实际启动**。若以后再接手，需先只读复核队列和端口，不能根据本记录假设仍为空闲。

启动成功后访问 `http://127.0.0.1:5190/novels`。专用新验收书入口为“手动创建小说”（`/novels/create`），或用户认可的“AI 自动导演开书”（`/novels/auto-director`）；不要恢复旧样本。生成动作由用户主动执行，按[十章操作单](../evals/2026-10-11-ten-chapter-acceptance.md)固定范围与费用。中断回章节源工作区“稿件与恢复”，运行记录只读。

本记录仅为运行状态，不引入产品行为或长期架构知识；无需更新release notes、README或wiki。UI、模型和十章文学验收仍未运行。
