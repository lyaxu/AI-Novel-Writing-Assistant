# 第二章审查时序契约闭环

时间：2026-10-13 08:22 UTC。分支codex/production-core-refactor，接续43e42117，旧服务生产代码f2772d5f9c35。

## 现场与主因

08:03用户继续v13后，证据编号均可定位；首答把场景说明写成编号对象，格式修复后漏行动状态证据，语义纠正补了证据却仍漏拳术的回叙时序声明，原review再次暂停。v14显式列明编号/说明字段边界，每个状态强制故事时间判断及完整示例；缺字段与其他证据错误一次性汇总，沿用一次完整上下文纠正，缺失时序不交给无正文的JSON修复猜测。115项封网及shared/server编译通过，正确时序是人工模拟，真实模型仍待验。两章hash、原任务/预算/范围保留，模型记录27均用户触发、代理0。旧50604仍v13，待本轮管理员加载。

三份回答均来自20261013-021328-old-server.llm.jsonl，耗时18.372s、12.334s、11.746s，均正常stop。原任务只恢复review。第一答sceneCausalityVerdicts的prerequisiteEvidence/constraintEvidence应为字符串，却返回编号对象；修复格式后arrive_and_meet为earned但状态证据缺失，suppress_with_fist引用“练了十几年”的后叙段落却漏beforeEvidenceTiming。最终回答补了前者，后者仍漏字段，造成CHAPTER_REVIEW_INCOMPLETE。主因是契约/提示实现缺陷，正常产品路径可复现，并非断网或用户操作错误。

v13把完整时序纠正反馈压缩成字段名，且示例未展示该字段，必须对此缺口负责。新增before_or_at_action后四种关系能覆盖普通顺叙、回叙、实际事后及未知；不靠程序关键词推断。解析保留兼容，业务后校验强制，遗漏进入既有一次带完整正文语义纠正；不新增模型、不自动放行。其他格式损坏仍属于已有格式修复边界，不宣称所有模型失误已消除。

## 离线验证

shared/server编译通过；9文件115/115封网通过。新reviewTimingContract测试10项含三真实回答完整对象摘要核对、目录hash65723ef4510a5104a65518d6c008644f861f0b968b4f98410052ded036f911e3、旧报告兼容、缺时序不进入JSON修复、缺项与其他错误同时反馈、一次纠正耗尽留稿、真实事后不能before_or绕过、unknown不能earned、完整字段示例。

人工给最后一答逐状态填时序，其中拳术为retrospective_prior_state，其余顺叙为before_or_at_action，即通过现有门禁。没有改原回答的证据编号、行动、结论或正文。这是人工reviewer simulation，不是实际模型或文学验收。既有引文定位、重复句位置、候选复审、缓存隔离、失败恢复回归继续覆盖。

## 数据与加载

08:22真实DB仅只读：原job cmv5h9a64000j20w0uw4cxeo0 failed/manual1，导演cmv3wvaqm000sgow0l5or2pke pendingManualRecovery1；job范围2—2，导演原范围1—3。首章3013字hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6；第二章3652字hash 461051846359919e84f43627c317c07ed07eff7da652caa434303bcc37489b91。准备/规划/draft/save_draft保持完成，原review失败可恢复，账本committed。模型记录27，活跃任务/命令/副作用0，代理模型0。

旧后端50604 OS启动2026-10-13T07:13:29.0219163Z，仍加载v13；新加载脚本 .codex-run/review-timing-contract-20261013/restart-old-review.cmd 绑定该身份与27条调用，并保护旧前端及新版服务。旧脚本仅保留历史。用户管理员加载后核验日志，再从第二章源工作区F5、继续原审查；不自动恢复、不改DB、不另建GUI。

## 主线与证据边界

此次仍属可靠生产链的审查/恢复闭环，保留创作能力、认可写法、质量检查、防丢稿。后续章纲、资源面板理解成本、自由场景说明语义可靠性、任意倒叙after/transition及固定版本十章仍待验；当前连续验收未通过。同步CURRENT、台账、批准方案、wiki与发布说明。预存三处客户端改动、台账历史964行及未跟踪资产保留，不push/合并。

加载预检：33项源码manifest、旧50604进程身份、原任务/正文/27条调用和保护服务状态均通过CheckOnly，未停止或启动进程。最终manifest在阶段提交后绑定提交ID。

## 08:37 UTC电脑重启后加载核验完成

08:27:50 UTC电脑重启，3000/5190/5173/8787均关闭；用户08:34运行旧维护脚本因5190历史PID不再存在，在停止/启动任何进程前退出。08:36代理按原隔离配置冷启动旧后端18844与旧前端8500，未启动新版；08:37实时health c660f2e15a42/v14/stale=false，33项源码hash及原job只读预检通过。两章3013/3652字hash、原review暂停/范围/预算/账本committed不变，模型记录27、活跃工作0。无需再运行脚本；用户第二章源页F5后一次继续自动导演，真实v14审查与十章仍待验。

旧版冷启动环境保持DATABASE_URL=file:D:/novel/.comparison/2026-10-10/old-test.db、HOST=127.0.0.1、PORT=3000、CORS_ORIGIN=http://127.0.0.1:5190、RAG_ENABLED=false、AI_NOVEL_LOG_CLEANUP_ENABLED=false；前端Vite严格端口5190，代理3000。两个进程均隐藏启动，无进程终止、无数据库修复。

复用c660f2e1的115项封网及shared/server编译，因为生产源码33项hash未变。本轮仅维护操作及运行记录，不重复产品测试或发布说明。启动后只读prepareDirector通过，恢复阶段review；服务启动不等于任务自动续作，人工暂停保持。稳定冷启动边界同步wiki；新文档提交不会改变已加载生产源码。
