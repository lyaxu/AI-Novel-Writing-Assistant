// A small structurally complete AI output for schema/transaction tests, not a literary benchmark.
exports.createSceneCausality = () => ({
  actor: "调查者",
  choice: "当面核对证人提供的记录",
  motive: "避免依据未经核实的指控行动",
  prerequisites: [{ condition: "证人提供原始记录", sourceKind: "establish_in_scene", reference: "本场开头证人递交记录" }],
  resistanceResponse: "证人拒绝透露记录的来源",
  outcomeMechanism: "只确认记录与现场痕迹吻合，保留来源疑点",
  resultingConstraints: [{ constraint: "不能把证人推测当作已证事实", persistence: "直到另有来源交叉验证" }],
});
