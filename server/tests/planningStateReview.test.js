const test = require("node:test");
const assert = require("node:assert/strict");
const { projectPlanningStateReview: validate } = require("../dist/prompting/prompts/novel/volume/evidence/planningStateReview.js");
const { chapterTaskSheetQualityPrompt: prompt } = require("../dist/prompting/prompts/novel/volume/chapterTaskSheetQuality.prompts.js");
const { buildPrimaryProseCitationCatalog } = require("../dist/prompting/prompts/novel/volume/evidence/primaryProseCitationCatalog.js");
const quote = (sourcePath, quote) => ({ sourcePath, quote });
const context = JSON.stringify({ writtenEvidence: { chapters: [{ order: 1, content: "余粮三袋。仓门冻住，还未决定先求援还是破门。" }] } });
const prior = quote("writtenEvidence.chapters[0].content", "余粮三袋。");
const candidate = { chapterOrder: 2, summary: "她拿出十袋余粮付给邻居。", sceneCards: "{}" };
function assessment() {
  return { verdict: "repairable", safeToSync: false, recommendedHandling: "repair_contract", loadRisk: "normal",
    summary: "数量缺口", confidence: .9, issues: [{ id: "stock", severity: "high", target: "scene_cards",
      summary: "没有额外粮食", repairHint: "旧值999",
      basis: { kind: "conflicting_requirements", candidateEvidence: [quote("summary", candidate.summary)],
        counterEvidence: [], contextEvidence: [prior], executionImpact: "无法支付", whyExistingConstraintsInsufficient: "无新增" } }],
    repairGuidance: ["错误汇总888"], stateChecks: [], issueDecisions: [{ issueId: "stock", claimIds: [],
      candidateAssertion: { subject: "主角", statement: "此前持有十袋粮", temporalScope: "prior", modality: "fact", evidence: [quote("summary", candidate.summary)] },
      referenceAssertion: { subject: "主角", statement: "此前只有三袋粮", temporalScope: "prior", modality: "fact", evidence: [prior] },
      relation: "contradiction", comparisonScope: "same_state", transition: "not_applicable", transitionEvidence: [],
      explanation: "同一库存没有新来源", repair: { instruction: "以三袋为现有库存，改为承担得起的交易；额外来源须在使用前安排。", premiseEvidence: [prior] },
    }] };
}
test("one decision owns issue and aggregate repair directions; free duplicate numbers are not consumed", () => {
  const result = validate(assessment(), candidate, context);
  assert.equal(result.issues[0].repairHint, result.issueDecisions[0].repair.instruction);
  assert.deepEqual(result.repairGuidance, [result.issues[0].repairHint]);
  assert.doesNotMatch(result.repairGuidance.join(), /888|999/);
});
test("a later intention or attempt cannot be labeled the same accomplished historical state", () => {
  for (const modality of ["intention", "attempt"]) {
    const value = assessment(); value.issueDecisions[0].candidateAssertion.modality = modality;
    value.issueDecisions[0].candidateAssertion.temporalScope = "planned";
    value.issueDecisions[0].comparisonScope = "new_transition";
    assert.throws(() => validate(value, candidate, context), /same subject, time and comparable modality/);
  }
});
test("different actor or different state such as total debt versus partial payment is not an identical-state conflict", () => {
  const value = assessment(); value.issueDecisions[0].comparisonScope = "different_state";
  assert.throws(() => validate(value, candidate, context), /same subject/);
  value.issueDecisions[0].comparisonScope = "same_state";
  value.issueDecisions[0].referenceAssertion.subject = "邻居";
  assert.throws(() => validate(value, candidate, context), /same subject/);
});
test("future plans and compressed facts cannot masquerade as earlier facts or historical repair premises", () => {
  for (const [sourcePath, extra] of [["readonlyNext.summary", {readonlyNext:{summary:"后来找到十袋粮"}}],
    ["writtenEvidence.compressedFacts.text",{writtenEvidence:{chapters:[{order:1,content:"余粮三袋。"}],compressedFacts:{text:"后来找到十袋粮"}}}]]) {
    const value=assessment(), expanded=JSON.stringify({...JSON.parse(context),...extra});
    value.issueDecisions[0].referenceAssertion.evidence=[quote(sourcePath,"后来找到十袋粮")];
    assert.throws(()=>validate(value,candidate,expanded),/earlier facts|secondary\/future/);
    value.issueDecisions[0].referenceAssertion.evidence=[prior];
    value.issueDecisions[0].repair.premiseEvidence=[quote(sourcePath,"后来找到十袋粮")];
    assert.throws(()=>validate(value,candidate,expanded),/planning claims/);
  }
});
test("promise mapping cannot overwrite the single validated repair decision", () => {
  const { mapSemanticAssessmentToQualityGate }=require("../../shared/dist/types/chapterTaskSheetQuality.js");
  const value=assessment(); value.issues[0].id="selected_direction_drift";value.issueDecisions[0].issueId="selected_direction_drift";
  value.promiseChecks=[{sourceId:"promise",status:"insufficient",scope:"current_chapter",repairHint:"凭空用十三袋",explanation:"缺口",candidateEvidence:[],sourceEvidence:[prior],contextEvidence:[]}];
  const checked=validate(value,candidate,context), result=mapSemanticAssessmentToQualityGate(checked,"full_book_autopilot");
  assert.deepEqual(result.repairGuidance,[value.issueDecisions[0].repair.instruction]);
  assert.doesNotMatch(result.issues.map(issue=>issue.repairHint).join(),/十三袋/);
  value.issues=[];value.issueDecisions=[];
  assert.throws(()=>validate(value,candidate,context),/canonical decision/);
});
test("established bridge and missing prerequisite cannot coexist, and forged repair premises are refused", () => {
  const value = assessment(); value.issues[0].basis.kind = "unsupported_prerequisite";
  Object.assign(value.issueDecisions[0], { relation: "missing_precondition", transition: "established", transitionEvidence: [quote("summary", candidate.summary)] });
  assert.throws(() => validate(value, candidate, context), /established transition/);
  value.issueDecisions[0].transition = "missing";
  value.issueDecisions[0].repair.premiseEvidence = [quote(prior.sourcePath, "已有十三袋粮")];
  assert.throws(() => validate(value, candidate, context), /absent premise/);
});
test("every preserved unresolved issue needs a fresh decision; resolved/unknown IDs cannot smuggle advice", () => {
  for (const mutate of [v => v.issueDecisions = [], v => v.issueDecisions.push(v.issueDecisions[0]), v => v.issueDecisions[0].issueId = "other"]) {
    const value = assessment(); mutate(value); assert.throws(() => validate(value, candidate, context), /exactly once/);
  }
});
test("a fresh decision can correct an inherited issue classification without rewriting the historical record", () => {
  const value = assessment(); value.issues[0].basis.kind = "unsupported_prerequisite";
  const result = validate(value, candidate, context, new Set(["stock"]));
  assert.equal(result.issues[0].basis.kind, "conflicting_requirements");
  assert.deepEqual(result.issues[0].basis.contextEvidence, [prior]);
  assert.equal(value.issues[0].basis.kind, "unsupported_prerequisite");
});
test("an unknown consumed before-state cannot escape coverage by omitting the duplicate prerequisites list", () => {
  const current = { ...candidate, sceneCards: JSON.stringify({ stateClaims: [{ id: "fuel", subject: "主角", predicate: "有燃料",
    temporalScope: "prior", modality: "fact", source: { kind: "unknown", reason: "未提供来源" } }],
    scenes: [{ key: "s", causality: { prerequisites: [], stateTransition: { beforeClaimIds: ["fuel"] } } }] }) };
  const value = { ...assessment(), verdict: "usable", safeToSync: true, issues: [], issueDecisions: [],
    stateChecks: [{ claimId: "fuel", status: "insufficient_context", evidence: [], explanation: "没有来源", issueId: null }] };
  assert.throws(() => validate(value, current, context), /unknown prerequisite/);
  const plan = JSON.parse(current.sceneCards); plan.scenes = []; current.sceneCards = JSON.stringify(plan);
  assert.equal(validate(value, current, context).safeToSync, true, "an unresolved mystery that is not consumed is not an automatic blocker");
});
function withClaims() {
  const id = buildPrimaryProseCitationCatalog(context, 2).sources[0].excerpts[0].evidenceId;
  const current = { ...candidate, sceneCards: JSON.stringify({ stateClaims: [{ id: "stock", subject: "主角", predicate: "拥有三袋粮",
    temporalScope: "prior", modality: "fact", source: { kind: "written_prose", evidenceIds: [id] } }] }) };
  const value = { ...assessment(), issues: [], issueDecisions: [], verdict: "usable", safeToSync: true, recommendedHandling: "use_as_is",
    stateChecks: [{ claimId: "stock", status: "supported", evidence: [prior], explanation: "原文明确", issueId: null }] };
  return { current, value };
}
test("state claim coverage and earlier prose identity are mandatory", () => {
  const { current, value } = withClaims(); assert.equal(validate(value, current, context).safeToSync, true);
  assert.throws(() => validate({ ...value, stateChecks: [] }, current, context), /every state claim/);
  assert.throws(() => validate(value, current, context.replace("三袋", "两袋")), /citation|evidence|正文|ID/i);
  value.stateChecks[0].evidence = [quote("summary", current.summary)];
  assert.throws(() => validate(value, current, context), /earlier primary prose/);
});
test("planned new decisions remain admissible without pretending they happened earlier", () => {
  const current = { ...candidate, summary: "她决定先求援，收到工具后再尝试破门。", sceneCards: JSON.stringify({ stateClaims: [{
    id: "choice", subject: "主角", predicate: "本章决定求援", temporalScope: "planned", modality: "intention",
    source: { kind: "planned_scene", sceneKey: "s", phase: "action" },
  }] }) };
  const value = { ...assessment(), issues: [], issueDecisions: [], verdict: "usable", safeToSync: true,
    stateChecks: [{ claimId: "choice", status: "established_in_plan", evidence: [quote("summary", current.summary)], explanation: "本章新决定并未声称仓门已打开", issueId: null }] };
  assert.equal(validate(value, current, context).safeToSync, true);
  value.stateChecks[0].status = "supported";
  assert.throws(() => validate(value, current, context), /historical state/);
});
test("supported state and blocking decision cannot contradict each other", () => {
  const { current, value } = withClaims(); const blocked = assessment();
  blocked.stateChecks = value.stateChecks; blocked.issueDecisions[0].claimIds = ["stock"];
  assert.throws(() => validate(blocked, current, context), /same blocking decision/);
});
test("fresh review schema requires decisions and state coverage; duplicate free repair fields are stripped", () => {
  const value = assessment(); value.progressionChecks = ["event_repetition", "knowledge_repetition", "prior_goal_followthrough"].map(dimension => ({
    dimension, status: "insufficient_context", candidateEvidence: [quote("summary", candidate.summary)], priorEvidence: [], explanation: "无足够前文", issueId: null, repairHint: "",
  })); value.promiseChecks = []; value.issueChecks = []; value.refinements = [];
  const parsed = prompt.outputSchema.parse(value);
  assert.equal(parsed.repairGuidance, undefined); assert.equal(parsed.issues[0].repairHint, undefined);
  assert.equal(parsed.issueDecisions[0].claimIds, undefined);
  assert.deepEqual(prompt.postValidate(parsed, {candidate, mode:"full_book_autopilot", reviewContextJson:context}).issueDecisions[0].claimIds, []);
  assert.equal(prompt.outputSchema.safeParse({ ...value, issueDecisions: undefined }).success, false);
  assert.equal(prompt.outputSchema.safeParse({ ...value, stateChecks: undefined }).success, false);
});
