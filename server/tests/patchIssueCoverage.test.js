const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePatchIssueCoverage, chapterPatchRepairPrompt } = require('../dist/prompting/prompts/novel/chapterPatchRepair.prompts.js');
const { chapterPatchRepairPlanSchema } = require('../../shared/dist/types/chapterPatchRepair.js');

function plan() {
  return { strategy: 'patch_first', summary: 'One repair, remaining claims accounted for.',
    requiresFullRewrite: false, escalationReason: null,
    patches: [{ id: 'p1', targetExcerpt: 'A duplicated action.', replacement: 'A new consequence.', reason: 'Remove duplication.', issueIds: ['i1'] }],
    issueResolutions: [
      { issueId: 'i1', disposition: 'patched', patchIds: ['p1'], reason: 'Target changed.' },
      { issueId: 'i2', disposition: 'deferred', patchIds: [], reason: 'Evidence remains uncertain.' },
      { issueId: 'i3', disposition: 'not_supported', patchIds: [], reason: 'Knows the task, not the location.' },
      { issueId: 'i4', disposition: 'plan_conflict', patchIds: [], reason: 'Contract conflicts with prior delivery.' },
      { issueId: 'i5', disposition: 'deferred', patchIds: [], reason: 'Outside this patch budget.' },
      { issueId: 'i6', disposition: 'deferred', patchIds: [], reason: 'Still outstanding.' },
    ] };
}
const ids = ['i1','i2','i3','i4','i5','i6'];
test('all issues require receipts even when only one patch is attempted', () => {
  assert.doesNotThrow(() => validatePatchIssueCoverage(plan(), ids));
  const value = plan(); value.issueResolutions.pop();
  assert.throws(() => validatePatchIssueCoverage(value, ids), /every supplied issue/);
});
test('unknown or duplicate issue receipts cannot hide an omitted claim', () => {
  for (const replacement of ['i1', 'invented']) {
    const value = plan(); value.issueResolutions[5].issueId = replacement;
    assert.throws(() => validatePatchIssueCoverage(value, ids), /every supplied issue/);
  }
});
test('patched claims require bidirectional links to an actual patch', () => {
  const value = plan(); value.issueResolutions[0].patchIds = ['missing'];
  assert.throws(() => validatePatchIssueCoverage(value, ids), /existing patches/);
  const unlinked = plan(); unlinked.patches[0].issueIds = ['i2'];
  assert.throws(() => validatePatchIssueCoverage(unlinked, ids));
  const deferred = plan(); deferred.issueResolutions[1].patchIds = ['p1'];
  assert.throws(() => validatePatchIssueCoverage(deferred, ids), /Unpatched/);
});
test('old saved patch plans stay readable but fresh output requires receipts', () => {
  const value = plan(); delete value.issueResolutions;
  assert.equal(chapterPatchRepairPlanSchema.safeParse(value).success, true);
  assert.equal(chapterPatchRepairPrompt.outputSchema.safeParse(value).success, false);
});
