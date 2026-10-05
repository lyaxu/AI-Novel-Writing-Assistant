import { createHash } from "node:crypto";
import type { Chapter, NovelWorkflowTask, Prisma } from "@prisma/client";
import type { VolumeChapterPlan, VolumePlanDocument } from "@ai-novel/shared/types/novel";
import { assessChapterExecutionContractShape } from "@ai-novel/shared/types/chapterTaskSheetQuality";
import { prisma } from "../../../../db/prisma";
import { withSqliteRetry } from "../../../../db/sqliteRetry";
import { novelEventBus } from "../../../../events/EventBus";
import { batchContextCache } from "../../runtime/BatchContextCache";
import {
  buildVolumeWorkspaceDocument,
  normalizeVolumeWorkspaceDocument,
  serializeVolumeWorkspaceDocument,
} from "../volumeWorkspaceDocument";
import { mapVolumeRow } from "../volumeModels";
import { writtenSourceFingerprint } from "../writtenEvidence";
import { selectedPlanningCandidateSchema, type SelectedPlanningDirection } from "@ai-novel/shared/types/novel/planningPromises";
import { isVolumeChapterListPartiallyPersisted, resolveOriginalVolumeStatus } from "../volumeGenerationHelpers";
import {
  persistActiveVolumeWorkspace,
  VOLUME_WORKSPACE_TRANSACTION_TIMEOUT_MS,
} from "../volumeWorkspacePersistence";

export interface PlanningRepairState {
  version: 1;
  key: string;
  novelId: string;
  volumeId: string;
  /** VolumeChapterPlan ID, not necessarily a materialized Chapter ID. */
  chapterId: string;
  chapterOrder: number;
  rounds: number;
  maxRounds: number;
  phase: "assessing" | "repairing" | "reviewing" | "ready" | "committed"
    | "waiting_confirmation" | "uncertain" | "technical_failed" | "abandoned";
  candidateVersionId?: string;
  affectedChapterIds?: string[];
  pendingOperation?: { kind: string; startedAt: string };
  repairOutputPending?: { inputFingerprint: string; round: number };
  summary?: string;
  quality?: unknown;
  history: unknown[];
  obligationMoves?: unknown[];
  guidance?: string;
  recoveryAction?: { requestId: string; mode: "repair_then_review" | "review_existing"; paidRound?: number; affectedChapterIds?: string[] };
  technicalError?: string;
  /** Set when the user gives up on this session. Kept as evidence; the session is not reusable. */
  abandonedAt?: string;
  abandonReason?: string;
  /**
   * Rounds consumed at the moment of abandonment.
   *
   * A new session for the same window starts from here. Without it, abandoning a session with an
   * exhausted budget would hand out a fresh two rounds, and "abandon" would become a free retry.
   */
  abandonedRounds?: number;
}

export interface RepairSession {
  taskId: string;
  state: PlanningRepairState;
  baselineDocument: VolumePlanDocument;
  /** All IDs in this window are VolumeChapterPlan IDs. */
  eligibleChapterIds: string[];
  inputFingerprint: string;
  snapshotToken: string;
  /** Frozen novel default (2800 when unset), for resolving null chapter budgets. */
  effectiveDefaultChapterLength?: number;
  candidate?: VolumePlanDocument;
}

export interface BeginPlanningRepairInput {
  selectedPlanningDirection?: SelectedPlanningDirection;
  expectedWrittenSourceFingerprint?: string;
  novelId: string;
  taskId: string;
  document: VolumePlanDocument;
  volumeId: string;
  chapterId: string;
}

export interface RebasePlanningRepairInput extends BeginPlanningRepairInput {
  /** Exact seed reserved by the recovery command, checked before any rebase work. */
  expectedSeedPayloadJson?: string | null;
  /** Advice selection must still refer to the same canonical source inside the transaction. */
  expectedSourceToken?: string;
}

export class PlanningRepairConflictError extends Error {
  readonly code = "PLANNING_REPAIR_CONFLICT";
  constructor(message: string, readonly reason?: "advice_source_changed") {
    super(message);
    this.name = "PlanningRepairConflictError";
  }
}

interface StoredSnapshot {
  selectedCandidateFingerprint?: string;
  writtenSourceFingerprint?: string;
  version: 1;
  taskId: string;
  baselineDocument: VolumePlanDocument;
  eligibleChapterIds: string[];
  inputFingerprint: string;
  snapshotToken: string;
  effectiveDefaultChapterLength?: number;
  candidateHash?: string;
  committed?: boolean;
  committedPlanHash?: string;
  committedSourceHash?: string;
}

type Seed = Record<string, unknown>;
const SNAPSHOT_KEY = "planningRepairSnapshot";
const INACTIVE_PHASES = new Set(["waiting_confirmation", "uncertain", "technical_failed"]);
const PHASES = new Set([
  "assessing", "repairing", "reviewing", "ready", "committed",
  "waiting_confirmation", "uncertain", "technical_failed", "abandoned",
]);
/**
 * Phases in which a repair session is over and stops holding the novel's repair lock.
 *
 * `abandoned` is deliberately its own terminal phase rather than a second meaning for `committed`:
 * commit records that a candidate was accepted and applied, and abandoning one never was. Writing
 * `committed` here would put "this candidate was approved" into the history as a falsehood.
 */
