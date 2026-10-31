/** Shared model-facing wire instructions. Persisted scene plans use the projected canonical format. */
export const sceneOwnershipRules = [
  "状态声明按归属只写一次。顶层stateClaims只存前文上下文声明，每项{id,subject,predicate,temporalScope:prior,modality:fact|intention|attempt|outcome,source}，source只允许{kind:written_prose,evidenceIds:[本次目录ID]}或{kind:unknown,reason}。没有前文声明时返回[]。禁止把本章计划放入顶层stateClaims，禁止输出恢复后的evidence原文字段。",
  "每场causality.stateTransition必须为{beforeClaimIds:[],entryClaims:[],actionClaims:[],afterClaims:[]}。三个Claims数组每项只写{id,subject,predicate,modality}，不写source、sceneKey、phase、temporalScope或反向actionClaimIds/afterClaimIds；所属场景与阶段由数组位置唯一确定，程序投影为planned声明。actionClaims与afterClaims各1-6项，entryClaims可0-6项。",
  "beforeClaimIds只引用顶层上下文或此前场景已声明的ID；本场entryClaims自动加入入口，不必也不得再列入beforeClaimIds。两者合计1-6个不同入口声明。prerequisites只写[{claimIds:[...]}]，引用这些入口声明，最多6个不同ID；禁止另写condition/sourceKind/reference。没有必要前提可[]。所有ID全章唯一，不能提前引用本场动作、离场或后场景条件。",
  "sceneCards不输出entryState/exitState；程序逐字连接入口或离场声明的subject：predicate生成兼容字段，不会截断。每场入口声明合并文本与离场声明合并文本分别不超过240字符；subject最多64、predicate最多160，全章上下文与场景声明合计最多48项。需要精简时压缩命题表述，不能删除必要条件或改动数量、持有者、时态及模态。",
  "首章无已写正文不等于不能开场。已确认设定在本章首次呈现的处境、身份、记忆或世界规则，应放在对应场景entryClaims；它表示本章会呈现该入口，不冒充前文证明。必须符合给定书级设定，不能凭空补成既得资源、权限或能力。缺乏依据的既往事实仍须unknown，不能通过改成entry来掩盖缺口；质量复核会检查本章建立方式及设定支持。",
  "声明区分事实、人物打算、尝试和结果：打算不等于已做到，尝试不等于成功，失败或尚未决定不禁止本章新选择。正文ID只证明出处，命题必须确受原文支持。场景choice、机制及其它叙述沿用同一声明的主体、状态、数量与模态，不独立重写事实。",
];

export const sceneOwnershipCorrectionRule = "若收到Contract repair feedback，必须对照完整rejectedResponse、validationError和relationshipIssues纠正同一合同，保留有效设计及未解职责。拒收响应可能是旧canonical结构或有错的引用图：按本次wire协议把planned声明移入所属场景entryClaims/actionClaims/afterClaims，删除旧反向字段，由程序重新投影；不能原样复刻旧字段、删除未解决要求或杜撰来源来通过校验。只返回完整修订合同，仍需结构及语义复核。";

/** Structurally connected placeholders: unlike schema-only samples, IDs do not collide across scenes. */
export function createSceneOwnershipExample() {
  return {
    stateClaims: [],
    sceneCards: [1, 2, 3].map(index => ({
      key: `scene_${index}`, title: "<本场标题>", purpose: "<本场职责>", mustAdvance: ["<实际推进>"], mustPreserve: ["<需保留的约束>"],
      forbiddenExpansion: ["<不得扩张的范围>"], targetWordCount: 800, resistance: "<具体阻力>", turn: "<反馈或转折>",
      emotionalShift: "<符合人物的情绪变化>", readerValue: "<本场阅读价值>",
      causality: { actor: "<行动者>", choice: "<具体选择>", motive: "<选择原因>",
        prerequisites: [{ claimIds: [index === 1 ? "opening" : `result_${index - 1}`] }],
        stateTransition: {
          beforeClaimIds: index === 1 ? [] : [`result_${index - 1}`],
          entryClaims: index === 1 ? [{ id: "opening", subject: "<主体>", predicate: "<本章首次呈现且符合设定的初始处境>", modality: "fact" }] : [],
          actionClaims: [{ id: `action_${index}`, subject: "<主体>", predicate: "<本场实际选择或尝试>", modality: "attempt" }],
          afterClaims: [{ id: `result_${index}`, subject: "<主体>", predicate: "<本场反馈造成的离场状态>", modality: "outcome" }],
        }, resistanceResponse: "<他人或环境回应>", outcomeMechanism: "<回应如何造成离场状态>", resultingConstraints: [],
      },
    })),
  };
}

export function createTaskSheetWireExample() {
  return { requiredElements: ["<本章必须发生的具体事件>"], taskSheet: "<执行摘要>",
    readerExperience: { readerQuestion: "<读者疑问>", promisedReward: "<本章回报>", rewardLevel: "partial",
      protagonistWant: "<主角所求>", primaryResistance: "<主要阻力>", keyTurn: "<关键变化>", emotionalShift: "<情绪位移>",
      informationReveal: "<信息增量>", netChange: "<净变化>", inheritedHookResponsibilities: [], endingHook: "<章末问题>" },
    ...createSceneOwnershipExample(), neighborEventUse: [], mustAvoidConflicts: [] };
}

/** Chapter capacity classification. One main event, one explicit turn, everything else classified. */
export function createCapacityPlanWireExample() {
  return {
    coreEvent: "<本章唯一主事件，必须与 exclusiveEvent 是同一件事>",
    keyTurn: "<本章唯一明确转折，不能复述主事件>",
    mustDeliver: ["<本章必须兑现的可见结果>"],
    deferable: [],
    seedOnly: ["<只埋设、本章不兑现的线索>"],
    estimatedCoreWordCount: 2400,
  };
}

export function createExecutionContractWireExample() {
  return { purpose: "<章节职责>", exclusiveEvent: "<本章独占事件>", endingState: "<章末稳定状态>",
    nextChapterEntryState: "<下一章承接入口>", conflictLevel: 30, revealLevel: 20, targetWordCount: 2400,
    mustAvoid: "<当前禁止事项>", payoffRefs: [], capacityPlan: createCapacityPlanWireExample(),
    ...createTaskSheetWireExample() };
}

export const sceneOwnershipExampleNote = "这是字段与引用关系示例，不是剧情建议。必须替换全部占位文本、主体、事件、预算和实际模态；示例ID可按本章重新命名但须保持唯一及正确引用。已有前文需在stateClaims列出真实上下文声明并引用本次正文目录ID，不要机械套用示例的空前文。";
