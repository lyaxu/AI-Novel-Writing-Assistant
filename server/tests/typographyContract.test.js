const test = require("node:test");
const assert = require("node:assert/strict");

const { CHAPTER_TYPOGRAPHY_RULES, CHAPTER_TYPOGRAPHY_AUDIT_RULES } = require("../dist/prompting/prompts/novel/context/typography.js");
const { chapterWriterPrompt } = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const { chapterAcceptanceAssessmentPrompt } = require("../dist/prompting/prompts/novel/chapterAcceptance.prompts.js");
const { chapterReviewPrompt, chapterRepairPrompt } = require("../dist/prompting/prompts/novel/review.prompts.js");

const systemText = (rendered) => rendered
  .filter((message) => message.constructor?.name === "SystemMessage" || (message.lc_namespace ?? []).includes("system"))
  .map((message) => (typeof message.content === "string" ? message.content : ""))
  .join("\n");

test("typography contract states concrete paragraph limits instead of vague advice", () => {
  assert.ok(CHAPTER_TYPOGRAPHY_RULES.length > 0);
  const joined = CHAPTER_TYPOGRAPHY_RULES.join("\n");
  // The numbers are the point: without them the rule is unenforceable by the model.
  assert.match(joined, /40-120/);
  assert.match(joined, /160/);
  assert.match(joined, /空一行/);
  assert.match(joined, /说话人一换就必须换段/);
});

test("typography contract stays genre-neutral and does not ban quiet prose", () => {
  const all = [...CHAPTER_TYPOGRAPHY_RULES, ...CHAPTER_TYPOGRAPHY_AUDIT_RULES];
  for (const banned of ["武侠", "修仙", "末世", "科幻", "悬疑", "金庸"]) {
    assert.ok(!all.some((rule) => rule.includes(banned)), `unexpected genre hard-coding: ${banned}`);
  }
  // Short paragraphs and quiet scenes must stay legal; only unreadable layout is a defect.
  assert.ok(CHAPTER_TYPOGRAPHY_AUDIT_RULES.some((rule) => /不要因段落偏短|场景安静/.test(rule)));
  assert.ok(!all.some((rule) => /每段必须超过|禁止短段|不得使用短句/.test(rule)));
});

test("the writer prompt carries the typography section verbatim", () => {
  const text = systemText(chapterWriterPrompt.render(
    { novelTitle: "测试书", chapterOrder: 1, chapterTitle: "测试章", mode: "draft", targetWordCount: 2800 },
    { blocks: [] },
  ));
  assert.match(text, /【排版要求】/);
  for (const rule of CHAPTER_TYPOGRAPHY_RULES) assert.ok(text.includes(rule), `missing writer rule: ${rule.slice(0, 24)}`);
});

test("acceptance and review prompts carry the typography audit section", () => {
  const acceptance = systemText(chapterAcceptanceAssessmentPrompt.render(
    { novelTitle: "测试书", chapterOrder: 2, chapterTitle: "测试章", content: "正文", expectedSceneKeys: [], establishedProse: [] },
    { blocks: [{ id: "chapter_mission", group: "chapter_mission", priority: 100, required: true, content: "任务" }] },
  ));
  assert.match(acceptance, /排版与说话人审查/);
  for (const rule of CHAPTER_TYPOGRAPHY_AUDIT_RULES) assert.ok(acceptance.includes(rule), `missing audit rule in acceptance`);

  const review = systemText(chapterReviewPrompt.render(
    { novelTitle: "测试书", chapterTitle: "测试章", chapterContent: "正文" },
    { blocks: [] },
  ));
  assert.match(review, /【排版与说话人审查】/);

  // A layout defect is locally repairable: the audit rules must not escalate it to a global stop.
  assert.ok(CHAPTER_TYPOGRAPHY_AUDIT_RULES.some((rule) => /不因排版问题升级为全局重写或停止/.test(rule)));
});

test("the repair prompt is told that layout defects are repairable in place", () => {
  const repair = systemText(chapterRepairPrompt.render(
    { novelTitle: "测试书", chapterTitle: "测试章", chapterContent: "正文", issuesJson: "[]", bibleContent: "" },
    { blocks: [] },
  ));
  assert.match(repair, /【排版与说话人要求】/);
  for (const rule of CHAPTER_TYPOGRAPHY_AUDIT_RULES) assert.ok(repair.includes(rule), "missing audit rule in repair prompt");
});
