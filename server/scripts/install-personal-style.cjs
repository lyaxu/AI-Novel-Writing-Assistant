const profile = require('../../docs/style-profiles/shijing-xini.json');
const { prisma } = require('../dist/db/prisma.js');
const { StyleProfileService } = require('../dist/services/styleEngine/StyleProfileService.js');
const { StyleRuntimeResolver } = require('../dist/services/styleEngine/StyleRuntimeResolver.js');

async function main() {
  // Re-running installation never overwrites a user's subsequent GUI edits.
  const existing = await prisma.styleProfile.findFirst({ where: { sourceRefId: profile.sourceRefId } });
  const saved = existing || await new StyleProfileService().createManualProfile(profile);
  const resolved = await new StyleRuntimeResolver().resolve({ styleProfileId: saved.id });
  const blocks = resolved.context.compiledBlocks;
  if (!blocks?.character.includes('situated_inner_voice') || !blocks.selfCheck.includes('character-specific inner reasoning')) {
    throw new Error('Personal style is saved but its effective contract differs; inspect the profile without overwriting it.');
  }
  console.log(JSON.stringify({ id: saved.id, name: saved.name, created: !existing,
    psychologyMode: blocks.mergedRules.characterRules.psychologyMode,
    allowSwearing: blocks.mergedRules.languageRules.allowSwearing,
    antiAiRules: resolved.antiAiRules.map(r => ({ key: r.key, instruction: r.promptInstruction })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
