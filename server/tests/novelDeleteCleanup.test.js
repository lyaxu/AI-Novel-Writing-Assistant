const test = require("node:test");
const assert = require("node:assert/strict");

const { NovelCoreCrudService } = require("../dist/services/novel/novelCoreCrudService.js");
const { prisma } = require("../dist/db/prisma.js");
const { ragServices } = require("../dist/services/rag/index.js");

test("deleteNovel removes all linked novel tasks and their archive markers before deleting the novel", async () => {
  const originalTransaction = prisma.$transaction;
  const originalEnqueueDelete = ragServices.ragIndexService.enqueueDelete;
  const calls = [];

  const transaction = {
    directorRuntimeInstance: { deleteMany: async () => {} },
    directorEvent: { deleteMany: async () => {} },
    directorLlmUsageRecord: { deleteMany: async () => {} },
    autoDirectorFollowUpActionLog: { deleteMany: async () => {} },
    autoDirectorFollowUpNotificationLog: { deleteMany: async () => {} },
    novelWorkflowTask: {
      findMany: async (query) => {
        calls.push(["findFailedTasks", query]);
        return [{ id: "failed_task_1" }, { id: "failed_task_2" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteFailedTasks", query]);
        return { count: 2 };
      },
    },
    agentRun: {
      findMany: async (query) => {
        calls.push(["findFailedAgentRuns", query]);
        return [{ id: "failed_agent_1" }];
      },
      deleteMany: async (query) => {
        calls.push(["deleteFailedAgentRuns", query]);
        return { count: 1 };
      },
    },
    generationJob: {
      findMany: async (query) => {
        calls.push(["findFailedPipelineJobs", query]);
        return [{ id: "failed_pipeline_1" }];
      },
    },
    imageGenerationTask: {
      findMany: async (query) => {
        calls.push(["findFailedImageTasks", query]);
        return [{ id: "failed_image_1" }];
      },
    },
    taskCenterArchive: {
      deleteMany: async (query) => {
        calls.push(["deleteArchiveMarkers", query]);
        return { count: 1 };
      },
    },
    novel: {
      delete: async (query) => {
        calls.push(["deleteNovel", query]);
        return { id: "novel_1" };
      },
    },
  };

  prisma.$transaction = async (callback) => callback(transaction);
  ragServices.ragIndexService.enqueueDelete = async (ownerType, ownerId) => {
    calls.push(["queueRagDelete", { ownerType, ownerId }]);
  };

  try {
    await new NovelCoreCrudService().deleteNovel("novel_1");

    assert.deepEqual(calls, [
      ["findFailedTasks", {
        where: { novelId: "novel_1" },
        select: { id: true },
      }],
      ["findFailedAgentRuns", {
        where: { novelId: "novel_1" },
        select: { id: true },
      }],
      ["findFailedPipelineJobs", {
        where: { novelId: "novel_1" },
        select: { id: true },
      }],
      ["findFailedImageTasks", {
        where: { novelId: "novel_1" },
        select: { id: true },
      }],
      ["deleteArchiveMarkers", {
        where: {
          OR: [
            { taskKind: "novel_workflow", taskId: { in: ["failed_task_1", "failed_task_2"] } },
            { taskKind: "agent_run", taskId: { in: ["failed_agent_1"] } },
            { taskKind: "novel_pipeline", taskId: { in: ["failed_pipeline_1"] } },
            { taskKind: "image_generation", taskId: { in: ["failed_image_1"] } },
          ],
        },
      }],
      ["deleteFailedTasks", {
        where: { id: { in: ["failed_task_1", "failed_task_2"] } },
      }],
      ["deleteFailedAgentRuns", {
        where: { id: { in: ["failed_agent_1"] } },
      }],
      ["deleteNovel", { where: { id: "novel_1" } }],
      ["queueRagDelete", { ownerType: "novel", ownerId: "novel_1" }],
      ["queueRagDelete", { ownerType: "bible", ownerId: "novel_1" }],
    ]);
  } finally {
    prisma.$transaction = originalTransaction;
    ragServices.ragIndexService.enqueueDelete = originalEnqueueDelete;
  }
});

test("deleteNovel cleans every status but preserves unrelated novels and unbound drafts", async () => {
  const originalTransaction = prisma.$transaction;
  const originalEnqueueDelete = ragServices.ragIndexService.enqueueDelete;
  const statuses = ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"];
  const makeRows = () => [...statuses.map((status) => ({ id: status, status, novelId: "deleted" })),
    { id: "draft", status: "queued", novelId: null },
    { id: "other", status: "running", novelId: "other" }];
  const workflows = makeRows();
  const agents = makeRows();
  const archives = [];
  const runtimeDeletes = [];
  const followUpDeletes = [];
  const model = (rows) => ({
    findMany: async ({ where }) => rows.filter((r) => r.novelId === where.novelId && (!where.status || r.status === where.status)),
    deleteMany: async ({ where }) => {
      for (let i = rows.length - 1; i >= 0; i--) if (where.id.in.includes(rows[i].id)) rows.splice(i, 1);
    },
  });
  prisma.$transaction = async (fn) => fn({
    directorRuntimeInstance: { deleteMany: async (q) => runtimeDeletes.push(q) },
    directorEvent: { deleteMany: async (q) => assert.deepEqual(q.where, { novelId: "deleted" }) },
    directorLlmUsageRecord: { deleteMany: async (q) => assert.deepEqual(q.where, { novelId: "deleted" }) },
    autoDirectorFollowUpActionLog: { deleteMany: async (q) => followUpDeletes.push(q) },
    autoDirectorFollowUpNotificationLog: { deleteMany: async (q) => followUpDeletes.push(q) },
    novelWorkflowTask: model(workflows), agentRun: model(agents),
    generationJob: model(makeRows()), imageGenerationTask: model(makeRows()),
    taskCenterArchive: { deleteMany: async (q) => archives.push(q) },
    novel: { delete: async ({ where }) => assert.equal(where.id, "deleted") },
  });
  ragServices.ragIndexService.enqueueDelete = async () => {};
  try {
    await new NovelCoreCrudService().deleteNovel("deleted");
    assert.deepEqual(workflows.map((r) => r.id), ["draft", "other"]);
    assert.deepEqual(agents.map((r) => r.id), ["draft", "other"]);
    for (const q of archives[0].where.OR) assert.deepEqual(q.taskId.in, statuses);
    assert.deepEqual(runtimeDeletes[0].where, { OR: [{ novelId: "deleted" }, { workflowTaskId: { in: statuses } }] });
    for (const q of followUpDeletes) assert.deepEqual(q.where, { taskId: { in: statuses } });
  } finally {
    prisma.$transaction = originalTransaction;
    ragServices.ragIndexService.enqueueDelete = originalEnqueueDelete;
  }
});
