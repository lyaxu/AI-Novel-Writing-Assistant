import type { NovelWorkflowTask, Prisma, PrismaClient } from "@prisma/client";

const REPAIR_SEED_KEYS = [
  "planningRepair", "planningRepairSnapshot", "planningRepairRecovery", "planningRepairRecoveryRequests",
] as const;

const REPAIR_LIFECYCLE_FIELDS = [
  "status", "pendingManualRecovery", "checkpointType", "checkpointSummary", "resumeTargetJson",
  "currentStage", "currentItemKey", "currentItemLabel", "progress", "lastError", "finishedAt",
  "startedAt", "heartbeatAt", "cancelRequestedAt", "attemptCount",
] as const;

type UpdateData = Prisma.NovelWorkflowTaskUpdateArgs["data"];
type Seed = Record<string, unknown>;

function parseSeed(value: string | null): Seed | null {
  if (value === null) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Seed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Seed {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Ordinary progress writers cannot create, roll back or erase repair-owned state. */
export function guardPlanningRepairWorkflowUpdate(current: NovelWorkflowTask, desired: UpdateData): UpdateData {
  const data = { ...desired };
  const currentSeed = parseSeed(current.seedPayloadJson);
  const repair = currentSeed?.planningRepair;
  const waiting = isRecord(repair) && ["waiting_confirmation", "uncertain"].includes(String(repair.phase));
  const hasRepair = currentSeed !== null && REPAIR_SEED_KEYS.some(key => Object.hasOwn(currentSeed, key));
  const cancelled = hasRepair && (current.status === "cancelled" || current.cancelRequestedAt !== null);
  const desiredStatus = typeof data.status === "string" ? data.status : data.status?.set;
  if ((waiting || cancelled) && desiredStatus !== "cancelled") {
    for (const field of REPAIR_LIFECYCLE_FIELDS) delete data[field];
  }
  // Even a repeated cancellation cannot clear an already persisted cancellation request.
  if (cancelled && current.cancelRequestedAt !== null) data.cancelRequestedAt = current.cancelRequestedAt;

  const seedWrite = data.seedPayloadJson;
  const desiredRaw = typeof seedWrite === "object" && seedWrite !== null ? seedWrite.set : seedWrite;
  if (desiredRaw === undefined) return data;
  if (currentSeed === null) {
    throw new Error("Cannot replace an unreadable workflow seed; repair ownership must be recovered first.");
  }
  const desiredSeed = parseSeed(desiredRaw);
  if (desiredSeed === null) {
    if (hasRepair) throw new Error("Cannot replace planning repair state with an invalid workflow seed.");
    return data;
  }
  const hasDesiredRepair = REPAIR_SEED_KEYS.some(key => Object.hasOwn(desiredSeed, key));
  if (!hasRepair && !hasDesiredRepair) return data;
  for (const key of REPAIR_SEED_KEYS) {
    if (Object.hasOwn(currentSeed, key)) desiredSeed[key] = currentSeed[key];
    else delete desiredSeed[key];
  }
  if (waiting || cancelled) {
    if (Object.hasOwn(currentSeed, "resumeTarget")) desiredSeed.resumeTarget = currentSeed.resumeTarget;
    else delete desiredSeed.resumeTarget;
  }
  const merged = JSON.stringify(desiredSeed);
  data.seedPayloadJson = typeof seedWrite === "object" && seedWrite !== null ? { set: merged } : merged;
  return data;
}

/** Retry the entire transaction, not just its update, so a retry always merges against the latest seed. */
export function updateWorkflowTaskWithPlanningRepairGuard(
  client: Pick<PrismaClient, "$transaction">,
  args: Prisma.NovelWorkflowTaskUpdateArgs,
) {
  return client.$transaction(async (tx) => {
    const before = await tx.novelWorkflowTask.findUniqueOrThrow({
      where: args.where,
      include: { novel: { select: { title: true } } },
    });
    const after = await tx.novelWorkflowTask.update({
      ...args,
      data: guardPlanningRepairWorkflowUpdate(before, args.data),
    });
    return { before, after };
  }, { isolationLevel: "Serializable" });
}
