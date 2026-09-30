# 规划技术失败后的恢复入口

## 用户观察

用户新开《外卖箱闯金庸》，自动导演完成前两章后暂停，按提示回到节奏板却没有 AI 修复建议入口。随后用户反馈第一章“又有进步，有一点好看了似乎”。这是用户对实际正文的正向阅读反馈，不等于本轮重新完成全文文学验收；修复不得以恢复流程为由覆盖这些正文。

## 只读现场与根因

- 小说 `cmuocysv9000c4ww0dqghfyhk`，导演 `cmuoc448h00004ww0son4x49c`。
- 第一、二章分别2901、2556字符，均 completed；第三章为空、pending_generation。
- 规划修复 `technical_failed`，已用1/2轮；导演外层为 running + pendingManualRecovery，错误挂在 quality_repair / chapter_batch_ready。
- `pauseIfNeeded` 漏掉 technical_failed，进入普通批次挂起分支。前端和建议/授权接口仅认 waiting_approval / failed，导致正确源页面上没有动作。
- 第三章 job `cmuod7son019i4ww0rw4ah1br` 为 queued + pendingManualRecovery，owner与lease均为空。建议接口又把它当成活跃生成，单补按钮仍会失败。新建的 manual_create 任务不是本次按钮缺失原因。

规划审查停因是真实旧引文：请求53 `stream-1790788487292-53` 使用的旧结算句以“半个时辰倒计时。”结束。修复后的候选已改成“半个时辰倒计时；结算发光与入箱异象被远处令狐冲目击。”，请求55及一次纠错56仍引用旧句号版本。正式匹配器拒绝正确；没有放宽标点匹配、替换引文或自动批准候选。

## 修复与验收范围

技术失败进入原有规划暂停与structured来源路径。前后端共用暂停状态规则，兼容历史running/queued但明确pendingManualRecovery的任务；GET和投影只读，不改库、不追加预算、不恢复生成。建议冲突检查仅放过本导演当前已明确挂起且无执行归属/租约的job，其他生成或命令仍阻止操作。

本轮不生成AI建议、不选择方案、不恢复导演、不修改正文。按钮和真实建议链路由用户刷新页面后验收；入口恢复不表示下一轮规划审查一定通过。

## 工程验证

共享类型及服务端编译、前端类型检查通过。恢复、建议、暂停兼容和工作流写入保护共80项聚焦回归通过，包括只读状态查询、technical_failed暂停保留、历史running/queued挂起、取消拒绝、活跃任务拦截、明确恢复与幂等重放。日志在本机 `.codex-run/recovery-entry-20260930/targeted-tests.txt`。界面交互留给用户验收，没有以类型检查代替真实页面确认。
