const test = require('node:test');
const assert = require('node:assert/strict');
const { ChapterAcceptanceAssessmentService } = require('../../dist/services/novel/runtime/ChapterAcceptanceAssessmentService.js');

for (const failure of [
  Object.assign(new Error('offline timeout'), { code: 'ETIMEDOUT' }),
  Object.assign(new Error('limit'), { code: 'LLM_OUTPUT_LIMIT' }),
  Object.assign(new Error('invalid answer'), { name: 'StructuredOutputError', category: 'schema_mismatch' }),
]) {
  test(`unfinished review preserves ${failure.code ?? failure.category} instead of accepting prose`, async () => {
    const service = new ChapterAcceptanceAssessmentService();
    service.invokeAssessment = async () => { throw failure; };
    service.persistAcceptanceReports = async () => assert.fail('failed review must not publish acceptance');
    await assert.rejects(service.assess({ novelId: 'n', chapterId: 'c', content: '保留原稿', persist: false }), error => error === failure);
  });
}

const { assertReviewCompleted } = require('../../dist/services/novel/runtime/acceptance/index.js');
for (const invalid of [
  { riskTags: ['acceptance_source_evidence_unverified'] },
  { blockingIssues: [{ sourceValidationIssues: ['wrong quote'] }] },
  { progressionAuditIssues: ['coverage_missing'] },
  { actionStateChecks: [{ validationIssues: ['source mismatch'] }] },
]) {
  test(`invalid review evidence cannot certify prose: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => assertReviewCompleted({ riskTags: [], blockingIssues: [], ...invalid }), { code: 'CHAPTER_REVIEW_INCOMPLETE' });
  });
}
test('valid story debt and stylistic opinion stay outside review availability errors', () => {
  assert.doesNotThrow(() => assertReviewCompleted({ riskTags: ['style_warning'], blockingIssues: [{ severity: 'medium', code: 'story_gap' }], progressionChecks: [{ status: 'insufficient_evidence', validationIssues: [] }] }));
});
