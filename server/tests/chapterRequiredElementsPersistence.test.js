const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeChapterScenePlan,
  serializeChapterScenePlan,
  parseChapterScenePlan,
} = require("../../shared/dist/types/chapterLengthControl.js");

const scene = (index) => ({
  key: `scene-${index}`,
  title: `场景 ${index}`,
  purpose: "推动当前章任务",
  mustAdvance: ["推进一件事"],
  mustPreserve: [],
  entryState: "进入场景",
  exitState: "离开场景",
  forbiddenExpansion: [],
  targetWordCount: 900,
  resistance: "有人阻拦",
  turn: "局面转向",
  emotionalShift: "由紧到松",
  readerValue: "拿到一条线索",
});

const rawPlan = (extra = {}) => ({
  targetWordCount: 2800,
  scenes: [scene(1), scene(2), scene(3)],
  readerExperience: {},
  ...extra,
});

test("chapter requiredElements survive normalize, serialize and re-parse", () => {
  const elements = [
    "假丘处机在城外验货时露出北方口音破绽",
    "劳梓凡把药包交到黄蓉手上并拿到回执",
    "系统在收件人一栏闪出「来源异常追溯中」",
  ];
  const plan = normalizeChapterScenePlan(rawPlan({ requiredElements: elements }), 2800);
  assert.deepEqual(plan.requiredElements, elements);

  // The persistence boundary is the serialized plan string stored in the chapter row.
  const stored = serializeChapterScenePlan(plan);
  assert.ok(stored.includes("requiredElements"));

  const reparsed = parseChapterScenePlan(stored, { targetWordCount: 2800 });
  assert.ok(reparsed);
  assert.deepEqual(reparsed.requiredElements, elements);

  // Without a target word count the stored string must still round-trip.
  const plain = parseChapterScenePlan(stored);
  assert.ok(plain);
  assert.deepEqual(plain.requiredElements, elements);
});

test("legacy stored plans without requiredElements still parse, defaulting to empty", () => {
  const plan = normalizeChapterScenePlan(rawPlan(), 2800);
  assert.deepEqual(plan.requiredElements, []);

  const legacy = JSON.stringify({
    targetWordCount: 2800,
    lengthBudget: plan.lengthBudget,
    scenes: plan.scenes,
    readerExperience: plan.readerExperience,
  });
  const reparsed = parseChapterScenePlan(legacy, { targetWordCount: 2800 });
  assert.ok(reparsed, "a stored plan predating the field must not become unparseable");
  assert.deepEqual(reparsed.requiredElements, []);
});

test("malformed entries are sanitized instead of making a valid plan unparseable", () => {
  const plan = normalizeChapterScenePlan(rawPlan({
    requiredElements: ["有效事件", "", "   ", 42, null, "x".repeat(200), "另一条有效事件"],
  }), 2800);
  assert.deepEqual(plan.requiredElements, ["有效事件", "另一条有效事件"]);
});

test("the list is bounded so a runaway model output cannot bloat storage", () => {
  const plan = normalizeChapterScenePlan(rawPlan({
    requiredElements: Array.from({ length: 30 }, (_, i) => `事件 ${i + 1}`),
  }), 2800);
  assert.equal(plan.requiredElements.length, 8);
});
