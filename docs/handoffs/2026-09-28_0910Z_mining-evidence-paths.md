# 矿区规划修复再次暂停：证据路径与建议阅读范围

先读 `PROJECT_CONTEXT.md`。分支仍为 `codex/fix-task-cleanup-personal-style`，本轮基线 `c0ed9249`；本快照与修复同次本地阶段提交，最终 HEAD 以 Git 为准。未 push 或合并。

## 实际故障

用户点击重新获取建议后仍不能推进。本轮 GET 和 SQLite 只读查到：建议已返回，用户执行过修复 round2，又选择最新 C 的 `review_existing`；并非建议生成仍在运行。导演 `cmukwgxjg000p70w0fn8vrz80` 仍 `waiting_approval`、pendingManualRecovery=true，规划 `waiting_confirmation`、rounds=2/maxRounds=5。

- 最新候选 `cmuky53yc0006bww0wfcj7n91`，第一至第七章已有路线。
- 拒收错误：`issueChecks resume_unresolved_prerequisite contains evidence absent from the current candidate.`
- 引用 `dragged_continue.causality.prerequisites[2].reference` 的原文实际存在；索引只列删掉 causality 的路径，导致有效返回被拒收。两份 round2 复核停在这一技术边界。
- AdviceContext 只给修改窗口与紧邻章节，遗漏第五至第七章，虽补过节奏板仍不足以让建议知道具体承接。A 让用户补来源、B 明说只修措辞留下阻塞、C 以创作取舍请求只复核；后两项以前仍被标为可执行。
- 最新建议 `2ff4f78e-91c4-4924-8222-28ed07a9a3aa` 已 stale，不能继续采用。

## 通用修复

1. 当前输入树逐叶建立场景证据别名：支持扁平路径、保留 causality 的场景 key 路径和 sceneCards 的真实数组路径；错场景、错下标、错原文或歧义仍拒绝。没有近似匹配和故事关键词判断。
2. 建议复用 planningPromises facade 的规划视野，分别提供基线与候选的实际同卷后续路线及节奏板；阅读范围不等于修改范围。无需在第二章重复抄写后续已存承接，仍检查内容和期限是否实际覆盖承诺。
3. 新建议的 blockerResolution 结构化声明覆盖全部阻塞与剩余问题；complete 且无剩余才能采用。review_existing 还须 review_disagreement，不能用创作取舍把未解问题转成待办。旧建议缺声明时只读不可执行。
4. 章节规划复核提示 v8，建议提示 v4；注册表同步。未修改 Coordinator、恢复预算、正文或暂停状态。

## 验证与运行状态

- shared build、server build、client typecheck 全部通过。
- 聚焦测试 179 项：177 通过、2 项原有跳过、0 失败；包括本次完整拒收响应对照原请求与候选离线回放。回放能通过技术校验，但仍 repairable/unsafe，未把残余问题放行。
- 服务 GET catalog 确认复核 v8、建议 v4。最终旧建议 GET 仍 stale。
- 私有证据 `.codex-run/mining-followup-{evidence,candidate,review-request}.json`；检查日志 `mining-followup-{shared-build,server-build,client-typecheck,tests}.log`。不加入 Git。
- 本轮未实际调用模型、未恢复或重试任务、未写数据库、未改正文。UI 及真实生成按项目规则交用户验收，不能将离线通过说成第二章已解锁。

## 用户下一步与保留风险

刷新原节奏/拆章页面并重新获取新版建议，确认采用新方案；旧 C 不再适用。接手不要自动发起付费调用，不要清空暂停状态或加预算。若再次暂停，查具体响应、来源与残余语义问题；不要只建议重复点按钮。

前轮文学评价仍有效，参见 [矿区开篇观察](../evals/framework-quality/observations/2026-09-28-mining-opening.md)。句式扫描误伤有效线索的问题本轮仍未扩展修改。原有无关未跟踪文件全部保留。
