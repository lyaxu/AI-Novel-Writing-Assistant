const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSource } = require('./sourceHarness.cjs');
const contracts = loadRuntimeSource('../production/reliability/types.ts', { 'node:crypto': require('node:crypto') });
const { createChapterProductionJournal } = loadRuntimeSource('../production/reliability/session.ts', {
  'node:crypto': require('node:crypto'), './types': contracts,
});
const context = loadRuntimeSource('../production/reliability/executionContext.ts', {
  'node:async_hooks': require('node:async_hooks'),
  '../../../../llm/invocation/executionPolicy': { withUnknownOutcomeProtection: action => action() },
});
const { executeProduction } = loadRuntimeSource('../production/reliability/ChapterProductionExecution.ts', {
  './executionContext': context,
});
const incomplete = () => Object.assign(new Error('candidate evidence invalid'), {
  code: 'CHAPTER_REVIEW_INCOMPLETE', reviewOutput: { actionStateChecks: [{ validationIssues: ['invalid_quote'] }] },
});

function harness({ candidateFailure = incomplete(), candidateReview, originalFailure, failCommitOnce = false, replan,
  original = '保留原稿。这里有尚待处理的局部质量问题。', candidate = '未经有效审查的候选，不能覆盖原稿。', originalAssessment } = {}) {
  const events = [];
  const chapter = { id: 'c', novelId: 'n', title: '第一章', content: original, taskSheet: 'contract', expectation: null };
  let record = null;
  const journal = createChapterProductionJournal({ repository: { transaction: async fn => {
    const previous = record;
    try {
      return await fn({
        readChapter: async () => ({ ...chapter }), readJournal: async () => record && ({ metadataJson: record }),
        writeJournal: async (_n, _c, expected, next) => { assert.equal(record, expected); record = next; },
        archiveJournal: async () => assert.fail('same operation must be reused'),
      });
    } catch (error) { record = previous; throw error; }
  } } });
  const originalEvaluation = {
    finalContent: original, needsRepair: true, acceptancePersistenceDeferred: true,
    acceptanceResult: { assessment: originalAssessment ?? { status: 'repairable', summary: 'valid original assessment' } },
    runtimePackage: {
      novelId: 'n', chapterId: 'c', context: {},
      audit: { score: { coherence: 86, repetition: 86, engagement: 86, pacing: 86, voice: 86, overall: 86 },
        hasBlockingIssues: false, reports: [], openIssues: [{ id: 'issue-1', code: 'original_local_debt',
          severity: 'medium', auditType: 'continuity', evidence: '原稿的可核实问题', fixSuggestion: '局部修正' }] },
      meta: { acceptanceStatus: 'repairable', continuePolicy: 'repair_once' },
      ...(replan ? { replanRecommendation: replan } : {}),
    },
  };
  const receipt = [{ issueId: 'issue-1', disposition: 'patched', patchIds: ['p1'], reason: '候选已应用补丁' }];
  const { runPipelineChapterWithRuntime } = loadRuntimeSource('chapterRuntimePipeline.ts', {
    '../production/reliability': context,
    './acceptance': { filterVerifiedRepairIssues: issues => issues },
    '../../styleEngine/styleGenerationSanitizer': { detectForbiddenStyleEntities: () => [] },
    './chapterEmptyContentError': { assertChapterContentNotEmpty: value => value, isChapterEmptyContentError: () => false },
    './repair/chapterRepairRuntime': { runChapterRepairText: async () => {
      events.push('patch'); return { content: candidate, issueResolutions: receipt };
    } },
    '../chapterPatchRepairService': { ChapterPatchRepairFailedError: class extends Error {} },
    './selection/ChapterRepairCandidateSelection': { selectChapterRepairCandidate: () => assert.fail('invalid candidate has no comparable assessment') },
    './artifactSync/ChapterArtifactSyncResult': { ChapterArtifactSyncBoundaryError: class extends Error {} },
  });
  const deps = {
    validateRequest: value => value, ensureNovelCharacters: async () => {},
    assemble: async () => ({ novel: { id: 'n', title: '小说' }, chapter: { ...chapter, order: 1 }, contextPackage: {} }),
    generateDraftFromWriter: async () => assert.fail('saved original must not regenerate'),
    saveDraftAndArtifacts: async () => assert.fail('invalid candidate must not overwrite original'),
    finalizeChapterContent: async ({ content }) => {
      events.push(content === original ? 'original_review' : 'candidate_review');
      if (content === original) { if (originalFailure) throw originalFailure; return structuredClone(originalEvaluation); }
      assert.equal(content, candidate);
      // Match the real nested candidate evaluation journal boundary.
      return context.productionStep('evaluation:candidate', async () => {
        if (candidateReview) return candidateReview();
        throw candidateFailure;
      }, true);
    },
    commitFinalizedChapterContent: async ({ evaluation }) => {
      events.push('commit'); assert.deepEqual(evaluation, originalEvaluation);
      if (failCommitOnce) { failCommitOnce = false; throw new contracts.ChapterProductionError('CHAPTER_PRODUCTION_STORAGE', 'offline sync fault'); }
    },
    syncFinalChapterArtifacts: async (_n, _c, content, options) => {
      assert.equal(content, original); assert.equal(options.contentProvenance, 'debt'); events.push('sync');
      return { status: 'completed', contentHash: original, completedArtifacts: ['artifact_delta'] };
    },
    finalizeChapterTimeline: async () => {}, markChapterNeedsRepair: async () => {},
    markChapterGenerationState: async (_c, state) => { assert.equal(state, 'reviewed'); events.push('reviewed'); },
  };
  async function open() { return journal.open({ novelId: 'n', chapterId: 'c', operationId: 'pipeline:job:c', request: { entry: 'pipeline' } }); }
  return {
    events, originalEvaluation, original, candidate, receipt, record: () => JSON.parse(record),
    seedLegacySteps: async () => {
      const session = await open();
      await session.runStep('pipeline.review:0', async () => structuredClone(originalEvaluation), { external: true });
      await session.runStep('pipeline.repair_budget', async () => true);
      await session.runStep('pipeline.repair', async () => ({ content: candidate, issueResolutions: receipt }), { external: true });
      await session.close();
    },
    run: async (hooks = {}) => executeProduction(await open(), () => runPipelineChapterWithRuntime(deps, 'n', 'c', { maxRetries: 1 }, {
      onRetryConsumed: async () => { events.push('budget'); return true; }, ...hooks,
    })),
  };
}

