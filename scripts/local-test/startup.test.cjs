const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { assertIdleDatabase, profile } = require('./entry.cjs');
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['DirectorRunCommand','DirectorRuntimeExecution','GenerationJob','NovelSideEffectJob','ShortStory','ShortStoryProductionRun','BookAnalysis','StyleExtractionTask','ImageGenerationTask','NovelWorkflowTask']) {
    db.exec(`CREATE TABLE "${name}" (id TEXT, status TEXT, pendingManualRecovery INTEGER, lane TEXT)`);
  }
  return db;
}
test('paused original director and pipeline can cold-start without changing saved records', () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO NovelWorkflowTask VALUES ('director','running',1,'auto_director'); INSERT INTO GenerationJob VALUES ('pipeline','queued',1,NULL)");
    assertIdleDatabase(db);
    assert.equal(db.prepare('SELECT pendingManualRecovery FROM NovelWorkflowTask').get().pendingManualRecovery, 1);
    assert.ok(profile.database.endsWith('old-test.db'));
    assert.ok(profile.url.startsWith('http://127.0.0.1:5190/novels/'));
  } finally { db.close(); }
});
for (const [table,status,pending,lane] of [
  ['NovelSideEffectJob','failed',0,null],
  ['NovelWorkflowTask','running',1,'creation_studio'],
  ['NovelWorkflowTask','queued',0,'auto_director'],
  ['DirectorRunCommand','queued',0,null],
  ['GenerationJob','running',0,null],
  ['ImageGenerationTask','generating',0,null],
]) test(`cold-start refuses runnable ${table}/${status}/${lane}`, () => {
  const db = fixture();
  try {
    db.prepare(`INSERT INTO "${table}" VALUES (?,?,?,?)`).run('job',status,pending,lane);
    assert.throws(() => assertIdleDatabase(db), /work exists/i);
    assert.equal(db.prepare(`SELECT count(*) n FROM "${table}"`).get().n,1);
  } finally { db.close(); }
});
