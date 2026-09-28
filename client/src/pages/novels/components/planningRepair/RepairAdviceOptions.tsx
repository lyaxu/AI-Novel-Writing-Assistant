import type { PlanningRepairAdviceStatus } from "@/api/planningRepair";

export function RepairAdviceOptions({ advice, selectedId, disabled, onSelect }: {
  advice: PlanningRepairAdviceStatus;
  selectedId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 text-sm font-medium">选择修复方向</legend>
    {(advice.options ?? []).map(option => <label key={option.id}
      className={`block cursor-pointer rounded-md p-3 ${selectedId === option.id ? "bg-primary/10 ring-1 ring-primary/40" : "bg-background/50"}`}>
      <span className="flex items-start gap-2">
        <input type="radio" name={`planning-advice-${advice.adviceId}`} value={option.id}
          checked={selectedId === option.id} onChange={() => onSelect(option.id)} className="mt-1 accent-primary" />
        <span className="min-w-0 flex-1 space-y-2">
          <span className="block text-sm font-semibold">{option.title}
            {option.id === advice.recommendedOptionId ? <span className="ml-2 text-xs font-medium text-primary">AI 推荐</span> : null}
          </span>
          <span className="block break-words text-sm text-muted-foreground">{option.reason}</span>
          {([["调整", option.changes], ["保留", option.preserves], ["取舍", option.tradeoffs]] as const).map(([label, items]) => (
            <span key={label} className="block text-sm"><span className="font-medium">{label}：</span>{items.join("；") || "无额外说明"}</span>
          ))}
          {!option.canResume ? <span className="block text-sm text-destructive">{option.blockedReason || "该方案需要调整受保护内容或扩大范围，不能直接执行。"}</span> : null}
        </span>
      </span>
    </label>)}
  </fieldset>;
}