test('completed invalid candidate review retains valid original and original debt without claiming patch success', async () => {
  const f = harness(); const result = await f.run();
  assert.equal(result.pass, false); assert.equal(result.reviewExecuted, true);
  assert.deepEqual(result.runtimePackage, f.originalEvaluation.runtimePackage);
  assert.equal(result.retryCountUsed, 1); assert.equal(result.repairSelection, null);
  assert.deepEqual(result.recoverableRepairFailure.failureTypes, ['candidate_review_incomplete']);
  assert.equal(result.qualityDebtAttribution.patchIssueResolutions, undefined);
  assert.deepEqual(result.qualityDebtAttribution.firstFailureIssueCodes, ['original_local_debt']);
  assert.deepEqual(result.qualityDebtAttribution.secondFailureIssueCodes, []);
  const record = f.record();
  assert.equal(record.status, 'completed');
  assert.equal(record.error, undefined);
  assert.equal(record.steps['pipeline.review:1'].status, 'done');
  assert.equal(record.steps['pipeline.review:1'].output.kind, 'candidate_review_incomplete');
  assert.equal(record.steps['evaluation:candidate'].status, 'failed');
  assert.match(record.steps['evaluation:candidate'].error, /candidate evidence invalid/);
  assert.deepEqual(record.steps['pipeline.repair'].output.issueResolutions, f.receipt);
  assert.deepEqual(f.events, ['original_review', 'budget', 'patch', 'candidate_review', 'commit', 'sync', 'reviewed']);
});

