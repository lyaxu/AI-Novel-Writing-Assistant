# 原稿保留后停在资源状态提交

## 主线和当前结论

目标始终是旧版可靠保存、失败恢复及连续生产，保留认可写法、创作能力和质量检查，最终由用户固定版本验收十章。当前阶段4真实验收仍卡第一章状态提交，第二章为空；不是十章或阶段3真实验收完成。阶段2/3已有工程实现继续通过真实故障补闭环，不扩新版、第三版GUI或书内agent。

2026-10-12 13:56—13:58 UTC用户点击继续。运行HEAD1c0cb9a3b31c，旧后端55320。原稿审查复用；候选复审经一次格式修复及一次语义纠正仍无效，pipeline.review:1保存candidate_review_incomplete，保留已审查原稿及质量债。随后完成时间线和资产抽取/提交，停在assets boundary：旧账本资源提案pending_review。

主因分类5（Prompt契约缺陷），次因4（操作指引及可核对信息不完整），模型6按含混风险含义回答。正常产品路径可再次触发。实际抽取旧账本confidence=.95、riskLevel=high，理由“账本可能带来未知债务转移风险。”这是剧情危险，不能直接证明记录持有事实有冲突。validator保守暂停符合既有规则，不能删除安全门。本次narrativeFunction=key，并非hidden_card函数保护触发。

## 数据与真实证据

- 小说cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke，原job cmv3x3pr500r7gow0pt92xbmt，第一章cmv3x2mt600jsgow0e6kb0852。
- 首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6；候选3265字符hash dbd24c04c577d67e5a2e70681d06b230b3642fb3c0f139a0365568535c5fcd6b仍保留未选。原稿审查、修订预算、补丁、时间线和assets消费者均已完成。
- 唯一pending资源提案cmv5bhew50019oow0j37nfjvr；线索提案cmv5bhevu0016oow00ipzsi2f已committed。旧账本提案包含ownerName/holderName同为劳梓凡；持有与所有权需分别核对，不能由代理私自确认。
- 原job failed/manual pause，范围1—3、父导演指针未变，无可自动执行job/command/task/sideEffect。本次用户产生5次调用（候选审查3含格式修复、时间线1、资产1），原job总调用17，10-11 17:00后用量记录11。代理模型0次，未写真实数据库。
- 原始日志.codex-run/maoshan-candidate-review-20261012/20261012-082308-old-server.log及同名前缀llm.jsonl；本轮只读预检与回归在.codex-run/maoshan-resource-pause-20261012/。

## 修复与验证

资源delta及独立资源抽取资产升v2，共享schema明确事实写入风险；剧情危险落限制/影响，不以题材关键词降级。任务要求与未来计划不能证明事实，持有不等于归属或已掌握隐藏能力。registry loader和版本测试同步。历史抽取结果不重跑、旧提案不自动降级。

章节右侧资源风险展示全部pending、完整证据与原因、持有人/归属/状态/限制，正确标记自动同步；无效抽取禁确认但保留忽略。报错指向真实入口。确认事务补原operation核验，重读pending与内容快照，CAS领取后应用账本；并发确认不重复写，应用失败回滚。正文/租约/非法载荷保护保留。

服务端与客户端tsc通过。6文件65/65封网回归：真实现场fixture经实际ActualState/journal/StateCommit/schema/validation，12项新增含重复恢复、显式确认、正文/租约/operation变化、自动归档与人工忽略、边界写失败、确认竞态、提案变化、应用失败回滚；其余覆盖候选失败、旧资源与自动处理。另2/2提示词registry与契约检查。日志offline-tests.log、prompt-tests.log、server-tsc-final.log。无浏览器/UI或真实模型验收；事务与ledger writer是内存替身，不证明真实SQLite并发。状态版本日志仍在事务外，日志失败修复属于残余验证项。

## 加载与操作

新服务代码尚未加载；旧3000/PID55320仍1c0cb9a3b31c/stale=true。旧5190/PID45328及新版5173/PID3960、8787/PID21116未动。源码16项hash、旧后端PID/OS启动时间、原任务/原稿/候选/预算/提案/暂停/11条用量及全局无自动工作预检通过。

新管理员入口.codex-run/maoshan-resource-pause-20261012/restart-old-resources.cmd，沿原隔离old-test.db配置，仅加载服务，不确认提案、不恢复任务。用户执行后代理检查restart-last.log、health与只读预检。此前旧cmd不能代替本轮加载。

确认加载后，从CURRENT第一章源页按F5→右侧“资源风险”→“需要判断的资源变更”，核对“旧账本”的说明、证据和归属；符合正文才点“确认”，不接受则明确“忽略”。这是一项待核对事实，不是要求重写。处理完成后点一次“继续自动导演”，复用原稿/审查/时间线/资源抽取，仅补状态提交再推进。直接继续而不处理提案仍会暂停。运行记录只读。

CURRENT、WORK_LEDGER、批准方案入口和wiki同步，本轮依仓库规则本地阶段提交，不push/合并。后续仍须记录每次人工干预，不能把多轮修复拼成固定版本连续十章成功。
