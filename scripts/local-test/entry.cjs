// This checkout's explicitly selected legacy test environment. Never fall back to dev.db.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const database = path.resolve(root, '../.comparison/2026-10-10/old-test.db');
const novelId = 'cmv3wyvw40015gow0780pycx9';
const taskId = 'cmv8d55el0033z8w0hneoiiru';
const profile = {
  root, database, novelId, taskId,
  url: `http://127.0.0.1:5190/novels/${novelId}/edit?directorTaskId=${taskId}`,
  fingerprint: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
};

function assertIdleDatabase(db) {
  if (db.prepare("SELECT count(*) n FROM NovelSideEffectJob WHERE status='failed'").get().n
    || db.prepare("SELECT count(*) n FROM NovelWorkflowTask WHERE lane='creation_studio' AND status IN ('queued','running')").get().n) {
    throw new Error('Background retry or creation-studio work exists; inspect it before cold startup.');
  }
  for (const table of ['DirectorRunCommand', 'DirectorRuntimeExecution', 'GenerationJob', 'NovelSideEffectJob', 'ShortStory', 'ShortStoryProductionRun', 'BookAnalysis', 'StyleExtractionTask', 'ImageGenerationTask', 'NovelWorkflowTask']) {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (!cols.some(c => c.name === 'status')) continue;
    const rows = db.prepare(`SELECT * FROM "${table}" WHERE status IN ('running','queued','leased','pending','generating')`).all();
    if (rows.some(r => r.pendingManualRecovery !== 1)) throw new Error(`Unpaused work exists in ${table}; inspect it before cold startup.`);
  }
}

function inspectDatabase({ requireIdle = true } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('This SQLite runtime requires Node 24.');
  if (!fs.existsSync(database)) throw new Error(`Test database is missing: ${database}`);
  // Load the application's native driver as well as checking the file read-only.
  const Database = require(require.resolve('better-sqlite3', { paths: [path.join(root, 'server')] }));
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const novel = db.prepare('SELECT id FROM Novel WHERE id=?').get(novelId);
    const task = db.prepare('SELECT id,novelId,status,pendingManualRecovery FROM NovelWorkflowTask WHERE id=?').get(taskId);
    if (!novel || task?.novelId !== novelId) throw new Error('The configured database does not contain the expected book and original task.');
    if (requireIdle) assertIdleDatabase(db);
    return { ...profile, task, chapters: db.prepare('SELECT "order",content FROM Chapter WHERE novelId=? ORDER BY "order"').all(novelId).map(c => ({ order: c.order, chars: c.content?.length ?? 0, sha256: createHash('sha256').update(c.content ?? '').digest('hex') })) };
  } finally { db.close(); }
}

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'profile') console.log(JSON.stringify(profile));
  else if (mode === 'check') console.log(JSON.stringify(inspectDatabase()));
  else if (mode === 'server' || mode === 'client') {
    if (!fs.existsSync(database)) throw new Error('Test database is missing; startup refused.');
    Object.assign(process.env, {
      AI_NOVEL_RUNTIME: 'web', DATABASE_URL: `file:${database.replaceAll('\\', '/')}`,
      HOST: '127.0.0.1', PORT: '3000', CORS_ORIGIN: 'http://127.0.0.1:5190',
      RAG_ENABLED: 'false', AI_NOVEL_LOG_CLEANUP_ENABLED: 'false', LLM_DEBUG_FILE_LOG: 'true',
    });
    if (mode === 'server') {
      inspectDatabase();
      process.chdir(path.join(root, 'server'));
      const runner = require.resolve('ts-node-dev', { paths: [process.cwd()] });
      require(require.resolve('ts-node/register/transpile-only', { paths: [runner] }));
      require(path.join(process.cwd(), 'src/app.ts')).startServer().catch(error => {
        console.error('[local-test] Backend startup failed.', error);
        process.exit(1);
      });
    } else {
      process.chdir(path.join(root, 'client'));
      const vite = path.join(path.dirname(require.resolve('vite/package.json', { paths: [process.cwd()] })), 'bin/vite.js');
      process.argv = [process.execPath, vite, '--host', '127.0.0.1', '--port', '5190', '--strictPort'];
      import(require('node:url').pathToFileURL(vite).href);
    }
  } else throw new Error('Expected profile, check, server, or client.');
}
module.exports = { profile, inspectDatabase, assertIdleDatabase };
