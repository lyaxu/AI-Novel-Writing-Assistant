const test=require('node:test');const assert=require('node:assert/strict');
const {StructuredOutputError}=require('../dist/llm/structuredOutput.js');
const {shouldFallbackToStagedAutoCast}=require('../dist/services/novel/characterPrep/characterCastGeneration.js');
const make=(category)=>new StructuredOutputError({message:'limit',category,diagnostics:{}});
test('cast auto falls back to staged members/relations on provider output limit',()=>{
 for(const category of ['output_limit','incomplete_json','malformed_json','schema_mismatch']) assert.equal(shouldFallbackToStagedAutoCast(make(category)),true,category);
 for(const category of ['transport_error']) assert.equal(shouldFallbackToStagedAutoCast(make(category)),false,category);
 assert.equal(shouldFallbackToStagedAutoCast(new Error('x')),false);
});
