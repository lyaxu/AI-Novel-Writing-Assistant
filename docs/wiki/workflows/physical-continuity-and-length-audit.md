# 物理连续性、真实世界规则、专有名词命名来源与长度符合性审计

## 背景

用户试写《赛博骑手，送餐顺便降个妖》时发现两类真实缺陷：第 2 章直接使用镇宅符，但前文只有空白符纸和朱砂笔，没有画符动作；第 1 章餐箱能藏下一个孩子，第 2 章又能单手拎着同一只餐箱。同一份试写还出现目标每章约 2800 字、实际 3775/4362 字，以及文笔清单化的问题。

随后的样本书又暴露另一类跨题材问题：第 1 章正文结尾直接写“破妄眼每用一次……”，但前文从未在故事内建立“破妄眼”这个名称，读者不知道金手指叫这个名字。这不是文笔或文风问题，而是关键专有名词在正文内没有命名来源就被直接使用；只靠作者设定、大纲或规划任务单知道名字，读者并不知道。

原有的章节接收闸门主要检查因果链、章节义务、人物状态与文风，对“物品容量/重量是否支撑正文动作”“动作前置条件是否已经建立”“专有名词首次出现是否有名源”“长度是否落在目标带内”这类真实世界与读者信息规则缺少统一的结构化检查，长度控制也只在写作阶段处理“太短续写”，没有在验收阶段处理“明显超长”。

## 决策

- 不新建并行大流程，也不增加一次模型调用：把物理连续性、真实世界规则与专有名词命名来源审计并入现有接收资产 `novel.chapter.acceptance_assessment`（v20），作为与因果、推进同级的结构化检查项。
- 语义判断全部交给 AI：审计分五个固定维度，由 AI 结合本书设定和已写正文给出结论；程序不维护题材规则表，不用关键词或正则判断创作内容，也不维护专有名词词表。
- 专有名词投放的创作底线同时进入全局“通用创作规则”（`story_craft_contract`）：规划要求安排首次命名，复核检查候选是否要求使用未建立的名字，正文写作只写功能、现象与代称直到名称来源建立（见 [通用故事工程规则](../prompts/story-craft-defaults-context.md)）。
- 长度不交给模型自算：正文长度是可测量属性，由确定性后处理按既有 `chapterLengthControl` 合同（`targetWordCount / softMinWordCount / softMaxWordCount / hardMaxWordCount`）计算，程序只把测量结果和带内/带外事实结构化。
- 问题继续走现有通道：`defect` 投影为普通 blocking issue，进入现有一次自动修复；修复耗尽且正文可用时按完成优先策略记质量债，不因单章物理、专名或长度问题停止整本生产。

## 当前规则

### 物理连续性、真实世界规则与专有名词五维

- `object_container`：物品与容器的尺寸、容量、重量、数量是否支撑正文动作（装人、抬动、携带、藏匿），搬运是否超出人物体力、人数或运输条件。
- `action_prerequisite`：动作在使用时是否已具备前置（画符需要落笔/朱砂/纸张/时间，拆装需要工具，施法需要符纸与代价，进入场所或调取资料需要权限/身份，引用知识需要此前已获得）。
- `physical_environment`：距离与时间、温度、耐力、伤势、能源/电量、承重、重力与载具条件是否与设定和已写事实一致。
- `continuity_state`：道具状态与位置、伤势与消耗、持有物、人物知识与关系、时间线是否与本章正文、已提供前章或状态快照一致。
- `terminology_introduction`：关键专有名词第一次进入正文时，正文内是否已经建立这个名称的来源。能力、功法、势力、组织、特殊物品、称号等作者设定名，在首次出现之前必须由正文内渠道建立：前文已由人物命名、他人告知、系统/界面提示、铭文/记录/告示、传闻等带出，或本章在首次使用之前用上述渠道带出。名称未建立就直接使用设定名 = `defect`，即使后文补出名字也算首次使用时读者不知道；名称尚未建立时正文只写功能、现象或代称（“这双眼睛”“那股寒意”）不算缺陷。计划、大纲、任务书、作者设定只能说明“要有这个名字”，不能当作正文已经建立。判断只针对读者跟读所需的关键专有名词；普通叙述、日常名词、不承担设定信息的虚构词不进入本维度，本章没有这类首次命名时用 `not_applicable`。作者或题材确有明确叙述约定（例如已建立的说书人、回忆体、系统播报允许直接称呼名物）时可以 `exempt`，并在 `worldRuleBasis` 写明具体依据；仅凭题材标签不得豁免。

