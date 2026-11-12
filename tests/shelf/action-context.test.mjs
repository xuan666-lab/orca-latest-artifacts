import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createShelf} from '../../src/shelf/service.mjs';

test('file actions reject stale card task and revision instead of acting on another task sharing the path', async () => {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'artifact-action-'))),values=new Map();let opens=0;
 const shelf=createShelf({storage:{get:async k=>structuredClone(values.get(k)),set:async(k,v)=>values.set(k,structuredClone(v))},panels:{post(){}},log(){}},{stableMs:1,open:async()=>{opens++;}});
 try{
  const file=path.join(root,'shared.html');await fs.writeFile(file,'same file');
  await shelf.action({action:'start',name:'A',roots:root});
  const a=await shelf.action({action:'import'});
  await shelf.action({action:'start',name:'B',roots:root});
  const b=await shelf.action({action:'import'});
  for(const action of ['remove','deliver','open','reveal']){
   await assert.rejects(shelf.action({action,path:file,taskId:a.active,revision:a.revision}),/产物列表已更新/);
   await assert.rejects(shelf.action({action,path:file,taskId:b.active,revision:b.revision-1}),/产物列表已更新/);
   await assert.rejects(shelf.action({action,path:file}),/产物列表已更新/);
  }
  const current=await shelf.action();
  assert.ok(current.tasks.find(t=>t.id===b.active).items[file]);
  assert.equal(current.tasks.find(t=>t.id===b.active).items[file].delivered,undefined);
  assert.equal(opens,0);
  await shelf.action({action:'remove',path:file,taskId:b.active,revision:current.revision});
  assert.equal((await shelf.action()).tasks.find(t=>t.id===b.active).items[file],undefined);
  await shelf.action({action:'switch',id:a.active});
  assert.ok((await shelf.action()).tasks.find(t=>t.id===a.active).items[file]);
 }finally{await shelf.dispose();await fs.rm(root,{recursive:true,force:true});}
});
