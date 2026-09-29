import type { BookStoryFoundation } from "@ai-novel/shared/types/novel/bookStoryFoundation";

/** Shared author-facing contract; never a genre router or a chapter-completion gate. */
export const BOOK_STORY_FOUNDATION_RULES = [
  "【书级构思：大底、世界边界与人物主线】",
  "必须生成 bookStoryFoundation。先想清整本书的因果与收束，再填结构；各项用具体选择、行动及后果表达，避免抽象口号，保持简练。",
  "throughline：centralQuestion 是全书持续追问的问题；thematicAnswer 是作品最终以事件表达的回答；endingChoice 写终局关键选择，choiceCost 写放弃、风险或责任，resolution 写这个选择怎样解决核心矛盾；setupPayoffs 写1-4组前期依据setup与后期回收payoff。候选要提出一条清楚的终局方向，不用‘可能这样或那样’逃避构思，但不必写死全书细纲。",
  "大底是作者掌握的因果与结局方向，不是每部作品必须有隐藏幕后、牺牲或惊天反转。轻松日常、喜剧和打脸故事可以以生活尺度的满足收束；代价可以是机会取舍或责任，不强迫苦难升华。悬疑要知道真相及可回看的线索，未知对读者成立不等于作者也不知道。",
  "worldBoundary：baseline 写实际故事时代、地点、技术和超常规则；crossingRules 写是否跨时空、携物/往返条件与后果，不跨越则明确说明；knowledgeBoundary 区分作者真相、人物所知、记忆和比喻；hardLimits 写1-5条不可擅改的边界。现代出身不等于现代世界，题材标签不得覆盖用户明确设定，同人范围也不得擅自扩展。",
  "viewpoint：anchor 写承载叙事的具体生活处境与观察立场；scopeConnection 写更大事件如何通过利益、规则和关系影响这个人，并由其选择反馈到主线。小人物视角可以呈现宏大叙事，也可只写生活尺度，不强迫宏大化或固定视角形式。",
  "characterDynamics 写1-5个关键角色或角色槽位：role、independentGoal、mainlineEffect、relationshipChange；说明其自身目的如何改变主线、主角的行动如何反过来改变关系。重要人物不能只负责羞辱、送线索、惊叹或解围；普通背景人物不要求人人有完整弧线。",
  "progression：escalationLogic 写后果如何改变目标、策略、关系或对问题的理解；emotionalMovement 写与本书调性相符的情绪怎样由经历积累并兑现。讽刺、荒诞、幽默、热血、悲伤按故事需要组合，不按清单每章凑齐，也不强迫每章反转、升级或获胜。",
  "书级构思必须与原始想法、已确认世界、storyPrototype、endingDirection一致。开篇只承担适合它的铺垫和回报，不提前揭底；不能为了主题或角色齐全重复场景、扩大篇幅。修正候选时同步修正受影响的书级构思，保留无关已确认内容。",
];

export function renderBookStoryFoundation(value?: BookStoryFoundation | null): string {
  if (!value) return "";
  return [
    "书级构思（作者规划，非已发生事实）：世界边界持续适用；终局、人物变化和回收按故事进度兑现，不能当作人物已知信息、开篇必须完成事项或本章必须揭晓的秘密。只落实与当前场景有关的作用，不安排清单式露面。",
    JSON.stringify(value),
  ].join("\n");
}
