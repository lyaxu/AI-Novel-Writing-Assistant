const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/secondChapterPlannerFollowUp.json');
const { plannerChapterPlanPrompt: asset } = require('../../dist/prompting/prompts/planner/plannerPlan.prompts');
const { validateChapterPayoffDecisions, PayoffPlanningReplanRequiredError, buildPayoffPlanningEvidenceBlock } = require('../../dist/services/planner/payoff');
const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');

function simulatedDecision(operation = 'touch') {
  const output = structuredClone(fixture.responses[1].output);
  for (const decision of output.payoffDecisions.slice(0, 2)) {
    decision.operation = operation;
    decision.followUp = null;
    decision.reason = operation === 'requires_replan'
      ? '后续未写章节尚未提供规划，需要先建立有证据的承接。'
      : '只推进当前合同授权的首次处理与报酬，不宣称整个候选回报已部分交付。';
  }
  return output;
}

async function withResponses(responses, action) {
  const calls = [];
  const schemaRepairRequests = [];
  setPromptRunnerStructuredInvokerForTests(async (request) => {
    calls.push(request);
    assert.ok(calls.length <= responses.length, 'must not silently add another invocation');
    const response = structuredClone(responses[calls.length - 1]);
    // The real structured invoker uses this exact schema before entering JSON
    // repair. These received JSON objects must pass that boundary unchanged.
    const parsed = request.schema.safeParse(response);
    if (!parsed.success) schemaRepairRequests.push(parsed.error);
    assert.equal(parsed.success, true, 'a business follow-up decision must reach context-aware validation');
    return { data: parsed.data, repairUsed: false, repairAttempts: 0 };
  });
  try {
    await action(calls, () => runStructuredPrompt({ asset,
      promptInput: { scopeLabel: '第二章规划离线回放', payoffValidation: fixture.input },
      contextBlocks: [buildPayoffPlanningEvidenceBlock(fixture.input, [])],
      options: { provider: 'deepseek', model: 'offline-fixture', disableFallbackModel: true,
        transportRetryCount: 0, disableStrategyFallback: true },
    }));
    assert.equal(schemaRepairRequests.length, 0);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
}

test('all three recorded responses remain invalid; transport shape does not certify partial payoff', () => {
  assert.equal(fixture.input.chapterOrder, 2);
  assert.ok(fixture.input.planningWindow.every(volume => volume.chapters.length === 0));
  for (const response of fixture.responses) {
    assert.equal(asset.outputSchema.safeParse(response.output).success, true);
    assert.throws(() => asset.postValidate(response.output, { payoffValidation: fixture.input }),
      /supplied future|Partial payoff/);
  }
});

test('recorded retry with null partial follow-up is rejected without a context-free third repair', async () => {
  const responses = fixture.responses.slice(0, 2).map(row => row.output);
  await withResponses(responses, async (calls, invoke) => {
    await assert.rejects(invoke(), error => {
      assert.match(error.message, /Partial payoff/);
      assert.match(error.message, /未来章序：\[\]/);
      assert.match(error.message, /不能保留该operation/);
      assert.deepEqual(error.completedPromptResponse.output, asset.outputSchema.parse(responses[1]));
      return true;
    });
    assert.equal(calls.length, 2);
    const retry = calls[1].messages.map(message => String(message.content)).join('\n');
    assert.match(retry, /operation=partial_reveal/);
    assert.match(retry, /requires_replan/);
    assert.ok(retry.includes(fixture.input.contract.taskSheet));
    assert.equal(calls[1].promptMeta.semanticRetryAttempts, 1);
  });
});

test('recorded JSON repair inventing chapter 4 still cannot pass the real prompt runner', async () => {
  await withResponses([fixture.responses[0].output, fixture.responses[2].output], async (calls, invoke) => {
    await assert.rejects(invoke(), /Chapter 4 is not a supplied future chapter/);
    assert.equal(calls.length, 2);
  });
});

test('simulated valid AI operation correction passes with the same bounded semantic retry', async () => {
  const corrected = simulatedDecision();
  await withResponses([fixture.responses[1].output, corrected], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 2);
    assert.equal(result.meta.invocation.repairUsed, false);
    assert.deepEqual(result.output.payoffDecisions, corrected.payoffDecisions);
    assert.deepEqual(validateChapterPayoffDecisions({ ...fixture.input, decisions: result.output.payoffDecisions }), corrected.payoffDecisions);
  });
});

