# 新书初始执行合同拒收：通用性评估

## 接手摘要

2026-10-18 01:16（北京时间）。用户新建《零下八十度，我买下地铁站建城》后，在界面“节奏”附近停下，要求发现通用问题、先评估再修改，禁止按书打补丁。本轮完成只读调查与纯内存回放，尚未修改应用代码、重载、恢复或调用模型。通用缺口已确认，不需要用户重开书或购买修复建议。

## 环境与唯一真源

D:/novel/AI-Novel-Writing-Assistant，codex/production-core-refactor。调查时HEAD及远端基线f9d9ee23；应用加载f9d9ee23a7cb，Node24.19.0/source，3000/PID2632、5190/PID60636，stale=false。固定库D:/novel/.comparison/2026-10-10/old-test.db；启动记录2026-10-18 00:47。当前仅文档记录另提交推送，应用不需重载。三个Structured组件及WORK_LEDGER历史964行继续保留未提交。

## 用户目标与不可破坏约束

用户已删除极寒文旧正文并选择直接重写，取消“先读取7—8章旧稿”待办；不再索要旧稿。已签约背景不授权操作平台。本轮先调查评估，不针对书名、人物、金额或桥段加条件，不替用户手修响应后强行继续。旧五章书仍冻结作回归样本；新书也保持当前暂停。

## 关键进程时间线

实际北京时间00:56:28开始第1章执行合同v13：

| 步骤 | 实际情况 | tokens |
| --- | --- | --- |
| 首次生成 | 所有场景缺entryState/exitState，存在指向不存在场景的声明 | 19138 |
| 格式修复 | 补齐进入/离开状态，但保留错误引用图，校验报SC4引用不存在场景 | 11357 |
| 第二次生成 | 收到上述错误文本，重新生成；再次缺进入/离开状态 | 19406 |
| 第二次格式修复 | 补齐文本，仍有阶段/跨场引用错误；scene1动作指向自身entry，最终拒收 | 11897 |

四次共61798 tokens，均finish_reason=stop、非输出截断、非网络错误。00:57:31合同阶段结束；后续承诺台账同步调用，任务00:59:28最终停下。全任务24次/258227 tokens，规划轮次0/2表示候选修复未开始，不表示此前没有消费。

## 已完成调查与主因分类

主因分类：功能闭环未完成，涉及新生成协议的可生成性、定向纠正及无候选恢复；伴随模型实际漏字段/错引用。正常产品路径能够再次产生，题材无关。

1. **生成协议重复维护同一关系。** stateClaims.source写sceneKey和entry/action/exit，scene.stateTransition又写反向ID，同时自由文本仍分别写进入/离开与因果。Schema局部合法不能证明跨关系一致，postValidate严格拒收是正确保护。当前模型两次未正确维护该图。
2. **提示说明存在不一致，但不能说模型没收到字段。** execution v13的system只说“sceneCards除原字段外”，完整原字段说明存在另一个task_sheet提示中；不过真实request第三条human自动骨架明确包含entryState/exitState。因此本次是“收到骨架仍漏字段”，不是缺Schema提示单一原因。不要仅加一句提示词就宣布根治。
3. **纠正没有消费完整失败合同。** runner保存completedPromptResponse.output；生成服务的post_validate失败分支却仅传lastError.message。第二请求确实收到“State claim SC4 cites an absent planned scene.”，虽然可选guidance被预算裁掉，required反馈尾部未丢。缺的是完整原输出和逐路径实际/期望关系；不能误诊成反馈完全被裁掉。
4. **初始失败无候选，恢复断在两种状态之间。** 本次candidateVersionId不存在，只有rejected_response。只复核及按原策略继续都要求有效候选，真实GET均available=false，这个拒绝正确。通用建议/自定义入口仍可能先付建议费、追加授权，再在原pipeline恢复时因无候选失败；后半段是代码路径审计，未实际点击或付费验证。不能移除candidate保护或伪造候选ID。
5. **首章来源类型是需要纳入设计的次要缺口。** 当前只有已写正文、本章场景、未知。真实SC1把书级重生设定标prior/unknown；该声明又被当动作前提。后续严格状态审查不能直接认证未知前提。需明确已确认初始设定如何建立在本章入口，或引入可验证设定来源；不是本次已触发的最终错误，不应混称已实测失败。

## 验证与实测结果

