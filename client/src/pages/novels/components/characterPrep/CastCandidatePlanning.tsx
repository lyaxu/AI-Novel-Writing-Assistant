import { useEffect, useState } from "react";
import type { CharacterCastOption } from "@ai-novel/shared/types/novel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AiButton from "@/components/common/AiButton";

export function CandidateNameEditor(props: {
  name: string; identityKey: string; nameLocked?: boolean; disabled: boolean;
  onSave: (identityKey: string, name: string) => void;
}) {
  const [name, setName] = useState(props.name);
  useEffect(() => { setName(props.name); }, [props.name]);
  return <div className="flex flex-wrap items-center gap-2">
    <Input aria-label={`${props.name}的候选姓名`} value={name} maxLength={80}
      disabled={props.disabled} className="h-8 w-36"
      onChange={(event) => setName(event.target.value)} />
    <Button size="sm" variant="ghost" disabled={props.disabled || !name.trim() || name.trim() === props.name}
      onClick={() => props.onSave(props.identityKey, name.trim())}>保存姓名</Button>
    {props.nameLocked ? <span className="text-xs text-muted-foreground">沿用你的命名</span> : null}
  </div>;
}

const tierLabels = { core: "核心", recurring: "长期人物", arc: "阶段人物", support: "配角" };

export default function CastCandidatePlanning(props: {
  option: CharacterCastOption; disabled: boolean; developing: boolean;
  characterNameById: Map<string, string>;
  onRename: (identityKey: string, name: string) => void;
  onDevelop: () => void;
}) {
  const plan = props.option.coveragePlan;
  if (!plan) return null;
  const pending = plan.roles.filter((role) => role.detailStatus !== "completed");
  return <section className="mt-3 space-y-3 bg-muted/30 p-3" aria-label="全书人物安排">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="space-y-1">
        <div className="text-sm font-medium">全书人物安排{plan.targetChapterCount ? ` · ${plan.targetChapterCount} 章` : ""}</div>
        <div className="text-xs text-muted-foreground">共 {plan.roles.length} 位人物，{plan.roles.length - pending.length} 位资料齐全，{pending.length} 位待完善</div>
      </div>
      {pending.length ? <AiButton size="sm" variant="outline" disabled={props.disabled}
        onClick={props.onDevelop}>{props.developing ? "正在完善人物…" : "完善下一批人物"}</AiButton> : null}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{plan.rationale}</p>
    {pending.length ? <p className="text-xs text-muted-foreground">先用资料齐全的人物开篇。后续可分批完善，每批最多 6 位；中断后会保留已完成的人物。</p> : null}
    <details>
      <summary className="cursor-pointer text-xs font-medium">查看出场安排与待完善人物</summary>
      <div className="mt-2 divide-y divide-border/40">
        {plan.roles.map((role) => <div key={role.identityKey} className="space-y-1 py-3">
          {role.detailStatus === "planned" ? <CandidateNameEditor name={role.name} identityKey={role.identityKey}
            nameLocked={role.nameLocked} disabled={props.disabled} onSave={props.onRename} />
            : <div className="text-sm font-medium">{(() => {
              const member = props.option.members.find((item) => item.identityKey === role.identityKey);
              return member?.appliedCharacterId ? props.characterNameById.get(member.appliedCharacterId) ?? role.name : role.name;
            })()} <span className="text-xs font-normal text-muted-foreground">资料齐全</span></div>}
          <div className="text-xs text-muted-foreground">{tierLabels[role.tier]} · {role.introductionStage}</div>
          <p className="text-xs text-muted-foreground">{role.storyFunction}</p>
        </div>)}
      </div>
    </details>
  </section>;
}
