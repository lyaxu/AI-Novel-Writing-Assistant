# 通用故事工程规则（题材无关元规则）

## 背景

样本书连续写完 1–7 章后，暴露的问题不是某一个题材的设定问题，而是跨题材的工程问题：

- 书里已经有时钟，但时钟没有变成每章压力，紧张感只在卷首卷尾出现；
- 故事重心滑向基建、经营和流程展示，章节在重复同类场景；
- 人物规模没有先规划，写到哪算哪，后期角色覆盖不上；
- 特殊能力/金手指只有收益，没有代价、升级条件和反制，爽点变成无成本开挂；
- 第 1 章结尾直接写“破妄眼每用一次……”，但前文从未在故事内建立这个名称，读者不知道金手指叫什么；只有作者设定和规划知道名字，不算正文已经告诉读者。

这些经验如果只写进某一本书的设定或某个题材的提示词，用户换题材就会重新踩坑；如果写死“末世要倒计时”“修仙要境界”，又会把一种题材的合理要求变成全书种禁令。因此需要一层**题材无关的元规则**，作为所有书共享的默认创作底线。

## 决策

把这五类底线抽象成一份全局设置，存进 `AppSetting`，key 为 `storyCraftDefaults`：

- 压力契约：中心压力/时钟每章推进、每 N 章一次不可逆升级、每章一个可见代价、禁止纯铺垫章；
- 章节义务：开篇钩子、目标-阻力-转折-结果、本章不可逆变化、外部威胁或关系升级、回报或新钩子、避免连续同场景循环；
- 人物规划：按预计章节数给出金字塔规模（主角、核心圈、跨卷对手、卷级配角、有名 NPC 范围）与每卷投放/退场节奏；
- 特殊能力/金手指：可见代价、冷却/次数限制、失败风险、升级路径、反制手段、信息优势不直接兑换资源、揭示节奏、与创伤/缺陷绑定；
- 专有名词投放：能力、功法、势力、组织、特殊物品、称号等作者设定名，必须先让读者在正文内看到名称来源（人物命名、他人告知、系统/界面提示、铭文/记录/传闻等），再直接使用；名称未建立前只能写功能、现象或代称，首次命名要落在场景动作或信息渠道上，不能靠旁白术语突然点出。

服务端把这份设置渲染成 required context block `story_craft_contract`，注入卷规划、章节规划、规划质量复核和正文写作提示词。规则正文只写“必须达到什么工程底线”，并明确要求 AI 按当前书的题材、世界观、角色关系和已写正文把规则**实例化**；渲染函数里不出现任何具体题材设定。

之所以放在全局设置而不是书级设置：用户跨题材创作时希望复用同一套工程标准；书级差异（题材、世界规则）由 AI 在实例化时处理，而不是让用户为每本书重写规则。

## 当前规则

- 共享契约：`shared/types/storyCraft.ts` 定义 zod schema、默认值和 `enabled` 总开关；`DEFAULT_STORY_CRAFT_DEFAULTS` 由 schema 默认项生成，保证“未保存”和“恢复默认”是同一份规则。新增的 `terminologyIntroduction` 规则组同样默认开启：要求先建立名源、未建立时只写功能或代称、首次命名落在场景或信息渠道。
- 持久化：`server/src/services/settings/StoryCraftSettingsService.ts` 读写 `AppSetting` 的单条 JSON。数据缺失、JSON 损坏、表不存在或数据库不可用时回落到默认值，不阻断创作。
- 上下文渲染：`server/src/services/settings/storyCraftContractContext.ts` 生成 `story_craft_contract` block（`required: true`、`allowSummary: false`）。提供三种 scope：
  - `planning`：五组规则全量，用于卷战略、卷骨架、节奏板、章节列表、章节执行合同；
  - `review`：五组规则全量 + 复核口径，用于章节任务书质量复核；专有名词组改为“检查候选是否要求使用未建立的名字”；
  - `writing`：特殊能力 + 专有名词写作迁移 + 人物使用边界，用于正文生成，避免把人物规划塞进正文预算。写作 scope 的专有名词规则只写“正文怎么写”（先让故事内出现名称，再使用；未建立时写功能与代称；首次命名落在动作或渠道上），不出现“规划/复核/缺陷”这类流程口吻。
- 注入位置：
  - 正文写作：`server/src/services/novel/chapterWritingGraph.ts` 的 writer blocks（草稿与长度续写）；
  - 卷/章节规划：`volumeGenerationOrchestrator`（战略、骨架、章节 purpose/boundary）、`volumeBeatSheetGeneration`、`volumeChapterListGeneration`、`chapterDetail/chapterExecutionContractGeneration`；
  - 规划质量复核：`ChapterTaskSheetQualityGateService` 调用 `novel.volume.chapter_task_sheet_quality` 时传入该 block，提示词同步渲染上下文块。
- 预算：承载该 block 的规划/写作 prompt 预算整体上调约 300 tokens（`NOVEL_PROMPT_BUDGETS`），避免 required block 挤压既有上下文。
- HTTP：`GET/PUT /api/settings/story-craft`，PUT 复用共享 schema 校验（越界数值、下限大于上限、名称来源参考超过 200 字等返回 400）。
- 失败降级：设置读取失败、被关闭或没有任何启用的规则组时，注入函数返回 `null`，调用方保持原有 prompt 继续运行；老书、老 prompt、未保存过设置的库都走默认值或空注入。