const TERMINAL_PHASES = new Set(["committed", "abandoned"]);
// Fields an eligible chapter may legitimately be rewritten in by generation or repair.
//
// KEEP IN SYNC with the object returned by `generateChapterTaskSheetDetail`
// (services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts): every field that
// function writes is applied onto the chapter document, so any field missing here makes the guard
// reject a perfectly valid generation as a protected-field change. That is exactly what happened
// when `requiredElements` was added to the contract without being added here: every auto-director
// book then failed at the first chapter with "changes protected workspace fields".
const MUTABLE_CHAPTER_FIELDS = new Set([
  "title", "summary", "purpose", "exclusiveEvent", "endingState", "nextChapterEntryState",
  "conflictLevel", "conflictLevelSource", "revealLevel", "targetWordCount", "mustAvoid",
  "taskSheet", "sceneCards", "styleContract", "payoffRefs", "requiredElements",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function record(value: unknown): value is Seed {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function conflict(message: string): never {
  throw new PlanningRepairConflictError(message);
}

function parseSeed(raw: string | null): Seed {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (record(value)) return value;
  } catch { /* A malformed seed must never silently reset a paid-call budget. */ }
  return conflict("The task seed is invalid; planning repair cannot replace it.");
}

function repairSeedAuthority(seed: Seed): string {
  // Heartbeat projections are not generation inputs. Compare only repair authority and
  // business inputs here; casSeed still guards the exact freshly read JSON at the write.
  const protectedKeys = [
    "planningRepair", SNAPSHOT_KEY, "planningRepairRecovery", "planningRepairRecoveryRequests",
    "directorInput", "novelId", "provider", "model", "temperature", "guidance",
    "runMode", "issueGovernanceVersion", "issuePolicy", "issuePolicySource",
    "styleProfileId", "taskStyleProfileId", "styleIntentSummary", "postGenerationStyleReviewEnabled",
    "completionProfile", "autoExecutionPlan", "candidate", "startupPreparation",
  ];
  return hash(Object.fromEntries(protectedKeys.map((key) => [key, seed[key]])));
}

function readState(seed: Seed): PlanningRepairState | undefined {
  const value = seed.planningRepair;
  if (value === undefined) return undefined;
  if (!record(value) || value.version !== 1 || typeof value.key !== "string"
    || typeof value.novelId !== "string" || typeof value.volumeId !== "string"
    || typeof value.chapterId !== "string" || !Number.isInteger(value.chapterOrder)
    || !Number.isInteger(value.rounds) || Number(value.rounds) < 0
    || !Number.isInteger(value.maxRounds) || Number(value.maxRounds) < 1
    || Number(value.rounds) > Number(value.maxRounds)
    || typeof value.phase !== "string" || !PHASES.has(value.phase) || !Array.isArray(value.history)) {
    return conflict("The saved planning repair state is invalid; its budget is preserved.");
  }
  return value as unknown as PlanningRepairState;
}

function readSnapshot(seed: Seed, taskId: string): StoredSnapshot {
  const value = seed[SNAPSHOT_KEY];
  if (!record(value) || value.version !== 1 || value.taskId !== taskId
    || !record(value.baselineDocument) || !Array.isArray(value.eligibleChapterIds)
    || typeof value.inputFingerprint !== "string" || typeof value.snapshotToken !== "string") {
    return conflict("The saved repair snapshot is missing or invalid; explicit recovery is required.");
  }
  return value as unknown as StoredSnapshot;
}

function owner(task: NovelWorkflowTask) {
  return {
    id: task.id, novelId: task.novelId, lane: task.lane, status: task.status,
    attemptCount: task.attemptCount, startedAt: task.startedAt,
    cancelRequestedAt: task.cancelRequestedAt,
  };
}

function executionIdentity(task: NovelWorkflowTask) {
  // Queued/running are progress projections within one execution, not a new owner.
  // Keep the exact owner fields in casSeed so a pause or takeover racing a write still rejects it.
  return { ...owner(task),
    status: task.status === "queued" || task.status === "running" ? "active" : task.status,
    pendingManualRecovery: Boolean(task.pendingManualRecovery),
  };
}

async function readTask(tx: Prisma.TransactionClient, taskId: string, novelId: string, allowCancelled = false) {
  const task = await tx.novelWorkflowTask.findUnique({ where: { id: taskId } });
  if (!task || task.novelId !== novelId) return conflict("Repair task does not own this novel.");
  if ((!allowCancelled && (task.cancelRequestedAt || task.status === "cancelled")) || task.status === "succeeded") {
    return conflict("The repair task is cancelled or completed.");
  }
  const otherTasks = await tx.novelWorkflowTask.findMany({
    where: { novelId, id: { not: taskId }, status: { in: ["queued", "running", "waiting_approval"] } },
    select: { id: true, seedPayloadJson: true },
  });
  for (const other of otherTasks) {
    const repair = readState(parseSeed(other.seedPayloadJson));
    // An abandoned session is over: it must stop blocking every other task in the novel. Leaving it
    // in this check is precisely what kept a dead run holding the lock forever.
    if (repair && !TERMINAL_PHASES.has(repair.phase)) conflict("Another live task owns planning repair for this novel.");
  }
  return task;
}

async function readSource(tx: Prisma.TransactionClient, novelId: string, task: NovelWorkflowTask) {
  const novel = await tx.novel.findUnique({ where: { id: novelId } });
  if (!novel) return conflict("Repair novel no longer exists.");
  const effectiveDefaultChapterLength = novel.defaultChapterLength ?? 2800;
  if (!Number.isSafeInteger(effectiveDefaultChapterLength) || effectiveDefaultChapterLength <= 0) {
    return conflict("The novel default chapter length is invalid; explicit correction is required.");
  }
  const volumes = await tx.volumePlan.findMany({
    where: { novelId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { chapters: { orderBy: { chapterOrder: "asc" } } },
  });
  const versions = await tx.volumePlanVersion.findMany({
    where: {
      novelId,
      OR: [{ status: "active" }, { id: { in: volumes.flatMap((v) => v.sourceVersionId ? [v.sourceVersionId] : []) } }],
    },
    orderBy: [{ version: "asc" }],
  });
  const chapters = await tx.chapter.findMany({ where: { novelId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const macro = await tx.storyMacroPlan.findUnique({ where: { novelId } });
  const active = versions.filter((v) => v.status === "active");
  if (active.length > 1) return conflict("Multiple active workspace versions require manual recovery.");
  const document = active[0]
    ? normalizeVolumeWorkspaceDocument(novelId, active[0].contentJson, {
      source: volumes.length ? "volume" : "empty", activeVersionId: active[0].id,
    })
    : buildVolumeWorkspaceDocument({ novelId, volumes: volumes.map(mapVolumeRow), source: "volume" });
  // Switching the production interface must not invalidate a planning source.
  const { creationExperience: _experience, updatedAt: _updatedAt, ...novelPlanningSource } = novel;
  return {
    chapters, volumes, versions, document, effectiveDefaultChapterLength,
    token: hash({ novel: novelPlanningSource, volumes, versions, chapters, macro }),
    legacyToken: hash({ novel, volumes, versions, chapters, macro }),
  };
}

type Source = Awaited<ReturnType<typeof readSource>>;

function materializedMapping(document: VolumePlanDocument, rows: Chapter[]) {
  const plans = document.volumes.flatMap((volume) => volume.chapters);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const mapping = new Map<string, Chapter | undefined>();
  const claimed = new Set<string>();
  for (const plan of plans) {
    if (mapping.has(plan.id) || plans.filter((p) => p.chapterOrder === plan.chapterOrder).length !== 1) {
      return conflict("Ambiguous plan chapter ID or order.");
    }
    const matches = rows.filter((row) => row.order === plan.chapterOrder);
    const linked = plan.chapterId ? byId.get(plan.chapterId) : undefined;
    if (plan.chapterId && (!linked || linked.order !== plan.chapterOrder)) {
      return conflict("The materialized chapter link is stale or belongs to another novel.");
    }
    if (matches.length > 1) return conflict("Ambiguous materialized chapter order.");
    const row = linked ?? matches[0];
    if (row && claimed.has(row.id)) return conflict("Two plan chapters share a materialized chapter.");
    if (row) claimed.add(row.id);
    mapping.set(plan.id, row);
  }
  return mapping;
}

function isLocked(row: Chapter | undefined): boolean {
  // There is no chapter lock column. Drafts and in-progress/finished execution are protected.
  return Boolean(row && (row.content?.trim() || row.generationState !== "planned"
    || (row.chapterStatus && !["unplanned", "pending_generation"].includes(row.chapterStatus))));
}

function eligibleWindow(document: VolumePlanDocument, volumeId: string, chapterId: string, source: Source) {
  const volume = document.volumes.find((v) => v.id === volumeId);
  if (!volume) return conflict("Repair volume does not exist.");
  const mapping = materializedMapping(document, source.chapters);
  const matches = volume.chapters.filter((p) => p.id === chapterId || mapping.get(p.id)?.id === chapterId);
  if (matches.length !== 1) return conflict("Repair chapter is missing or ambiguous.");
  const chapter = matches[0];
  const sorted = [...volume.chapters].sort((a, b) => a.chapterOrder - b.chapterOrder);
  const index = sorted.findIndex((p) => p.id === chapter.id);
  const eligible: string[] = [];
  const sourceVolume = source.volumes.find((v) => v.id === volumeId);
  const frozen = resolveOriginalVolumeStatus(volume.status) !== "active"
    || (sourceVolume && resolveOriginalVolumeStatus(sourceVolume.status) !== "active")
    || source.versions.some((v) => v.id === sourceVolume?.sourceVersionId && v.status === "frozen");
  if (!frozen) {
    for (const plan of sorted.slice(index, index + 3)) {
      if (plan.chapterOrder > chapter.chapterOrder + 2 || isLocked(mapping.get(plan.id))) break;
      eligible.push(plan.id);
    }
  }
  return { chapter, eligible };
}

function semanticDocument(document: VolumePlanDocument): unknown {
  // Workspace normalization deliberately resets row timestamps to epoch.
  const normalized = buildVolumeWorkspaceDocument(document);
  return { ...normalized, derivedOutline: undefined, derivedStructuredOutline: undefined, readiness: undefined };
}

function committedPlanHash(document: VolumePlanDocument): string {
  return hash(semanticDocument(document));
}

function persistedPlanHash(document: VolumePlanDocument): string {
  const normalized = buildVolumeWorkspaceDocument(document);
  // These fields live only in version JSON; mapVolumeRow returns null for them.
  // committedPlanHash independently protects the complete reviewed document.
  return hash(normalized.volumes.map((volume) => ({
    ...volume, sourceVersionId: undefined, openingHook: null, primaryPressureSource: null,
    coreSellingPoint: null, midVolumeRisk: null, payoffType: null,
    chapters: volume.chapters.map((chapter) => ({
      ...chapter, beatKey: null, exclusiveEvent: null, endingState: null,
      nextChapterEntryState: null, styleContract: null,
      conflictLevelSource: chapter.conflictLevel != null ? chapter.conflictLevelSource ?? "ai" : null,
    })),
  })));
}

function committedSourceHash(source: Source): string {
  // Execution status, prose and timestamps are outputs, not the reviewed plan.
  const rows = buildVolumeWorkspaceDocument({ novelId: source.document.novelId,
    volumes: source.volumes.map(mapVolumeRow), source: "volume" });
  const contracts = source.chapters.map((chapter) => Object.fromEntries([
    "id", "order", "title", "expectation", "taskSheet", "sceneCards", "targetWordCount",
    "conflictLevel", "revealLevel", "mustAvoid",
  ].map((key) => [key, (chapter as unknown as Seed)[key] ?? null])));
  return hash({ plan: semanticDocument(rows), contracts, defaultLength: source.effectiveDefaultChapterLength });
}

/**
 * Path-level description of what actually differs between two projected documents.
 *
 * Why this exists: the guard used to reject a candidate with one generic sentence, and the
 * candidate is never persisted. A rejection therefore left no evidence at all — there was nothing
 * to inspect afterwards, so the same failure could only be reported as "it stopped again".
 * Naming the differing paths turns that into a diagnosis, and because the message is stored as the
 * repair session's `technicalError`, it survives the run and can be read back later.
 */
const MAX_REPORTED_DIFF_PATHS = 6;

function previewValue(value: unknown): string {
  if (value === undefined) return "(absent)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return String(value);
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function describeProjectedDiff(before: unknown, after: unknown, limit = MAX_REPORTED_DIFF_PATHS): string {
  const diffs: string[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (diffs.length >= limit) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) diffs.push(`${path}.length ${a.length}->${b.length}`);
      for (let index = 0; index < Math.min(a.length, b.length) && diffs.length < limit; index += 1) {
        walk(a[index], b[index], `${path}[${index}]`);
      }
      return;
    }
    if (record(a) && record(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        if (diffs.length >= limit) return;
        walk(a[key], b[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    if (a !== b) diffs.push(`${path || "(root)"} ${previewValue(a)} -> ${previewValue(b)}`);
  };
  walk(before, after, "");
  return diffs.join("; ");
}

function validateCandidate(snapshot: StoredSnapshot, candidate: VolumePlanDocument): string[] {
  const baseline = snapshot.baselineDocument;
  const allowed = new Set(snapshot.eligibleChapterIds);
  const affected: string[] = [];
  const project = (document: VolumePlanDocument, before: boolean) => ({
    ...document,
    derivedOutline: undefined, derivedStructuredOutline: undefined, readiness: undefined,
    volumes: document.volumes.map((volume) => ({
      ...volume, createdAt: undefined, updatedAt: undefined,
      chapters: volume.chapters.map((chapter) => {
        const content = { ...chapter, createdAt: undefined, updatedAt: undefined };
        if (!allowed.has(chapter.id)) return content;
        const original = baseline.volumes.flatMap((v) => v.chapters).find((c) => c.id === chapter.id)!;
        if (!before && hash(content) !== hash({ ...original, createdAt: undefined, updatedAt: undefined })) affected.push(chapter.id);
        if (original.targetWordCount != null && chapter.targetWordCount !== original.targetWordCount) {
          return conflict("Planning repair cannot change the original chapter word count budget.");
        }
        if (original.targetWordCount == null && chapter.targetWordCount != null
          && chapter.targetWordCount !== snapshot.effectiveDefaultChapterLength) {
          return conflict("An inherited chapter budget must match the frozen novel default.");
        }
        if (original.conflictLevelSource === "user"
          && (chapter.conflictLevel !== original.conflictLevel || chapter.conflictLevelSource !== "user")) {
          return conflict("A user-set conflict level cannot be changed by planning repair.");
        }
        return Object.fromEntries(Object.entries(content).filter(([key]) => !MUTABLE_CHAPTER_FIELDS.has(key)));
      }),
    })),
  });
  const projectedBaseline = project(baseline, true);
  const projectedCandidate = project(candidate, false);
  if (hash(projectedBaseline) !== hash(projectedCandidate)) {
    const detail = describeProjectedDiff(projectedBaseline, projectedCandidate);
    return conflict(
      "Candidate changes protected workspace fields or chapters outside the repair window."
      + (detail ? ` Differences: ${detail}` : " (no path-level difference could be derived.)"),
    );
  }
  return affected;
}

function validateState(previous: PlanningRepairState, next: PlanningRepairState, eligible: string[]) {
  for (const key of ["version", "key", "novelId", "volumeId", "chapterId", "chapterOrder", "maxRounds"] as const) {
    if (previous[key] !== next[key]) conflict(`Repair state cannot replace ${key}.`);
  }
  readState({ planningRepair: next });
  if (next.rounds < previous.rounds || next.rounds > previous.rounds + 1) {
    conflict("Repair rounds must be monotonic and consumed one at a time.");
  }
  if (next.history.length < previous.history.length
    || hash(next.history.slice(0, previous.history.length)) !== hash(previous.history)) {
    conflict("Accepted repair history is append-only.");
  }
  if (next.affectedChapterIds?.some((id) => !eligible.includes(id))) {
    const outside = next.affectedChapterIds.filter((id) => !eligible.includes(id));
    conflict(`Affected chapter is outside the repair window. Outside: ${outside.join(", ")}. Allowed: ${eligible.join(", ") || "(none)"}.`);
  }
  if (previous.phase === "committed" || next.phase === "committed") conflict("Only commit may finalize a repair session.");
  // Same reasoning for giving up. `validateState` guards the rebase path only; commit and abandon
  // each have their own guarded write path, and a rebase must not reach either state.
  if (previous.phase === "abandoned" || next.phase === "abandoned") conflict("Only abandon may give up a repair session.");
}

/**
 * Write the repair seed with a CAS that separates real ownership changes from ordinary
 * progress projections.
 *
 * A repair window can span a chapter hand-off: the auto-execution sync rewrites `status`
 * (queued <-> running) and the `autoExecution` / `directorSession` / `resumeTarget`
 * heartbeat keys. Comparing the raw status or the exact seed bytes read earlier treats
 * that normal progress as a concurrent edit and fails the whole chapter batch, even
 * though the read-side guard (`current`) already tolerates it.
 *
 * So re-read inside this transaction and verify the same two authorities the session guard
 * uses: `executionIdentity` for ownership (pause, cancel, takeover and rerun still reject)
 * and `repairSeedAuthority` for protected generation inputs. The caller's intended changes
 * are then rebased onto the freshest seed so concurrent heartbeat projections survive.
 */
async function casSeed(tx: Prisma.TransactionClient, task: NovelWorkflowTask, seed: Seed) {
  const fresh = await tx.novelWorkflowTask.findUnique({ where: { id: task.id } });
  if (!fresh) conflict("The repair task disappeared; reload planning repair before continuing.");
  // queued <-> running is one execution's progress, not a new owner; anything else is real.
  if (hash(executionIdentity(fresh)) !== hash(executionIdentity(task))) {
    conflict("The task changed concurrently; reload planning repair before continuing.");
  }
  const previousSeed = parseSeed(task.seedPayloadJson);
  const freshSeed = parseSeed(fresh.seedPayloadJson);
  if (repairSeedAuthority(freshSeed) !== repairSeedAuthority(previousSeed)) {
    conflict("The repair seed or protected generation inputs changed concurrently; reload it.");
  }
  // Rebase onto the freshest seed: keep heartbeat/progress keys the caller did not intend to change.
  const merged: Seed = { ...freshSeed };
  for (const key of new Set([...Object.keys(previousSeed), ...Object.keys(seed)])) {
    if (hash(previousSeed[key]) === hash(seed[key])) continue;
    if (seed[key] === undefined) delete merged[key];
    else merged[key] = seed[key];
  }
  const raw = JSON.stringify(merged);
  const state = readState(merged);
  const changed = await tx.novelWorkflowTask.updateMany({
    // Exact CAS, but against the row read inside this transaction: a change landing after that
    // read (a real takeover, or a second projection) still fails instead of being clobbered.
    // The earlier read is deliberately not reused — it can predate a chapter hand-off.
    where: { ...owner(fresh), pendingManualRecovery: fresh.pendingManualRecovery, seedPayloadJson: fresh.seedPayloadJson },
    data: { seedPayloadJson: raw, ...(state?.summary ? { currentItemLabel: state.summary } : {}) },
  });
  if (changed.count !== 1) conflict("The task changed concurrently; reload planning repair before continuing.");
  return raw;
}

function transaction<T>(runner: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withSqliteRetry(() => prisma.$transaction(runner, {
    timeout: VOLUME_WORKSPACE_TRANSACTION_TIMEOUT_MS,
    isolationLevel: "Serializable",
  }), { label: "volume.planningRepair", retryDelaysMs: [500, 1500, 3000, 6000] });
}

export class PlanningRepairStore {
  // Keep CAS authority separate from the coordinator's intentionally mutable session/state.
  private readonly seeds = new WeakMap<RepairSession, string | null>();
  private readonly owners = new WeakMap<RepairSession, string>();

  /** Persist a verified, already returned initial contract after cancellation; never calls AI or grants rounds. */
  async recoverCompletedInitialGeneration(input: {
    novelId: string; taskId: string; expectedSeedPayloadJson: string;
    operationStartedAt: string; candidate: VolumePlanDocument;
  }): Promise<PlanningRepairState> {
    return transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId, true);
      if (task.status !== "cancelled" || task.seedPayloadJson !== input.expectedSeedPayloadJson) {
        return conflict("Completed-response recovery requires the exact cancelled task snapshot.");
      }
      const seed = parseSeed(task.seedPayloadJson);
      const state = readState(seed);
      const snapshot = readSnapshot(seed, task.id);
      if (!state || state.phase !== "assessing" || state.rounds !== 0 || state.maxRounds !== 2
        || state.history.length || state.candidateVersionId || snapshot.candidateHash || snapshot.committed
        || state.pendingOperation?.kind !== "initial_generation"
        || state.pendingOperation.startedAt !== input.operationStartedAt) {
        return conflict("Only the original interrupted initial contract can be recovered.");
      }
      const source = await readSource(tx, input.novelId, task);
      if (source.token !== snapshot.snapshotToken) return conflict("Planning source changed; response cannot be replayed.");
      if (await tx.generationJob.findFirst({ where: { novelId: input.novelId, status: { in: ["queued", "running"] } } })
        || await tx.directorRunCommand.findFirst({ where: { taskId: task.id, status: { in: ["queued", "leased", "running"] } } })) {
        return conflict("Wait for active execution before replaying a completed response.");
      }
      const { eligible } = eligibleWindow(source.document, state.volumeId, state.chapterId, source);
      const affected = validateCandidate(snapshot, input.candidate);
      if (!eligible.includes(state.chapterId) || affected.some(id => id !== state.chapterId)) {
        return conflict("Initial response may only restore its original unwritten chapter.");
      }
      await this.ensureActiveBaseline(tx, task, snapshot, source);
      const version = await this.createDraft(tx, input.novelId, input.candidate, "已接收任务单，等待规划复核");
      const next: PlanningRepairState = {
        ...state, phase: "reviewing", pendingOperation: undefined, candidateVersionId: version.id,
        affectedChapterIds: [state.chapterId], quality: { chapters: {} }, summary: "已接收任务单，等待规划复核",
      };
      snapshot.candidateHash = hash(input.candidate);
      await casSeed(tx, task, { ...seed, planningRepair: next, [SNAPSHOT_KEY]: snapshot });
      return next;
    });
  }

  /** Explicit technical correction for the initial partial-active misclassification; grants no budget. */
  async recoverInitialPartialVolumeProtection(input: { novelId: string; taskId: string }): Promise<PlanningRepairState> {
    return transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId, true);
      if (task.lane !== "auto_director" || !["cancelled", "failed", "waiting_approval"].includes(task.status)) {
        return conflict("Technical correction requires an inactive auto-director task.");
      }
      const activeJob = await tx.generationJob.findFirst({
        where: { novelId: input.novelId, status: { in: ["queued", "running"] } }, select: { id: true },
      });
      const activeCommand = await tx.directorRunCommand.findFirst({
        where: { taskId: task.id, status: { in: ["queued", "leased", "running"] } }, select: { id: true },
      });
      if (activeJob || activeCommand) return conflict("Wait for active generation and commands before technical correction.");
      const seed = parseSeed(task.seedPayloadJson);
      const state = readState(seed);
      const snapshot = readSnapshot(seed, task.id);
      if (!state || state.novelId !== input.novelId || state.phase !== "waiting_confirmation"
        || state.summary !== "Planning source is stale or the chapter is protected."
        || state.rounds !== 0 || state.maxRounds !== 2 || state.history.length !== 0
        || state.quality != null || state.candidateVersionId || state.pendingOperation || state.repairOutputPending
        || state.affectedChapterIds?.length || state.obligationMoves?.length || state.guidance
        || snapshot.eligibleChapterIds.length !== 0 || snapshot.candidateHash || snapshot.committed
        || seed.planningRepairRecoveryRequests || (record(seed.planningRepairRecovery) && seed.planningRepairRecovery.pendingGrant)) {
        return conflict("Only an untouched initial partial-volume protection failure can be corrected without a grant.");
      }
      const source = await readSource(tx, input.novelId, task);
      if (![source.token, source.legacyToken].includes(snapshot.snapshotToken)
        || snapshot.effectiveDefaultChapterLength !== source.effectiveDefaultChapterLength) {
        return conflict("Planning inputs changed; explicit source confirmation is still required.");
      }
      if (hash(semanticDocument(snapshot.baselineDocument)) !== hash(semanticDocument(source.document))) {
        return conflict("Planning source changed; explicit source confirmation is still required.");
      }
      const volume = source.document.volumes.find((v) => v.id === state.volumeId);
      const persistedVolume = source.volumes.find((v) => v.id === state.volumeId);
      if (!volume || !persistedVolume || !isVolumeChapterListPartiallyPersisted(volume)
        || !isVolumeChapterListPartiallyPersisted(persistedVolume)
        || resolveOriginalVolumeStatus(volume.status) !== "active"
        || resolveOriginalVolumeStatus(persistedVolume.status) !== "active") {
        return conflict("This failure is not the partial-active volume compatibility case.");
      }
      const { chapter, eligible } = eligibleWindow(source.document, state.volumeId, state.chapterId, source);
      if (chapter.id !== state.chapterId || chapter.chapterOrder !== state.chapterOrder || !eligible.includes(chapter.id)) {
        return conflict("The original repair chapter is missing, moved, or protected.");
      }
      const corrected = { ...state, phase: "assessing" as const, summary: undefined };
      const nextSnapshot: StoredSnapshot = {
        ...snapshot, baselineDocument: clone(source.document), eligibleChapterIds: eligible,
        snapshotToken: source.token,
        inputFingerprint: hash({ document: semanticDocument(source.document), source: source.token }),
        effectiveDefaultChapterLength: source.effectiveDefaultChapterLength,
      };
      await casSeed(tx, task, { ...seed, planningRepair: corrected, [SNAPSHOT_KEY]: nextSnapshot });
      return corrected;
    });
  }

  async migrateCommittedSnapshot(input: {
    novelId: string; taskId: string; expectedSeedPayloadJson: string; evidenceDocument: VolumePlanDocument;
  }): Promise<PlanningRepairState> {
    return transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId, true);
      if (task.seedPayloadJson !== input.expectedSeedPayloadJson
        || task.status === "running" || task.status === "queued"
        || await tx.generationJob.findFirst({ where: { novelId: input.novelId, status: { in: ["queued", "running"] } } })
        || await tx.directorRunCommand.findFirst({ where: { taskId: input.taskId, status: { in: ["queued", "leased", "running"] } } })) {
        conflict("Committed snapshot migration requires an unchanged, inactive task.");
      }
      const seed = parseSeed(task.seedPayloadJson);
      const state = readState(seed);
      const snapshot = readSnapshot(seed, input.taskId);
      const source = await readSource(tx, input.novelId, task);
      if (!state || state.phase !== "committed" || state.pendingOperation || !snapshot.committed
        || snapshot.committedPlanHash || snapshot.committedSourceHash
        || hash(input.evidenceDocument) !== snapshot.candidateHash
        || source.document.activeVersionId !== state.candidateVersionId
        || !source.versions.some((v) => v.id === state.candidateVersionId && v.status === "active")
        || committedPlanHash(input.evidenceDocument) !== committedPlanHash(source.document)
        || persistedPlanHash(input.evidenceDocument) !== persistedPlanHash(buildVolumeWorkspaceDocument({
          novelId: input.novelId, source: "volume", volumes: source.volumes.map(mapVolumeRow),
        }))
        || snapshot.effectiveDefaultChapterLength !== source.effectiveDefaultChapterLength) {
        conflict("Committed snapshot evidence does not match the saved review and active plan.");
      }
      const mapping = materializedMapping(input.evidenceDocument, source.chapters);
      for (const id of state.affectedChapterIds ?? []) {
        const plan = input.evidenceDocument.volumes.flatMap((v) => v.chapters).find((c) => c.id === id);
        const row = mapping.get(id);
        if (!plan || (row && Object.entries(this.chapterContract(plan)).some(([key, value]) =>
          hash((row as unknown as Seed)[key] ?? null) !== hash(value ?? null)))) {
          conflict("Materialized execution contract differs from the reviewed evidence.");
        }
      }
      snapshot.committedPlanHash = committedPlanHash(input.evidenceDocument);
      snapshot.committedSourceHash = committedSourceHash(source);
      await casSeed(tx, task, { ...seed, [SNAPSHOT_KEY]: snapshot });
      return state;
    });
  }

  async rebaseCommittedRouteAppend(input: {
    novelId: string; taskId: string; expectedSeedPayloadJson: string; evidenceDocument: VolumePlanDocument;
  }): Promise<PlanningRepairState> {
    return transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId, true);
      if (task.seedPayloadJson !== input.expectedSeedPayloadJson
        || task.status === "running" || task.status === "queued"
        || await tx.generationJob.findFirst({ where: { novelId: input.novelId, status: { in: ["queued", "running"] } } })
        || await tx.directorRunCommand.findFirst({ where: { taskId: input.taskId, status: { in: ["queued", "leased", "running"] } } })) {
        conflict("Route append recovery requires an unchanged, inactive task.");
      }
      const seed = parseSeed(task.seedPayloadJson);
      const state = readState(seed);
      const snapshot = readSnapshot(seed, input.taskId);
      const source = await readSource(tx, input.novelId, task);
      const active = source.versions.find((v) => v.status === "active");
      if (!state || state.phase !== "committed" || state.pendingOperation || !snapshot.committed
        || !snapshot.committedSourceHash || !snapshot.committedPlanHash
        || hash(input.evidenceDocument) !== snapshot.candidateHash
        || committedPlanHash(input.evidenceDocument) !== snapshot.committedPlanHash
        || !active || active.id !== state.candidateVersionId
        || source.document.activeVersionId !== state.candidateVersionId) {
        conflict("Route append evidence does not match the committed review.");
      }
      const oldPlans = input.evidenceDocument.volumes.flatMap((v) => v.chapters);
      const oldIds = new Set(oldPlans.map((c) => c.id));
      const oldVolume = input.evidenceDocument.volumes.find((v) => v.id === state.volumeId);
      if (!oldVolume?.chapters.length) conflict("The reviewed route volume is missing.");
      const lastOrder = Math.max(...oldVolume.chapters.map((c) => c.chapterOrder));
      const added = source.document.volumes.flatMap((v) => v.chapters.filter((c) => !oldIds.has(c.id)));
      if (!added.length || added.some((c) => c.volumeId !== state.volumeId || c.chapterOrder <= lastOrder
        || c.taskSheet?.trim() || c.sceneCards?.trim())) {
        conflict("Only unwritten route chapters appended after the reviewed volume are allowed.");
      }
      const addedIds = new Set(added.map((c) => c.id));
      const priorDocument = { ...source.document, volumes: source.document.volumes.map((v) => ({
        ...v, chapters: v.chapters.filter((c) => !addedIds.has(c.id)),
      })) };
      if (committedPlanHash(priorDocument) !== snapshot.committedPlanHash
        || persistedPlanHash(source.document) !== persistedPlanHash(buildVolumeWorkspaceDocument({
          novelId: input.novelId, source: "volume", volumes: source.volumes.map(mapVolumeRow),
        }))) {
        conflict("Existing reviewed fields or persisted route rows changed.");
      }
      const mapping = materializedMapping(source.document, source.chapters);
      const addedChapterIds = new Set<string>();
      for (const plan of added) {
        const row = mapping.get(plan.id);
        if (row && (isLocked(row) || row.taskSheet?.trim() || row.sceneCards?.trim())) {
          conflict("An appended chapter already has prose, execution, or a detailed contract.");
        }
        if (row) addedChapterIds.add(row.id);
      }
      const priorSource = { ...source, document: priorDocument,
        volumes: source.volumes.map((v) => ({ ...v, chapters: v.chapters.filter((c) => !addedIds.has(c.id)) })),
        chapters: source.chapters.filter((c) => !addedChapterIds.has(c.id)),
      };
      if (committedSourceHash(priorSource) !== snapshot.committedSourceHash) {
        conflict("The reviewed source changed beyond appended route chapters.");
      }
      snapshot.candidateHash = hash(JSON.parse(active.contentJson));
      snapshot.committedPlanHash = committedPlanHash(source.document);
      snapshot.committedSourceHash = committedSourceHash(source);
      await casSeed(tx, task, { ...seed, [SNAPSHOT_KEY]: snapshot });
      return state;
    });
  }

  async begin(input: BeginPlanningRepairInput): Promise<RepairSession> {
    const result = await transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId);
      const seed = parseSeed(task.seedPayloadJson);
      const previous = readState(seed);
      const source = await readSource(tx, input.novelId, task);
      const selectedCandidateFingerprint = hash(seed.candidate ?? null);
      if (input.selectedPlanningDirection) {
        const actual = selectedPlanningCandidateSchema.safeParse(seed.candidate);
        const expected = input.selectedPlanningDirection;
        if (actual.success !== (expected.status === "available") || (actual.success && expected.status === "available"
          && (expected.sourceTaskId !== task.id || hash(actual.data) !== hash(expected.candidate)))) {
          conflict("Selected planning direction changed before review; reload the source.");
        }
      }
      if (previous && previous.novelId !== input.novelId) conflict("Saved repair belongs to another novel.");
      const sameChapter = previous && previous.volumeId === input.volumeId
        && (previous.chapterId === input.chapterId
          || source.chapters.some((row) => row.id === input.chapterId && row.order === previous.chapterOrder));
      const requestedPlan = source.document.volumes.find((v) => v.id === input.volumeId)?.chapters
        .find((chapter) => chapter.id === input.chapterId || chapter.chapterId === input.chapterId);
      const writtenFingerprint = requestedPlan ? writtenSourceFingerprint(source.chapters, requestedPlan.chapterOrder) : undefined;
      if (input.expectedWrittenSourceFingerprint !== undefined && input.expectedWrittenSourceFingerprint !== writtenFingerprint) {
        conflict("Written chapter evidence changed before planning began; reload the source.");
      }
      const reviewedWindowChapter = previous?.phase === "committed" && previous.volumeId === input.volumeId
        && requestedPlan && previous.affectedChapterIds?.includes(requestedPlan.id);
      // A session the user gave up is never revived. `abandoned` is absorbing, so reusing it here
      // would leave the chapter unrepairable forever — the worst outcome of that absorbing state.
      // The next attempt starts as a new session; the abandoned one keeps the evidence (including
      // the rounds it had consumed), which is what the audit trail needs.
      const abandonedGaveUp = previous?.phase === "abandoned";
      if (previous && !abandonedGaveUp && (previous.phase !== "committed" || sameChapter || reviewedWindowChapter)) {
        const snapshot = readSnapshot(seed, input.taskId);
        let state = previous;
        const upgradeBudget = snapshot.effectiveDefaultChapterLength === undefined && snapshot.snapshotToken === source.token;
        if (upgradeBudget) snapshot.effectiveDefaultChapterLength = source.effectiveDefaultChapterLength;
        const committed = previous.phase === "committed" && snapshot.committed;
        if (reviewedWindowChapter && !sameChapter) {
          if (!snapshot.committedPlanHash || !snapshot.committedSourceHash) {
            conflict("The committed window requires verified snapshot migration before reuse.");
          }
          this.assertReviewedContracts(previous, source.document, [requestedPlan.id]);
        }
        if (committed && snapshot.committedPlanHash && snapshot.committedSourceHash) {
          if (source.document.activeVersionId !== previous.candidateVersionId
            || !source.versions.some((v) => v.id === previous.candidateVersionId && v.status === "active")
            || committedPlanHash(source.document) !== snapshot.committedPlanHash
            || committedSourceHash(source) !== snapshot.committedSourceHash) {
            conflict("The committed planning contract changed; explicit confirmation is required.");
          }
        } else if (snapshot.snapshotToken !== source.token || (input.selectedPlanningDirection
          && snapshot.selectedCandidateFingerprint !== selectedCandidateFingerprint)) {
          state = { ...previous, phase: "waiting_confirmation", summary: "Planning source changed; explicit confirmation is required." };
        }
        if (committed && requestedPlan && ((input.expectedWrittenSourceFingerprint !== undefined
          && snapshot.writtenSourceFingerprint !== writtenFingerprint) || (input.selectedPlanningDirection
          && snapshot.selectedCandidateFingerprint !== selectedCandidateFingerprint))) {
          // Ordinary forward progress changes the available prose. Re-review the saved contract,
          // without buying an initial generation, resetting repair rounds, or asking the user to fix it.
          const { chapter, eligible } = eligibleWindow(source.document, input.volumeId, requestedPlan.id, source);
          if (!eligible.includes(chapter.id)) conflict("The chapter requiring factual re-review is protected.");
          const candidate = clone(source.document);
          const version = await this.createDraft(tx, input.novelId, candidate, "已写事实更新，复核现有章节合同");
          const next: PlanningRepairState = { ...previous, key: `${input.novelId}:${input.volumeId}:${chapter.id}`,
            history: [...previous.history, { kind: "evidence_refresh", chapterId: chapter.id,
              writtenSourceFingerprint: writtenFingerprint, selectedCandidateFingerprint }],
            chapterId: chapter.id, chapterOrder: chapter.chapterOrder, phase: "reviewing", candidateVersionId: version.id,
            affectedChapterIds: [chapter.id], quality: { chapters: {} }, pendingOperation: undefined,
            repairOutputPending: undefined, technicalError: undefined, summary: "已写事实更新，复核现有章节合同" };
          const renewed: StoredSnapshot = { version: 1, taskId: task.id, baselineDocument: clone(source.document),
            eligibleChapterIds: eligible, inputFingerprint: hash({ document: semanticDocument(source.document), source: source.token }),
            snapshotToken: source.token, effectiveDefaultChapterLength: source.effectiveDefaultChapterLength,
            candidateHash: hash(candidate), writtenSourceFingerprint: writtenFingerprint, selectedCandidateFingerprint };
          const raw = await casSeed(tx, task, { ...seed, planningRepair: next, [SNAPSHOT_KEY]: renewed });
          return { session: this.session(next, renewed, candidate), raw, owner: hash(executionIdentity(task)) };
        }
        const candidate = await this.loadCandidate(tx, previous, snapshot);
        const raw = state === previous && !upgradeBudget ? task.seedPayloadJson
          : await casSeed(tx, task, { ...seed, planningRepair: state, [SNAPSHOT_KEY]: snapshot });
        return { session: this.session(state, snapshot, candidate), raw, owner: hash(executionIdentity(task)) };
      }
      if (input.document.novelId !== input.novelId) conflict("Input document belongs to another novel.");
      const { chapter, eligible } = eligibleWindow(input.document, input.volumeId, input.chapterId, source);
      const stale = hash(semanticDocument(input.document)) !== hash(semanticDocument(source.document));
      const state: PlanningRepairState = {
        version: 1, key: `${input.novelId}:${input.volumeId}:${chapter.id}`,
        novelId: input.novelId, volumeId: input.volumeId, chapterId: chapter.id,
        chapterOrder: chapter.chapterOrder, rounds: 0, maxRounds: 2,
        phase: stale || !eligible.length ? "waiting_confirmation" : "assessing",
        // A task holds one repair slot, so this new attempt replaces the given-up session. Carry a
        // record of it forward: without this, giving up would erase exactly the evidence the abandon
        // path exists to keep.
        history: abandonedGaveUp && previous.novelId === input.novelId
          ? [{ kind: "abandoned_previous", abandonedAt: previous.abandonedAt, abandonedRounds: previous.abandonedRounds,
            reason: previous.abandonReason, technicalError: previous.technicalError }]
          : [],
        quality: null, obligationMoves: [],
        ...(stale || !eligible.length ? { summary: "Planning source is stale or the chapter is protected." } : {}),
      };
      const snapshot: StoredSnapshot = {
        version: 1, taskId: task.id, baselineDocument: clone(input.document),
        writtenSourceFingerprint: writtenFingerprint,
        selectedCandidateFingerprint,
        eligibleChapterIds: eligible, inputFingerprint: hash({ document: semanticDocument(input.document), source: source.token }),
        snapshotToken: source.token,
        effectiveDefaultChapterLength: source.effectiveDefaultChapterLength,
      };
      const raw = await casSeed(tx, task, { ...seed, planningRepair: state, [SNAPSHOT_KEY]: snapshot });
      return { session: this.session(state, snapshot), raw, owner: hash(executionIdentity(task)) };
    });
    this.seeds.set(result.session, result.raw);
    this.owners.set(result.session, result.owner);
    return result.session;
  }

  /** Explicit recovery only. This does not grant rounds; the caller must persist any approved grant. */
  async rebase(input: RebasePlanningRepairInput): Promise<RepairSession> {
    const result = await transaction(async (tx) => {
      const task = await readTask(tx, input.taskId, input.novelId);
      if (input.expectedSeedPayloadJson !== undefined && task.seedPayloadJson !== input.expectedSeedPayloadJson) {
        return conflict("The recovery seed reservation changed; reload before rebasing planning repair.");
      }
      const seed = parseSeed(task.seedPayloadJson);
      const previous = readState(seed);
      if (!previous || previous.novelId !== input.novelId || previous.volumeId !== input.volumeId) {
        return conflict("Explicit recovery must target the existing repair session.");
      }
      // A given-up session is final. Recovery entry points already refuse terminal phases, but a
      // store must not rely on callers having checked: `validateState` guards `save`, not this path,
      // so without this a rebase silently revived the session the user had just given up.
      if (previous.phase === "abandoned") return conflict("这次修复已经放弃，不能再继续。");
      const snapshot = readSnapshot(seed, task.id);
      const source = await readSource(tx, input.novelId, task);
      if (input.expectedSourceToken !== undefined && input.expectedSourceToken !== source.token) {
        throw new PlanningRepairConflictError("规划来源已变化，请重新获取推荐方案。", "advice_source_changed");
      }
      if (hash(semanticDocument(input.document)) !== hash(semanticDocument(source.document))) {
        return conflict("Explicit recovery requires a fresh canonical workspace document.");
      }
      const { chapter, eligible } = eligibleWindow(input.document, input.volumeId, input.chapterId, source);
      if (chapter.id !== previous.chapterId || chapter.chapterOrder !== previous.chapterOrder || !eligible.includes(chapter.id)) {
        return conflict("The original repair chapter is missing, moved, or protected.");
      }
      const changed = snapshot.snapshotToken !== source.token;
      const candidate = changed ? undefined : await this.loadCandidate(tx, previous, snapshot);
      if (!changed && snapshot.committed) return conflict("The repair is already committed.");
      const nextSnapshot: StoredSnapshot = changed ? {
        version: 1, taskId: task.id, baselineDocument: clone(input.document), eligibleChapterIds: eligible,
        inputFingerprint: hash({ document: semanticDocument(input.document), source: source.token }), snapshotToken: source.token,
        effectiveDefaultChapterLength: source.effectiveDefaultChapterLength,
      } : snapshot;
      nextSnapshot.effectiveDefaultChapterLength ??= source.effectiveDefaultChapterLength;
      nextSnapshot.writtenSourceFingerprint = writtenSourceFingerprint(source.chapters, previous.chapterOrder);
      nextSnapshot.selectedCandidateFingerprint = hash(seed.candidate ?? null);
      const state: PlanningRepairState = {
        ...previous, phase: candidate ? "reviewing" : "assessing", pendingOperation: undefined,
        quality: undefined, technicalError: undefined,
        ...(changed ? { candidateVersionId: undefined, affectedChapterIds: undefined, obligationMoves: [], repairOutputPending: undefined } : {}),
      };
      const raw = await casSeed(tx, task, { ...seed, planningRepair: state, [SNAPSHOT_KEY]: nextSnapshot });
      return { session: this.session(state, nextSnapshot, candidate), raw, owner: hash(executionIdentity(task)) };
    });
    this.seeds.set(result.session, result.raw);
    this.owners.set(result.session, result.owner);
    return result.session;
  }

  async save(session: RepairSession, state: PlanningRepairState, candidate?: VolumePlanDocument): Promise<RepairSession> {
    const requestedState = clone(state);
    const requestedCandidate = candidate ? clone(candidate) : undefined;
    const result = await transaction(async (tx) => {
      const { task, seed, previous, snapshot } = await this.current(tx, session);
      if (snapshot.committed) conflict("A committed repair cannot be resumed as a draft.");
      validateState(previous, requestedState, snapshot.eligibleChapterIds);
      const source = await readSource(tx, previous.novelId, task);
      if (source.token !== snapshot.snapshotToken) {
        const waiting = { ...previous, phase: "waiting_confirmation" as const, summary: "Planning source changed; explicit confirmation is required." };
        const raw = await casSeed(tx, task, { ...seed, planningRepair: waiting });
        return { state: waiting, snapshot, candidate: await this.loadCandidate(tx, previous, snapshot), raw, stale: true };
      }
      let next = requestedState;
      let draft = await this.loadCandidate(tx, previous, snapshot);
      if (requestedState.candidateVersionId !== previous.candidateVersionId) conflict("Candidate ownership is managed by the store.");
      if (requestedCandidate) {
        const affected = [...new Set([previous.chapterId, ...(requestedState.affectedChapterIds ?? []),
          ...validateCandidate(snapshot, requestedCandidate)])];
        await this.ensureActiveBaseline(tx, task, snapshot, source);
        const version = await this.createDraft(tx, previous.novelId, requestedCandidate, next.summary);
        next = { ...next, candidateVersionId: version.id, affectedChapterIds: affected };
        snapshot.candidateHash = hash(requestedCandidate);
        draft = requestedCandidate;
      }
      const raw = await casSeed(tx, task, { ...seed, planningRepair: next, [SNAPSHOT_KEY]: snapshot });
      return { state: next, snapshot, candidate: draft, raw, stale: false };
    });
    Object.assign(session, this.session(result.state, result.snapshot, result.candidate));
    this.seeds.set(session, result.raw);
    if (result.stale) conflict("Planning source changed; the repair is waiting for confirmation.");
    return session;
  }

  /**
   * Give up on this task's repair session.
   *
   * Needed because a session that stopped in `technical_failed` / `uncertain` / `waiting_confirmation`
   * holds the novel's planning-repair lock while offering the same frozen error back however often
   * the user retries. The only existing way out was cancelling the whole director run, which throws
   * away unrelated progress.
   *
   * The workspace is never touched here: no candidate is applied and no chapter changes. What is
   * written is the record that the user gave up, so the decision is auditable rather than silent.
   *
   * Read+CAS rather than `this.current(...)` on purpose: the panel acts on a task id, not on the
   * in-memory session that `current` requires.
   */
  async abandon(input: { taskId: string; reason?: string }): Promise<PlanningRepairState> {
    return transaction(async (tx) => {
      const task = await tx.novelWorkflowTask.findUnique({ where: { id: input.taskId } });
      if (!task) conflict("找不到这次修复所属的任务，可能已经被清理。");
      const seed = parseSeed(task.seedPayloadJson);
      const previous = readState(seed);
      if (!previous) conflict("这次任务没有可以放弃的修复。");
      // Giving up twice is the same intent; it must be idempotent rather than an error.
      if (previous.phase === "abandoned") return previous;
      if (previous.phase === "committed") conflict("这次修复已经应用完成，没有可放弃的内容。");
      if (task.status === "cancelled" || task.status === "succeeded") {
        conflict("这次运行已经结束，它的修复不再占用任何东西。");
      }
      const next: PlanningRepairState = {
        ...previous,
        phase: "abandoned",
        // These two are "a call is in flight" markers. Leaving them set is what kept the panel
        // showing a frozen error after the session had stopped for good.
        pendingOperation: undefined,
        repairOutputPending: undefined,
        // Points at a recovery action that must not be executed once the session is given up.
        recoveryAction: undefined,
        abandonedAt: new Date().toISOString(),
        // Evidence, not enforcement: the next attempt starts with a fresh budget because the two
        // rounds exist to stop the machine retrying on its own, and an explicit give-up is the very
        // intervention they are meant to force. Keeping the count here preserves the audit trail.
        abandonedRounds: previous.rounds,
        ...(input.reason?.trim() ? { abandonReason: input.reason.trim() } : {}),
        summary: "用户已放弃这次修复。计划与正文均未改动。",
      };
      await casSeed(tx, task, { ...seed, planningRepair: next });
      return next;
    });
  }

  async commit(session: RepairSession, candidate: VolumePlanDocument): Promise<VolumePlanDocument> {
    const requested = clone(candidate);
    const result = await transaction(async (tx) => {
      const { task, seed, previous, snapshot } = await this.current(tx, session);
      if (snapshot.committed) conflict("Repair is already committed; reload the active workspace.");
      const source = await readSource(tx, previous.novelId, task);
      if (source.token !== snapshot.snapshotToken) {
        const waiting = { ...previous, phase: "waiting_confirmation" as const, summary: "Planning source changed; commit was not applied." };
        const raw = await casSeed(tx, task, { ...seed, planningRepair: waiting });
        return { stale: true as const, state: waiting, snapshot, raw };
      }
      if (previous.phase !== "ready" || previous.pendingOperation || previous.repairOutputPending || INACTIVE_PHASES.has(previous.phase)) {
        return conflict("Only a ready repair without a pending operation can commit.");
      }
      const affected = [...new Set([previous.chapterId, ...validateCandidate(snapshot, requested)])];
      if (!snapshot.eligibleChapterIds.includes(previous.chapterId)) conflict("The target chapter is protected.");
      this.assertReviewedContracts(previous, requested, affected);
      const mapping = materializedMapping(snapshot.baselineDocument, source.chapters);
      if (affected.some((id) => isLocked(mapping.get(id)))) conflict("A repair chapter is no longer empty and unlocked.");
      const saved = await this.loadCandidate(tx, previous, snapshot);
      if (saved && hash(saved) !== hash(requested)) conflict("Commit must use the saved and reviewed candidate.");
      await this.ensureActiveBaseline(tx, task, snapshot, source);
      const versionId = previous.candidateVersionId
        ?? (await this.createDraft(tx, previous.novelId, requested, previous.summary)).id;
      // Rebuild only derived text; protected planning fields retain their exact representation.
      const derived = buildVolumeWorkspaceDocument(requested);
      const document: VolumePlanDocument = {
        ...requested, derivedOutline: derived.derivedOutline, derivedStructuredOutline: derived.derivedStructuredOutline,
        readiness: derived.readiness, source: "volume", activeVersionId: versionId,
      };
      const materializedIds: string[] = [];
      for (const volume of document.volumes) {
        for (const chapter of volume.chapters) {
          if (!affected.includes(chapter.id)) continue;
          const row = mapping.get(chapter.id);
          if (!row) continue;
          const changed = await tx.chapter.updateMany({
            where: {
              id: row.id, novelId: previous.novelId, order: row.order, updatedAt: row.updatedAt,
              content: row.content, generationState: row.generationState, chapterStatus: row.chapterStatus,
            },
            data: this.chapterContract(chapter),
          });
          if (changed.count !== 1) conflict("Chapter changed while applying the repair contract.");
          materializedIds.push(row.id);
        }
      }
      await tx.volumePlanVersion.updateMany({ where: { novelId: previous.novelId, status: "active" }, data: { status: "frozen" } });
      const activated = await tx.volumePlanVersion.updateMany({
        where: { id: versionId, novelId: previous.novelId, status: "draft" },
        data: { status: "active", contentJson: serializeVolumeWorkspaceDocument(document) },
      });
      if (activated.count !== 1) conflict("Candidate was activated or modified by another writer.");
      await persistActiveVolumeWorkspace(tx, previous.novelId, document, versionId);
      if (materializedIds.length) {
        await tx.storyPlan.updateMany({
          where: { novelId: previous.novelId, level: "chapter", chapterId: { in: materializedIds } },
          data: { status: "stale" },
        });
      }
      const state: PlanningRepairState = { ...previous, phase: "committed", candidateVersionId: versionId,
        affectedChapterIds: affected, summary: `第${previous.chapterOrder}章起的规划已通过复核并保存（${affected.length}章）。` };
      snapshot.candidateHash = hash(document);
      snapshot.committed = true;
      const committedSource = await readSource(tx, previous.novelId, task);
      snapshot.snapshotToken = committedSource.token;
      snapshot.committedPlanHash = committedPlanHash(document);
      snapshot.committedSourceHash = committedSourceHash(committedSource);
      snapshot.writtenSourceFingerprint = writtenSourceFingerprint(committedSource.chapters, previous.chapterOrder);
      snapshot.selectedCandidateFingerprint = hash(seed.candidate ?? null);
      const raw = await casSeed(tx, task, { ...seed, planningRepair: state, [SNAPSHOT_KEY]: snapshot });
      return { stale: false as const, state, snapshot, raw, document };
    });
    Object.assign(session, this.session(result.state, result.snapshot, result.stale ? session.candidate : result.document));
    this.seeds.set(session, result.raw);
    if (result.stale) return conflict("Planning source changed; the repair is waiting for confirmation.");
    batchContextCache.invalidate(result.state.novelId);
    await novelEventBus.emit({ type: "volume:updated", payload: { novelId: result.state.novelId, reason: "chapter_sync" } });
    return result.document;
  }

  private session(state: PlanningRepairState, snapshot: StoredSnapshot, candidate?: VolumePlanDocument): RepairSession {
    return clone({
      taskId: snapshot.taskId, state, baselineDocument: snapshot.baselineDocument,
      eligibleChapterIds: snapshot.eligibleChapterIds, inputFingerprint: snapshot.inputFingerprint,
      snapshotToken: snapshot.snapshotToken, ...(candidate ? { candidate } : {}),
      effectiveDefaultChapterLength: snapshot.effectiveDefaultChapterLength,
    });
  }

  private async current(tx: Prisma.TransactionClient, session: RepairSession) {
    if (!this.seeds.has(session)) return conflict("Unknown repair session; call begin before writing.");
    const task = await readTask(tx, session.taskId, session.state.novelId);
    if (this.owners.get(session) !== hash(executionIdentity(task))) conflict("Repair task ownership changed; reopen the session.");
    const seed = parseSeed(task.seedPayloadJson);
    const expectedSeed = parseSeed(this.seeds.get(session) ?? null);
    if (repairSeedAuthority(seed) !== repairSeedAuthority(expectedSeed)) {
      return conflict("The repair seed or protected generation inputs changed concurrently; reload it.");
    }
    const previous = readState(seed);
    if (!previous || previous.key !== session.state.key) return conflict("Repair session ownership changed.");
    const snapshot = readSnapshot(seed, task.id);
    if (snapshot.snapshotToken !== session.snapshotToken) conflict("Repair snapshot token changed.");
    return { task, seed, previous, snapshot };
  }

  private async loadCandidate(tx: Prisma.TransactionClient, state: PlanningRepairState, snapshot: StoredSnapshot) {
    if (!state.candidateVersionId) return undefined;
    const row = await tx.volumePlanVersion.findFirst({ where: { id: state.candidateVersionId, novelId: state.novelId } });
    if (!row || (row.status !== "draft" && !snapshot.committed)) conflict("Saved repair candidate is no longer a draft.");
    const candidate = JSON.parse(row.contentJson) as VolumePlanDocument;
    if (snapshot.committed && snapshot.committedPlanHash) {
      if (row.status !== "active" || committedPlanHash(candidate) !== snapshot.committedPlanHash) {
        conflict("Saved repair candidate was changed outside this session.");
      }
    } else if (hash(candidate) !== snapshot.candidateHash) conflict("Saved repair candidate was changed outside this session.");
    return candidate;
  }

  private createDraft(tx: Prisma.TransactionClient, novelId: string, document: VolumePlanDocument, summary?: string) {
    return tx.volumePlanVersion.findFirst({ where: { novelId }, orderBy: { version: "desc" } }).then((latest) => (
      tx.volumePlanVersion.create({
        data: { novelId, version: (latest?.version ?? 0) + 1, status: "draft", contentJson: serializeVolumeWorkspaceDocument(document), diffSummary: summary ?? "Planning repair candidate" },
      })
    ));
  }

  private async ensureActiveBaseline(tx: Prisma.TransactionClient, task: NovelWorkflowTask, snapshot: StoredSnapshot, source: Source) {
    if (source.versions.some((version) => version.status === "active")) return;
    const baseline = snapshot.baselineDocument;
    const latest = await tx.volumePlanVersion.findFirst({ where: { novelId: baseline.novelId }, orderBy: { version: "desc" } });
    const version = await tx.volumePlanVersion.create({
      data: {
        novelId: baseline.novelId, version: (latest?.version ?? 0) + 1, status: "active",
        contentJson: serializeVolumeWorkspaceDocument(baseline), diffSummary: "Planning repair baseline",
      },
    });
    const document = { ...baseline, source: "volume" as const, activeVersionId: version.id };
    await tx.volumePlanVersion.update({ where: { id: version.id }, data: { contentJson: serializeVolumeWorkspaceDocument(document) } });
    await persistActiveVolumeWorkspace(tx, baseline.novelId, document, version.id);
    snapshot.snapshotToken = (await readSource(tx, baseline.novelId, task)).token;
  }

  private chapterContract(chapter: VolumeChapterPlan): Prisma.ChapterUpdateManyMutationInput {
    return {
      title: chapter.title, expectation: chapter.summary,
      targetWordCount: chapter.targetWordCount ?? null, conflictLevel: chapter.conflictLevel ?? null,
      revealLevel: chapter.revealLevel ?? null, mustAvoid: chapter.mustAvoid ?? null,
      taskSheet: chapter.taskSheet?.trim() || null, sceneCards: chapter.sceneCards ?? null,
    };
  }

  private assertReviewedContracts(state: PlanningRepairState, document: VolumePlanDocument, affected: string[]) {
    const quality = state.quality;
    if (!record(quality) || !record(quality.chapters) || !record(quality.window)
      || quality.window.usable !== true || quality.window.safeToSync !== true
      || quality.window.requiresUserDecision !== false || !Array.isArray(quality.window.issues)
      || quality.window.issues.length !== 0) {
      conflict("Commit requires a saved, successful joint-window review.");
    }
    for (const id of affected) {
      const review = quality.chapters[id];
      if (!record(review) || review.status !== "passed" || review.verdict !== "usable" || review.safeToSync !== true) {
        conflict(`Commit requires a saved, successful chapter review for ${id}.`);
      }
      const chapter = document.volumes.flatMap((v) => v.chapters).find((c) => c.id === id)!;
      const shape = assessChapterExecutionContractShape({ ...chapter, novelId: state.novelId, chapterId: id });
      if (!shape.canEnterExecution) conflict(`Chapter ${id} has an invalid execution contract.`);
    }
  }
}

export const planningRepairStore = new PlanningRepairStore();
