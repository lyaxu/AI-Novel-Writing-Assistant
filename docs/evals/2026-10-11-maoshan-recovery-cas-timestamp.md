# 原任务继续409：维护时间格式导致CAS误判

核验与修复：2026-10-11 13:18 UTC-5（18:18 UTC）。用户按[完整入口修复](2026-10-11-maoshan-full-entry-recovery.md)继续后提示“导演任务已被取消、恢复或修改，请刷新工作区”。正常源页POST两次409；无新命令或模型调用。刷新无法解决这次持久化兼容问题。

## 根因与验证缺口

上次安全纠正关联的维护脚本用JavaScript toISOString写入updatedAt，值为`2026-10-11T17:45:36.227Z`。Prisma SQLite适配器读取为Date后，在命令CAS中以`2026-10-11T17:45:36.227+00:00`绑定。SQLite文本等值不相同，导致updateMany命中0，即使任务没有被取消或改变。

这是代理维护操作引入的数据格式缺陷，不是用户操作、页面缓存或恢复分支再次丢job。此前封网测试用替身承接数据库CAS，副本演练只核对字段保留与journal preflight，漏了真实Prisma适配器的日期往返匹配。保留这一验证缺口，不把上轮全绿解释为本次用户问题已被覆盖。

## 修复与真实证据

- 维护脚本写入适配器一致的`+00:00`格式，新增真实Prisma SQLite回归：维护写入后，原命令CAS匹配1行；重复旧CAS仍匹配0。该组12/12通过，全封网，使用临时本地数据库。
- 新建一致性备份`.codex-run/maoshan-cas-timestamp-20261011/before-timestamp-fix.db`，1,027,043,328字节，quick_check=ok。
- 完整副本中以真实Prisma查询复现日期条件不匹配；仅转换后缀后，调用实际DirectorCommandService.enqueueApproveGateCommand，真实事务受理approve_gate。后台worker未启动，模型网络被拦截，生成内容和继续执行未运行。
- 18:18:23真实数据库事务仅将该任务updatedAt后缀Z转换成+00:00，时刻毫秒值不变。CAS核对旧字段、关联、暂停和原稿hash；其余任务字段全部相同，Chapter/GenerationJob/ChapterArtifactSyncCheckpoint/DirectorRunCommand全行hash不变。首次事务保护检查遇到JS原型差异已回滚，修正比较方式后才提交。
- 18:18:25真实Prisma只读查询完整命令CAS谓词匹配成功；原任务prepareDirector预检再次通过，首章3013字符、hash `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`不变，1—3章范围、预算和人工暂停保留，本导演17:00后模型用量0。

私有证据：上述目录`rehearsal-evidence.json`、`live-fix-result.json`、两份隔离命令演练副本。第一份演练已受理continue，因测试断言要求approve_gate而失败；第二份改用源页实际approve_gate入口并通过，没有将错误断言当产品故障。命令演练副本绝不能作为正常服务数据源。

仅维护脚本、测试、文档及一个数据时间字段变化，运行应用源码未改；**无需重启**。旧服务继续运行已加载的入口修复；新版未动。此维护兼容性修正不新增产品能力，发布说明不重复追加。稳定教训已入[wiki](../wiki/workflows/chapter-review-resume.md)。

用户可在当前第一章源工作区按F5或点浏览器刷新，再点一次“继续自动导演”。代理不自动点击；真实模型接续与连续章节仍等待用户验收。状态同步[CURRENT](../handoffs/CURRENT.md)和[台账](../handoffs/WORK_LEDGER.md)。
