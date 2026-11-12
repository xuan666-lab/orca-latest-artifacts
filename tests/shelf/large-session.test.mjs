import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './session-fixtures.mjs';
import {createChunkedStorage} from '../../src/shelf/storage.mjs';
import {createShelf} from '../../src/shelf/service.mjs';

const hostStore=()=>{
  const values=new Map();
  return {values,
    get:async k=>structuredClone(values.get(k)??null),
    set:async(k,v)=>{
      const size=Buffer.byteLength(JSON.stringify(v));
      assert.ok(size<=256*1024,'host single-value limit');
      const total=[...values].filter(([key])=>key!==k).reduce((n,[,value])=>n+Buffer.byteLength(JSON.stringify(value)),size);
      if(total>5*1024*1024)throw Error('host total storage limit');
      if(!values.has(k)&&values.size>=1024)throw Error('host key count limit');
      values.set(k,structuredClone(v));
    },delete:async k=>values.delete(k),keys:async()=>[...values.keys()]};
};

test('large native history preserves the full index and latest productive round through restart',async()=>{
  const f=await fixture(),raw=hostStore();let shelf;
  const start=()=>createShelf({storage:createChunkedStorage(raw),host:{call:async()=>({workspaces:[f.workspace]})},panels:{post(){}},log(){}},{sessions:true,sessionOptions:{paths:f.paths,registrationDirectory:path.join(f.root,'registrations')}});
  try{
    f.session('A');f.current('A');
    const file=path.join(f.root,'结果🙂.html');await fs.writeFile(file,'<h1>Report</h1>');
    for(let i=1;i<=3500;i++)f.item('A','write-'+i,i,{kind:'diff',path:file,patch:{head:'not exported',truncated:false}});
    const latest=path.join(f.root,'latest.md');await fs.writeFile(latest,'# Latest');
    f.item('A','latest-turn',3501,{kind:'turn',state:'completed',outcome:'success'});
    f.item('A','latest-write',3502,{kind:'diff',path:latest,patch:{head:'not exported',truncated:false}});
    f.journal.prepare("UPDATE journal_outcomes SET value_json=json_set(value_json,'$.turnScope.turnItemId','latest-turn') WHERE entry_key='latest-write'").run();
    f.item('A','empty-turn',3503,{kind:'turn',state:'completed',outcome:'success'});
    shelf=start();let view=await shelf.action();
    for(let i=0;i<5&&view.sessionLoading;i++)view=await shelf.action({action:'refresh'});
    assert.equal(view.sessionStatus,null);
    assert.deepEqual(Object.keys(view.tasks[0].items),[latest]);
    assert.equal(view.productiveTurn.id,'latest-turn');
    assert.ok(Buffer.byteLength(JSON.stringify(view))<256*1024);
    const stored=await createChunkedStorage(raw).get('session.cursor.v1.A');
    assert.equal(Object.keys(stored.entries).length,3501);
    assert.ok(Buffer.byteLength(JSON.stringify(stored))>256*1024);
    assert.equal((await createChunkedStorage(raw).get('shelf')).sessionTask,undefined);
    await shelf.dispose();shelf=start();view=await shelf.action();
    assert.deepEqual(Object.keys(view.tasks[0].items),[latest]);
    assert.equal(view.sessionStatus,null);
  }finally{await shelf?.dispose();await f.close();}
});

test('quota failures do not blank the current list or report user edits as saved',async()=>{
  const f=await fixture(),raw=hostStore();let shelf;
  try{
    f.session('A');f.current('A');const file=path.join(f.root,'a.md');await fs.writeFile(file,'# A');
    f.item('A','w',1,{kind:'diff',path:file,patch:{head:'private',truncated:false}});
    raw.set=async()=>{throw Error('host total storage limit');};
    shelf=createShelf({storage:createChunkedStorage(raw),host:{call:async()=>({workspaces:[f.workspace]})},panels:{post(){}},log(){}},{sessions:true,sessionOptions:{paths:f.paths,registrationDirectory:path.join(f.root,'registrations')}});
    const view=await shelf.action();
    assert.deepEqual(Object.keys(view.tasks[0].items),[file]);
    assert.match(view.sessionStatus,/缓存未能保存/);
    await assert.rejects(shelf.action({action:'remove',path:file,taskId:view.active,revision:view.revision}),/host total storage limit/);
    assert.equal(raw.values.size,0);
    assert.deepEqual(Object.keys((await shelf.action()).tasks[0].items),[file]);
  }finally{await shelf?.dispose();await f.close();}
});
