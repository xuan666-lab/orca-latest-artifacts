import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { ui, t, localizedError } from '../../src/i18n.mjs';
const settle = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(tag='div') { Object.assign(this,{tag,value:'',dataset:{},children:[],textContent:'',selectedOptions:[],attributes:{}}); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; }
  setAttribute(key,value) { this.attributes[key]=value; }
  get classList() { return {toggle(){}}; }
}
async function harness({ pageCap = 100 } = {}) {
 const nodes=new Map(),events=new Map(),calls=[];
 const root={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 root.getElementById('filter').value='全部';
 let active='A',revision=1,subscriber,delayed=null,release;
 const files=Array.from({length:205},(_,i)=>({path:`/out/file-${String(i).padStart(3,'0')}.${i===204?'md':'xlsx'}`,relative:`file-${i}`,kind:i===204?'Markdown':'表格',mtime:205-i,size:1,signature:String(i),source:'test'}));
 const request=async(_name,input={})=>{
   calls.push(input);
   if(input.action==='workspaces')return {workspaces:[]};
   if(input.action==='version')return {revision};
   if(input.action==='preview')return {preview:null};
   if(input.action==='open')return {tasks:[],revision};
   const list=files.filter(f=>(!input.search||f.path.toLowerCase().includes(input.search.toLowerCase()))&&(!input.kind||input.kind==='全部'||f.kind===input.kind));
   const reset=!!((input.expectedTaskId&&input.expectedTaskId!==active)||(input.expectedRevision!=null&&input.expectedRevision!==revision));
   const offset=reset?0:input.offset||0,limit=input.limit||100;
   const items=Object.fromEntries(list.slice(offset,offset+Math.min(limit,pageCap)).map(f=>[f.path,{...f}]));
   const result={active,revision,mode:'session',tasks:[{id:active,name:active,roots:['/out'],items}],pagination:{offset,limit,total:list.length,nextOffset:offset+Object.keys(items).length,hasMore:offset+Object.keys(items).length<list.length,taskId:active,revision,reset}};
   if(delayed?.(input)){delayed=null;await new Promise(r=>release=r);}
   return result;
 };
 const document={hidden:false,createElement:t=>new Element(t),addEventListener(){},removeEventListener(){}};
 const host={hidden:false,addEventListener:(n,h)=>events.set(n,h),removeEventListener:n=>events.delete(n)};
 const api={locale:'en',plugin:{request,on:(_n,fn)=>{subscriber=fn;return{dispose(){subscriber=null;}};}}};
 const source=(await fs.readFile(new URL('../../src/shelf/panel-mount.js',import.meta.url),'utf8')).replace(/^import[^;]+;\n/gm,'').replace('export function mount','function mount');
 const context=vm.createContext({ui,t,localizedError,document,window:{addEventListener:(n,h)=>events.set(n,h)},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,console});
 vm.runInContext(source,context);context.mount(root,api,host);await settle();await settle();
 return{nodes,calls,events,emit:()=>subscriber?.(),changeTask:()=>{active='B';revision++;},bump:()=>revision++,delay:p=>{delayed=p;},release:()=>release(),close:()=>events.get('pagehide')()};
}
const cards=h=>h.nodes.get('cards').children.filter(n=>n.className==='card');

test('latest artifacts pages 100 at a time and searches/filter across the complete server index',async()=>{
 const h=await harness();try{
   assert.equal(h.calls.filter(c=>!c.action||c.action==='list')[0].action,'list');
   assert.equal(cards(h).length,100);
   await h.nodes.get('load-more').onclick();await settle();
   assert.equal(cards(h).length,200);
   await h.nodes.get('load-more').onclick();await settle();
   assert.equal(cards(h).length,205);
   assert.equal(h.nodes.get('load-more').hidden,true);
   h.nodes.get('search').value='file-204';h.nodes.get('search').oninput();await new Promise(r=>setTimeout(r,250));await settle();
   assert.equal(cards(h).length,1);
   assert.equal(cards(h)[0].dataset.path,'/out/file-204.md');
   assert.ok(h.calls.some(c=>c.action==='list'&&c.search==='file-204'&&c.offset===0));
   h.nodes.get('search').value='';h.nodes.get('filter').value='Markdown';h.nodes.get('filter').onchange();await settle();
   assert.equal(cards(h).length,1);
   assert.ok(h.calls.some(c=>c.action==='list'&&c.kind==='Markdown'));
 }finally{h.close();}
});

test('a delayed next page cannot append to a new session or replace a newer search',async()=>{
 const h=await harness();try{
   h.delay(i=>i.action==='list'&&i.offset===100);
   const pending=h.nodes.get('load-more').onclick();await settle();
   h.changeTask();h.emit();await settle();await settle();
   assert.equal(h.nodes.get('tasks').value,'B');
   h.release();await pending;await settle();
   assert.equal(h.nodes.get('tasks').value,'B');assert.equal(cards(h).length,100);
   h.delay(i=>i.action==='list'&&i.offset===100);
   const later=h.nodes.get('load-more').onclick();await settle();
   h.nodes.get('search').value='file-204';h.nodes.get('search').oninput();await new Promise(r=>setTimeout(r,250));await settle();
   h.release();await later;await settle();
   assert.equal(cards(h).length,1);assert.equal(cards(h)[0].dataset.path,'/out/file-204.md');
 }finally{h.close();}
});

test('server reset on revision change replaces old pages rather than merging duplicates',async()=>{
 const h=await harness();try{
   await h.nodes.get('load-more').onclick();await settle();assert.equal(cards(h).length,200);
   h.bump();await h.nodes.get('load-more').onclick();await settle();
   assert.equal(cards(h).length,100);
   assert.equal(new Set(cards(h).map(c=>c.dataset.path)).size,100);
 }finally{h.close();}
});


test('byte-limited short pages use the returned next offset without skipping artifacts',async()=>{
 const h=await harness({pageCap:37});try{
   assert.equal(cards(h).length,37);
   await h.nodes.get('load-more').onclick();await settle();
   assert.equal(cards(h).length,74);
   assert.deepEqual(h.calls.filter(c=>c.action==='list').map(c=>c.offset),[0,37]);
   assert.equal(h.nodes.get('page-count').textContent,'Showing 74 of 205 artifacts');
 }finally{h.close();}
});

test('a retained card sends its rendered task and revision, not the newly focused task',async()=>{
 const h=await harness();try{
   const oldOpen=cards(h)[0].children[0];
   h.changeTask();h.emit();await settle();await settle();
   assert.equal(h.nodes.get('tasks').value,'B');
   await oldOpen.onclick();
   const action=h.calls.find(c=>c.action==='open');
   assert.equal(action.taskId,'A');
   assert.equal(action.revision,1);
 }finally{h.close();}
});
