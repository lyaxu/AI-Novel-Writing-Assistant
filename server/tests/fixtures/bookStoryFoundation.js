const foundation = {
  throughline: {
    centralQuestion: "Can the tenant keep a livelihood without exploiting neighbors?",
    thematicAnswer: "Shared security can matter more than winning alone.",
    endingChoice: "Turn the profitable lease into a cooperative.",
    choiceCost: "Give up exclusive control and a larger private return.",
    resolution: "The street stays open under a jointly negotiated lease.",
    setupPayoffs: [{ setup: "A neighbor keeps the discarded rent receipts.", payoff: "The receipts establish everyone's contribution at the final negotiation." }],
  },
  worldBoundary: {
    baseline: "An ordinary contemporary neighborhood with no supernatural powers.",
    crossingRules: "Not applicable: recollections do not transport people or objects.",
    knowledgeBoundary: "The tenant learns the sale terms only after seeing the contract.",
    hardLimits: ["Ownership cannot change merely because a crowd cheers."],
  },
  characterDynamics: [{
    role: "The neighboring tailor",
    independentGoal: "Preserve a reliable income before retirement.",
    mainlineEffect: "Refuses the risky protest but brings the old receipts to negotiation.",
    relationshipChange: "Mutual suspicion becomes a negotiated partnership.",
  }],
  viewpoint: {
    anchor: "A tenant who measures every choice against next month's rent.",
    scopeConnection: "Changes in street ownership are felt through rent and regular customers.",
  },
  progression: {
    escalationLogic: "Each short-term rent deal shifts who bears the next risk.",
    emotionalMovement: "Awkward bargaining grows into earned trust and a lighthearted shared victory.",
  },
};

const storyPrototype = {
  protagonistWant: "Keep the shop", opposition: "A creditor needs the site",
  difficultChoice: "Risk the lease or betray the tailor", distinctiveEngine: "Every deal shifts obligations",
  earlyPayoff: "Secure the first extension", appealRisk: "Avoid repetitive negotiations",
  openingChain: [1, 2, 3].map(chapterOrder => ({ chapterOrder, action: "Negotiate", resistance: "The owner refuses",
    choice: "Offer collateral", consequence: "Lose a guarantee", payoff: "Gain time", nextQuestion: "Who acquired the lease?" })),
};

const legacyCandidate = {
  id: "neighborhood", workingTitle: "The Lease", logline: "A tenant bargains for a street's future",
  positioning: "Everyday comedy", sellingPoint: "Consequential neighborhood bargains", coreConflict: "Security versus control",
  protagonistPath: "Learn to share decisions", endingDirection: "A cooperative lease", hookStrategy: "Uncover the sale terms",
  progressionLoop: "Bargains alter obligations", whyItFits: "Ordinary stakes", toneKeywords: ["Warm", "Comic"],
  targetChapterCount: 80, recommendedWritingPlatform: "fanqie_free", writingPlatformReason: "Accessible everyday stakes",
};

module.exports = { foundation, storyPrototype, legacyCandidate };