每章恰好五个维度各一行，`verdict` 只能是 `consistent / defect / exempt / not_applicable / unknown`；确实没有可审计事实的维度用 `not_applicable`，不能用它跳过已经发生的关键动作或首次出现的专有名词。

### AI-first 与设定豁免

- 本书世界观明确允许的超自然或科幻规则（空间装备、法术搬运、系统赠予、义体力量、传送）本身就是合理依据，不算错误。AI 判 `exempt` 时必须给出 `worldRuleBasis`（来自本次上下文或已写正文的设定依据）。
- 没有提供设定依据时，不得以“题材如此”或关键词自行豁免；程序不建立题材白名单，也不把写实常识强加给明确设定允许的世界。
- 只把文本内部无法自洽、缺少已建立前置、名称未建立就使用或与已写事实冲突的情况记 `defect`。计划、摘要、任务表只能说明意图，不能证明前置或名称来源已经建立。
- 作者或题材确有特例时，通过全局“通用创作规则”的专有名词投放补充要求说明允许的讲述方式；AI 在审查里只按已提供的设定与正文判断，不自行发明特例。

### 证据与审查合同

- 审计行只输出 `{evidenceId}`，从本次正文证据目录选择；原文、来源、位置由程序还原。
- `defect` 至少包含一条 `current_prose` 证据，并必须给出 `severity` 与 `fixSuggestion`；`consistent`/`exempt` 至少一条本章或已写前章证据；`unknown` 只保留风险。
- `terminology_introduction` 的 `defect` 必须写清名称、首次出现的位置与缺失的命名渠道；修复建议只允许两种方向：在首次使用之前补一个正文内命名场景或信息渠道，或把首次使用改成只写功能、现象与代称。
- 编号不存在、维度缺失或重复、`defect` 缺修复建议、`exempt` 缺设定依据，统一进入现有“一次带完整正文的语义纠正”；纠正耗尽后按 `CHAPTER_REVIEW_INCOMPLETE` 保留原稿并暂停审查，不把未核实意见喂给修文。
- 该字段在新模型输出中固定为五行，但对旧报告与旧 prompt 保持可选：没有审计数据或只有旧四维数据的旧记录不会被伪造为已审计。

### 长度符合性

- 验收前由程序统计正文字符数，并按既有长度合同得出 `lengthCompliance`：`status = within_band | over_soft | over_hard | under_soft`，同时记录目标、实际、软下限、软上限、硬上限与超出字数。
- `within_band` 不产生问题，并会撤销模型声称的、与测量相反的长度问题及其修文指令；`over_soft` 记为 medium，`over_hard` 记为 high，`under_soft` 记为 medium，全部使用现有 `plot` 审计分类。
- 不新增任何字数阈值：目标区间来自章节合同/`resolveLengthBudgetContract`，目标未指定时不计算、不产生问题。
- 同一方向已有模型确证的长度问题时不再重复添加程序问题；程序测量只填补缺口，不覆盖模型的事实判断。

### 修复、质量债与治理边界

