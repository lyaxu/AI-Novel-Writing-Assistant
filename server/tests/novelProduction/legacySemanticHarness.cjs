// Historical v16 semantic-contract replay only. Production v17 transports raw
// JSON objects and validates shape with full context; this harness keeps v16's
// strict schema boundary and original semantic hooks explicit.
const prompts = require('../../dist/prompting/prompts/novel/chapterAcceptance.prompts');
const { validateSemanticAcceptance, recoverSemanticAcceptance, semanticExample } =
  require('../../dist/prompting/prompts/novel/acceptance/semantic/reviewContract');
const productionAsset = prompts.chapterAcceptanceAssessmentPrompt;
const asset = {
  ...productionAsset,
  outputSchema: prompts.semanticChapterAcceptanceSchema,
  structuredOutputHint: { example: semanticExample() },
  postValidate: (raw, input) => validateSemanticAcceptance(raw, input),
  postValidateFailureRecovery: ({ rawOutput, promptInput, validationError }) =>
    recoverSemanticAcceptance(rawOutput, promptInput, validationError),
};
module.exports = { ...prompts, asset, productionAsset };
