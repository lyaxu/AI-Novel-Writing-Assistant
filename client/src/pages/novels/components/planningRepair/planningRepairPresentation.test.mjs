import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./planningRepairPresentation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { planningRepairHistory, planningRepairIssues } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("history exposes concise model reasons with original round labels, never raw JSON", () => {
  assert.deepEqual(planningRepairHistory([
    { round: 1, kind: "repair", output: { reason: "Move reveal to next chapter", changes: [{ secret: "huge" }] } },
    { round: 1, kind: "review", result: { window: { summary: "Continuity still fails" } } },
    { round: 0, kind: "assessment", result: { chapters: { first: { summary: "Too much work in one chapter" } } } },
    { kind: "unknown", payload: "Ignore" }, null,
  ]), [
    { round: 1, kind: "repair", summary: "Move reveal to next chapter" },
    { round: 1, kind: "review", summary: "Continuity still fails" },
    { round: 0, kind: "assessment", summary: "Too much work in one chapter" },
  ]);
});

test("quality displays three distinct concrete issues safely", () => {
  assert.deepEqual(planningRepairIssues({
    window: { issues: ["Overlap", "Overlap"] },
    chapters: { first: { issues: [{ summary: "Missing entry" }, { summary: "Too many obligations" }, { summary: "Fourth" }] } },
  }), ["Overlap", "Missing entry", "Too many obligations"]);
  assert.deepEqual(planningRepairIssues(null), []);
});

test("only new paid grants require confirmation and the panel stays on source workspace", () => {
  const panel = readFileSync(new URL("./PlanningRepairPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /!status\.recoveryRequest && !window\.confirm/);
  assert.match(panel, /模型调用费用/);
  assert.doesNotMatch(panel, /workspaceTaskId/);
});
