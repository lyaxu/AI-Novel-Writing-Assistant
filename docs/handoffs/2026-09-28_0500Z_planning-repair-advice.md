# 规划暂停后的 AI 建议与方向选择

## 用户目标与授权

用户目标仍是提高工具跨题材小说框架质量，以真实样本发现机制问题，不为样书单独润色。本阶段明确授权补齐“AI 给方案、用户选方向”的流程，完成后由用户继续检验作品质量。本阶段没有授权代选方向、调用模型生成建议或恢复当前书；这些操作保持未执行。

## 环境与样本

- 仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/fix-task-cleanup-personal-style`，接手 HEAD `f25a6389`。本阶段仅本地提交，不 push、不合并 beta/main、不新建任务或工作树。
- 新样本《祭品厨神：我在禁忌森林开食堂》，小说 `cmukqni0l004y9ww0usot67gs`，导演任务 `cmukq9vvf004m9ww0s426950e`。`cmukqu5c201609ww0xra93ub2` 是页面产生的手动工作区任务，不可替代导演任务。
- 只读核验：导演 waiting_approval / step_review_required，planningRepair waiting_confirmation，rounds=2/maxRounds=2，lastError=null，候选 `cmukqqv4j012q9ww03n68ts5s`。两条 Chapter 记录均无正文，活动 generationJob 为 0，未生成建议。
- 用户选择 DeepSeek；生成建议从任务配置继承 provider/model，不能自动换到其他厂商。来源及模型改变后旧建议失效。
- 保留 `.codex-run/`、`.playwright-cli/`、probe db、启动脚本和旧中文书稿，不纳入提交。此前样书前三章结果与框架首期见 [上一快照](2026-09-28_0355Z_framework-quality-phase-one.md)。

## 已落实的工作流

1. 节奏拆章源工作区显式获取 AI 建议，展示 1–3 个方向及推荐项、改动、保留内容与取舍。自定义指导保留为高级选项，新手不必自己写修复提示。
2. 获取建议只生成建议，不改变规划与预算。采用建议后通过既有恢复服务追加一轮，逐章及窗口复核仍需通过。涉及硬约束或范围外变更的建议不能直接采用。
3. 建议持久化并绑定来源指纹；读取与刷新不调用模型。传输重试、格式策略回退、备用模型、JSON 修复与语义重试均对该建议调用显式关闭。历史请求标识、单进程并发锁及 CAS 防止重复请求与迟到结果覆盖。
4. 采用接口只接收建议及选项标识，后端取出保存的指导。事务内再次检查来源。确定来源冲突时仅撤销尚未领取额度的本次授权，未知失败保留恢复记录。
5. 规划复核接收真实书级/窗口上下文，并逐条核对上轮问题，要求当前候选原文证据。不能因另一字段没有重复描述而把已经安排的检查动作或代价再次判缺失；真正的魔法知识、行动条件、因果缺口仍要修。

稳定边界见 [写前规划修复 Wiki](../wiki/workflows/planning-repair-loop.md)。新建议模块保持独立责任目录，不增加数据表。不把任何真实小说名或章节内容硬编码到产品逻辑。

## 验证边界

- shared build、最终 server build、client typecheck 全通过；生产代码最终构建后仅修改测试与文档，没有使编译证据失效。
- 12 个定向测试文件共 306 个唯一用例：304 通过、2 原有跳过、0 未处理失败。主代理 7 文件 213 项、请求策略代理 3 文件 82 项（80 通过、2 跳过）、客户端 2 文件 11 项。重复跑的 Store/Recovery 不累加。
- 恢复测试首次暴露旧 fixture 缺少已经存在的 productionExperience 选择；补齐“用户已选创作界面”的前置条件后 15 项恢复测试通过。没有绕过生产选择门槛或更改该运行逻辑。
- 当前运行服务的 GET advice 返回 200 / none；GET 修复状态返回 waiting_approval / waiting_confirmation / 2/2、recoveryRequest=null。没有发送 POST。
- 主代理测试记录在 `.codex-run/planning-advice-root-tests.log`、`planning-advice-final-tests.log`、`planning-advice-recovery-tests.log`。第二份保留首次旧 fixture 失败，第三份记录修复后的通过结果。

本阶段仅做离线模拟回归、编译、类型检查及只读运行状态核验；未发起真实建议、修复、续写、付费模型评测或浏览器交互验收。工程检查不能证明建议质量、真实供应商响应格式或小说文学质量已经达标。UI 与作品验收交由用户。

建议并发归属采用当前本地单进程模型。若部署多 worker，需要先升级为持久化租约；不可把另一个进程的在途建议视为重启遗留。本轮没有改变部署拓扑。

## 下一步

用户刷新现有源工作区，点击“让 AI 推荐修复方案”，比较后点击“采用此方案并修复”。该操作需要模型调用并增加一轮额度。后续若仍未通过，应检查本轮候选及原文依据、建议采用结果和真实知识缺口，不以放松门槛或无限重试绕过。

新窗口先读 PROJECT_CONTEXT、CURRENT 和本快照，核对 branch/HEAD/dirty 与实时任务；不要依据这份带时间记录自行恢复当前书。
