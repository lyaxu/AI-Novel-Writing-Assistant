import fs from "node:fs";
import path from "node:path";
import type { RuntimeIdentity } from "@ai-novel/shared/types/runtimeIdentity";
import { resolveServerRoot, resolveWorkspaceRoot } from "./appPaths";

export type { RuntimeIdentity };

/**
 * Runtime identity, so "the code changed but the process did not reload" stops being invisible.
 *
 * Why this exists: a fix can be committed, reviewed and compiled while the process that answers
 * requests is still running the previous code. Nothing in the product said so, so the symptom was
 * indistinguishable from "the fix did not work" — during a real debugging session that cost a
 * false conclusion before the process start time was compared against the file mtime by hand.
 *
 * The signal that matters is deliberately mechanical: compare the newest source mtime against the
 * process start time. It does not depend on git state, so it also catches uncommitted edits, and it
 * works the same whether the server runs from source (ts-node-dev) or from `dist`.
 */

const PROCESS_STARTED_AT = new Date();
const CACHE_TTL_MS = 5_000;
const MAX_REPORTED_FILES = 5;
const MAX_WALKED_FILES = 20_000;

/**
 * The commit this process started from, captured once.
 *
 * Reading HEAD at request time would report commits made after startup, which would tell a reader
 * the running code is newer than it is — the exact misreading this module exists to prevent.
 */
const STARTUP_GIT_HEAD = readGitHead(resolveWorkspaceRoot());

// The shape lives in shared/types so the client renders exactly what the server reports.
export interface SourceFileStamp {
  file: string;
  mtimeMs: number;
}

function isExecutedFromSource(): boolean {
  // Under ts-node the module path still ends in .ts; a compiled build loads .js from dist.
  return __filename.endsWith(".ts");
}

function collectSourceRoots(): string[] {
  const serverRoot = resolveServerRoot();
  const workspaceRoot = resolveWorkspaceRoot();
  return [
    path.join(serverRoot, "src"),
    // Shared types are compiled into the server build; a change there also needs a reload.
    path.join(workspaceRoot, "shared", "types"),
  ].filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

function walk(root: string, onFile: (file: string, mtimeMs: number) => void): void {
  let visited = 0;
  const stack = [root];
  while (stack.length && visited < MAX_WALKED_FILES) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      visited += 1;
      try {
        onFile(full, fs.statSync(full).mtimeMs);
      } catch {
        /* A file that vanished mid-walk is not worth failing over. */
      }
    }
  }
}

function readGitHead(workspaceRoot: string): string | null {
  try {
    const gitPath = path.join(workspaceRoot, ".git");
    const stat = fs.statSync(gitPath);
    // A worktree or submodule keeps `.git` as a file pointing at the real git dir.
    const gitDir = stat.isDirectory()
      ? gitPath
      : path.resolve(workspaceRoot, fs.readFileSync(gitPath, "utf8").replace(/^gitdir:\s*/i, "").trim());
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 12);
    const ref = head.slice(4).trim();
    const refFile = path.join(gitDir, ref);
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, "utf8").trim().slice(0, 12);
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
    return line ? line.split(" ")[0].slice(0, 12) : null;
  } catch {
    return null;
  }
}

/**
 * The staleness decision, kept pure so it can be tested directly.
 *
 * An untested detector that silently returns "fresh" is worse than no detector, so the comparison
 * lives here rather than inline in the walk.
 */
export function evaluateStaleness(
  startedMs: number,
  files: readonly SourceFileStamp[],
  workspaceRoot: string,
): { newestSourceMtime: string | null; newerSources: string[]; stale: boolean } {
  let newestMs = 0;
  const newer: SourceFileStamp[] = [];
  for (const entry of files) {
    if (entry.mtimeMs > newestMs) newestMs = entry.mtimeMs;
    if (entry.mtimeMs > startedMs) newer.push(entry);
  }
  newer.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return {
    newestSourceMtime: newestMs ? new Date(newestMs).toISOString() : null,
    newerSources: newer.slice(0, MAX_REPORTED_FILES).map((entry) => path.relative(workspaceRoot, entry.file)),
    stale: newer.length > 0,
  };
}

function computeIdentity(): RuntimeIdentity {
  const workspaceRoot = resolveWorkspaceRoot();
  const startedMs = PROCESS_STARTED_AT.getTime();
  const files: SourceFileStamp[] = [];
  for (const root of collectSourceRoots()) {
    walk(root, (file, mtimeMs) => files.push({ file, mtimeMs }));
  }
  const staleness = evaluateStaleness(startedMs, files, workspaceRoot);
  return {
    pid: process.pid,
    startedAt: PROCESS_STARTED_AT.toISOString(),
    nodeVersion: process.version,
    executionMode: isExecutedFromSource() ? "source" : "compiled",
    ...staleness,
    gitHead: STARTUP_GIT_HEAD,
    currentGitHead: readGitHead(workspaceRoot),
  };
}

let cached: { at: number; value: RuntimeIdentity } | null = null;

/** Cached briefly: walking the source tree on every health request would be wasteful. */
export function readRuntimeIdentity(): RuntimeIdentity {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const value = computeIdentity();
  cached = { at: now, value };
  return value;
}

/** One-line description for logs and for the health payload's message. */
export function describeRuntimeIdentity(identity: RuntimeIdentity = readRuntimeIdentity()): string {
  const head = identity.gitHead ? ` @${identity.gitHead}` : "";
  if (!identity.stale) return `服务已加载最新代码（pid ${identity.pid}，启动于 ${identity.startedAt}${head}）`;
  return `服务正在运行旧代码：有 ${identity.newerSources.length} 个源文件在启动后被修改，需重启才能生效（pid ${identity.pid}，头几个：${identity.newerSources.join("、")}）`;
}
