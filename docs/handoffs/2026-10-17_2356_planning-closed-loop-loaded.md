# 规划状态闭环完成与新书验收交接

## 接手摘要

2026-10-17 23:56，北京时间。通用闭环已实现、测试、推送并加载；旧书按用户明确要求保持暂停，作为回归样本。下一步可开始独立新书验收准备：用户拟重写已签约、原有7—8章的末世极寒文，先读取原稿并评估开篇节奏，尚未创建新书或生成正文。

## 环境与唯一真源

工作区 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`，个人远端 `lyaxu`（GitHub lyaxu/AI-Novel-Writing-Assistant）。代码HEAD `b3705bd4ff3aff79cd0bfc8a9270302bd279e277` 已推送且ls-remote一致；本快照另作纯文档提交并推送，最终文档HEAD以Git为准。不合并main/beta。

运行Node v24.19.0；后端3000/PID56952，前端5190/PID55684；固定数据库 `D:/novel/.comparison/2026-10-10/old-test.db`。23:55双端health核验加载 `b3705bd4ff3a`，stale=false。入口仍是 `start-local.bat`；它固定打开旧样本工作区，不会自动恢复导演。新书应从同一应用的小说列表新建独立样本，不要点击旧书继续。

无关dirty：三个Structured组件的22/8、6/3、2/0行改动，以及台账历史964行均原样保留。数据库、临时资料及未跟踪草稿不入提交。不要使用pnpm dev、旧stop-local.bat或默认dev.db替代固定启动环境。

## 用户目标与不可破坏约束

用户要求通过多部书把通用工具跑通，不为某一本测试书逐项打补丁；明确旧书保留暂停。保留前五章、原候选、原任务和调用记录，不自动恢复或删除。允许必要独立模型测试，费用必须记账。新书准备与原平台已签约稿件的发布/替换是不同操作，本次未触碰平台。

## 关键进程时间线

- 20:15完成只读诊断，定位事实输入、命题绑定、审查自相矛盾与原策略恢复缺口；当时未实现。
- 用户确认完整闭环及旧书停用后，实施通用声明表、可信审查、写后覆盖和原策略恢复。
- 23:29客户端类型检查通过；后续客户端未改动。23:52最终server编译及30文件联合回归520/520通过。
- 独立模型开发三轮共12次，保留失败；最终4组首答3组通过，第4组按现有一次完整上下文纠正通过，合计13次。
- 23:53代码b3705bd4已推送。重载前旧进程已退出，原因未核查；未执行进程终止。数据库身份/空闲/保护检查通过后用固定启动器启动。首次前端代理验证超时，后续同一实例200正常。
- 23:55服务加载与旧书保护复验通过；本记录单独提交推送。

## 已完成实现

1. 章节列表获得真实已写正文；新任务单/合同/规划修复携带主体、命题、时态、模态、来源的统一状态声明。正文目录ID恢复确切原文；场景引用前状态、动作和后状态，前提文本从声明投影。
2. 逐声明语义复核，单个问题决定同时拥有比较关系、过渡和修复前提。修复建议与反向关联均从唯一来源生成；未知和未来计划不能冒充既成事实，旧问题可据新证据重判。规划未批准时所有模式均不可进入正文。
3. 写作/验收/修复传递完整状态表；写后漏检保留审查质量债，不伪造正文问题或全局阻塞。事实同步只消费最终选稿。
4. 源工作区“按原策略继续”显式恢复原自动权限与剩余轮次，冻结稳定授权字段，避免进度状态变化自我作废；“只复核”权限不扩大。不新增数据库字段或迁移。

## 验证与实测结果

- Node24运行 `node_modules/typescript/bin/tsc -p shared/tsconfig.json`、server编译及client类型检查通过。client日志23:29；后续共享描述/反向投影不改变前端消费类型，故不重复。
- Node24+`server/tests/novelProduction/offlineBootstrap.cjs` 联合30文件：520 tests，520 pass，0 fail/skip，约26秒；测试文件清单和最终日志见本地证据目录。覆盖恢复预算/幂等/保护、旧结构兼容、新状态来源、统一修复、跨卷正文、最终选稿和启动保护。
- 注册quality v19真实render/schema/postValidate，deepseek-v4-flash、temperature0.1，4独立合成案例最终符合人工预期，其中1例需要一次纠正。开发累计13次，输入157473、输出25674、总183147 tokens；无旧书调用与业务表写入。不是盲测，不是完整开书/写作链。
- 23:55只读GET health（3000及5190）、planning-repair、resume-policy成功；原策略入口available=true、剩余2轮、候选与第6章一致。仅检查接口，未POST恢复。
- UI操作/浏览器验收留给用户；全文文学与十章固定版本验收尚未进行。

## 已知问题与临时绕过

模型首答仍可能混合事实与动作、漏覆盖或误解语义。严格拒收+一次带完整上下文纠正，不用降低门槛或题材特例放行；两次仍失败会安全暂停。此实现不承诺所有书自动写完，也不证明情节已经够快。26条多题材人工答案矩阵仅为后续测试素材，不能冒充26次真实模型通过。

## 未执行与待执行任务

- P0 新书验收准备（待原稿）：读取用户极寒文7—8章全文，整理保留卖点、拖慢情节的重复和可压缩铺垫；形成前三章行动/后果/阶段回报方案。用户未提供文件路径，尚未阅读、创建或生成。
- P0 固定版本新书：先前三章全文人工审读，核对因果、人物动机、资源归属、净推进和读者回报；通过后推进十章并记录暂停/恢复/用量，失败须做机制分类。不能拿开发样例通过代替该验收。
- P1 其他题材留出样本、人物阵容/候选改名独立样本、dashboard反馈等既有待办保留，未在本轮新增执行。
- 旧书第6—10章续写不再是待执行目标，除用户重新授权外保持冻结。

## 关键文件与产物索引

- [独立模型与工程观察](../evals/framework-quality/observations/2026-10-17-planning-closed-loop-verification.md)、[历史根因](../evals/framework-quality/observations/2026-10-17-planning-state-review-root-cause.md)。
- 稳定规则：[因果与证据](../wiki/workflows/scene-causality-and-quality-evidence.md)、[规划修复](../wiki/workflows/planning-repair-loop.md)。
- 本地证据 `D:/novel/AI-Novel-Writing-Assistant/.codex-run/planning-closed-loop-20261017/`：regression-final.log、model-accounting.json、model-round1/2、最终四份输出和一次retry、loaded-api.json、pre/post-reload-protection.txt。原始本地证据不公开提交。
- 旧书 `cmv3wyvw40015gow0780pycx9`，任务 `cmv8d55el0033z8w0hneoiiru`，候选 `cmvc62qaf0007mww08k8tpvlv`；waiting_approval/pendingManualRecovery1，planning waiting_confirmation/rounds0/max2。原任务调用32、累计1396340 tokens。第6章空稿；原任务、候选、调用和正文保护摘要前后完全一致。
- 前5章SHA256：1 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`；2 `4704d2b0170166b28e798971db8c2b6aa295a04db03c9141bf16686330da309a`；3 `2260cac78879bfbd562ae19fd1363e0fd816a9b971c70236200a7981e66d172b`；4 `e0b6d1a575df3ff1c668a6d7c92eb5be1fd991dffef387e4339846ba0464377b`；5 `f1ab36068aa3c61026e0cc3ebd5850306e2569d9cb122270ad2ec9477f391fdc`。
- 原备份 `.codex-run/mainline-load-20261017/pre-migration-backup.db`（1027043328字节）仍保留，它早于本次32调用现场，不能冒充本次快照；本轮无数据库迁移或破坏性操作，未新建全库备份。
- 个人记忆新增 `C:/Users/lyaxu/.codex/memories/extensions/ad_hoc/notes/20261017-2356-novel-planning-closed-loop.md`，未改记忆主文件。

## 下一窗口启动顺序

1. 读AGENTS全文→PROJECT_CONTEXT→CURRENT→本页，核实同一仓库分支和实际服务。
2. 只读刷新保护状态，不因为resume-policy可用就恢复旧书。
3. 获取极寒文原稿路径，先做全文节奏诊断和新样本方案；不要凭书名或旧印象虚构剧情。
4. 新书验收过程中区分代码通过、已推送、已加载、用户UI通过和全文通过，记录失败与成本；无需重复已覆盖同代码的工程检查。

## 待确认事项与风险

可以开始新书验收准备，尚未宣称用户验收通过。原稿尚未获取，具体保留剧情与重写范围待全文分析。服务加载代码b3705bd4，之后纯文档提交不需重载；health的gitHead与currentGitHead可能因此不同，但stale应保持false。严禁把这种差异误判为应用未加载。

## 可直接发送给新窗口的开场提示

读取CURRENT及本快照。通用规划状态闭环已测试/推送/加载，旧五章书保持暂停作回归样本。先核实保护与版本，再读取我提供的末世极寒文原稿，诊断开篇为何拖慢并准备前三章新书验收；不要自动恢复旧任务或直接替换平台已签约稿。