test('explicit AI replan is preserved and still stops at the service replan boundary', async () => {
  const output = simulatedDecision('requires_replan');
  await withResponses([output], async (calls, invoke) => {
    const result = await invoke();
    assert.equal(calls.length, 1);
    assert.throws(() => validateChapterPayoffDecisions({ ...fixture.input, decisions: result.output.payoffDecisions }), PayoffPlanningReplanRequiredError);
  });
});

test('manually simulated first-service payoff can close its promised loop while preserving wider mysteries', () => {
  // This is a human-authored interpretation of the captured contract, not proof
  // that a live model will choose it or that prose has passed literary review.
  const output = structuredClone(fixture.responses[1].output);
  const quote = '读者看到第一轮循环完成（接单→解决→收钱→账本更新），同时获得新线索“二手市场”和悬念“债还在”。';
  assert.ok(fixture.input.contract.sceneCards.includes(quote));
  for (const decision of output.payoffDecisions.slice(0, 2)) {
    decision.operation = 'payoff';
    decision.reason = '本候选的首次接单、处理见效、获得报酬与账本更新形成闭环；根源追查和账本来源是仍须保留的后续谜团。';
    decision.authorizedScope = '暂时压制阴气、收三百元、账本提示债还在；不彻底消灭阴气，不揭示账本来源和阴司全貌，不宣称债务结清。';
    decision.contractEvidence = { sourcePath: 'sceneCards', quote };
    decision.followUp = null;
    delete decision.remainingObligation;
  }
  const validated = validateChapterPayoffDecisions({ ...fixture.input, decisions: output.payoffDecisions });
  assert.deepEqual(validated.slice(0, 2).map(decision => decision.ledgerKey), ['chapter_3_stage_payoff', 'first_round_loop_complete']);
  assert.ok(validated.slice(0, 2).every(decision => decision.operation === 'payoff' && decision.followUp === null));
  assert.deepEqual(output.mustPreserve, fixture.responses[1].output.mustPreserve);
  assert.equal(validated.find(decision => decision.ledgerKey === 'ledger_bad_debt_and_name_mechanism').operation, 'seed');
  assert.ok(validated[0].authorizedScope.includes('不彻底消灭阴气'));
  assert.ok(validated[0].authorizedScope.includes('不揭示账本来源和阴司全貌'));
  // The same current-chapter quote cannot become a fictional future plan.
  const invalid = structuredClone(output.payoffDecisions);
  invalid[0].operation = 'partial_reveal';
  invalid[0].remainingObligation = '继续追查根源';
  invalid[0].followUp = { chapterOrder: 3, expectedChange: '揭示根源', planningQuote: quote };
  assert.throws(() => validateChapterPayoffDecisions({ ...fixture.input, decisions: invalid }), /not a supplied future chapter/);
});

test('strict follow-up and overdue rules remain intact outside the transport parser', () => {
  const output = simulatedDecision();
  const first = output.payoffDecisions[0];
  for (const operation of ['partial_reveal', 'defer']) {
    first.operation = operation;
    assert.throws(() => validateChapterPayoffDecisions({ ...fixture.input, decisions: output.payoffDecisions }), /requires|Requires/);
  }
  first.operation = 'touch';
  const candidates = structuredClone(fixture.input.candidates);
  candidates[0].currentStatus = 'overdue';
  assert.throws(() => validateChapterPayoffDecisions({ ...fixture.input, candidates, decisions: output.payoffDecisions }), /Unpaid due payoff/);
});
