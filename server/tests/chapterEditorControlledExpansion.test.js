const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPresetIntent } = require("../dist/services/novel/chapterEditor/chapterEditorShared.js");

const intent = (operation, custom) => buildPresetIntent(operation, ["保留当前剧情事实"], custom);
const joined = (value) => (value.mustAvoid ?? []).join("\n");

test("expansion may add detail but must not add events the plan never agreed to", () => {
  const avoid = joined(intent("expand"));
  assert.match(avoid, /不得新增人物、场景、支线或伏笔/);
  assert.match(avoid, /不得让剧情向前推进/);
  assert.match(avoid, /不得提前兑现后续章节的安排/);
  // The pre-existing baseline constraints must survive the override.
  assert.match(avoid, /不要破坏上下文承接/);
  assert.match(avoid, /保留当前剧情事实|不要改写出模板化 AI 腔/);
});

test("expansion keeps the quiet, non-advancing register it is for", () => {
  const value = intent("expand");
  assert.match(value.editGoal, /补足细节/);
  assert.match(value.paceAdjustment, /略微放慢/);
});

test("compression must not buy pace by dropping what the chapter exists to deliver", () => {
  const avoid = joined(intent("compress"));
  assert.match(avoid, /不得删除已发生的事件、关键选择或其后果/);
  assert.match(avoid, /不得为了让篇幅变短而省略因果桥/);
  assert.match(avoid, /不得把细腻的心理与关系变化压成流水账/);
  assert.match(avoid, /不要破坏上下文承接/);
});

test("the two directions are not interchangeable", () => {
  // A shared constraint set would mean one of the two directions is unguarded.
  assert.notDeepEqual(intent("expand").mustAvoid, intent("compress").mustAvoid);
  assert.ok(!joined(intent("expand")).includes("不得删除已发生的事件"));
  assert.ok(!joined(intent("compress")).includes("不得新增人物、场景、支线或伏笔"));
});

test("other operations keep the original, narrower constraint set", () => {
  for (const operation of ["polish", "emotion", "conflict"]) {
    const avoid = joined(intent(operation));
    assert.ok(!avoid.includes("不得新增人物、场景、支线或伏笔"), `${operation} should not inherit expansion rules`);
    assert.ok(avoid.length > 0);
  }
});
