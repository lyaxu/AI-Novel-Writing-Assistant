import type { BookStoryFoundation } from "@ai-novel/shared/types/novel/bookStoryFoundation";

export function BookStoryFoundationDetails({ value }: { value?: BookStoryFoundation }) {
  if (!value) return null;
  return <details className="mt-5 border-t pt-4">
    <summary className="cursor-pointer text-sm font-medium">整本书讲什么 · 世界边界与人物关系（含结局方向）</summary>
    <div className="mt-3 space-y-4 text-sm leading-6 break-words [overflow-wrap:anywhere]">
      <section className="space-y-1">
        <h4 className="font-semibold">故事的大底</h4>
        <p>贯穿全书的问题：{value.throughline.centralQuestion}</p>
        <p>最终表达：{value.throughline.thematicAnswer}</p>
        <p>最后的选择：{value.throughline.endingChoice}</p>
        <p>付出与取舍：{value.throughline.choiceCost}</p>
        <p>如何收束：{value.throughline.resolution}</p>
        {value.throughline.setupPayoffs.map((item, index) => <p key={index}>铺垫：{item.setup} → 回收：{item.payoff}</p>)}
      </section>
      <section className="space-y-1">
        <h4 className="font-semibold">从谁的生活看这个故事</h4>
        <p>{value.viewpoint.anchor}</p><p>{value.viewpoint.scopeConnection}</p>
      </section>
      <section className="space-y-1">
        <h4 className="font-semibold">世界边界</h4>
        <p>{value.worldBoundary.baseline}</p>
        <p>跨时空规则：{value.worldBoundary.crossingRules}</p>
        <p>人物能知道什么：{value.worldBoundary.knowledgeBoundary}</p>
        <ul className="list-disc pl-5">{value.worldBoundary.hardLimits.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section>
      <section className="space-y-3">
        <h4 className="font-semibold">人物怎样推动故事</h4>
        {value.characterDynamics.map((item, index) => <div key={index}>
          <p className="font-medium">{item.role}</p>
          <p>自己的目的：{item.independentGoal}</p>
          <p>对主线的影响：{item.mainlineEffect}</p>
          <p>关系怎样变化：{item.relationshipChange}</p>
        </div>)}
      </section>
      <section className="space-y-1">
        <h4 className="font-semibold">故事与情绪怎样向前走</h4>
        <p>{value.progression.escalationLogic}</p><p>{value.progression.emotionalMovement}</p>
      </section>
    </div>
  </details>;
}
