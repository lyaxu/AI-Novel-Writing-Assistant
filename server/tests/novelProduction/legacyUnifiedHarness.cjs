// Test-only v15 replay. Keep registered current identity for the real runner,
// while explicitly binding the historical schema, example and validation hooks.
// No archived v15 response is a valid raw response for the v16 semantic contract.
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { validateUnifiedAcceptance, recoverUnifiedAcceptance, unifiedExample } =
  require('../../dist/prompting/prompts/novel/acceptance/reviewContract');
const productionAsset = prompts.chapterAcceptanceAssessmentPrompt;
const asset = {
  ...productionAsset,
  outputSchema: prompts.unifiedChapterAcceptanceAssessmentSchema,
  structuredOutputHint: { example: unifiedExample(prompts.referenceExample(prompts.legacyExample)) },
  postValidate: (raw, input) => validateUnifiedAcceptance(raw, input),
  postValidateFailureRecovery: ({ rawOutput, promptInput, validationError }) =>
    recoverUnifiedAcceptance(rawOutput, promptInput, validationError),
};
module.exports = { ...prompts, asset, productionAsset };
