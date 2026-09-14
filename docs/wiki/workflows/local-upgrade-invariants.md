# Local deployment upgrade contracts

The local Windows checkout follows stable upstream tags on controlled upgrade
branches. Preserve observable behavior, not obsolete implementations. Manuscripts
are disposable for upgrade acceptance; credentials, style profiles and knowledge
settings are separate data and must not be silently reset.

## Decisions verified against v0.4.24

| Local change | Decision | Reason |
| --- | --- | --- |
| Stable chapter editor key and IndexedDB drafts | Keep | Upstream still resets content when server content changes and does not restore browser-local drafts. |
| Conflict/reveal strength and pace passed to writer | Keep | The local prompt bridge remains needed; retain upstream prose contract and configurable slots. |
| Reusable local style presets | Keep | These are user-selected writing resources, not replacements for all upstream defaults. |
| Target chapter length and scene budgets | Use upstream | The current writer and scene controls already carry and enforce the length goal. |
| Soft obligation classification patch | Retire | Upstream acceptance normalization and issue governance now own repairability and continuation. |
| Legacy persistent quality gate cache patch | Retire | Upstream owns cache identity, in-flight coalescing and acceptance persistence. |
| Legacy PromptAddendum injection | Retire | This deployment has zero legacy addendum rows; the upstream slot/template mechanism is authoritative. |
| Timeline finalization when autoReview=false | Keep and adapt | This path bypasses the upstream terminal commit. Finalize after artifact sync, check execution ownership before and after, and refuse approval if the timeline checkpoint is not written. |
| Supporting world context bridge | Keep | It supplies the existing context consumer with the world prompt block. |
| Legacy context render helpers | Compatibility only | They are referenced by existing regression tests, not the production context assembler. Do not extend them or reintroduce them into generation. |

## Continuation boundaries

Use the upstream issue-governance policy for quality debt, retry and replan.
Recoverable local quality problems should not independently fail full-book work.
Explicit replan and runtime ownership/data-safety boundaries must remain effective.
Do not reintroduce legacy keyword-based soft-replan routing alongside the new policy.

Reviewed content is committed through the upstream terminal commit, which owns
timeline finalization. The local timeline callback runs only with autoReview=false;
calling both would duplicate model work and risk conflicting chapter state.

## Verification

Check editor refresh/save/reload behavior independently from server tests. Server
coverage must include chapter runtime, acceptance, issue governance, writer length,
prompt slots, style presets and incremental volume planning. The local timeline
tests verify that a failed checkpoint or lost execution ownership prevents approval.

Old full-suite failures are not automatically accepted as baseline failures for a
new tag. Reproduce failures against that exact upstream tag before attributing them
to upstream, and record environmental or incomplete-baseline limitations explicitly.
