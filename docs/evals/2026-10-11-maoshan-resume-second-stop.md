# 原任务恢复第二次停顿：真实入口漏传任务身份

2026-10-11 17:15 UTC只读调查。用户成功管理员重启后点击继续自动导演，数秒再停。本轮只读数据库、health、日志及代码，纯函数离线回放；没有改产品源码、业务数据、重启服务或调用模型。

## 已确认现场

- 重启已成功：后端34144、前端45328，17:01:34启动，运行HEAD b81e279d，health stale=false。包含d2cc20e5修复，新版5173/8787仍3960/21116。不是没加载代码。
- 用户17:07:16.514提交approve_gate命令cmv42sxpe0000cgw03z6l7565，payload为resume/forceResume=true。命令succeeded仅表示受理与调度，不代表审查成功。
- 原job cmv3x3pr500r7gow0pt92xbmt仍failed/manual1/reviewing，updatedAt停在14:30:26.998，完全未恢复。
- 新job cmv42syf1002gcgw06h79ovnu于17:07:17.437创建，17.532即因正文/合同/所有权冲突失败，manual1。导演seed的pipelineJobId指向它，不能再照旧建议直接点继续。
- journal仍归属原operationId pipeline:cmv3x3pr500r7gow0pt92xbmt:cmv3x2mt600jsgow0e6kb0852，prepare/draft/save均done，review/evaluation仍原failed。首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6未变，第二章为空。
- 17点后该导演模型用量记录0，新启动LLM日志未产生；失败路径在journal归属核验处、模型调用前。不能将空stdout视为没发生错误，持久任务/命令/事件是本次主要证据。

## 根因及上轮验证缺口

主因：功能闭环未完成（恢复路由与执行适配丢失原身份），正常源页操作可触发。不是用户操作、模型质量或网络错误。

实际active VolumePlanVersion（cmv3x464y00rbgow010u86vjh，14:28:20.988）离线调用真实dist纯函数：默认规划游标step=chapter_list、volumeChapterListComplete=false；允许partial时为chapter_detail_bundle/第2章。即使hasExecutableRange=true、missingContracts=false，resolveAssetFirstRecoveryFromSnapshot在novelDirectorRecovery.ts:153—169仍优先选phase/structured_outline。

ContinueRuntime调用assetFirstRecovery后绕过携existingPipelineJobId和resumePendingManualRecovery的auto_execution分支，转runDirectorPipeline。novelDirectorPipelineRuntime.ts:395的maybeRunAutoApprovedChapters再次进入runChapterExecutionNode时未传existingPipelineJobId、existingState、resumePendingManualRecovery。RuntimePreparation据缺参将pipelineJobId置空，随后创建新job，撞上仍属于原job的journal。即使bootstrap合并保留seed，缺参路径仍会丢绑定。planningRepair.phase=committed，不是活动规划修复导致。

上轮307项验证覆盖了命令预检、原job恢复函数和直接runFromReady，但没有覆盖“真实规划游标→assetFirstRecovery→规划流程自动进入章节节点”的跨模块路径。不能将此前绿灯宣称为原任务真实恢复已验收；本次明确记录验收失败。事件中node_completed也不能当作章节已完成。

## 下一修复范围与操作边界

1. 明确待恢复已保存章节/journal优先，不能由后续规划未齐重定向到新生产。
2. 各入口保持原任务身份、原请求、原预算及显式恢复授权；缺身份时拒绝新建替代job，而非猜测或重写。
3. 增加跨完整入口的离线场景，含真实规划版本、原暂停journal、未来未细化章和误建job；不能只给runFromReady喂已正确的任务号。
4. 本次导演已经指向误建新job，后续须设计并验证可核对的原任务重关联；本轮未回写、未删除新旧任务。业务数据修复须保留证据，涉及破坏性操作时遵循备份与授权规则。

用户暂不继续点击、不单独生成第二章、不重写第一章。此次定位未实施上述修复，不再宣称当前版本可以安全完成原任务恢复。总体目标仍旧版核心稳定与十章验收，不改新版或恢复历史书。

证据目录 `.codex-run/maoshan-resume-second-stop-20261011/`；前序[两处修复](2026-10-11-maoshan-review-recovery-fix.md)，当前入口[CURRENT](../handoffs/CURRENT.md)，统一[台账](../handoffs/WORK_LEDGER.md)。
