import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './session-fixtures.mjs';
import { createSessionCatalog } from '../../src/shelf/session-catalog.mjs';
import { createChunkedStorage } from '../../src/shelf/storage.mjs';

const delivery = (id, file) => JSON.stringify({type:'assistant', sessionId:'S', uuid:id,
  timestamp:'2026-11-12T01:00:00Z', message:{stop_reason:'end_turn',content:[{type:'text',text:'交付产物\n```text\n'+file+'\n```'}]}})+'\n';

test('full host quota keeps verified Claude terminal artifacts available, including after worker restart', async () => {
  const f = await fixture();
  const statusDb=path.join(f.root,'hooks.db'), transcript=path.join(f.root,'S.jsonl');
  const db=new DatabaseSync(statusDb);
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('schema_version','202');CREATE TABLE rows(key TEXT PRIMARY KEY,seq INTEGER,value TEXT)");
  const terminal={handle:'term',incarnationId:'inc',tabId:'terminal-tab',leafId:'leaf',worktreeId:f.workspace.id,
    worktreePath:f.root,connected:true,orphaned:false,executionHostId:'local',agentIdentity:'claude'};
  const identity={providerSession:{id:'S',key:'session_id',transcriptPath:transcript,cwd:f.root},
    agentPresence:{sessionOwner:true,process:{pid:1,startTime:'Tue Nov 10 07:25:19 2026',platform:'darwin'}},
    hostTurn:{owner:'claude:S'},payload:{agentType:'claude'},worktreeId:f.workspace.id,
    tabId:'terminal-tab',paneKey:'terminal-tab:leaf',connectionId:null};
  db.prepare('INSERT INTO rows VALUES(?,?,?)').run('entry\0terminal-tab:leaf',1,JSON.stringify(identity));
  const values=new Map(Array.from({length:20},(_,i)=>['reserved-'+i,'x'.repeat(256*1024-2)]));
  const bytes=v=>Buffer.byteLength(JSON.stringify(v));
  const raw={get:async k=>structuredClone(values.get(k)??null),keys:async()=>[...values.keys()],delete:async k=>values.delete(k),
    set:async(k,v)=>{assert.ok(bytes(v)<=256*1024);const total=[...values].filter(([key])=>key!==k).reduce((n,[,value])=>n+bytes(value),bytes(v));if(total>5*1024*1024)throw Error('host total storage exceeds 5 MiB');values.set(k,structuredClone(v));}};
  let cacheReads=0,cacheWrites=0;
  const start=()=>{
    const storage=createChunkedStorage(raw);
    return createSessionCatalog({storage:{...storage,
      getCache:async k=>{cacheReads++;return storage.getCache(k);},
      setCache:async(k,v)=>{cacheWrites++;return storage.setCache(k,v);}},
      host:{call:async()=>({workspaces:[f.workspace]})}},
      {paths:f.paths,trackerDirectory:path.join(f.root,'tracking'),liveTerminals:async()=>[terminal],
       existingTerminal:{statusDb,allowFixturePaths:true,runner:async()=>({stdout:'Tue Nov 10 07:25:19 2026 claude'})}});
  };
  try {
    const first=path.join(f.root,'first.html'),second=path.join(f.root,'第二.xlsx');
    await fs.writeFile(first,'<h1>First</h1>');await fs.writeFile(second,'spreadsheet');
    await fs.writeFile(transcript,delivery('first',first));
    f.current('A');f.part(['activeTabTypeByWorktree',f.workspace.id],'terminal');f.part(['activeTabIdByWorktree',f.workspace.id],'terminal-tab');
    f.part(['tabGroups',f.workspace.id],[{id:'g',worktreeId:f.workspace.id,activeTabId:'terminal-tab'}]);
    let catalog=start(), result=await catalog.refresh(null);
    assert.equal(result.terminalStatus,'connected');
    assert.deepEqual(Object.keys(result.task.items),[first]);
    assert.match(result.status,/缓存未能保存/);
    await fs.appendFile(transcript,delivery('second',second));
    result=await catalog.refresh(result.task);
    assert.deepEqual(Object.keys(result.task.items).sort(),[first,second].sort());
    assert.match(result.status,/缓存未能保存/);
    assert.ok(cacheReads>=2);assert.ok(cacheWrites>=2);
    const writesBefore=cacheWrites;
    result=await catalog.refresh(result.task);
    assert.deepEqual(Object.keys(result.task.items).sort(),[first,second].sort());
    assert.match(result.status,/缓存未能保存/);
    assert.equal(cacheWrites,writesBefore,'unchanged cache is not rewritten every refresh');
    // A new adapter/catalog has no memory cache. Rebuild from the untouched transcript.
    catalog=start();result=await catalog.refresh(null);
    assert.deepEqual(Object.keys(result.task.items).sort(),[first,second].sort());
    assert.equal(result.terminalStatus,'connected');assert.match(result.status,/缓存未能保存/);
    assert.equal(values.size,20);
  } finally {db.close();await f.close();}
});
