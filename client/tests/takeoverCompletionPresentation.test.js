import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
// Render the actual presentation components without a browser or application services.
function load(file, imports) {
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", source)(id => {
    if (Object.hasOwn(imports, id)) return imports[id];
    if (id === "react/jsx-runtime") return require(id);
    throw new Error(`Unexpected component dependency ${id}`);
  }, exports);
  return exports;
}
const cn = (...values) => values.filter(Boolean).join(" ");
const progress = load("../src/components/workflow/WorkflowProgressBar.tsx", {
  "@/lib/utils": { cn },
  "framer-motion": { motion: { div: () => React.createElement("i", { "data-running-sweep": true }) } },
});
const { default: Takeover } = load("../src/components/workflow/AITakeoverContainer.tsx", {
  "@/lib/utils": { cn }, "./WorkflowProgressBar": progress,
  "@/components/ui/badge": { Badge: ({ children }) => React.createElement("span", null, children) },
  "@/components/ui/button": { Button: ({ children }) => React.createElement("button", null, children) },
});

test("completed takeover renders a static completed result rather than a running or waiting signal", () => {
  const html = renderToStaticMarkup(React.createElement(Takeover, {
    mode: "completed", title: "本轮完成", description: "第 1—3 章完成", progress: 100,
    actions: [{ label: "完成并收起", onClick: () => assert.fail("Render cannot mutate tasks") }],
  }));
  assert.match(html, /本轮已完成/); assert.match(html, /100%/); assert.match(html, /完成并收起/);
  assert.doesNotMatch(html, /实时推进中|AI 接管中|等待你确认|animate-ping|data-running-sweep/);
});

test("running progress remains live even at 100 percent and a manual pause stays a pause", () => {
  const render = mode => renderToStaticMarkup(React.createElement(Takeover, { mode, title: "验收", description: "", progress: 100 }));
  assert.match(render("running"), /实时推进中/); assert.match(render("running"), /data-running-sweep/);
  assert.match(render("waiting"), /等待你确认/); assert.doesNotMatch(render("waiting"), /data-running-sweep|本轮已完成/);
});
