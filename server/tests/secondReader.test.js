const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/db/prisma.js");
const runner = require("../dist/prompting/core/promptRunner.js");
const { SecondReaderService } = require("../dist/services/novel/secondReader/SecondReaderService.js");

function mockMethod(t, target, name, implementation) {
  const original = target[name];
  const mocked = t.mock.fn(implementation);
  target[name] = mocked;
  t.after(() => { target[name] = original; });
  return mocked;
}

function setup(t) {
  const calls = [];
  mockMethod(t, prisma.appSetting, "findUnique", async () => ({ value: JSON.stringify({
    provider: "custom_claude_openlux", model: "claude-opus-5-5", temperature: 0.3,
  }) }));
  mockMethod(t, prisma.novel, "findUnique", async () => ({ title: "Test", description: "Idea" }));
  mockMethod(t, prisma.chapter, "findMany", async (query) => {
    calls.push(query);
    return [{ order: 1, title: "One", content: "Opening" }, { order: 2, title: "Two", content: "Continuation" }];
  });
  const invoke = t.mock.method(runner, "runTextPrompt", async () => ({ output: " Reading notes " }));
  for (const model of [prisma.novel, prisma.chapter, prisma.appSetting]) {
    for (const method of ["create", "update", "upsert", "delete", "updateMany", "deleteMany"]) {
      mockMethod(t, model, method, () => { throw new Error("Second reader must not mutate data"); });
    }
  }
  return { service: new SecondReaderService(), calls, invoke };
}

test("second reader uses its explicit model and complete selected chapters", async (t) => {
  const { service, calls, invoke } = setup(t);
  const result = await service.read("novel-1", 1, 2);
  assert.equal(result.text, "Reading notes");
  assert.equal(result.model, "claude-opus-5-5");
  assert.deepEqual(calls[0].where, { novelId: "novel-1", order: { gte: 1, lte: 2 } });
  const input = invoke.mock.calls[0].arguments[0];
  assert.equal(input.options.provider, "custom_claude_openlux");
  assert.equal(input.options.model, "claude-opus-5-5");
  assert.equal(input.options.temperature, 0.3);
  assert.match(input.promptInput.chapters, /Opening/);
  assert.match(input.promptInput.chapters, /Continuation/);
  assert.equal(input.asset.id, "novel.second_reader");
});

test("invalid ranges do not invoke a paid model", async (t) => {
  const { service, invoke } = setup(t);
  for (const [start, end] of [[0, 2], [3, 2], [1.5, 2]]) {
    await assert.rejects(service.read("novel-1", start, end));
  }
  assert.equal(invoke.mock.callCount(), 0);
});

test("invalid saved settings do not silently select the production model", async (t) => {
  const { service, invoke } = setup(t);
  prisma.appSetting.findUnique.mock.mockImplementation(async () => ({ value: "invalid" }));
  await assert.rejects(service.read("novel-1", 1, 2), /配置第二读者/);
  assert.equal(invoke.mock.callCount(), 0);
});

test("missing or blank chapters are rejected instead of reviewing a partial range", async (t) => {
  const { service, invoke } = setup(t);
  prisma.chapter.findMany.mock.mockImplementation(async () => [{ order: 1, title: "One", content: "Text" }]);
  await assert.rejects(service.read("novel-1", 1, 2), /缺失/);
  prisma.chapter.findMany.mock.mockImplementation(async () => [{ order: 1, title: "One", content: " " }]);
  await assert.rejects(service.read("novel-1", 1, 1), /未完成/);
  assert.equal(invoke.mock.callCount(), 0);
});

test("oversized input is rejected without truncation or a paid call", async (t) => {
  const { service, invoke } = setup(t);
  prisma.chapter.findMany.mock.mockImplementation(async () => [{ order: 1, title: "One", content: "a".repeat(80001) }]);
  await assert.rejects(service.read("novel-1", 1, 1), /超过8万/);
  assert.equal(invoke.mock.callCount(), 0);
});

test("provider failures and empty reports remain failures", async (t) => {
  const { service, invoke } = setup(t);
  invoke.mock.mockImplementation(async () => { throw new Error("upstream disconnected"); });
  await assert.rejects(service.read("novel-1", 1, 2), /upstream disconnected/);
  invoke.mock.mockImplementation(async () => ({ output: " " }));
  await assert.rejects(service.read("novel-1", 1, 2), /未返回意见/);
});

test("HTTP reader validates ranges, rejects duplicate calls and releases failures", async (t) => {
  const express = require("express");
  const router = require("../dist/services/novel/secondReader/http/secondReaderRoutes.js").default;
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const read = t.mock.method(SecondReaderService.prototype, "read", async () => {
    started();
    return new Promise((resolve, reject) => { release = () => reject(new Error("test failure")); });
  });
  const app = express();
  app.use(express.json());
  app.use("/reader", router);
  app.use((error, req, res, next) => { res.status(error.name === "ZodError" ? 400 : error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/reader/novel-1`;
  const post = (startOrder, endOrder) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startOrder, endOrder }),
  });
  const invalid = await post(3, 1);
  assert.equal(invalid.status, 400);
  assert.equal(read.mock.callCount(), 0);
  const pending = post(1, 2);
  await entered;
  try {
    assert.equal((await post(1, 2)).status, 409);
    assert.equal(read.mock.callCount(), 1);
  } finally { release(); }
  assert.equal((await pending).status, 500);
  read.mock.mockImplementation(async () => ({ text: "Notes" }));
  const retried = await post(1, 2);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).data.text, "Notes");
});
