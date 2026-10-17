require('./novelProduction/offlineBootstrap.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareCastForPersistence, selectCastBatch } = require('../dist/services/novel/characterPrep/domain/characterCastCoverage.js');
const { developCastBatchWorkflow } = require('../dist/services/novel/characterPrep/application/developCharacterCastBatch.js');
const { buildCharacterCastContextBlocks } = require('../dist/prompting/prompts/novel/characterPreparation.contextBlocks.js');
const { characterCastDevelopBatchPrompt } = require('../dist/prompting/prompts/novel/characterPreparation.development.prompts.js');
function plan(count = 12) {
  return { version: 1, scope: 'book', targetChapterCount: 100, targetWordCount: 300000, rationale: '覆盖四卷人物职责', roles: Array.from({length: count}, (_, i) => ({identityKey: `person-${i}`, name: `人物${i}`, tier: i < 3 ? 'core' : 'arc', storyFunction: `承担第${i}条关系线`, introductionStage: `第${i + 1}阶段`, detailStatus: 'planned'})) };
}
function member(i) { return { identityKey: `person-${i}`, name: `人物${i}`, role: '同行', gender: 'unknown', castRole: i ? 'ally' : 'protagonist', storyFunction: '承担关系线', prohibitions: [] }; }
test('AI full book coverage is not capped by the initial core cast or the seven chapter batch', () => {
  const original = plan(17);
  const result = prepareCastForPersistence({coveragePlan: original, members: [member(0),member(1),member(2)]});
  assert.equal(result.coveragePlan.roles.length, 17);
  assert.equal(result.coveragePlan.roles.filter(r => r.detailStatus === 'completed').length, 3);
  assert.equal(result.coveragePlan.targetChapterCount, 100);
  assert.equal(original.roles[0].detailStatus, 'planned');
  assert.equal(selectCastBatch(result.coveragePlan).length, 6);
  const short = prepareCastForPersistence({coveragePlan: {...plan(3),targetChapterCount:8}, members:[member(0),member(1),member(2)]});
  assert.equal(short.coveragePlan.roles.length,3);
});
test('book scale context carries canonical novel scope and volume duties', () => {
  const content = buildCharacterCastContextBlocks({projectTitle:'测试',storyInput:'故事',targetChapterCount:100,targetWordCount:300000,volumeStructure:[{title:'远行',sortOrder:2,summary:'关系扩展'}]}).map(b=>b.content).join('\n');
  assert.match(content,/整书目标章数：100/);assert.match(content,/远行/);assert.match(content,/不得用当前写作批次替代全书规模/);
});
test('later batch failure preserves completed members and retry only invokes remaining identities', async () => {
  const state = {plan:plan(3),members:[]}; const calls=[]; let fail=true;
  const deps={load:async()=>structuredClone(state),generate:async(role)=>{calls.push(role.identityKey);if(role.identityKey==='person-1'&&fail)throw new Error('provider offline');return member(Number(role.identityKey.split('-')[1]));},save:async(key,m)=>{state.members.push(m);state.plan.roles.find(r=>r.identityKey===key).detailStatus='completed';}};
  await assert.rejects(developCastBatchWorkflow(deps),/provider offline/);
  assert.equal(state.members.length,1);assert.equal(state.plan.roles[0].detailStatus,'completed');
  fail=false;await developCastBatchWorkflow(deps);
  assert.deepEqual(calls,['person-0','person-1','person-1','person-2']);assert.equal(state.members.length,3);
  await developCastBatchWorkflow(deps);assert.equal(calls.length,4);
});
test('batch re-reads a renamed locked role before generation and rejects identity drift', async () => {
  const state={plan:plan(1),members:[]};let reads=0;let saveCalls=0;
  await assert.rejects(developCastBatchWorkflow({load:async()=>{if(++reads>1){state.plan.roles[0].name='用户姓名';state.plan.roles[0].nameLocked=true;}return structuredClone(state);},generate:async(role)=>{assert.equal(role.name,'用户姓名');return {...member(0),identityKey:'wrong'};},save:async()=>{saveCalls++;}}),/不同身份/);
  assert.equal(saveCalls,0);
});
test('development prompt rejects changing or repeating requested identities', () => {
  const input={identities:[{identityKey:'person-0',name:'用户姓名'}]};
  assert.throws(()=>characterCastDevelopBatchPrompt.postValidate({members:[member(0)]},input),/姓名/);
  const output={members:[{...member(0),name:'用户姓名'}]};assert.equal(characterCastDevelopBatchPrompt.postValidate(output,input),output);
});
test('additive sqlite migration preserves preexisting option/member/relation rows', () => {
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE CharacterCastOption (id TEXT PRIMARY KEY);CREATE TABLE CharacterCastOptionMember (id TEXT PRIMARY KEY, optionId TEXT, name TEXT);CREATE TABLE CharacterCastOptionRelation (id TEXT PRIMARY KEY);INSERT INTO CharacterCastOption VALUES ('old-option');INSERT INTO CharacterCastOptionMember VALUES ('old-member','old-option','保留原名');INSERT INTO CharacterCastOptionRelation VALUES ('old-relation');`);
  db.exec(fs.readFileSync(path.join(__dirname,'../src/prisma/migrations.sqlite/20261017010000_character_cast_coverage_identity/migration.sql'),'utf8'));
  const row=db.prepare('SELECT * FROM CharacterCastOptionMember').get();assert.equal(row.name,'保留原名');assert.equal(row.nameLocked,0);assert.equal(row.aliasesJson,'[]');assert.equal(db.prepare('SELECT COUNT(*) AS count FROM CharacterCastOptionRelation').get().count,1);db.close();
});
const { prisma } = require('../dist/db/prisma.js');
const { persistCharacterCastOptionsDraft } = require('../dist/services/novel/characterPrep/infrastructure/characterCastRepository.js');
test('shared persistence appends candidates and stores stable member/relation identities', async () => {
  const saved=[];const original=prisma.$transaction;
  prisma.$transaction=async(run)=>run({characterCastOption:{create:async(data)=>{saved.push(data.data);}}});
  try {
    await persistCharacterCastOptionsDraft('novel','story',{options:[{title:'候选',summary:'摘要',coveragePlan:plan(8),members:[member(0),member(1),member(2)],relations:[{sourceName:'人物0',targetName:'人物1',surfaceRelation:'同行'}]}]});
    assert.equal(saved.length,1);assert.equal(saved[0].members.create[0].identityKey,'person-0');
    assert.equal(saved[0].relations.create[0].sourceIdentityKey,'person-0');
    assert.equal(saved[0].relations.create[0].targetIdentityKey,'person-1');
    assert.equal(JSON.parse(saved[0].coveragePlanJson).roles.length,8);
  } finally {prisma.$transaction=original;}
});

test('real batch persistence rejects stale names then keeps user locks on an explicit retry', async () => {
  const runner=require('../dist/prompting/core/promptRunner.js');
  const generation=require('../dist/services/novel/characterPrep/characterCastGeneration.js');
  const {developCharacterCastBatch}=require('../dist/services/novel/characterPrep/application/developCharacterCastBatch.js');
  const saved=[];const coverage=plan(1);const row={id:'option',novelId:'novel',coveragePlanJson:JSON.stringify(coverage),members:[],updatedAt:new Date(1)};
  const original={find:prisma.characterCastOption.findFirst,transaction:prisma.$transaction,run:runner.runStructuredPrompt,context:generation.loadCastGenerationContext};
  prisma.characterCastOption.findFirst=async()=>structuredClone(row);
  generation.loadCastGenerationContext=async()=>({contextBlocks:[],storyInput:'story'});
  runner.runStructuredPrompt=async()=>{coverage.roles[0].name='用户决定的新名';coverage.roles[0].nameLocked=true;coverage.roles[0].aliases=['人物0'];row.coveragePlanJson=JSON.stringify(coverage);row.updatedAt=new Date(2);return {output:{members:[member(0)]}};};
  prisma.$transaction=async(run)=>run({characterCastOption:{findFirst:async()=>structuredClone(row),updateMany:async({data})=>{Object.assign(row,data);return {count:1};}},characterCastOptionMember:{create:async({data})=>{saved.push(data);row.members.push(data);}}});
  try {
    await assert.rejects(developCharacterCastBatch('novel','option',{}),/姓名在完善期间已修改/);
    assert.equal(saved.length,0);
    runner.runStructuredPrompt=async()=>({output:{members:[{...member(0),name:'用户决定的新名'}]}});
    await developCharacterCastBatch('novel','option',{});
    assert.equal(saved[0].name,'用户决定的新名');assert.equal(saved[0].nameLocked,true);assert.equal(saved[0].aliasesJson,'["人物0"]');
    assert.equal(JSON.parse(row.coveragePlanJson).roles[0].detailStatus,'completed');
  } finally {prisma.characterCastOption.findFirst=original.find;prisma.$transaction=original.transaction;runner.runStructuredPrompt=original.run;generation.loadCastGenerationContext=original.context;}
});
test('invalid duplicate and missing roster identities cannot be persisted', () => {
  const duplicate=plan(3);duplicate.roles[1].identityKey=duplicate.roles[0].identityKey;
  assert.throws(()=>prepareCastForPersistence({coveragePlan:duplicate,members:[member(0)]}),/重复身份/);
  assert.throws(()=>prepareCastForPersistence({coveragePlan:plan(1),members:[member(5)]}),/未关联/);
  assert.throws(()=>selectCastBatch(plan(1),['foreign-key']),/不在/);
});
test('identity keys are scoped to each candidate and locked name context is explicit', () => {
  const a=prepareCastForPersistence({coveragePlan:plan(3),members:[member(0)]});
  const b=prepareCastForPersistence({coveragePlan:plan(3),members:[{...member(0),name:'另一候选主角'}]});
  assert.equal(a.coveragePlan.roles[0].name,'人物0');assert.equal(b.coveragePlan.roles[0].name,'另一候选主角');
  const content=buildCharacterCastContextBlocks({projectTitle:'测试',storyInput:'故事',lockedCharacterIdentities:[{optionId:'source-option',members:[{identityKey:'person-0',name:'用户姓名',nameLocked:true,aliases:['旧姓名']}]}]}).map(b=>b.content).join('\n');
  assert.match(content,/用户姓名/);assert.match(content,/旧姓名/);assert.match(content,/不得恢复为主名或另建同人/);
});

test('single identity development schema rejects extra generated profiles', () => {
  const {characterCastDevelopBatchSchema}=require('../dist/prompting/prompts/novel/characterPreparation.promptSchemas.js');
  assert.equal(characterCastDevelopBatchSchema.safeParse({members:[member(0),member(1)]}).success,false);
});

test('AI cannot mint a user name lock or mark ungenerated profiles complete', () => {
  const input=plan(2);input.roles.forEach(role=>{role.nameLocked=true;role.detailStatus='completed';role.aliases=['自然称呼'];});
  const result=prepareCastForPersistence({coveragePlan:input,members:[member(0)]});
  assert.equal(result.coveragePlan.roles[0].nameLocked,false);
  assert.equal(result.coveragePlan.roles[1].nameLocked,false);
  assert.equal(result.coveragePlan.roles[1].detailStatus,'planned');
  assert.deepEqual(result.coveragePlan.roles[0].aliases,['自然称呼']);
});

test('subsequent generation uses bound asset names over stale candidate locks', () => {
  const {buildCastIdentityContext}=require('../dist/services/novel/characterPrep/domain/characterCastCoverage.js');
  const result=buildCastIdentityContext([{id:'option',coveragePlanJson:JSON.stringify(plan(1)),members:[{identityKey:'person-0',name:'人物0',aliasesJson:'[]',appliedCharacterId:'actual',nameLocked:true}]}],[{id:'actual',name:'档案新姓名'}]);
  assert.equal(result[0].members[0].name,'档案新姓名');assert.deepEqual(result[0].members[0].aliases,['人物0']);
  assert.equal(result[0].coveragePlan.roles[0].name,'档案新姓名');
});

test('single-process batch guard rejects overlapping requests and releases after failure', async () => {
  const {withCastDevelopmentFlight}=require('../dist/services/novel/characterPrep/application/developCharacterCastBatch.js');
  let finish;const gate=new Promise(resolve=>{finish=resolve;});let calls=0;
  const first=withCastDevelopmentFlight('novel','same',async()=>{calls++;await gate;throw new Error('provider failed');});
  await assert.rejects(withCastDevelopmentFlight('novel','same',async()=>{calls++;}),/正在完善/);
  await withCastDevelopmentFlight('novel','different',async()=>{calls++;});
  assert.equal(calls,2);finish();await assert.rejects(first,/provider failed/);
  await withCastDevelopmentFlight('novel','same',async()=>{calls++;});assert.equal(calls,3);
});
