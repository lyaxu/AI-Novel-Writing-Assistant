# 固定旧版测试启动器与服务重载完成

## 接手摘要
2026-10-17 16:46（北京时间）。用户明确要求完成重载并将start-local.bat固定到当前测试书环境。已完成；双击启动同一旧版数据源，原任务仍人工暂停，由用户下一次点击继续。前轮自动审批阻塞已在本轮新授权后解除。

## 环境与唯一真源
D:/novel/AI-Novel-Writing-Assistant，codex/production-core-refactor，个人远端lyaxu。启动器提交a42fb99d8962916bb8d006543c2218311efb548d已推送；收尾包含Windows命令行尾空格复用修正与文档，以最终git HEAD为准。加载服务提交a42fb99d8962，后续未改应用源码无需重启。后端3000/PID39704，16:43:15启动，Node24.19.0/source/stale=false；前端5190/PID43320。数据库D:/novel/.comparison/2026-10-10/old-test.db。

## 用户目标与不可破坏约束
以后双击根start-local.bat直接打开当前测试书旧版工作区，不能误开server/dev.db。保留五章、原4—10范围、暂停、模型和质量设置；代理不自动继续、不发模型请求。未合并main/beta。

## 关键进程时间线
核对旧31072/56660及五章/26调用→备份原bat→固定数据源及端口启动器→占用端口拒绝验证→核验无执行后停止两个旧服务→首次冷启动发现app.ts require.main门禁并显式调用startServer修复→补齐failed副作用及creation_studio可执行队列检查→7项内存SQLite测试→最终经bat冷启动→发现Windows进程命令尾空格导致复用拒绝，TrimEnd修复→bat重复运行exit0，PID不变→GET和保护状态再次校验。没有通过生成验证启动器。

## 已完成实现
start-local.bat转到scripts/local-test/start.ps1，Node24固定来源；entry.cjs固定相邻old-test.db、5190/3000、原书原任务URL、web模式，不运行pnpm dev/迁移/种子。数据库缺失、书任务身份不符、ABI不符即停止。冷启动拒绝未暂停任务和后台可重试队列；重复双击互斥及身份核对，健康且相同配置直接复用。冲突/旧源码不杀进程、不另选端口、不回退数据库。浏览器仅在就绪后打开；-NoBrowser用于同链路维护验证。

## 验证与实测结果
- Node24只读真实库预检、PowerShell解析、占用端口拒绝通过。
- scripts/local-test/startup.test.cjs 7/7通过，内存数据库验证暂停保留与六种自动任务拒绝。
- 经cmd执行start-local.bat -NoBrowser冷启动成功；重复启动exit0，仍39704/43320。未做浏览器视觉验收，自动打开URL分支由脚本直接调用系统默认浏览器。
- 3000及5190代理health均200、相同PID39704、stale=false、source、加载a42fb99d8962；原导演任务GET保持pendingManualRecovery=true。
- 原导演完整记录与备份一致，除手动工作区导航之外的保护摘要与16:27:50基线一致；五章approved/completed，字符3013/3680/3729/3916/5808、完整SHA256不变。任务26调用/全库151，原4—10完成2/7、next6。旧停止样本仍保留。代理0次模型请求。
- 复用前轮server编译、126相关恢复测试及4项新整链离线通过；本轮未变server/src/shared/client，无需重复应用构建。

16:44:36手动工作区manual_create记录的导航/seed/时间变化，使按整书所有任务做hash的旧脚本断言失败；已逐行核对原导演完整记录与备份一致，其余保护表hash和26/151调用一致。此项单独记录，不冒称整库或全部任务逐字未变，详见final-protection.json。

## 已知问题与临时绕过
当前重载阻塞已解除。启动器是此checkout指定环境，不是跨机器通用默认；缺Node24或目标库需明确配置，不能自动创建空库。后续应用源码变动时要求受控重载；双击不会中断正在运行的生成。原stop-local.bat仍为用户原广泛匹配脚本，未修改、未使用；不推荐拿它作为精确维护动作。旧dashboard阶段/实时状态残留仍待UI反馈。

## 未执行与待执行任务
用户从原书源页继续第6—10章；结束后核对正文连续性、人物身份、资源归属、暂停恢复和累计用量。正式固定版本十章另行冻结版本；人物规划/候选改名使用独立样本，不重生成现书人物。启动器及恢复代码已完成/推送/加载，真实续写和文学验收未通过。

## 关键文件与产物索引
启动入口start-local.bat；实现及稳定说明scripts/local-test/。运行日志和PID回执.logs/local-test/；证据.codex-run/launcher-20261017/（原bat备份、占用测试、冷启动日志、重复启动日志、7项测试、health.json、final-task.json）。五章SHA与保护比较沿用.codex-run/completed-boundary-20261017/before.json和verify-state.cjs。原一致性备份.codex-run/mainline-load-20261017/pre-migration-backup.db仍保留（1027043328字节）；本轮无迁移。

## 下一窗口启动顺序
1. AGENTS→PROJECT_CONTEXT→CURRENT→本页，核验git及dirty。
2. 先只读检查实际进程、数据源、任务、章节和调用；不能把PID和26调用视作永久值。
3. 用户未生成则保持等待；收到真实运行反馈再定位，不重复调用。
4. 续写完成后先评估恢复验收，再安排固定版本十章。

## 待确认事项与风险
用户尚未验收页面和真实续写；启动器验证不能替代文学判断。三个Structured组件和WORK_LEDGER历史964行未提交，素材/DB未混入。当前适合交接，下一步明确属于用户操作。

## 可直接发送给新窗口的开场提示
读取AGENTS和CURRENT.md。固定旧版启动器已完成，3000/5190已加载章间恢复修复，五章/26调用/人工暂停保留。先只读核对现状，等待用户继续第6—10章，不自动生成。
