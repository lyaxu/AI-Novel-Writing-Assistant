# Local controlled upgrade: 2026-09-25

## Scope and preservation

- Repository: `D:\novel\AI-Novel-Writing-Assistant`.
- Source: `codex/upgrade-v0.4.26-controlled`, `838e41c4`.
- Destination: `codex/upgrade-v0.4.28-controlled`.
- Target: stable upstream `v0.4.28`, `2c035ac7`, including v0.4.27.
- Adopt upstream DeepSeek Flash/Pro aliases, Kimi K3 fixed temperature across
  custom providers, count-based volume strategy budget and repeat radar analysis.
- Only README and release notes conflicted. Both histories were preserved.
- Local editor, stream rejection ownership, chapter execution contract budget,
  writer enhancements, style templates and timeline/context protection code
  remain unchanged from the source branch.
- Upstream volume strategy budget (1800-5200 tokens) does not replace the local
  8192-token chapter contract budget or the prose word-count controls.
- User launch scripts, probe databases and untracked manuscripts were untouched.

## Backup and schema synchronization

- No project service process or reachable port 5173 was found before upgrading.
- Backup directory: `.codex-backups/pre-v0.4.28-20260925/`.
- Copied `dev.db` (1,027,043,328 bytes), WAL (0 bytes) and SHM together.
- Backup `PRAGMA quick_check` returned `ok`; full-history `code.bundle` verified.
- Frozen-lockfile dependency install succeeded; dependencies already up to date.
- Non-destructive `prisma:push` completed without reset or data-loss flags.
- MarketTrendReport runId uniqueness was replaced by the runId/createdAt index,
  allowing multiple reports for one scan without deleting existing report rows.
- Complete row hashes and counts matched the backup for AppSetting (34),
  StyleProfile (7), StyleTemplate (11), KnowledgeDocument (1), MarketTrendReport
  (1), MarketSavedTopic (0) and MarketCreativeBrief (4).

## Verification

- Bundled Node 24.19.0 and pnpm 11.19.0; Prisma remains 7.4.2.
- Root typecheck passed: shared build, server, client and desktop checks.
- Server build passed.
- 21 targeted server test files: 161 passed, 0 failed, 0 skipped.
- Tests cover radar UI-state helpers and repeat/concurrent analysis, report
  migration reference preservation, DeepSeek/Kimi compatibility, volume strategy
  budgets and schema, migration completeness/runtime migration, strict-process
  stream failures, token/transport diagnostics, structured repair/retry, local
  writer controls, timeline ownership, chapter length and singleflight, director
  issue governance, quality loop, prompt slots, style sanitization and resource
  recommendation.
- Log: `.logs/2026-09-25/upgrade-v0428-tests.log`.
- No full test suites, desktop packaging, browser interaction or paid generation
  were run. Previous full-suite/baseline failures are not claimed fixed. The
  prior resource-delta-cap assertion was outside this run's selected scope.
- Editor implementation is byte-identical to the source branch; actual browser
  draft restoration and clear-after-save remain user acceptance checks.

## Runtime and acceptance

- Started hidden `pnpm dev` using bundled Node 24; no task resume or generation
  commands were issued.
- Startup logs: `.logs/2026-09-25/upgrade-start.stdout.log` and stderr log.
- Direct backend health and eight web/proxy endpoints returned HTTP 200:
  homepage, health, style profiles/templates, knowledge documents, radar sources,
  latest scan and latest report. No real scan or analysis was submitted.
- Local URL: `http://127.0.0.1:5173/`.
- Manual acceptance: change selected radar books and generate a new analysis;
  confirm old report-linked assets remain; test an unsaved chapter reload and
  then save/reload; observe the first real multi-volume planning run.
