const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const corpus = require('./fixtures/reviewFailureCorpus.json');
const {
  generatedChapterAcceptanceAssessmentSchema,
  referenceChapterAcceptanceAssessmentSchema,
  resolvedAcceptanceValidation,
  legacyReferenceAcceptanceValidation,
} = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { asset: legacyUnifiedAsset, productionAsset } = require('./legacyUnifiedHarness.cjs');
const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/reviewCompletion');

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const atPath = (value, path) => path.split('.').reduce((node, key) => node[key], value);

test('v15 historical replay has its own schema and cannot masquerade as fresh v16 output', () => {
  assert.notEqual(legacyUnifiedAsset, productionAsset);
  assert.equal(legacyUnifiedAsset.version, productionAsset.version);
  assert.notEqual(legacyUnifiedAsset.outputSchema, productionAsset.outputSchema);
  for (const entry of corpus.entries.filter(row => row.promptVersion === 'v15')) {
    const { recorded } = fixtureFor(entry);
    assert.equal(legacyUnifiedAsset.outputSchema.safeParse(recorded).success, true);
    assert.equal(productionAsset.outputSchema.safeParse(recorded).success, false);
    assert.equal(hash(recorded), entry.responseObjectSha256);
  }
});

function fixtureFor(entry) {
  const document = require(`./fixtures/${entry.fixture}`);
  const inputDocument = require(`./fixtures/${entry.input.fixture}`);
  const input = structuredClone(atPath(inputDocument, entry.input.path));
  if (entry.input.restoreActualChapterIds) {
    assert.equal(typeof document.provenance.chapterId, 'string');
    assert.equal(typeof document.provenance.previousChapterId, 'string');
    assert.equal(input.establishedProse.length, 1, 'The archived two-chapter ID mapping must remain explicit');
    input.chapterId = document.provenance.chapterId;
    input.establishedProse[0].chapterId = document.provenance.previousChapterId;
  }
  return { input, recorded: atPath(document, entry.outputPath) };
}

test('failure corpus enumerates seventeen immutable real responses and separates authored simulations', () => {
  assert.equal(corpus.entries.length, 17);
  assert.equal(corpus.counts.recordedFailures, 16);
  assert.equal(corpus.counts.recordedValidOriginalControls, 1);
  assert.equal(new Set(corpus.entries.map(entry => entry.id)).size, 17);
  for (const entry of corpus.entries) {
    assert.equal(entry.origin, 'recorded_model_response');
    assert.equal(entry.manualSimulation, false);
    const { recorded } = fixtureFor(entry);
    assert.equal(hash(recorded), entry.responseObjectSha256, `${entry.id}: recorded object or shape changed`);
  }
  for (const simulation of corpus.manualSimulations) {
    assert.equal(simulation.origin, 'hand_authored_contract_simulation');
    assert.equal(simulation.manualSimulation, true);
    assert.ok(simulation.derivedFrom.every(id => corpus.entries.some(entry => entry.id === id)));
  }
});

for (const entry of corpus.entries) {
  test(`historical review corpus ${entry.id} preserves its recorded acceptance boundary`, () => {
    const { input, recorded } = fixtureFor(entry);
    const inputBefore = structuredClone(input);
    const referenceWire = entry.promptVersion === 'v13' || entry.promptVersion === 'v14';
    const schema = entry.promptVersion === 'v15' ? legacyUnifiedAsset.outputSchema : referenceWire ? referenceChapterAcceptanceAssessmentSchema : generatedChapterAcceptanceAssessmentSchema;
    const validation = entry.promptVersion === 'v15' ? legacyUnifiedAsset : referenceWire ? legacyReferenceAcceptanceValidation : resolvedAcceptanceValidation;
    assert.equal(typeof validation?.postValidate, 'function', 'Historical validation must have an explicit entrypoint');
    assert.equal(typeof validation?.postValidateFailureRecovery, 'function');
    const parsed = schema.safeParse(structuredClone(recorded));

    if (entry.id === 'second-v13-initial') {
      // This real answer is structurally malformed. It must never reach business
      // recovery with invented string explanations or fabricated review fields.
      assert.equal(parsed.success, false, 'Malformed reference objects in prose explanation arrays must remain invalid');
      assert.ok(parsed.error.issues.some(issue => issue.path[0] === 'sceneCausalityVerdicts'
        && (issue.path.includes('prerequisiteEvidence') || issue.path.includes('constraintEvidence'))));
      assert.equal(entry.expectedHistoricalDisposition, 'review_incomplete');
      assert.equal(hash(recorded), entry.responseObjectSha256);
      assert.deepEqual(input, inputBefore);
      return;
    }

    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    if (entry.expectedHistoricalDisposition === 'valid_original_review') {
      const completed = validation.postValidate(parsed.data, input, { blocks: [] });
      assert.doesNotThrow(() => assertReviewCompleted(completed), 'The valid original must survive rejection of its candidate');
    } else {
      assert.equal(entry.expectedHistoricalDisposition, 'review_incomplete');
      let failure;
      try {
        validation.postValidate(parsed.data, input, { blocks: [] });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error, `${entry.id}: a recorded invalid review must not silently become acceptance`);
      const recovered = validation.postValidateFailureRecovery({
        rawOutput: schema.parse(structuredClone(recorded)), promptInput: input,
        context: { blocks: [] }, validationError: failure.message, semanticRetryAttempts: 1,
      });
      assert.throws(() => assertReviewCompleted(recovered), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
      assert.deepEqual(recovered.repairDirectives, [], 'An invalid review cannot authorize prose repair');
    }
    assert.deepEqual(input, inputBefore, 'Review validation cannot change either manuscript or source identity');
    assert.equal(hash(recorded), entry.responseObjectSha256, 'Never rewrite archived responses to pass the regression');
  });
}
