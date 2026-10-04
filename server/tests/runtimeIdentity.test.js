const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateStaleness, describeRuntimeIdentity } = require("../dist/runtime/runtimeIdentity.js");

const STARTED = 1_000_000;
const stamp = (name, mtimeMs) => ({ file: `D:/ws/server/src/${name}`, mtimeMs });

test("a process whose sources are all older than it is fresh", () => {
  const result = evaluateStaleness(STARTED, [stamp("a.ts", STARTED - 5000), stamp("b.ts", STARTED - 1)], "D:/ws");
  assert.equal(result.stale, false);
  assert.deepEqual(result.newerSources, []);
});

test("a source edited after the process started makes it stale and names the file", () => {
  // This is the case that used to be invisible: the fix is on disk, the process is still old.
  const result = evaluateStaleness(STARTED, [
    stamp("old.ts", STARTED - 100),
    stamp("planner/payoff/index.ts", STARTED + 60_000),
  ], "D:/ws");
  assert.equal(result.stale, true);
  assert.equal(result.newerSources.length, 1);
  // Separator differs by platform; the suffix is what identifies the file.
  assert.match(result.newerSources[0].replace(/\\/g, "/"), /^server\/src\/planner\/payoff\/index\.ts$/);
});

test("a file edited in the same millisecond the process started is not treated as stale", () => {
  // The boundary matters: a respawn triggered by the edit itself must not report itself as stale.
  const result = evaluateStaleness(STARTED, [stamp("just-reloaded.ts", STARTED)], "D:/ws");
  assert.equal(result.stale, false);
});

test("every changed file is counted, but only a few are named", () => {
  const files = Array.from({ length: 12 }, (_, index) => stamp(`f${index}.ts`, STARTED + 1000 + index));
  const result = evaluateStaleness(STARTED, files, "D:/ws");
  assert.equal(result.stale, true);
  assert.equal(result.newerSources.length, 5, "the list is capped so the message stays readable");
  // Most recently changed first.
  assert.match(result.newerSources[0], /f11\.ts$/);
});

test("an empty source tree reports unknown rather than a false all-clear", () => {
  const result = evaluateStaleness(STARTED, [], "D:/ws");
  assert.equal(result.newestSourceMtime, null);
  assert.equal(result.stale, false);
});

test("the human message says which state the server is in", () => {
  const fresh = describeRuntimeIdentity({
    pid: 1, startedAt: "2026-10-04T11:41:56.800Z", nodeVersion: "v24", executionMode: "source",
    newestSourceMtime: "2026-10-04T11:41:52.435Z", newerSources: [], stale: false, gitHead: "abc123",
  });
  assert.match(fresh, /已加载最新代码/);
  assert.match(fresh, /abc123/);

  const stale = describeRuntimeIdentity({
    pid: 1, startedAt: "2026-10-04T11:41:56.800Z", nodeVersion: "v24", executionMode: "source",
    newestSourceMtime: null, newerSources: ["server/src/a.ts", "server/src/b.ts"], stale: true, gitHead: null,
  });
  assert.match(stale, /正在运行旧代码/);
  assert.match(stale, /需重启/);
  assert.match(stale, /server\/src\/a\.ts/);
});
