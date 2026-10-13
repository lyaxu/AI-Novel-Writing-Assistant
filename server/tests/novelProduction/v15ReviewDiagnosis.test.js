// Captured regression evidence, not a product fix or a successful semantic review.
const test=require('node:test'),assert=require('node:assert/strict');
const {asset}=require('./legacyUnifiedHarness.cjs');
const {assertReviewCompleted}=require('../../dist/services/novel/runtime/acceptance/reviewCompletion');
const fixture=require('./fixtures/secondChapterReviewV15.json');
const input={...require('./fixtures/secondChapterReview.json').input,chapterId:fixture.provenance.chapterId};
input.establishedProse=input.establishedProse.map(row=>({...row,chapterId:fixture.provenance.previousChapterId}));

test('recorded v15 first answer omits two scenes and misclassifies retrospective skill evidence',()=>{
 assert.throws(()=>asset.postValidate(asset.outputSchema.parse(fixture.outputs[0]),input),error=>{
  assert.equal(error.reviewContractIssues.length,4);
  assert.ok(error.reviewContractIssues.includes('action_state_coverage_missing:arrive_and_meet'));
  assert.ok(error.reviewContractIssues.includes('action_state_coverage_missing:identify_source'));
  assert.ok(error.reviewContractIssues.some(e=>e.includes('before_state_after_action:ability')));
  return true;
 });
});
test('recorded v15 corrected answer fixes original faults but exposes prior-source and dialogue timing faults',()=>{
 const raw=asset.outputSchema.parse(fixture.outputs[1]);let failure;
 try{asset.postValidate(raw,input);}catch(e){failure=e;}
 assert.equal(failure.reviewContractIssues.length,2);
 assert.ok(failure.reviewContractIssues.some(e=>e.includes('retrospective_before_source_missing')));
 assert.ok(failure.reviewContractIssues.some(e=>e.includes('before_state_after_action:knowledge')));
 const output=asset.postValidateFailureRecovery({rawOutput:raw,promptInput:input,validationError:failure.message,semanticRetryAttempts:1});
 assert.throws(()=>assertReviewCompleted(output),e=>e.code==='CHAPTER_REVIEW_INCOMPLETE');
 assert.deepEqual(output.reviewRawResponse,raw);
 assert.deepEqual(output.repairDirectives,[]);
 assert.deepEqual(output.deferredRepairDirectives,raw.repairDirectives);
});
test('timing-label-only counterfactual exposes the semantic gap and is never a correct-review control',()=>{
 const raw=structuredClone(fixture.outputs[1]);
 raw.actionStateChecks[0].states[0].beforeEvidenceTiming.relation='before_or_at_action';
 raw.actionStateChecks[1].states[0].beforeEvidenceTiming.relation='retrospective_prior_state';
 const output=asset.postValidate(asset.outputSchema.parse(raw),input);
 assert.doesNotThrow(()=>assertReviewCompleted(output));
 // A mechanical pass still retains disputed plot readings and unnecessary patch proposals.
 assert.equal(output.actionStateChecks[1].states[0].assessment.resultChange.status,'changed');
 assert.equal(output.actionStateChecks[2].states[0].dimension,'ability');
 assert.equal(output.actionStateChecks[2].states[0].assessment.resultChange.status,'changed');
 assert.ok(output.blockingIssues.some(i=>i.code==='timeline_transport_inconsistency'));
 assert.deepEqual(output.repairDirectives,fixture.outputs[1].repairDirectives);
 assert.equal(fixture.outputs[1].actionStateChecks[0].states[0].beforeEvidenceTiming.relation,'retrospective_prior_state');
});
