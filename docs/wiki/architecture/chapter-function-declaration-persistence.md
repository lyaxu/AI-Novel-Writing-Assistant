# 章节自述声明为什么必须落库

## 背景

`0d5d89ed` 把章节质量判断从「6 张中文关键词表」改成「模型自述 + 结构校验」。
模型为每一章声明 `protagonistAction`（这一章主角主动做了什么）与
`chapterPayoff`（这一章交付了什么推进），提示词会拒绝相邻两章声明同一件事
（`chapterList.prompts.ts` 的 `getChapterFunctionQualityIssue`）。

2026-10-06 的规划前置验证发现：**这两项在校验完就丢了。**

## 丢失发生在四个地方

| 层 | 位置 | 状态 |
|---|---|---|
| 结构化输出 schema | `volumeGenerationSchemas.ts:416-432` | ✅ 有 `chapterFunctionFields` |
| 传输类型 | `GeneratedVolumeChapterBlock.chapters`（`volumeGenerationHelpers.ts:24-33`） | ❌ 只有 `beatKey/title/summary` |
| 领域模型 | `VolumeChapterPlan`（`shared/types/novel.ts:805-828`） | ❌ 无这两个字段 |
| 合并与落库 | `mergeChapterList` 逐字段重建、`toVolumeChapterPlanData`、两处 `select`、`isChapterRowCurrent` | ❌ 均不含 |

**库内实测**：v5 全部 5 章的 `protagonistAction` / `chapterPayoff` 都是空字符串。

## 后果

那条规则**只在产生它的那一次模型调用内成立**。调用结束后，校验结果蒸发，
每章存下来都是空的。后来任何读取都拿不到可比对的数据，于是：

- 相邻两章的防重复校验**从未在已落库的计划上运行过**
- 写作阶段也读不到本章自述，无法在生成正文时对照「本章该做什么」

这类 bug 的危险在于**它看起来是生效的**：提示词确实要求、schema 确实校验、
测试确实通过。只有真正去库里查持久化结果，才会发现字段根本不存在。

## 规则

**凡是用来做判断的结构化输出，校验完必须能落库并读回。**
如果一个值只在单次调用内被检查过而没有被持久化，那么基于它的所有防线
实际上不存在。判断一个规则是否真的存在，要看**持久化之后**能不能再读到，
而不是看生成的那一刻有没有检查。

## 验证方式

`server/tests/volumeChapterFunctionDeclaration.test.js`：
声明必须能穿过 `normalizeVolumeDraftInput` → `buildVolumeWorkspaceDocument`
→ `serializeVolumeWorkspaceDocument` → `normalizeVolumeWorkspaceDocument`；
无声明的旧章归 `null` 而不失败；相邻章可据此比较重复声明。

## 相关模块

- `server/src/prompting/prompts/novel/volume/chapterList.prompts.ts`
- `server/src/services/novel/volume/volumeGenerationSchemas.ts`
- `server/src/services/novel/volume/volumeGenerationHelpers.ts`
- `server/src/services/novel/volume/volumePlanUtils.ts`
- `server/src/services/novel/volume/volumeWorkspacePersistence.ts`
- `server/src/services/novel/volume/volumeModels.ts`
- `shared/types/novel.ts`
- 迁移 `20261006210000_volume_chapter_plan_function_declaration`（两套目录都已建）
