const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { chapterFingerprint } = require('../../dist/services/novel/production/reliability/types');
const { reconcilePausedDirectorBinding } = require('../../scripts/reconcile-paused-director-binding.cjs');

function fixture() {
  const db = new DatabaseSync(':memory:');
  const chapter = { id: 'chapter', novelId: 'novel', order: 1, content: '已经保存的首章', title: '首章', taskSheet: '计划', sceneCards: '{}', expectation: null, targetWordCount: 3000 };
  const job = { novelId: 'novel', currentItemKey: 'chapter', payload: JSON.stringify({ workflowTaskId: 'director', maxRetries: 1 }), startOrder: 1, endOrder: 1,
    status: 'failed', pendingManualRecovery: 1, cancelRequestedAt: null, executionOwner: null, executionLeaseExpiresAt: null,
    llmCallCount: 0, totalTokens: 0, completedCount: 0, error: 'review incomplete', retryCount: 1 };
  const seed = { directorInput: { autoExecutionPlan: { mode: 'chapter_range', startOrder: 1, endOrder: 3 } }, autoExecution: {
    mode: 'chapter_range', startOrder: 1, endOrder: 3, pipelineJobId: 'wrong', pipelineStatus: 'failed', qualityLoopLedger: { used: 1 } } };
  const task = { id: 'director', novelId: 'novel', lane: 'auto_director', status: 'queued', pendingManualRecovery: 1, cancelRequestedAt: null,
    updatedAt: 'before', seedPayloadJson: JSON.stringify(seed), lastError: 'conflict' };
  const journal = { operationId: 'pipeline:original:chapter', request: { workflowTaskId: 'director', entry: 'pipeline' }, status: 'paused', expiresAt: 0,
    expectedFingerprint: chapterFingerprint(chapter), steps: Object.fromEntries(['prepare','pipeline.options','pipeline.draft','pipeline.save_draft'].map(k=>[k,{status:'done'}])) };
  journal.steps['pipeline.review:0'] = { status: 'failed' };
  const checkpoint = { id: 'journal', novelId: 'novel', chapterId: 'chapter', artifactType: 'production_execution', syncMode: 'journal', contentHash: 'active', metadataJson: JSON.stringify(journal) };
  function table(name, rows) {
    const keys = Object.keys(rows[0]);
    db.exec(`CREATE TABLE "${name}" (${keys.map(k=>`"${k}"`).join(',')})`);
    const insert=db.prepare(`INSERT INTO "${name}" VALUES (${keys.map(()=>'?').join(',')})`);
    for(const row of rows) insert.run(...keys.map(k=>row[k]));
  }
  table('Chapter',[chapter]); table('NovelWorkflowTask',[task]); table('GenerationJob',[{id:'original',...job},{id:'wrong',...job}]);
  table('ChapterArtifactSyncCheckpoint',[checkpoint]);
  db.exec('CREATE TABLE DirectorRunCommand(id, taskId, status)');
  const expected={taskId:'director',novelId:'novel',chapterId:'chapter',originalJobId:'original',displacedJobId:'wrong',taskUpdatedAt:'before',
    contentHash:createHash('sha256').update(chapter.content).digest('hex')};
  const snapshot=()=>Object.fromEntries(['Chapter','GenerationJob','ChapterArtifactSyncCheckpoint','DirectorRunCommand'].map(t=>[t,db.prepare(`SELECT * FROM "${t}"`).all()]));
  return { db, expected, journal, snapshot };
}

test('explicit paused binding reconciliation changes only pointer/error; preserves drafts, journals, budgets and failed evidence',()=>{
  const f=fixture();try {
    const before=f.snapshot(); const taskBefore=f.db.prepare('SELECT * FROM NovelWorkflowTask').get();
    assert.equal(reconcilePausedDirectorBinding(f.db,f.expected).applied,false);
    assert.deepEqual(f.db.prepare('SELECT * FROM NovelWorkflowTask').get(),taskBefore);
    reconcilePausedDirectorBinding(f.db,f.expected,{apply:true,now:1000});
    assert.deepEqual(f.snapshot(),before);
    const after=f.db.prepare('SELECT * FROM NovelWorkflowTask').get();
    assert.equal(JSON.parse(after.seedPayloadJson).autoExecution.pipelineJobId,'original');
    const oldSeed=JSON.parse(taskBefore.seedPayloadJson);oldSeed.autoExecution.pipelineJobId='original';
    assert.deepEqual(JSON.parse(after.seedPayloadJson),oldSeed);assert.equal(after.pendingManualRecovery,1);
    assert.throws(()=>reconcilePausedDirectorBinding(f.db,f.expected,{apply:true}),/changed since inspection/);
  }finally{f.db.close();}
});

const unsafe = {
  manual_edit: f=>f.db.exec("UPDATE Chapter SET content='手改正文'"),
  changed_contract: f=>f.db.exec("UPDATE Chapter SET taskSheet='另一个计划'"),
  cancelled: f=>f.db.exec("UPDATE GenerationJob SET cancelRequestedAt='2026-01-01' WHERE id='original'"),
  active_job: f=>f.db.exec("UPDATE GenerationJob SET executionOwner='worker',executionLeaseExpiresAt='2099-01-01' WHERE id='original'"),
  active_command: f=>f.db.exec("INSERT INTO DirectorRunCommand VALUES('cmd','director','running')"),
  wrong_parent: f=>f.db.exec(`UPDATE GenerationJob SET payload='{"workflowTaskId":"other"}' WHERE id='original'`),
  displaced_model_call: f=>f.db.exec("UPDATE GenerationJob SET llmCallCount=1 WHERE id='wrong'"),
  journal_unknown: f=>{f.journal.steps['pipeline.review:0'].status='unknown';f.db.prepare('UPDATE ChapterArtifactSyncCheckpoint SET metadataJson=?').run(JSON.stringify(f.journal));},
  journal_wrong_owner: f=>{f.journal.operationId='pipeline:wrong:chapter';f.db.prepare('UPDATE ChapterArtifactSyncCheckpoint SET metadataJson=?').run(JSON.stringify(f.journal));},
  changed_task: f=>{f.expected.taskUpdatedAt='stale';},
};
for(const [name,mutate] of Object.entries(unsafe))test(`reconciliation rejects ${name} without any write`,()=>{
  const f=fixture();try{mutate(f);const before=f.snapshot();const task=f.db.prepare('SELECT * FROM NovelWorkflowTask').get();
    assert.throws(()=>reconcilePausedDirectorBinding(f.db,f.expected,{apply:true}));
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.db.prepare('SELECT * FROM NovelWorkflowTask').get(),task);
  }finally{f.db.close();}
});
