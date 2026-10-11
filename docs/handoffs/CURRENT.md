# 最新交接入口

更新：2026-10-11 17:15 UTC。

**最新停点：用户成功加载修复后，原任务恢复仍失败，暂勿再次点击继续。** 旧服务已于17:01重启为34144/45328，运行b81e279d、stale=false；新版未动。17:07“继续”被规划恢复分支改道，进入章节节点时漏传原job身份，误建job cmv42syf1002gcgw06h79ovnu并在95毫秒内触发journal冲突。原job未恢复，首章3013字符/hash未变，无新增模型用量。详见[第二次停顿与根因](../evals/2026-10-11-maoshan-resume-second-stop.md)。本轮只读定位，未修源码或业务数据；此前307项离线成功不等于实际入口恢复通过。下方16:47及更早操作说明为历史，旧一次性重启脚本固定旧PID，不能重放。

用户双击运行日志确认：预检通过，但Stop-Process PID33000被Windows拒绝访问，尚未执行启动。16:47 health仍PID33000/stale=true；5190仍34024，新版3960/21116不变。此次是Windows进程权限问题，与前次时间比较和历史工具blocked by policy分别记录。脚本已在停止前明确要求右键restart-old.cmd“以管理员身份运行”，并设置UTF-8日志；未自动提权或重启。

用户手动重启的Backend identity changed是脚本把DateTime与字符串直接比较造成的误判，非服务换了身份；已修UTC比较，PowerShell 7.6.5和Windows PowerShell的CheckOnly实跑通过。服务仍未重启，原稿和暂停不变。可双击`.codex-run/maoshan-review-recovery-fix-20261011/restart-old.cmd`，日志自动保留在同目录restart-last.log；详见下方修复报告。源码修复提交为`d2cc20e5`，后续仅运行说明文档。

**当前停点：两处修复与离线回归完成，旧运行服务待加载修复，再由用户从原任务第一章审查继续。** 本轮用户授权修复审查证据校验及failed暂停原job恢复，并要求记录与整体台账同步。没有真实模型调用、恢复或正文写入。

必读：[完整交接](2026-10-11_1615Z_maoshan-review-recovery_thread_handoff.md) → [修复证据及继续步骤](../evals/2026-10-11-maoshan-review-recovery-fix.md) → [批准方案](../plans/2026-10-11-production-core-refactor.md)。长期约束见[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，总体事项见[WORK_LEDGER](WORK_LEDGER.md)。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)均为讨论未实施，已接入台账。

仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`。本轮基线HEAD `254e93da5479b354173890eabafa75b4fc409d76`；修复提交与本指针一同落库，实际HEAD用git核验。原三Structured客户端改动及WORK_LEDGER下方原964行未提交追加保留；本轮只提交台账顶部新记录。历史未跟踪材料保留。

本轮最终服务端编译通过；31文件307/307封网离线测试通过，无跳过。证据包含真实3013字符正文、原审查回答与暂停journal；纠正回答是离线替身。没有本轮客户端修改/UI测试。前序阶段2/3的417项结果是历史基线，不能与本轮数目相加或代替真实验收。

书《外卖小哥的茅山账本》`cmv3wyvw40015gow0780pycx9`；导演`cmv3wvaqm000sgow0l5or2pke`；原job`cmv3x3pr500r7gow0pt92xbmt`。16:12只读确认首章hash未变，job failed/pendingManualRecovery=1/reviewing；第二章原停点为空。导演持久范围已核实 **sample3/chapter_range 1—3**，job为1—1；full_book_autopilot是推进策略，不代表本次全书范围。

16:10服务：旧3000 PID33000/5190 PID34024，health stale=true，未加载修复；新版5173 PID3960/8787 PID21116未变。本轮未停止或重启进程。此前自动审批以blocked by policy拒绝启动；未绕过。已准备用户执行的一次性重启脚本（报告内附命令），只读预检与语法检查通过，启动部分未执行。

下一步：用户重启成功、刷新本书第一章源页，点击“继续自动导演”，沿原任务从审查继续；保留原范围/预算，勿单独生成第二章或跳过质检。运行记录只读。真实原任务恢复、完整三章及十章文学验收待做。不开历史导演、不自动调用模型、不改新版、不造GUI、不push/main/beta；历史清理与发布单列待办。