- 真库只读，日志原始请求/响应及两次格式修复全部核对；当前完整响应已持久保留。
- 取真实第43、47行响应调用现有bindStateClaimContract，分别复现不存在场景、缺本场action错误。把人物/状态命题替换为通用占位文本后，错误完全相同。只改内存副本，不改数据库或书稿。
- 最终输出还有scene1.after引用scene2.action、scene2.after引用自身action、scene4.action引用自身exit等错误；仅修第一个报错仍会停，证明不应逐条补丁。
- 实际GET review-existing与resume-policy均available=false。无POST、无额外模型请求。
- 旧五章书32次/1396340 tokens、暂停0/2、原候选不变，5章SHA256与上个快照一致，第6章空。新书第1/2章均空稿，24次/258227 tokens前后不变。
- 上轮520工程测试和4组质量审查模型样本不覆盖实际新合同生成→纠正→无候选恢复。它们没有被本次验证成无效，但不能用来证明首章全链可用。上轮“可开始新书验收”是试运行准入，不是产品已通过新书验收。

## 已知问题与临时处理

新书保留暂停及响应，先不点建议、自定义、继续，不重开碰运气。没有放宽质量门，没有替模型手写事实或补齐本书引用。应用代码仍未修复；本轮只将证据与修改范围变得可审阅。

## 未执行与待执行任务

推荐下一阶段按同一机制闭环实施，尚未开始：

1. 统一fresh wire与校验规则，减少双向重复：让模型在一个明确归属位置表达场景动作/结果，程序只投影已明确的关系；不按剧情猜测，也不从缺失文本造事实。旧持久结构兼容读取，生成协议单独升级。
2. 结构与关系诊断返回可定位错误集合；纠正携带原完整响应、来源快照和具体实际/期望关系，在持久化预算内定向改正，而非再次整份盲生成。输出截断、未知结果继续遵守终止边界。
3. 增加初始rejected_response恢复能力，绑定响应指纹、原输入/源版本、job/settled回执、空稿及无租约/无未知结果；验证通过才保存候选，接回正常语义及窗口复核。不能与只复核已有候选混用；UI避免给出无法执行的收费建议入口。
4. 统一记账生成、格式纠正、关系纠正及候选修复，0/2不能掩盖初始调用；重启和重复点击不重新赠送隐式重试包。
5. 验收必须覆盖：当前真实失败离线回放；无前文首章和后续章；独立末世/修仙/武侠素材；跨场/错阶段/未知来源/有效状态保持；首次失败→定向纠正→候选→语义/窗口→恢复。单测人工造正确JSON不够。先独立样本验证，再由用户决定恢复本书。

## 关键文件与产物索引

- 新novel cmvcmyfvt000c14w05b61rm5w；原task cmvcmumqq000014w0ycmxc44s；planning chapter cmvcmyfvt000c14w05b61rm5w-chapter-4300bf7e-a280-42da-956a-781d965aa285；原job cmvcn253t00my14w0b4wzmngo。
- 状态waiting_approval/pending1，planning waiting_confirmation/round0/max2，无candidateVersionId/quality/pendingOperation；原job failed/pending0，无活跃租约，journal paused且步骤failed/settled，无正文。
- 原始日志 `.logs/local-test/20261018-004648-790-server.llm.jsonl` 第40—47行：两次生成+两次格式纠正。对应repair日志第3—6行。原始书稿和日志不提交远端。
- `server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts`：execution提示、反馈及postValidate；`evidence/stateClaimBinding.ts`：跨声明关系保护。
- `server/src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts`：第280—302行失败反馈；`prompting/core/structuredOutputHint.ts`：实际骨架。
- `director/recovery/planningRepair/application/PlanningRepairReviewExistingService.ts`、`volume/planningRepair/PlanningRepairStore.ts`：候选恢复前置条件。`server/tests/planningStateClaims.test.js`：现有人工合同测试边界。

## 下一窗口启动顺序

1. AGENTS全文→PROJECT_CONTEXT→CURRENT→本页，确认f9d9ee23代码及仅文档后续提交，核实dirty。
2. 只读确认新书24次/空稿/无候选及旧书32次/五章/暂停，禁止按旧书恢复清单操作新书。
3. 基于本页评估通用协议与初始拒收恢复设计后实施；不得把逐个改SC编号当工具修复。
4. 先完成隔离回归及独立真实生成链验收，保留失败、费用和未验证边界，再安排用户恢复。

## 待确认事项与风险

用户要求先评估再修改；本轮应用实现未启动。选择单一归属wire结构及初始设定来源需保持AI语义主导，不能机械推导剧情。恢复入口必须保护来源、预算与幂等。模型可生成性不能只靠字段存在性测试推断。

## 可直接发送给新窗口的开场提示

读CURRENT和本快照。新极寒书在第一章执行合同生成阶段停下，通用重复引用协议与无候选恢复缺口已证实，当前仅评估未修改。保留新旧书暂停，按完整失败响应纠正和初始拒收恢复设计继续，不按这本书逐个改剧情或声明ID。
