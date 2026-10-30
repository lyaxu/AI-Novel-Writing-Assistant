import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_STORY_CRAFT_DEFAULTS,
  STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS,
  type StoryCraftDefaults,
} from "@ai-novel/shared/types/storyCraft";
import { getStoryCraftSettings, saveStoryCraftSettings } from "@/api/settings";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AUTO_DIRECTOR_MOBILE_CLASSES } from "@/mobile/autoDirector";

function toInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function ToggleRow(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { title, description, checked, disabled = false, onChange } = props;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className={`mt-0.5 text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
          {description}
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function NumberRow(props: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const { label, description, value, min, max, suffix, onChange } = props;
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className={`mt-0.5 text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
          {description}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          type="number"
          className="w-24"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(toInteger(event.target.value, value, min, max))}
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function TextRow(props: {
  label: string;
  description: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  const { label, description, value, placeholder, maxLength = 240, onChange } = props;
  return (
    <label className="block space-y-1.5 py-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={`block text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
        {description}
      </span>
    </label>
  );
}

function RuleGroup(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{props.title}</h3>
        <p className={`text-sm leading-6 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
          {props.description}
        </p>
      </div>
      <div className="space-y-1">{props.children}</div>
    </section>
  );
}

export default function StoryCraftSettingsSection(props: {
  onActionResult: (message: string) => void;
}) {
  const { onActionResult } = props;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StoryCraftDefaults | null>(null);

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.storyCraft,
    queryFn: getStoryCraftSettings,
  });
  const saved = settingsQuery.data?.data;
  const current = draft ?? saved ?? null;

  useEffect(() => {
    if (saved && draft === null) {
      setDraft(saved);
    }
  }, [draft, saved]);

  const hasChanges = useMemo(
    () => Boolean(current && saved && JSON.stringify(current) !== JSON.stringify(saved)),
    [current, saved],
  );

  const saveMutation = useMutation({
    mutationFn: saveStoryCraftSettings,
    onSuccess: async (response) => {
      onActionResult(response.message ?? "通用创作规则已保存。");
      if (response.data) {
        setDraft(response.data);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.storyCraft });
    },
    onError: (error) => {
      onActionResult(error instanceof Error ? error.message : "通用创作规则保存失败，请稍后重试。");
    },
  });

  const update = (patch: Partial<StoryCraftDefaults>) => {
    if (!current) {
      return;
    }
    onActionResult("");
    setDraft({ ...current, ...patch });
  };

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">通用创作规则</CardTitle>
          <CardDescription>
            {settingsQuery.isLoading
              ? "正在读取通用创作规则..."
              : "暂时无法读取通用创作规则。规划和写作仍可正常进行，稍后刷新页面可以重试。"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">通用创作规则</CardTitle>
            <CardDescription className={AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}>
              为所有书设定故事推进的底线：压力怎么走、每章要交付什么、人物规模怎么铺、特殊能力有什么代价、
              专有名词怎样在正文里先立住。规则不绑定题材，AI 会按每本书的题材和设定写成具体安排。
            </CardDescription>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {hasChanges ? "有未保存的修改" : "已按当前设置生效"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Switch
              checked={current.enabled}
              onCheckedChange={(checked) => update({ enabled: checked })}
              aria-label="启用通用创作规则"
            />
            启用通用创作规则
          </label>
          <span className={`text-xs text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
            关闭后，下面这些规则不会进入 AI 的规划和写作提示；设置内容仍会保留。
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <RuleGroup
          title="压力契约"
          description="让每章都带着压力往前走，而不是等到卷末才集中爆发。"
        >
          <ToggleRow
            title="每章推进中心压力与故事时钟"
            description="每章都要让读者看到中心压力在接近；时钟可以是倒计时、线索期限、关系期限或威胁等级。"
            checked={current.pressureContract.pressureAdvancesEveryChapter}
            onChange={(checked) => update({
              pressureContract: { ...current.pressureContract, pressureAdvancesEveryChapter: checked },
            })}
          />
          <NumberRow
            label="每隔几章安排一次不可逆升级"
            description="到点要让风险、对手、代价或世界规则跨过一道回不去的线。"
            value={current.pressureContract.escalationIntervalChapters}
            min={1}
            max={50}
            suffix="章一次"
            onChange={(value) => update({
              pressureContract: { ...current.pressureContract, escalationIntervalChapters: value },
            })}
          />
          <ToggleRow
            title="每章至少一个可见代价"
            description="损失、暴露、关系恶化、资源消耗或机会关闭，不能只有收益。"
            checked={current.pressureContract.visibleCostEveryChapter}
            onChange={(checked) => update({
              pressureContract: { ...current.pressureContract, visibleCostEveryChapter: checked },
            })}
          />
          <ToggleRow
            title="禁止纯铺垫章"
            description="没有推进压力、没有代价、没有变化的章节不占用正文篇幅。"
            checked={current.pressureContract.forbidPureSetupChapters}
            onChange={(checked) => update({
              pressureContract: { ...current.pressureContract, forbidPureSetupChapters: checked },
            })}
          />
          <TextRow
            label="压力源参考"
            description="只作参考，AI 会按本书题材选择具体压力源，并持续登记在章节安排里。"
            value={current.pressureContract.pressureSourceHint}
            maxLength={200}
            onChange={(value) => update({
              pressureContract: { ...current.pressureContract, pressureSourceHint: value },
            })}
          />
          <TextRow
            label="压力契约补充要求"
            description="可写这条规则在本书里的额外说明，留空则只使用上面的默认要求。"
            value={current.pressureContract.notes}
            placeholder="例如：每次升级都要牵动主角身边的人。"
            onChange={(value) => update({
              pressureContract: { ...current.pressureContract, notes: value },
            })}
          />
        </RuleGroup>

        <RuleGroup
          title="章节义务"
          description="每章交付什么，读者才不会觉得在原地打转。"
        >
          <ToggleRow
            title="开篇钩子"
            description="尽早让读者知道本章要解决什么、失败会怎样。"
            checked={current.chapterObligations.openingHook}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, openingHook: checked },
            })}
          />
          <ToggleRow
            title="目标-阻力-转折-结果"
            description="本章主行动至少完整走一次这条链路，不能只开始不落地。"
            checked={current.chapterObligations.goalObstacleTurnResult}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, goalObstacleTurnResult: checked },
            })}
          />
          <ToggleRow
            title="本章不可逆变化"
            description="结束时人物处境、关系、认知或外部局面至少一项回不去。"
            checked={current.chapterObligations.irreversibleChange}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, irreversibleChange: checked },
            })}
          />
          <ToggleRow
            title="外部威胁或关系升级"
            description="两者至少发生一项，避免整章只在内部想事情。"
            checked={current.chapterObligations.externalThreatOrRelationshipEscalation}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, externalThreatOrRelationshipEscalation: checked },
            })}
          />
          <ToggleRow
            title="结尾回报或新钩子"
            description="给本章一个兑现，或留下能被下一章接住的新问题。"
            checked={current.chapterObligations.rewardOrNewHook}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, rewardOrNewHook: checked },
            })}
          />
          <ToggleRow
            title="避免连续同场景循环"
            description="连续谈判、经营、会议、日常生产等同类场景要换冲突维度，不能靠重复流程推进。"
            checked={current.chapterObligations.forbidRepeatedSceneLoop}
            onChange={(checked) => update({
              chapterObligations: { ...current.chapterObligations, forbidRepeatedSceneLoop: checked },
            })}
          />
          <TextRow
            label="章节义务补充要求"
            description="可写本书对章节交付的额外要求，留空则只使用上面的默认要求。"
            value={current.chapterObligations.notes}
            placeholder="例如：每章至少推进一条关系线。"
            onChange={(value) => update({
              chapterObligations: { ...current.chapterObligations, notes: value },
            })}
          />
        </RuleGroup>

        <RuleGroup
          title="人物规划"
          description="先按篇幅规划人物规模，再按卷分批投放和退场。AI 会在开书和卷规划时按这套规模安排角色。"
        >
          <NumberRow
            label="主角人数"
            description="大多数题材 1 人；双主角结构可以设为 2 人。"
            value={current.characterPlanning.protagonists}
            min={1}
            max={2}
            suffix="人"
            onChange={(value) => update({
              characterPlanning: { ...current.characterPlanning, protagonists: value },
            })}
          />
          <NumberRow
            label="核心圈人数"
            description="贯穿全书、长期参与主线决策的角色。"
            value={current.characterPlanning.coreCircle}
            min={1}
            max={10}
            suffix="人"
            onChange={(value) => update({
              characterPlanning: { ...current.characterPlanning, coreCircle: value },
            })}
          />
          <NumberRow
            label="跨卷对手人数"
            description="能持续制造多卷压力的主要对抗者。"
            value={current.characterPlanning.crossVolumeAntagonists}
            min={1}
            max={8}
            suffix="人"
            onChange={(value) => update({
              characterPlanning: { ...current.characterPlanning, crossVolumeAntagonists: value },
            })}
          />
          <NumberRow
            label="每卷卷级配角人数"
            description="在单卷内承担功能、冲突或关系推进的角色。"
            value={current.characterPlanning.volumeSupportingPerVolume}
            min={1}
            max={10}
            suffix="人"
            onChange={(value) => update({
              characterPlanning: { ...current.characterPlanning, volumeSupportingPerVolume: value },
            })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberRow
              label="每卷有名 NPC 下限"
              description="有姓名、有功能，但不进入主线核心圈。"
              value={current.characterPlanning.namedNpcMinPerVolume}
              min={0}
              max={30}
              suffix="人"
              onChange={(value) => update({
                characterPlanning: { ...current.characterPlanning, namedNpcMinPerVolume: value },
              })}
            />
            <NumberRow
              label="每卷有名 NPC 上限"
              description="至少要大于等于下限。"
              value={current.characterPlanning.namedNpcMaxPerVolume}
              min={1}
              max={40}
              suffix="人"
              onChange={(value) => update({
                characterPlanning: { ...current.characterPlanning, namedNpcMaxPerVolume: value },
              })}
            />
          </div>
          <ToggleRow
            title="按预计章节数缩放人物规模"
            description="章节越多越靠人数上限，越少越靠下限，避免短篇人物过载或长篇人物不足。"
            checked={current.characterPlanning.scaleWithChapterCount}
            onChange={(checked) => update({
              characterPlanning: { ...current.characterPlanning, scaleWithChapterCount: checked },
            })}
          />
          <ToggleRow
            title="每卷投放新角色并安排旧角色退场"
            description="不允许开篇一次投放全书角色规模。"
            checked={current.characterPlanning.rolloutAndRetirePerVolume}
            onChange={(checked) => update({
              characterPlanning: { ...current.characterPlanning, rolloutAndRetirePerVolume: checked },
            })}
          />
          <TextRow
            label="人物规划补充要求"
            description="可写本书对人物规模或关系结构的额外要求。"
            value={current.characterPlanning.notes}
            placeholder="例如：核心圈里至少有一个与主角立场相反的人。"
            onChange={(value) => update({
              characterPlanning: { ...current.characterPlanning, notes: value },
            })}
          />
        </RuleGroup>

        <RuleGroup
          title="特殊能力 / 金手指"
          description="给能力定下代价、限制、升级和反制，避免无代价开挂。"
        >
          <ToggleRow
            title="每次使用都有可见代价"
            description="消耗、损耗、关系或风险，不能无成本改变局面。"
            checked={current.specialAbility.requireVisibleCost}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, requireVisibleCost: checked },
            })}
          />
          <ToggleRow
            title="有冷却、次数或使用条件限制"
            description="不能连续无限使用同一个能力。"
            checked={current.specialAbility.requireCooldownOrLimit}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, requireCooldownOrLimit: checked },
            })}
          />
          <ToggleRow
            title="可能失败或反噬"
            description="关键时刻能力不是稳定按钮，失败要带来新问题。"
            checked={current.specialAbility.requireFailureRisk}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, requireFailureRisk: checked },
            })}
          />
          <ToggleRow
            title="有明确升级条件与阶段收益"
            description="按阶段解锁更强的用法，不能一步到位。"
            checked={current.specialAbility.requireUpgradePath}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, requireUpgradePath: checked },
            })}
          />
          <ToggleRow
            title="有反制手段"
            description="对手、世界规则或环境能限制这个能力。"
            checked={current.specialAbility.requireCounterplay}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, requireCounterplay: checked },
            })}
          />
          <ToggleRow
            title="信息优势不直接兑换资源"
            description="预知、侦察或读取信息不能直接变成物资、战力或人脉，必须经过行动与代价。"
            checked={current.specialAbility.informationNotFreeResources}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, informationNotFreeResources: checked },
            })}
          />
          <ToggleRow
            title="与角色创伤、缺陷或执念绑定"
            description="使用能力时同时暴露人物弱点，让能力和人物一起成长。"
            checked={current.specialAbility.bindToTraumaOrFlaw}
            onChange={(checked) => update({
              specialAbility: { ...current.specialAbility, bindToTraumaOrFlaw: checked },
            })}
          />
          <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">揭示节奏</div>
              <div className={`mt-0.5 text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
                决定能力在全书里怎么亮相、怎么升级、怎么被反制。
              </div>
            </div>
            <Select
              value={current.specialAbility.revealPacing}
              onValueChange={(value) => update({
                specialAbility: {
                  ...current.specialAbility,
                  revealPacing: value as StoryCraftDefaults["specialAbility"]["revealPacing"],
                },
              })}
            >
              <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className={`text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
            {STORY_SPECIAL_ABILITY_REVEAL_PACING_OPTIONS.find((item) => item.value === current.specialAbility.revealPacing)?.description}
          </p>
          <TextRow
            label="特殊能力补充要求"
            description="可写本书对能力来源、代价或升级的额外要求。"
            value={current.specialAbility.notes}
            placeholder="例如：能力使用次数与主角的身体状态绑定。"
            onChange={(value) => update({
              specialAbility: { ...current.specialAbility, notes: value },
            })}
          />
        </RuleGroup>

        <RuleGroup
          title="专有名词投放"
          description="能力、功法、势力、组织、特殊物品、称号这些名字，先让读者在故事里知道名字从哪来，再直接使用。"
        >
          <ToggleRow
            title="名称先建立再使用"
            description="第一次出现专有名词前，正文里要先有人物命名、他人告知、系统或界面提示、铭文或记录、传闻等来源。"
            checked={current.terminologyIntroduction.requireInStoryNameSource}
            onChange={(checked) => update({
              terminologyIntroduction: { ...current.terminologyIntroduction, requireInStoryNameSource: checked },
            })}
          />
          <ToggleRow
            title="名称建立前只写功能或代称"
            description="读者还不知道名字时，写这双眼睛、那股寒意这类现象与代称，不直接使用作者设定名。"
            checked={current.terminologyIntroduction.allowFunctionBeforeName}
            onChange={(checked) => update({
              terminologyIntroduction: { ...current.terminologyIntroduction, allowFunctionBeforeName: checked },
            })}
          />
          <ToggleRow
            title="首次命名要落在场景或信息渠道上"
            description="第一次给出名字要发生在具体动作、对话、界面、铭文或传闻里，不能靠旁白术语突然点出。"
            checked={current.terminologyIntroduction.firstNamingNeedsSceneOrChannel}
            onChange={(checked) => update({
              terminologyIntroduction: { ...current.terminologyIntroduction, firstNamingNeedsSceneOrChannel: checked },
            })}
          />
          <TextRow
            label="名称来源参考"
            description="只作参考，AI 会按本书题材与叙述方式选择具体渠道，并写进章节安排。"
            value={current.terminologyIntroduction.nameSourceHint}
            maxLength={200}
            onChange={(value) => update({
              terminologyIntroduction: { ...current.terminologyIntroduction, nameSourceHint: value },
            })}
          />
          <TextRow
            label="专有名词投放补充要求"
            description="可写本书允许的讲述特例，例如某些称号由叙述者直接称呼；留空则按上面的通用规则。"
            value={current.terminologyIntroduction.notes}
            placeholder="例如：门内弟子称号允许由讲述者直接称呼。"
            onChange={(value) => update({
              terminologyIntroduction: { ...current.terminologyIntroduction, notes: value },
            })}
          />
        </RuleGroup>

        <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className={`text-xs leading-5 text-muted-foreground ${AUTO_DIRECTOR_MOBILE_CLASSES.wrapText}`}>
            保存后，新的规划和写作会按这套规则执行；已经写好的正文不会改动。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onActionResult("");
                setDraft(DEFAULT_STORY_CRAFT_DEFAULTS);
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认
            </Button>
            <Button
              type="button"
              onClick={() => saveMutation.mutate(current)}
              disabled={saveMutation.isPending || !hasChanges}
            >
              {saveMutation.isPending ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
