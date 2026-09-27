# 开书候选修复与窗口交接

## 接手摘要

日期 2026-09-27，Asia/Shanghai。用户正在读已生成的两套候选。当前不需要再跑书，也没有授权由接手者替他选择方案。
本窗口历史已多次压缩；以下以本轮磁盘核对、保留的工具结果和明确标注的历史报告为依据，不声称覆盖所有早期聊天。
目标是通用地改进故事原型质量与生产稳定性，不只是让当前小说通过。

## 环境与唯一真源

- 应用根目录 `D:/novel/AI-Novel-Writing-Assistant`；外层工作目录 `D:/novel`。
- 分支 `codex/fix-task-cleanup-personal-style`；HEAD `c176aea96cdee34712d146edfc38a46be5e479ff`。
- 页面显示 v0.4.28；不能据此推断包含的本地修改或当前上游版本。本次没有检查上游更新。
- Git status 未显示跟踪分支；本次未 fetch、commit、push，不宣称远端已同步。
- 数据库 `D:/novel/AI-Novel-Writing-Assistant/server/dev.db`；本次交接未改数据库、未做备份，不涉及破坏性操作。
- 服务此前为前端 localhost:5173、后端 127.0.0.1:3000；进程编号易变，接手重查，不启动重复服务。
- Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。
- pnpm 目录：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback`。

## 用户目标与约束

详见 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) 与仓库 AGENTS。保留草稿保护、规划修正预算/复核/事务、字数约束、质量分流、个人写法和按需第二读者。
用户当前愿意测试 K3；不可凭旧 DeepSeek 建议擅自换模型。以前允许付费测试不意味着接手自动再跑一次。

## 关键时间线

以下提交已从本地 git log 核对，功能细节需按源码/测试确认，不等于本轮重新验收：

| 提交 | 意图/历史实现 |
| --- | --- |
| 1bf3ab35 | 删书残留任务清理、个人写法「市井见微·细腻推进」 |
| 325cd6d7 | 自动世界设定沿用导演所选模型 |
| b633528b | 按需第二读者及主力模型分工 |
| c6714a09 | 写前规划修正、复核和有界恢复 |
| 824cd18b | 规划重试缺字段、节奏评分尺度 |
| 262ad697 | 场景复用、导演恢复指引 |
| 439a4f22 | 规划合同校验一致性、失败响应留存 |
| c176aea9 | 比较故事原型，默认限量试写样章 |

最近开书候选曾因模型没有可用正文失败；随后修复当前模型重试、输出额度识别、无效重复调用。官方 K3 候选阶段采用 low 思考强度及 32768 总输出预算；不是关闭思考，也不是章节字数目标。
22:14 左右用户重试，22:21 左右后台保存两套候选。后来用户页面仍显示12%，已刷新恢复并补前端同步保护。

## 当前候选事实

- taskId：`cmujtcwa9005fr4w0ffh9hvmh`。
- 页面：`http://localhost:5173/novels/auto-director?marketBriefId=cmujtbd68005er4w0q4uap1mv&taskId=cmujtcwa9005fr4w0ffh9hvmh`。
- 本轮 GET 核验 waiting_approval / candidate_selection_required；seedPayload.batches 含一批两套候选。
- 《流放迷雾死地：我的打捞每日翻倍》，id `a38dc9bb-7a5f-41e1-b76a-54e00a657e59`。
- 《我在迷雾里捞出活人》，id `abcb24a0-6cac-4a3f-a79b-8285d6fcf558`。
- 浏览器刷新后真实 DOM 验证两个标题各1处、“选用这套”按钮2个；未选择或重生成。
- 这些是交接时的快照，用户可能继续操作；不可把旧状态写回数据库。

## 未提交实现与文件索引

以下路径均相对 `D:/novel/AI-Novel-Writing-Assistant`，保留全部现有 diff：