- `defect` 与超带长度变成普通 blocking issue，复用现有“一次自动修复 → 候选复审 → 保留稿选择”链路；没有新增并行修复预算。
- 修复预算耗尽且仍有可用正文时，章节降级定稿并登记 `defer_and_continue` 质量债，不因单章物理或长度问题让整本自动导演失败。
- 审计问题不得写进正文，不得自动编造设定或修改大纲；修复只允许补足已建立的动作过程、限制动作规模、统一前后描述或补充已授权前置。
- 只有结构化 `replan_required`、无可用正文或数据/运行安全边界才允许停止整本链路。

## 示例

- 餐箱先藏下一个孩子、第二天又被单手拎走 → `object_container: defect` → `physical_object_container`（high）→ 局部修文统一容量/重量描述。
- 前文只有空白符纸和朱砂笔、后文直接拍出镇宅符 → `action_prerequisite: defect` → `physical_action_prerequisite` → 使用前补画符过程或改成已画好的符。
- 第 1 章结尾直接写“破妄眼每用一次……”，前文只有这双眼睛的功能与现象、没有任何人物命名或记录 → `terminology_introduction: defect` → `physical_terminology_introduction` → 在首次使用前补命名场景，或把结尾改成只写“这双眼睛”的代价；后文再补名字不算修复首次使用。
- 第 1 章由老人当面说“这叫破妄眼”，第 2 章再使用这个名称 → `terminology_introduction: consistent`（引用第 1 章命名与本章首次使用）→ 不生成改稿。
- 本章只有“青石板”“纸灯笼”这类普通叙述与日常名词 → `terminology_introduction: not_applicable` → 不误报专名缺陷。
- 本书设定餐箱是空间折叠装备 → `object_container: exempt` + `worldRuleBasis` → 不生成任何改稿要求，但豁免理由保留在审计记录中。
- 目标 2800 字、实际 4362 字 → 软区间 2380–3220、硬上限 3500 → `over_hard`（high）→ 压缩重复解释与清单式罗列；实际 2800 字则不产生长度问题。

## 失败模式

- 审查回答伪造证据编号：拒绝并纠正；耗尽后保留原稿等待人工，不得据未核实意见改稿。
- 旧报告缺少 `physicalContinuityChecks` 或只有 v19 四维数据：视为旧审计数据，不报错也不伪造通过。
- 五个维度缺项或重复：按合同纠正，不要新增重复行或换维度名凑数。
- 名称未建立就首次使用，但审查标成 `consistent` 或只报普通文风问题：属于漏报；应核对首次使用前是否有正文内命名来源，并把命名来源写进规划与任务单。
- 把普通叙述、日常名词或不承担设定信息的虚构词报成专名缺陷：属于误报；应使用 `not_applicable`，不要把词表或正则塞进程序。
- 把设定允许的超自然搬运记成缺陷：属于误报；应使用 `exempt + worldRuleBasis`，并检查提示是否缺少本书设定依据。
- 模型自算字数与程序测量冲突：以程序测量为准；带内的模型长度问题会被撤销。
- 把单章物理/专名/长度问题升级成全局重规划：违反完成优先策略，应走局部修复或质量债。

## 相关模块

- `server/src/prompting/prompts/novel/chapterAcceptance.prompts.ts`
- `server/src/prompting/prompts/novel/acceptance/semantic/physicalContinuity.ts`
- `server/src/services/novel/runtime/acceptance/lengthCompliance.ts`
- `server/src/services/novel/runtime/acceptance/physicalContinuityProjection.ts`
- `server/src/services/novel/runtime/ChapterAcceptanceAssessmentService.ts`
- `shared/types/chapterLengthControl.ts`
- `shared/types/storyCraft.ts`（全局专有名词投放规则组）
- `server/src/services/settings/storyCraftContractContext.ts`

## 来源文档

- [章节生产链路](./chapter-production-chain.md)
- [场景因果与质量证据](./scene-causality-and-quality-evidence.md)
- [通用故事工程规则](../prompts/story-craft-defaults-context.md)
- [版本更新说明](../../releases/release-notes.md)
