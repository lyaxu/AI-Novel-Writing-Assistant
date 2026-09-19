# Local controlled upgrade: 2026-09-20

## Scope

- Repository: `D:\novel\AI-Novel-Writing-Assistant`.
- Source: `codex/fix-llm-stream-budget`, `2a3f57a9`.
- Destination: `codex/upgrade-v0.4.26-controlled`.
- Upstream target: stable `v0.4.26`, commit `5b83a4b7`.
- Includes the skipped v0.4.25 migration repairs, branding and architecture docs.
- v0.4.26 resource recommendation accepts valid catalog ordinals and numeric
  selections, rejects invalid selections and duplicate primary/secondary modes,
  and registers the v3 prompt consistently. This applies to the web server too.

## Preservation and merge

- Only README and release notes conflicted. Both histories were retained and
  the latest local summary was recorded under 2026-09-20.
- No local runtime, LLM, chapter writer, editor or style implementation was
  replaced. Local code is unchanged from `2a3f57a9` in those protected paths.
- Keep editor stable identity, IndexedDB drafts, dirty-refetch protection,
  reload recovery, clear-on-save/accepted-rewrite and leave warnings.
- Keep stream completion rejection ownership, bounded output repair headroom,
  8192-token chapter contract budget, and finish-reason/usage diagnostics.
- Keep writer controls, style presets, world context and timeline finalization.
- Continue using upstream quality-debt governance and chapter length controls;
  do not reintroduce retired keyword-based soft-replan logic.
- Untracked launch scripts, probe database and manuscript files were untouched.

## Backup and database

- Stopped the existing `start-local.bat` process tree before backup and merge.
- Backup: `.codex-backups/pre-v0.4.26-20260920/`.
- Copied `dev.db` (1,027,043,328 bytes), its WAL and SHM together while stopped.
- Backup read-only `PRAGMA quick_check` returned `ok`; 162 tables readable.
- `code.bundle` preserves the full history through `2a3f57a9`; bundle verified.
- `pnpm install --frozen-lockfile`: already up to date; no lockfile change.
- `pnpm --dir server prisma:push`: database already in sync; no reset or data
  loss flags used. Generated the existing Prisma 7.4.2 client for checks.
- Before restart, compared complete rows against the backup without printing
  secrets: AppSetting 34, StyleProfile 7, StyleTemplate 11, KnowledgeDocument 1.
  All counts and content hashes matched.

## Verification

- Runtime: bundled Node 24.19.0; dependency install used bundled pnpm 11.19.0.
- Root `pnpm typecheck`: shared build and server/client/desktop checks passed.
- `pnpm --dir server build`: passed.
- Targeted server regression: 125 tests, 124 passed, 1 failed, no skips.
- Coverage: resource recommendation, migration completeness and incremental
  migration, strict-process stream failure, output diagnostics, structured
  parsing/repair/retry, token usage, writer controls, timeline ownership,
  chapter length, contract singleflight, acceptance, quality loop, director
  issue governance, prompt slots, style sanitization and volume planning.
- Failure: `chapterStructuredOutputNormalization.test.js:101`, resource
  extraction eight-item cap. The combined artifact schema accepts nine items
  while the test expects rejection; the standalone extraction schema caps eight.
- Reproduced the same failure on a fresh archive of exact upstream v0.4.26:
  upstream server compiled successfully; the test file had 9 passes / 1 failure.
  No local patches were applied to that archive. Installed dependencies were
  reused. This is not introduced by the merge; it remains an upstream limitation.
- Logs: `.logs/2026-09-20/upgrade-v0426-tests.log` and
  `.logs/2026-09-20/upstream-v0426-baseline.log`.
- Full server/client suites, desktop packaging, paid generation and browser
  interaction acceptance were not run. Editor implementation is unchanged;
  browser reload/save acceptance remains a manual check.

## Local service

- Restarted the existing web deployment with hidden `pnpm dev` under Node 24.
- HTTP 200: homepage, proxied `/api/health`, `/api/style-profiles`,
  `/api/style-templates`, `/api/knowledge/documents`, `/api/tasks/overview`.
- Startup logs: `.logs/2026-09-20/upgrade-start.stdout.log` and stderr log.
- No manual resume, retry, generation, cancellation or deletion was requested
  through the API. Existing historical task projections were not cleaned up.
- URL: `http://127.0.0.1:5173/`.

## Manual acceptance

1. Create a novel and run AI resource recommendation; confirm genre and story
   mode selections proceed normally.
2. Edit chapter text without saving, reload and confirm local draft restoration;
   save and reload again to confirm the old draft does not return.
3. For the first real generation, inspect target chapter length and task errors;
   a provider disconnection must not make the health endpoint unavailable.
