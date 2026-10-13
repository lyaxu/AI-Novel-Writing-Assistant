// Replay historical v13/v14 wire responses without claiming they satisfy the current model contract.
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const productionAsset = prompts.chapterAcceptanceAssessmentPrompt;
module.exports = { ...prompts, productionAsset, asset: {
  // Keep the registered identity only to exercise the runner; schema/hooks are explicitly historical.
  ...productionAsset, outputSchema: prompts.referenceChapterAcceptanceAssessmentSchema,
  ...prompts.legacyReferenceAcceptanceValidation,
  // Start from the explicit historical example, never reverse-transform current wire output.
  structuredOutputHint: { example: prompts.referenceExample(prompts.legacyExample) },
} };