test('recorded valid original and two invalid candidate reviews retain the 3013-character original through the real review gate', async () => {
  const fixture = require('./fixtures/firstChapterCandidateReview.json');
  const originalFixture = require('./fixtures/firstChapterReview.json');
  const { chapterAcceptanceAssessmentPrompt: asset } = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
  const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
  const { runStructuredPrompt, setPromptRunnerStructuredInvokerForTests } = require('../../dist/prompting/core/promptRunner');
  const originalAssessment = asset.postValidate(structuredClone(fixture.originalOutput), originalFixture.input);
  assert.doesNotThrow(() => assertReviewCompleted(originalAssessment));
  let calls = 0;
  setPromptRunnerStructuredInvokerForTests(async () => ({
    data: structuredClone(fixture.outputs[calls++]), repairUsed: false, repairAttempts: 0,
  }));
  try {
    const f = harness({ original: originalFixture.input.content, candidate: fixture.input.content, originalAssessment,
      candidateReview: async () => {
        const { output } = await runStructuredPrompt({ asset, promptInput: fixture.input,
          options: { provider: 'deepseek', model: 'offline-fixture', disableFallbackModel: true,
            transportRetryCount: 0, disableStrategyFallback: true } });
        assertReviewCompleted(output);
        assert.fail('the recorded candidate must remain unverified');
      } });
    const result = await f.run();
    assert.equal(calls, 2);
    assert.equal(f.original.length, 3013); assert.equal(f.candidate.length, 3265);
    assert.equal(require('node:crypto').createHash('sha256').update(f.original).digest('hex'),
      'd4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6');
    assert.equal(result.pass, false); assert.equal(result.retryCountUsed, 1);
    assert.equal(result.qualityDebtAttribution.patchIssueResolutions, undefined);
    assert.deepEqual(f.record().steps['pipeline.review:0'].output.acceptanceResult.assessment, originalAssessment);
    assert.equal(f.record().steps['pipeline.review:1'].output.kind, 'candidate_review_incomplete');
    assert.ok(f.record().steps['pipeline.review:1'].output.reviewOutput.actionStateChecks.some(row => row.validationIssues?.length));
    assert.deepEqual(f.events, ['original_review', 'budget', 'patch', 'candidate_review', 'commit', 'sync', 'reviewed']);
  } finally { setPromptRunnerStructuredInvokerForTests(); }
});

test('old saved original review and patch outputs replay, then a sync failure cannot charge for candidate review again', async () => {
  const f = harness({ failCommitOnce: true }); await f.seedLegacySteps();
  await assert.rejects(f.run(), { code: 'CHAPTER_PRODUCTION_STORAGE' });
  assert.equal(f.record().steps['pipeline.review:1'].status, 'done');
  const result = await f.run();
  assert.equal(result.pass, false);
  assert.deepEqual(f.events, ['candidate_review', 'commit', 'commit', 'sync', 'reviewed']);
  assert.equal(f.record().status, 'completed');
});

