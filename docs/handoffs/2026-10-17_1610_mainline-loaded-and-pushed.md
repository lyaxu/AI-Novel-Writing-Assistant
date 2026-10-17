# 主线已推送、数据库已迁移、旧版已加载

## 接手摘要

2026-10-17 16:10（北京时间，Asia/Shanghai）。用户明确批准推送、备份迁移、旧版加载与记录同步。61个历史未推送提交已上传个人远端，迁移和加载验证通过。下一步是用户在现书源页继续原任务第6—10章；代理没有发恢复命令或模型请求。

## 环境与唯一真源

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor，已跟踪 lyaxu/codex/production-core-refactor。远端 https://github.com/lyaxu/AI-Novel-Writing-Assistant.git，无需新建仓库，不推上游origin，不合并main/beta。加载提交e6c25c73368af830b4dc00081dcb268dff231f15，后续仅文档提交以git log为准，不影响已加载代码。

DB D:/novel/.comparison/2026-10-10/old-test.db。后端3000/PID31072，Node24.19.0，源码模式，启动北京时间2026-10-17 16:06:48；前端5190/PID56660。新版5173/8787未监听。原三个Structured组件、WORK_LEDGER历史964行、未跟踪素材与诊断目录保持。

## 用户目标与不可破坏约束

保持五章正文、原4—10任务、写法、模型配置和质量门禁；不自动生成、不恢复废弃样本、不新建4—10任务。正式连续十章另行冻结版本；当前续写只验证恢复。新人物覆盖/改名使用独立样本验收，不为测试重生成现书阵容。

## 关键进程时间线

只读确认五章/26调用/人工暂停→检查完整61提交及发布说明→推送个人远端并核对SHA→新建一致性备份并验证→单项增量SQL事务迁移→原162表17227行逐列hash一致→预检全局队列及停止样本→隐藏启动旧3000/5190→health及只读接口/模块检查→再次核对保护指纹→同步文档和个人记忆。

## 已完成实现

本轮没有新增产品代码。3A—3D既有实现已推送并加载。原库仅增加20261017010000_character_cast_coverage_identity的7个字段及1个唯一索引；无删除、合并人物、重写正文或全量迁移。

原库没有_prisma_migrations，未运行migrate deploy/db push/reset、未伪造历史应用状态。独立回执记录已应用SQL的SHA256：22909b3687b10df96d1279010b8bcf8716e8fb7b85bdae2e1cbbb65d3f3f8f49。

## 验证与实测结果

- 新备份：D:/novel/AI-Novel-Writing-Assistant/.codex-run/mainline-load-20261017/pre-migration-backup.db，1027043328字节；在线backup创建一致性快照，integrity_check=ok，逐表hash与原库一致。
- 迁移前后162表/17227行所有原有列数据一致，五章/任务保护指纹一致。启动后的比较范围为受保护业务数据与调用记录；后台运行时登记与设置初始化不冒称全库逐字不变。
- health直连及5190代理200，stale=false，2367源码/共享产物hash通过；任务GET、人物候选GET、源页和3个前端模块读取通过。未进行浏览器或视觉验收。
- 书cmv3wyvw40015gow0780pycx9《外卖小哥的茅山账本》，任务cmv8d55el0033z8w0hneoiiru；4—10仍完成2/7、next6、running/pendingManualRecovery=1。五章均approved/completed，字符数3013/3680/3729/3916/5808，hash与开发前一致。
- task调用26，全库151，前后不变；活跃执行0，废弃样本queued人工暂停job无owner/lease且hash未变。
- 复用前轮1352通过/0失败/8既有skip，以及shared/server编译和client typecheck；产品代码未再改变，未重复昂贵构建。代码清单与完整证据见[整合记录](../evals/2026-10-16-mainline-stage3-integration.md)。

## 已知问题与临时绕过

系统Node25与SQLite驱动ABI不兼容，启动使用既有Node24。原快照的dashboard/displayState仍有历史“项目设定/恢复中/3章正文”等不一致字段；真实task.pendingManualRecovery和五章事实未变，源页代码优先该人工暂停标志展示“继续自动导演”。此展示残留记录为UI验收观察项，不能据旧字段发重建或自动恢复命令；本轮不作无关产品修改。

历史246741提示和旧7章profile仍保留在暂停快照。用户显式继续后由新代码重算用量和整书profile，不手工修改旧错误或seed假装已恢复。

## 未执行与待执行任务

1. 用户打开[原书源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv8d55el0033z8w0hneoiiru)并刷新，核对五章及原4—10范围，点击一次“继续自动导演”，从第6章推进至10。运行记录只查看/导航，不在其中恢复。
2. 观察是否保留前五章、不重建任务、不因历史高用量重复暂停；检查正文连续性、人物/资源事实、费用和真正安全暂停。失败先保存现场，不反复点击。
3. 独立样本验收按篇幅人物覆盖、候选命名、分批补档与资源问题展示；模型调用由用户发起。
4. 固定版本新书十章未开始；不得把多个版本的本书五章加后五章认定为正式十章通过。断线/睡眠/重启完整续作和书内agent仍是待设计事项。

## 关键文件与产物索引

.codex-run/mainline-load-20261017/：verified-backup.json、migration-receipt.json、protected-before.json、latest-state.json、source-manifest.json、processes.json、health.json、loaded-verification.json及日志。完整五章hash保留在latest-state/loaded-verification，原始快照仅本地保存，不上传数据库或日志。

[主线计划](../plans/2026-10-11-production-core-refactor.md)、[开发快照](2026-10-17_0353Z_mainline-development.md)、[人物身份规则](../wiki/workflows/book-cast-identity.md)。个人记忆只在用户授权的extensions/ad_hoc/notes下追加本次记录，不直接改MEMORY.md。

## 下一窗口启动顺序

完整AGENTS→PROJECT_CONTEXT→CURRENT→本快照。核验branch/HEAD/dirty、端口PID/health加载身份和只读DB停点，不能把此处的16:07状态当后续实时事实。若用户已继续，先读真实新进度和调用，再决定检查范围；不照旧26调用断言恢复历史状态。

## 待确认事项与风险

后续UI/模型/文学验收由用户完成。若按钮或阶段显示与上述入口不符，先核对当前快照及人工暂停投影；不能凭旧dashboard文字重建任务。备份和两轮副本均保留，无自动清理。仅文档及稳定维护规则更新，无新增用户功能发布说明。

## 可直接发送给新窗口的开场提示

接手旧版主线，按AGENTS读取CURRENT及2026-10-17_1610_mainline-loaded-and-pushed.md。主线已推送到个人远端，原库人物字段迁移和旧3000/5190加载已完成，加载e6c25c73368a。请只读核验最新任务/五章/调用/服务身份，保留预存dirty和停止样本。用户下一步在原源页继续6—10；不要自动调用模型、重建任务或将本轮恢复验收当固定版本十章通过。