### 专有名词投放：规则边界

- 只约束“名称如何进入读者视野”，不规定具体名字、势力或题材；具体渠道由 AI 结合本书题材与叙述方式实例化。
- 默认通用：能力、功法、势力、组织、特殊物品、称号都要求名源。允许作者/题材特例（例如说书人、回忆体、系统播报在本书已建立）通过规则组 `notes` 写清允许的讲述方式；未写说明时按默认处理。
- 名源必须写在正文里：规划、大纲、任务书和作者设定只能说明“要有这个名字”，不能当作读者已经知道。首次使用后才由后文补出名字，仍算首次使用时读者不知道。
- 名称未建立前，正文只能写功能、现象或代称（“这双眼睛”“那股寒意”），不能直接使用作者设定名；这不算缺陷，是正确做法。
- 程序不做关键词或正则判定，也不维护专有名词词表；创作侧由 AI 在规划、复核、写作中实例化，审查侧由验收 AI 在 `terminology_introduction` 维度结构化判断，程序只校验证据与结构。

### 题材实例化口径

规则文本只给“来源示例”和“约束类型”，不给具体题材设定。例如压力源默认示例是“倒计时、线索期限、关系期限、威胁等级、资源耗尽等”，由 AI 按当前书题材选择并持续登记；人物金字塔按预计章节数在用户设定的范围内缩放；特殊能力的形式、代价和反制方式由 AI 结合本书的设定与角色历史实例化。

## 示例

推荐：

- 末世题材：AI 把“每 N 章一次不可逆升级”实例化为倒计时的阶段性恶化，把“每章可见代价”实例化为物资、据点或信任的损失。
- 修仙题材：AI 把“特殊能力有反制”实例化为境界压制、功法克星或天劫，而不是照搬末世的物资短缺。
- 日常向题材：AI 把“外部威胁或关系升级”实例化为关系期限、社会压力和选择后果，而不是硬塞战斗。
- 专有名词：第 1 章先由老人在场景里说“这叫破妄眼”，第 2 章再写“破妄眼每用一次……”；或第 1 章只写“这双眼睛能看穿幻象”，到人物真正得知名字的场合再给名。名字仍由本书设定决定，规则只要求先有名源。

不推荐：

- 在设置里写“本书必须出现丧尸/飞升/系统面板”，这会把元规则变成题材硬编码；
- 用关键词匹配决定是否注入规则，或按题材分支拼提示词；是否注入只看设置开关和启用组，具体怎么写由 AI 结构化输出承担；
- 在规划阶段之外省略正文写作注入，否则规划有压力、正文又写回纯铺垫；
- 把规则理解成“所有名词第一次出现都必须解释”：普通叙述、日常名词和读者不需要知道名字的虚构词不进入检查，专有名词也只要求名源，不要求作者用旁白解释设定。

## 失败模式

- 如果规则文本写进任何具体题材，其他题材的创作会被无关设定污染，用户需要为每本书重写规则。
- 如果设置读取失败时抛错，正文或规划会因一条全局设置无法读取而整链停摆。
- 如果只在规划注入、不在正文写作注入，正文会把规划好的压力写回日常流程，也会把未建立的名字直接写进正文。
- 如果把人物金字塔塞进 writer scope，正文上下文预算会被规划内容挤占；正文只需要人物使用边界。
- 如果新增规则组时跳过 zod 默认值和 `normalize`，旧数据或半截 PUT 会让设置页读不出来。
- 如果改动 prompt 内容却不更新 prompt version，Prompt Registry 的注册与历史调用无法区分新旧行为（本次验收资产从 v19 升到 v20）。
- 如果只在验收侧检查专有名词而不在规划/写作侧要求，正文仍会先写完再被反复退回；创作规则与验收检查必须成对生效。
- 如果程序用名词表、关键词或正则判定“是否专有名词”，会误伤普通叙述并把题材词表写死；判断必须由 AI 在结构化审查里完成。

## 相关模块

- `shared/types/storyCraft.ts`
- `server/src/services/settings/StoryCraftSettingsService.ts`
- `server/src/services/settings/storyCraftContractContext.ts`
- `server/src/routes/settingsStoryCraft.ts`
- `server/src/services/novel/chapterWritingGraph.ts`
- `server/src/services/novel/volume/*`
- `server/src/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.ts`
- `server/src/prompting/prompts/novel/acceptance/semantic/physicalContinuity.ts`（验收侧 `terminology_introduction` 维度）
- `client/src/pages/settings/StoryCraftSettingsSection.tsx`
- `client/src/pages/settings/views/StoryCraftSettingsPage.tsx`

## 来源文档

- 用户样书试写反馈（2026-10，1–7 章）：压力未落章、重心偏基建、人物规模未规划、金手指缺代价。
- 用户样书反馈（2026-10）：第 1 章结尾直接使用“破妄眼”，前文没有建立名称；文笔/文风不是原因，需要全局规则 + 验收检查。
- `docs/wiki/product/settings-readiness.md`
- `docs/wiki/prompts/prompt-registry-and-structured-output.md`
- `docs/releases/release-notes.md`
