const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../src/services/novel/volume/planningPromises/planningHorizon.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsValue = {};
vm.runInThisContext(`(function(exports){${code}\n})`, { filename })(exportsValue);
const { projectPlanningHorizon } = exportsValue;

test("later real routes and unexpanded beat plans remain visible without authorizing their modification", () => {
  const workspace = { volumes: [{ id: "v", chapters: [1, 2, 3, 6].map(order => ({ id: `c${order}`, chapterOrder: order, title: `Chapter ${order}` })) },
    { id: "other", chapters: [{ id: "c8", chapterOrder: 8 }] }],
    beatSheets: [{ volumeId: "v", beats: [{ key: "first_escalation", chapterSpanHint: "4-7", mustDeliver: ["exchange supplies for evidence"] }] }] };
  const original = JSON.stringify(workspace);
  const result = projectPlanningHorizon(workspace, "v", ["c2", "c3"]);
  assert.deepEqual(result.readonlyOpeningRoutes.map(chapter => chapter.id), ["c1", "c6"]);
  assert.equal(result.readonlyPlanningHorizon.beats[0].mustDeliver[0], "exchange supplies for evidence");
  assert.equal(result.readonlyPlanningHorizon.authority, "readonly_planning_not_prose");
  assert.equal(result.readonlyPlanningHorizon.coverage.omittedRouteCount, 0);
  assert.equal(JSON.stringify(workspace), original);
});

test("bounded route coverage declares omissions while retaining all actual beat promises", () => {
  const workspace = { volumes: [{ id: "v", chapters: Array.from({ length: 60 }, (_, i) => ({ id: `c${i + 1}`, chapterOrder: i + 1 })) }],
    beatSheets: [{ volumeId: "v", beats: [{ key: "end_hook", chapterSpanHint: "55-60", mustDeliver: ["settle the original debt"] }] }] };
  const result = projectPlanningHorizon(workspace, "v", ["c30"]);
  assert.equal(result.readonlyOpeningRoutes.length, 24);
  assert.equal(result.readonlyPlanningHorizon.coverage.omittedRouteCount, 35);
  assert.equal(result.readonlyPlanningHorizon.beats[0].mustDeliver[0], "settle the original debt");
  assert.equal(result.readonlyOpeningRoutes.some(chapter => chapter.id === "c30"), false);
});
