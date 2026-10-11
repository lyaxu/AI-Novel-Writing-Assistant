# 阶段 2：单章可靠保存与恢复离线验证

核验日期：2026-10-11（UTC-5）。分支 `codex/production-core-refactor`；接手 HEAD `d90fb0b984a425f33bcc61533cfaa5e9b50534f4`。这是后端故障恢复验证，不是模型、UI 或连续十章验收。

## 基线及范围

完整读取 AGENTS、PROJECT_CONTEXT、CURRENT、0840Z 快照、已批准方案和两轮最终对照报告。原有三个 Structured 客户端文件及 WORK_LEDGER 的补丁仍为 `cff9f07557cf83e8d5389afe87f8ab0fc0d06d87a4bcbe6e580cab9aa82e5a07`，与接手证据逐字节相同。未改新版、创作提示词、写法和质量策略；没有启动模型、旧导演、后续章节、服务重启或数据库迁移。

源码审计确认旧版已有审查前保存、精确请求审查缓存、GenerationJob 租约和修订额度。缺口是章节统一所有权、步骤结果与流式部分稿持久化、正文/合同并发校验，而不是重新建立这些既有能力。

## 故障先行与最终结果

- 新步骤/流测试先出现预期红灯；外层执行器的 8 个安全错误场景在修改前全部错误进入治理与重试，修改后停止在人工恢复边界。
- 新 journal 测试包含真实 `node:sqlite :memory:` 事务：双领取、旧 token、正文/合同冲突、正文写后检查点失败回滚。其余外部能力为明确替身。
- 实际 pipeline 的恢复测试验证：审查失败不重写；同步失败不重审、不重修；候选复核失败保留原稿和候选；剩余额度变 0 后不再次领额度；重复成功请求不把终态改回 generating。
- 实际流编排验证：每片段先保存，断流/提前结束/额度耗尽不标完整；normalize 已存后退出可恢复；保存失败只补保存；无人消费释放会话。
- 只读恢复接口测试证明 GET 不触发工作流步骤；journal inspection 前后存储记录完全不变。
- 最终指定 14 个文件合计 **148/148 通过**。服务端 `tsc -p server/tsconfig.json` 编译通过；未跑全库构建、桌面打包或浏览器。

最终测试使用以下前缀：

```powershell
& 'C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --require ./server/tests/novelProduction/offlineBootstrap.cjs --test <指定测试文件>
```

指定文件：`chapterProductionJournal`、`chapterProductionContext`、`chapterProductionRecovery`、`chapterProductionStream`、`chapterProductionRecoveryRoute`、`pipelineExecutorRecovery`、`reliabilityBaseline`、`artifactRecovery`（均在 `server/tests/novelProduction/`）；以及 `server/tests/` 中 `chapterRuntimePipeline`、`chapterRuntimeCoordinator`、`chapterRuntimeBoundary`、`chapterPatchRepair`、`chapterLifecycleState`、`promptOutputLimit`，扩展名均为 `.test.js`。

私有本地证据：`D:/novel/AI-Novel-Writing-Assistant/.codex-run/production-core-stage2-20261011/`：`offline-tests-final.log`、`source-fingerprint.json`、`preserved-dirty.patch`。初次旧测试集曾直接导入默认 Prisma 初始化模块，不能把该轮称作完全隔离的数据库验证；最终回归已在导入前阻断默认数据库及网络。没有执行生产生成、恢复或迁移；不能由单元测试推断运行服务已加载本次代码。

## 剩余验收边界

1. 运行旧后端仍是原启动进程，本轮未重启；用户网页尚未验证新代码。
2. 只读恢复投影和显式新操作标识已提供后端接口；源页面的新操作/未知输出核对交互未新增，需后续接线及用户验收。不得用后台随机换标识绕过暂停。
3. 正文与生命周期写入受同事务 CAS 保护；所有事实表、审查报告与执行 token 的统一原子提交尚未完成，属阶段 3。既有降级同步策略未被这次改造悄悄替换。
4. 准备阶段保留原规划门禁。准备内部模型结果或合同变更不确定时停止，未证明规划的所有内部步骤均可自动恢复。
5. 没有真实模型调用、十章连写或文学评审。UI 防丢稿代码原样保留的哈希证据，不等于已重新做 UI 防丢稿验收。