test('original review incomplete remains a stop and does not enter patch or terminal commit', async () => {
  const f = harness({ originalFailure: incomplete() });
  await assert.rejects(f.run(), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
  assert.deepEqual(f.events, ['original_review']);
  assert.equal(f.record().status, 'paused');
});

for (const code of ['CHAPTER_PRODUCTION_UNCERTAIN', 'LLM_OUTPUT_LIMIT', 'CHAPTER_PRODUCTION_CONFLICT',
  'CHAPTER_PRODUCTION_STORAGE', 'PIPELINE_CANCELLED', 'PLANNING_REPAIR_CONFIRMATION_REQUIRED']) {
  test(`candidate failure ${code} remains terminal rather than retaining original and advancing`, async () => {
    const f = harness({ candidateFailure: Object.assign(new Error(code), { code }) });
    await assert.rejects(f.run());
    assert.equal(f.events.includes('commit'), false);
    assert.equal(f.events.includes('sync'), false);
    assert.equal(f.record().status, 'paused');
  });
}

test('lost ownership during candidate rejection cannot be swallowed as a local quality debt', async () => {
  const f = harness();
  await assert.rejects(f.run({ onCheckCancelled: async () => {
    if (f.events.includes('candidate_review')) throw new contracts.ChapterProductionError('CHAPTER_PRODUCTION_CONFLICT', 'ownership changed');
  } }), { code: 'CHAPTER_PRODUCTION_CONFLICT' });
  assert.equal(f.events.includes('commit'), false);
});

const { DIRECTOR_ISSUE_POLICY_PRESETS, resolveDirectorIssueDecision } = require('../../../shared/dist/types/directorIssue.js');
const { applyChapterQualityClosure } = loadRuntimeSource('../production/qualityClosure/ChapterQualityClosure.ts', {
  '../../novelCoreShared': { logPipelineError: () => {}, logPipelineWarn: () => {} },
  '../../novelCoreReviewService': { createQualityReport: async () => {} },
  '../../quality/ChapterQualityLoopService': { chapterQualityLoopService: { recordAssessment: async () => {} } },
  '../issueGovernance/PipelineIssueGovernance': { reportPipelineIssue: async input => {
    const decision = resolveDirectorIssueDecision({ occurrence: { issueCode: input.issueCode, riskScore: null,
      attempt: input.attempt, maxAttempts: input.governance.policy.maxAutomaticRetries, hasUsableOutput: true,
      runMode: 'full_book_autopilot' }, policy: input.governance.policy, policySource: 'novel' });
    await input.applyAction?.(decision); return { decision };
  } },
});
for (const presetId of ['finish_full_book', 'quality_first']) {
  test(`retained original still follows ${presetId} at quality closure`, async () => {
    const result = await harness().run();
    const preset = DIRECTOR_ISSUE_POLICY_PRESETS.find(item => item.id === presetId);
    const closure = await applyChapterQualityClosure({ governance: { policy: preset.policy }, novelId: 'n', jobId: 'job',
      chapter: { id: 'c', order: 1 }, chapterResult: result, qualityThreshold: 75, runtimePayload: { autoReview: true },
      qualityAlertDetails: [], replanAlertDetails: [], recoverableRepairDetails: [],
      runLocalReplan: async () => assert.fail('local candidate review failure does not replan') });
    assert.equal(closure.shouldStopAfterCurrentChapter, presetId === 'quality_first');
    assert.equal(closure.stopAction, presetId === 'quality_first' ? 'pause_for_manual' : null);
  });
}

test('retained original explicit replan survives candidate failure and still stops at the chapter boundary', async () => {
  const replan = { recommended: true, action: 'stop_for_replan', scope: 'global_book', reason: 'verified original structural gap', blockingIssueIds: [] };
  const result = await harness({ replan }).run();
  assert.deepEqual(result.runtimePackage.replanRecommendation, replan);
  const preset = DIRECTOR_ISSUE_POLICY_PRESETS.find(item => item.id === 'finish_full_book');
  const details = [];
  const closure = await applyChapterQualityClosure({ governance: { policy: preset.policy }, novelId: 'n', jobId: 'job',
    chapter: { id: 'c', order: 1 }, chapterResult: result, qualityThreshold: 75, runtimePayload: { autoReview: true },
    qualityAlertDetails: [], replanAlertDetails: details, recoverableRepairDetails: [], runLocalReplan: async () => assert.fail('global replan') });
  assert.equal(closure.shouldStopAfterCurrentChapter, true);
  assert.equal(closure.stopAction, 'pause_for_manual'); assert.equal(details.length, 1);
});
