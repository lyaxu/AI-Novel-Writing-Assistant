// Replay historical v13/v14 wire responses without claiming they satisfy the v15 model contract.
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const productionAsset = prompts.chapterAcceptanceAssessmentPrompt;
module.exports = { ...prompts, productionAsset, asset: {
  // Keep the registered identity only to exercise the runner; schema/hooks are explicitly historical.
  ...productionAsset, outputSchema: prompts.referenceChapterAcceptanceAssessmentSchema,
  ...prompts.legacyReferenceAcceptanceValidation,
  // Historical ID example only; modern example uses the separate prerequisite/result contract.
  structuredOutputHint: { example: (() => {
    const example = structuredClone(productionAsset.structuredOutputHint.example);
    for (const check of example.actionStateChecks) {
      check.verdict = 'earned';
      for (const state of check.states) {
        delete state.prerequisite; delete state.resultChange;
        Object.assign(state, { stateChanged: false, enablingTransitionRequired: false, transitionStatus: 'not_needed', transitionEvidence: [] });
      }
    }
    return example;
  })() },
} };
