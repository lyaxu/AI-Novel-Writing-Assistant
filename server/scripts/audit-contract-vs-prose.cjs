#!/usr/bin/env node
/**
 * Contract-vs-prose audit — run it after writing a volume, or any time the question is
 * "did the chapters actually do what their contracts said".
 *
 *   node server/scripts/audit-contract-vs-prose.cjs <novelId> [chapterOrders...]
 *   node server/scripts/audit-contract-vs-prose.cjs --list        # show books and their chapters
 *
 * Requires a built server (pnpm --filter @ai-novel/server build) and the same LLM configuration the
 * app uses; the reading judgment is a model call, one per chapter with prose.
 *
 * The report is written to .codex-run/audit/<novelId>-<timestamp>.md and echoed to stdout.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadDistModule(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error("Build the server first: pnpm --filter @ai-novel/server build");
    }
    throw error;
  }
}

async function listBooks(prisma) {
  const novels = await prisma.novel.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 12,
    select: { id: true, title: true, createdAt: true },
  });
  for (const novel of novels) {
    const chapters = await prisma.chapter.findMany({
      where: { novelId: novel.id },
      orderBy: [{ order: "asc" }],
      select: { order: true, title: true, content: true },
    });
    const written = chapters.filter((chapter) => (chapter.content ?? "").trim().length > 0);
    console.log(`${novel.id}  ${novel.title}`);
    console.log(`    章节 ${chapters.length}，已写正文 ${written.length}：${written.map((c) => `第${c.order}章`).join(" ")}`);
  }
}

async function main() {
  const serverRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(serverRoot, "..");
  const args = process.argv.slice(2);

  const { prisma } = loadDistModule(path.join(repoRoot, "server", "dist", "db", "prisma.js"));

  if (args.length === 0 || args[0] === "--list") {
    await listBooks(prisma);
    await prisma.$disconnect();
    if (args.length === 0) {
      console.log("\n用法：node server/scripts/audit-contract-vs-prose.cjs <novelId> [chapterOrders...]");
      process.exitCode = 1;
    }
    return;
  }

  const { auditNovelContracts, renderContractProseReport } = loadDistModule(path.join(
    repoRoot, "server", "dist", "services", "novel", "audit", "ContractProseAuditService.js",
  ));

  const novelId = args[0];
  const chapterOrders = args.slice(1)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  const report = await auditNovelContracts({
    novelId,
    chapterOrders: chapterOrders.length ? chapterOrders : undefined,
    onProgress: (message) => console.log(`[audit] ${message}`),
  });
  await prisma.$disconnect();

  const markdown = renderContractProseReport(report);
  const outDir = path.join(repoRoot, ".codex-run", "audit");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `${novelId}-${stamp}.md`);
  fs.writeFileSync(outPath, markdown, "utf8");

  console.log("");
  console.log(markdown);
  console.log("");
  console.log(`报告已写入：${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
