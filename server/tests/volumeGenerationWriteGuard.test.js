const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/db/prisma.js");
const { NovelVolumeService, createVolumeGenerationWriteGuard } = require("../dist/services/novel/volume/NovelVolumeService.js");
const { VolumeChapterSyncService } = require("../dist/services/novel/volume/VolumeChapterSyncService.js");
const generation = require("../dist/services/novel/volume/volumeGenerationOrchestrator.js");
const { buildVolumeWorkspaceDocument } = require("../dist/services/novel/volume/volumeWorkspaceDocument.js");

function createHarness() {
  const originals = {
    workflow: prisma.novelWorkflowTask.findUnique,
    job: prisma.generationJob.findUnique,
    transaction: prisma.$transaction,
    chapters: prisma.chapter.findMany,
    generate: generation.generateVolumePlanDocument,
  };
  const workflow = { id: "task-1", novelId: "novel-1", status: "running", attemptCount: 1,
    startedAt: new Date(1000), cancelRequestedAt: null, pendingManualRecovery: false,
    seedPayloadJson: JSON.stringify({ autoExecution: { pipelineJobId: "job-1" } }) };
  const job = { id: "job-1", novelId: "novel-1", status: "running", startedAt: new Date(2000),
    cancelRequestedAt: null, pendingManualRecovery: false, executionOwner: "worker-1",
    executionLeaseExpiresAt: new Date("2099-01-01") };
  prisma.novelWorkflowTask.findUnique = async () => ({ ...workflow });
  prisma.generationJob.findUnique = async () => ({ ...job });
  prisma.$transaction = async (callback) => callback(prisma);
  prisma.chapter.findMany = async () => [];
  return {
    workflow, job,
    restore() {
      prisma.novelWorkflowTask.findUnique = originals.workflow;
      prisma.generationJob.findUnique = originals.job;
      prisma.$transaction = originals.transaction;
      prisma.chapter.findMany = originals.chapters;
      generation.generateVolumePlanDocument = originals.generate;
    },
  };
}

for (const change of ["cancel", "new_attempt", "lease_transfer", "lease_expired"]) {
  test(`volume generation write fence rejects ${change} after the request starts`, async () => {
    const harness = createHarness();
    try {
      const guard = await createVolumeGenerationWriteGuard("novel-1", "task-1");
      if (change === "cancel") harness.workflow.cancelRequestedAt = new Date();
      if (change === "new_attempt") harness.workflow.attemptCount += 1;
      if (change === "lease_transfer") harness.job.executionOwner = "worker-2";
      if (change === "lease_expired") harness.job.executionLeaseExpiresAt = new Date(0);
      await assert.rejects(() => guard(prisma), { code: "PIPELINE_CANCELLED" });
    } finally { harness.restore(); }
  });
}

test("a cancelled chapter-list response cannot save its intermediate document or materialize chapters", async () => {
  const harness = createHarness();
  const workspace = buildVolumeWorkspaceDocument({ novelId: "novel-1", volumes: [], beatSheets: [] });
  const service = new NovelVolumeService();
  let versionWrites = 0;
  let materializations = 0;
  service.ensureVolumeWorkspace = async () => workspace;
  service.ensureActiveVersionRecord = async () => { versionWrites += 1; throw new Error("must not write"); };
  generation.generateVolumePlanDocument = async ({ options }) => {
    harness.workflow.status = "cancelled";
    harness.workflow.cancelRequestedAt = new Date();
    await options.onIntermediateDocument({ scope: "chapter_list", isFinal: true, document: workspace });
    return workspace;
  };
  try {
    await assert.rejects(async () => {
      await service.generateVolumes("novel-1", { taskId: "task-1", scope: "chapter_list", entrypoint: "jit_route_window" });
      materializations += 1;
    }, { code: "PIPELINE_CANCELLED" });
    assert.equal(versionWrites, 0);
    assert.equal(materializations, 0);
  } finally { harness.restore(); }
});

test("cancellation after generation but before sync prevents late chapter materialization", async () => {
  const harness = createHarness();
  const workspace = buildVolumeWorkspaceDocument({ novelId: "novel-1", volumes: [], beatSheets: [] });
  let materializationWrites = 0;
  const service = new VolumeChapterSyncService({
    ensureVolumeWorkspace: async () => workspace,
    ensureActiveVersionRecord: async () => { materializationWrites += 1; throw new Error("must not write"); },
    emitVolumeUpdated: () => {}, syncPayoffLedger: () => {},
  });
  try {
    const guard = await createVolumeGenerationWriteGuard("novel-1", "task-1");
    harness.job.status = "cancelled";
    await assert.rejects(() => service.syncVolumeChaptersWithOptions("novel-1", {
      volumes: [], preserveContent: true, applyDeletes: false, allowIncompleteExecutionContracts: true,
    }, { writeGuard: guard }), { code: "PIPELINE_CANCELLED" });
    assert.equal(materializationWrites, 0);
  } finally { harness.restore(); }
});

test("an unchanged active execution may persist and an unowned manual request remains supported", async () => {
  const harness = createHarness();
  try {
    const guard = await createVolumeGenerationWriteGuard("novel-1", "task-1");
    await guard(prisma);
    assert.equal(await createVolumeGenerationWriteGuard("novel-1"), undefined);
  } finally { harness.restore(); }
});