- `client/src/api/novelWorkflow.ts`：retry command 带当前 provider/model/temperature。
- `client/src/pages/novels/autoDirector/useAutoDirectorCreateController.ts`：当前模型重试、后台状态读取恢复、先更新乐观进度再刷新真实状态。
- `client/src/pages/novels/autoDirector/directorTaskPolling.ts`（新增）：首读失败仍轮询、后台轮询、focus/reconnect 刷新；明确404才停轮询；失败快照低频查询，不调用模型。
- `client/tests/directorTaskPolling.test.js`（新增）：QueryObserver 模拟故障和后台恢复；回调顺序约束。
- `client/tests/autoDirectorWorkspaceUxContracts.test.js`：快速重试相关断言。
- `server/src/llm/structuredOutput.ts`、`structuredInvokeParser.ts`、`structuredInvoke.ts`：output_limit 分类、解析前记用量、额度耗尽不自动重试/修复/换模型。
- `server/src/services/novel/director/idea/ideaContext.ts`：output_limit 不走原上下文重试。
- `server/src/llm/factory.ts`：仅 Moonshot 官方 host + kimi-k3 + 候选 prompt，low + max_completion_tokens=32768；避免与 max_tokens 重复发送。
- `server/tests/structuredInvoke.test.js`、`llmFactoryRetryPolicy.test.js`、`directorRunCommandService.test.js`、`novelWorkflowContinue.test.js`：相关回归；保留已存在 full-book 请求应拒绝的测试纠正。
- `README.md`、`docs/releases/release-notes.md`、`docs/wiki/README.md`、`docs/wiki/workflows/structured-output-budget-recovery.md`（新增）：发布说明和稳定边界。
- 本轮交接另新增/修改：仓库 `AGENTS.md`、本目录文档；外层 `D:/novel/AGENTS.md`；全局 `C:/Users/lyaxu/.codex/skills/thread-handoff-packager/`。外层文件和全局技能不随本仓库 Git 自动保存。
- 预先存在的未跟踪杂项：`.codex-run/`、`.playwright-cli/`、旧2026-06-28交接、bat启动/写法脚本、probe db及手写章节 markdown。不是本次全部产物，不打包密钥、不随手清理或批量 git add。

## 验证证据与限制

最近候选显示修复在本会话实际执行：

```powershell
# 先把上述 Node24 bin 和 pnpm fallback 加到 PATH
pnpm --dir client typecheck
# 在 client 目录：
node --experimental-strip-types --test tests/directorTaskPolling.test.js
node --experimental-strip-types --test --test-name-pattern='candidate generation failures|failed candidate retry' tests/autoDirectorWorkspaceUxContracts.test.js
```

类型检查通过；新测试3项、快速重试测试2项通过；git diff --check 无空白错误，有 LF/CRLF 提示。真实浏览器确认候选可见。没有新增模型调用。
更早会话保留结果：server build、client typecheck通过；一次相关后端68项通过，随后K3相关35项通过。这两批可能重叠，不相加、不声称本轮重跑。
较早全量 client 有6个源代码契约基线失败（含旧进度面板/移动布局断言）；未逐项重验或修复，不能宣称全量绿。
候选生成真实成功是用户触发的已有调用，不是轮询修复后的全链路新开书测试。

## 已知问题与待办

| 优先级/状态 | 事项、依据与完成标准 |
| --- | --- |
| P1 等用户反馈 | 用户正在读候选；先听方向判断，不自动选用。下一轮样章应检验冲突、行动后果与回报，不只检验流程完成。 |
| P1 已修、待自然实测 | 状态读取失败可能停轮询、后台不刷新、重试回调覆盖选择界面已做保护。离线覆盖和刷新恢复已验证；当时浏览器没有完整网络跟踪，不能声称唯一触发原因已证明。下一次自然生成应无需手刷出现候选。 |
| P2 待查，未改 | 成功候选 checkpoint 仍可能留着历史 lastError、directorSession.isBackgroundRunning=true。之前接口/DB看到这种残留；需区分历史信息与当前状态，再决定清理投影/写入。不能重写历史日志或直接改DB掩盖问题。 |
| P2 待整理 | 全量 client 旧契约失败需独立审查；本轮不扩大修改。 |
| P2 未执行 | 当前未提交修复的范围审核、提交与推送；需用户请求，不把交接当 push 授权。使用 readme-release-updater。 |
| 已完成机制、待新窗口验收 | 全局交接技能升级、项目长期文档与最新指针已建立；未创建独立新任务证明宿主自动加载，接手第一条应回报读到的入口和分支。 |

## 下一窗口启动顺序

1. 读 `AGENTS.md`、PROJECT_CONTEXT、CURRENT 和本快照。
2. 在应用根目录执行 `git rev-parse --show-toplevel`、`git branch --show-current`、`git status --short`、`git log -3 --oneline`，核对差异，不覆盖它。
3. 简短汇报当前用户目标、未提交修复、验证限制、下一步；用户尚在阅读就等待，不启动模型。
4. 若用户报告卡点，先查新任务状态、日志、接口与页面；不要重放上述旧任务或反复按重试。
5. 只在需要验证对应代码时运行有针对性的类型检查/回归。需要新模型调用时明确范围，不自动启动整本。

## 新窗口开场提示

> 接手小说写作助手优化，按项目 AGENTS.md 读取最新交接。先只读核验分支、未提交修复和当前任务，再向我汇报；不要自动生成、重试或切换分支。我会继续反馈候选和样章。

## 风险与交接结论

现在是可换窗口的自然节点，但不是清洁提交边界。继续使用同一目录和同一分支，旧窗口停止写代码，新窗口接手；不必重启 GUI。
新worktree默认不会携带未提交修复。普通聊天压缩不会删代码，但可能丢失决策动机、旧限制与待办，本包用于补足这些，不保证聊天无损复制。
本次只改变协作文档/技能，不改写作运行、服务或数据库；没有为了打包而执行付费验收。
