# 阶段2源页收尾与阶段3离线验证报告

本报告对应旧仓库 `D:/novel/AI-Novel-Writing-Assistant`、`codex/production-core-refactor`。阶段2源页收尾提交 `17b2cab6`；阶段3固定源代码提交以包含本报告的提交及 [CURRENT](../handoffs/CURRENT.md) 为准。未推送、未合并 main/beta。

## 交付范围与保留项

| 批准要求 | 实现与离线证据位置 |
|---|---|
| 不重复重写阶段2 | 保留 journal/正文保存/流稿/版本保护机制，扩展本地资产事务端口及源页恢复；历史148项仅作为基线，本轮另作回归 |
| 旧版源工作区恢复 | productionRecovery 模块、章节工作区及批量源页；恢复读取只读，显式核对未知结果与显式恢复分开；范围、预算及原参数保留 |
| 一份有效合同 | preparation + planner/contracts；无正文入口沿用原语义/窗口门禁，有正文不重新规划；合同指纹与事务写前核验；过期细化视图不覆盖合同 |
| 审查有效性分流 | reviewCompletion + QualityGate + PipelineExecutor；调用失败与证据/覆盖不完整不伪造通过，不进入自动改稿；有效局部问题沿原质量策略 |
| 最终保留稿实际状态 | actualState + 时间线 + 资产适配器；外部抽取缓存、本地事务提交、完成边界；质量债也提交真实事件；无效提案在原工作区核对 |
| 不把旧事实传给下一章 | 前章 hash/operationId guard；旧自动事实保留为 superseded；数据库读取、导出、检索候选排除失效源；旧后台与手动旁路拒绝双写受管章 |
| 固定版本验收准备 | [十章操作单](2026-10-11-ten-chapter-acceptance.md)，未创建样本或启动生成 |

没有更换创作提示词、写法或模型配置，没有修改字数规则、数据库 schema、新版和历史样本。原三份 Structured 客户端文件与 WORK_LEDGER 未进入本轮提交；二进制补丁 SHA256 仍为 `cff9f07557cf83e8d5389afe87f8ab0fc0d06d87a4bcbe6e580cab9aa82e5a07`。

## 验证方法

服务端使用现有 Prisma 客户端执行 TypeScript 编译，不执行 prisma generate/迁移。客户端执行 TypeScript noEmit。服务端故障回归统一预加载 `server/tests/novelProduction/offlineBootstrap.cjs`，在导入前禁用默认 Prisma 与网络；真实 SQLite 测试只用内存库。使用模型替身注入超时、额度耗尽、无效格式与无效引文，不发送真实模型请求。

```powershell
node node_modules/typescript/bin/tsc -p server/tsconfig.json
node node_modules/typescript/bin/tsc -p client/tsconfig.json --noEmit
node --require ./server/tests/novelProduction/offlineBootstrap.cjs --test <记录在 test-files.txt 的文件>
```

实际执行使用本机 bundled Node 绝对路径；具体命令、文件集合及结果在 `.codex-run/production-core-stage3-20261011/`。这里只把最终覆盖已改文件的检查作为结论，不把重叠测试次数相加。

最终服务端编译 exit 0；46个测试文件 **417/417通过，0失败、0跳过**。本次最终编译与回归已覆盖独立批量恢复的预检/CAS及旧时间线旁路保护。客户端最终类型检查与27项离线策略回归使用本轮子代理在客户端代码冻结后的成功证据，未重复运行同一检查；最终源码指纹另行保存。

首轮扩大回归 350通过/7失败：缺少新依赖替身、旧审查测试未提供全部必查项。修正测试依赖并补完整输入后，相关43项通过；保留最初失败日志，不把它算作生产故障或抹去。此前跨模块审计还修复了检索索引延迟读旧事实、旧时间线旁路写入、状态提案失败后源页缓存不刷新，以及独立批量原任务恢复入口缺失。

## 证据文件

- `server-build.log`：主代理最终服务端编译原始输出（成功时为空）；`client-typecheck.log`：复用子代理检查的记录，session69313 / output a3f532 / exit0，不是重新执行的原始日志。
- `offline-tests-final.log`、`test-files.txt`：最终服务端定向回归及完整文件集合。
- `client-tests-final.log`：子代理客户端27/27证据摘要（output23006a），含确切四文件命令；无独立原始日志落盘，未冒充主代理重跑。
- `offline-tests-first-failure.log`、`updated-fixtures.log`：扩大回归最初失败及修正验证。
- `source-fingerprint.json`、`preserved-dirty.patch`：最终源文件指纹及原 dirty 保护证据。

以上为本地私有运行产物，不提交数据库、密钥、历史正文或日志。仓库保留测试源码与本报告即可复验。

## 边界与待验收

1. 没有浏览器交互、真实模型调用、十章连写或文学质量验收；客户端类型与策略测试不能替代点击、刷新、断流和编辑器防丢稿实测。
2. 旧后端仍为原非 watch 进程，未加载本轮后端改动，需要按操作单受控重启。新版与服务数据源未切换。
3. 事务是按阶段持久化，不是一笔涵盖外部模型与所有资产的长事务。不确定外部调用不能保证计费恰好一次，须用户核对后再恢复。
4. 历史随机操作标识的暂停记录没有可靠原job归属，不自动迁移或伪装本次恢复成功。历史清理/迁移单列待办，新验收使用新书。
5. 无效资源提案允许明确忽略以继续，但该忽略是用户决定，必须记入真实验收人工干预，不能称为全自动通过。
6. 未进行桌面打包、beta集成、发布或全项目测试；本阶段使用与核心生产链修改相符的定向检查。

稳定设计记录于 [生产链架构边界](../wiki/architecture/production-core-boundary.md) 和各 owned 模块 README；用户可见变化已合并进 2026-10-11 发布记录和 README 最新更新。
