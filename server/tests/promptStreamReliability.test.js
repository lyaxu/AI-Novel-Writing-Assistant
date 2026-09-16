const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("stream failures do not crash strict Node even when completion is awaited late or ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-stream-test-"));
  try {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "-e", `
      const assert = require('node:assert/strict');
      const runner = require('./dist/prompting/core/promptRunner');
      const { styleRewritePrompt } = require('./dist/prompting/prompts/style/style.prompts');
      const { genreTreePrompt } = require('./dist/prompting/prompts/genre/genre.prompts');
      const pause = () => new Promise(r => setTimeout(r, 30));
      const textInput = {asset: styleRewritePrompt, promptInput: {
        styleBlock:'plain', characterBlock:'action', antiAiBlock:'', content:'original', issuesBlock:''
      }};
      const structuredInput = {asset: genreTreePrompt, promptInput: {
        prompt:'fiction', retry:false, forceJson:true
      }};
      (async () => {
        for (const kind of ['text', 'structured']) {
          for (const mode of ['late', 'ignored', 'cancel']) {
            const error = new TypeError('terminated');
            runner.setPromptRunnerLLMFactoryForTests(async () => ({stream: async function* () {
              yield {content:'partial'};
              throw error;
            }}));
            const handle = await (kind === 'text'
              ? runner.streamTextPrompt(textInput) : runner.streamStructuredPrompt(structuredInput));
            if (mode === 'cancel') {
              for await (const chunk of handle.stream) { break; }
            } else {
              await assert.rejects(async () => {for await (const chunk of handle.stream) {}}, e => e === error);
            }
            await pause();
            if (mode !== 'ignored') {
              await assert.rejects(handle.complete, e => mode === 'cancel' ? e.name === 'AbortError' : e === error);
            }
          }
        }
        runner.setPromptRunnerLLMFactoryForTests(async () => ({stream: async function* () {
          yield {content:'complete'};
        }}));
        const originalValidate = styleRewritePrompt.postValidate;
        styleRewritePrompt.postValidate = () => {throw new Error('post validation failed');};
        const invalid = await runner.streamTextPrompt(textInput);
        for await (const chunk of invalid.stream) {}
        await pause();
        await assert.rejects(invalid.complete, /post validation failed/);
        styleRewritePrompt.postValidate = originalValidate;
        const valid = await runner.streamTextPrompt(textInput);
        for await (const chunk of valid.stream) {}
        assert.equal((await valid.complete).output, 'complete');
        console.log('strict-stream-regression-passed');
        await require('./dist/db/prisma').prisma.$disconnect();
      })().catch(error => {console.error(error); process.exitCode = 1;});
    `], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 60000,
      env: {...process.env, DATABASE_URL: `file:${path.join(dir, "test.db")}`, LLM_DEBUG_LOG: "false", LLM_DEBUG_FILE_LOG: "false"},
    });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /strict-stream-regression-passed/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
