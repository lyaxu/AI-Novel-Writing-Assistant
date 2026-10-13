// Historical quote fixtures exercise canonical evidence validation after resolution.
// This adapter is test-only: passing these tests does not verify the v13 ID-only wire contract.
function createResolvedAcceptanceHarness(prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts')) {
  const productionAsset = prompts.chapterAcceptanceAssessmentPrompt;
  if (!prompts.resolvedAcceptanceValidation) throw new Error('Canonical acceptance validation hooks are required');
  const asset = {
    ...productionAsset,
    outputSchema: prompts.generatedChapterAcceptanceAssessmentSchema,
    ...prompts.resolvedAcceptanceValidation,
  };
  return { ...prompts, asset, productionAsset };
}

module.exports = { createResolvedAcceptanceHarness };
