import {test} from 'node:test';
import assert from 'node:assert/strict';
import { shelfView } from '../../src/shelf/view.mjs';
const item=(path,i)=>({path,relative:path.slice(3),kind:i%2?'HTML':'Markdown',mtime:i,size:10,signature:'s'+i,source:'工具成功写入',sourceEvidence:{kind:'tool-write',turnItemId:'latest'},evidence:[{kind:'tool-write',turnItemId:'latest',detail:'x'.repeat(5000)}]});
test('paginated projection keeps complete latest turn searchable without sending old history or evidence',()=>{
  const items=Object.fromEntries(Array.from({length:245},(_,i)=>{const p='/p/文件'+i+'.md';return[p,item(p,i)]}));
  items['/p/old.md']={...item('/p/old.md',999),sourceEvidence:{kind:'tool-write',turnItemId:'old'},evidence:[]};
  const task={id:'session:A',name:'A',roots:['/p'],sourceSession:{id:'A'},items,baseline:{secret:'x'.repeat(300000)},turns:[{id:'old',sequence:1,state:'completed',outcome:'success'},{id:'latest',sequence:2,state:'completed',outcome:'success'}]};
  const state={mode:'session',revision:7,sessionTask:task,tasks:[]};
  const first=shelfView(state);
  assert.equal(first.pagination.total,245);assert.equal(Object.keys(first.tasks[0].items).length,100);
  assert.equal(first.sessionTask,undefined);assert.equal(first.tasks[0].baseline,undefined);assert.equal(first.tasks[0].turns,undefined);assert.equal(Object.values(first.tasks[0].items)[0].evidence,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(first))<256*1024);
  const all=[];let page=first;
  do{all.push(...Object.keys(page.tasks[0].items));if(!page.pagination.hasMore)break;page=shelfView(state,{offset:page.pagination.nextOffset,expectedTaskId:'session:A',expectedRevision:7});}while(true);
  assert.equal(new Set(all).size,245);
  assert.equal(shelfView(state,{search:'文件1.',kind:'HTML'}).pagination.total,1);
  const changed=shelfView({...state,revision:8},{offset:100,expectedTaskId:'session:A',expectedRevision:7});assert.equal(changed.pagination.offset,0);assert.equal(changed.pagination.reset,true);
});
