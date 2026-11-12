import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {fixture} from './shelf/session-fixtures.mjs';
import {verifySession,readEvidence} from '../src/shelf/session-adapter.mjs';
import {declaredPaths} from '../src/shelf/native-delivery.mjs';
function message(f,session,id,seq,text,{role='assistant',child=false,truncated=false,turn='turn'}={}){
 f.item(session,JSON.stringify(id),seq,{kind:'message',role,blocks:[{type:'text',text,truncated}]},{itemId:id});
 const generation=f.journal.prepare('SELECT generation FROM journal_outcome_epochs WHERE session_id=?').get(session).generation;
 const row=f.journal.prepare('SELECT value_json FROM journal_outcomes WHERE generation=? AND seq=?').get(generation,seq);const v=JSON.parse(row.value_json);v.turnScope={kind:'turn',turnItemId:turn};if(child){v.agentId='child';v.producerKind='agent';}f.journal.prepare('UPDATE journal_outcomes SET value_json=? WHERE generation=? AND seq=?').run(JSON.stringify(v),generation,seq);
}
function complete(f,session,seq,turn='turn',outcome='success'){f.item(session,JSON.stringify(turn),seq,{kind:'turn',state:'completed',outcome},{itemId:turn});}
test('native Codex and Claude completed final deliveries are recovered, never child/user/tool references',async()=>{
 const f=await fixture();try{f.session('A','codex');f.session('B','claude');for(const id of ['A','B']){
  const session=await verifySession(f.paths,id,[f.workspace]),p=path.join(f.root,id+'.html'),q=path.join(f.root,id+'.md');
  message(f,id,'user',1,'已生成 [x]('+path.join(f.root,'wrong-user.html')+')',{role:'user'});
  message(f,id,'progress',2,'计划生成 `'+path.join(f.root,'not-yet.html')+'`');
  message(f,id,'final',3,'已完成交付：[页面]('+p+')\n```text\n'+q+'\n```\nPRIVATE TEXT');
  let r=await readEvidence(f.paths,session);assert.equal(r.evidence.length,0);
  complete(f,id,4);r=await readEvidence(f.paths,session,r.cache);assert.deepEqual(r.evidence.map(p=>p.path).sort(),[p,q].sort());assert.ok(r.evidence.every(p=>p.evidence.kind==='session-delivery'));assert.equal(JSON.stringify(r.cache).includes('PRIVATE TEXT'),false);
  message(f,id,'child',5,'已完成交付 [x]('+path.join(f.root,'wrong-child.html')+')',{child:true});r=await readEvidence(f.paths,session,r.cache);assert.equal(r.evidence.length,2);
  f.item(id,JSON.stringify('final'),6,null,{itemId:'final',deleted:1});r=await readEvidence(f.paths,session,r.cache);assert.equal(r.evidence.length,0);
 }}finally{await f.close();}
});
test('failed turns, final references and truncated output do not become deliveries',async()=>{
 const f=await fixture();try{f.session('A');const session=await verifySession(f.paths,'A',[f.workspace]);const p=path.join(f.root,'x.html');
 message(f,'A','a',1,'已完成交付 [x]('+p+')',{truncated:true});complete(f,'A',2);let r=await readEvidence(f.paths,session);assert.equal(r.evidence.length,0);
 message(f,'A','b',3,'已完成交付 [x]('+p+')');complete(f,'A',4,'turn','failure');r=await readEvidence(f.paths,session,r.cache);assert.equal(r.evidence.length,0);
 assert.deepEqual(declaredPaths('参考文件：已生成 [x]('+p+')',f.root),[]);assert.deepEqual(declaredPaths('已生成 [x]('+p,f.root),[]);assert.deepEqual(declaredPaths('已生成 [x](/outside/x.html)',f.root),[]);
 }finally{await f.close();}
});

test('recovered native delivery survives latest productive filtering and empty follow-up',async()=>{
 const {latestProductiveArtifacts}=await import('../src/shelf/latest-artifacts.mjs');
 const f=await fixture();try{
 f.session('A');const session=await verifySession(f.paths,'A',[f.workspace]),p=path.join(f.root,'delivered.html');
 message(f,'A','answer',1,'已完成交付 [page]('+p+')');complete(f,'A',2);
 let result=await readEvidence(f.paths,session);
 const select=r=>latestProductiveArtifacts({turns:r.turns,items:Object.fromEntries(r.evidence.map(e=>[e.path,{path:e.path,sourceEvidence:e.evidence}]))});
 assert.deepEqual(Object.keys(select(result).items),[p]);
 message(f,'A','empty',3,'好的',{turn:'empty-turn'});complete(f,'A',4,'empty-turn');
 result=await readEvidence(f.paths,session,result.cache);assert.deepEqual(Object.keys(select(result).items),[p]);
 // Old delivery caches must be rebuilt even when the journal has not changed.
 result.cache.readerVersion=3;for(const v of Object.values(result.cache.deliveryTurns||{}))for(const e of v||[])if(e.evidence)delete e.evidence.turnItemId;
 result=await readEvidence(f.paths,session,result.cache);assert.deepEqual(Object.keys(select(result).items),[p]);
 }finally{await f.close();}
});
