import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { ui, t, localizedError } from '../../src/i18n.mjs';
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const nodes = new Map(), events = new Map(), intervals = new Set();
  const element = () => ({ value: '', dataset: {}, children: [], textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, selectedOptions: [], classList: { toggle() {} } });
  const root = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } };
  const document = { hidden: false, createElement: element, addEventListener() {}, removeEventListener() {} };
  const host = { hidden: false, addEventListener: (n,h) => events.set(n,h), removeEventListener: n => events.delete(n) };
  let subscriber, revision = 1, release = null, slow = false, versionCalls = 0;
  const api = { locale: 'en', plugin: {
    on: (_n, fn) => { subscriber = fn; return {dispose() {subscriber=null;}}; },
    request: async (_name,input={}) => {
      if(input.action==='workspaces')return {workspaces:[]};
      if(input.action==='version') {
        versionCalls++;
        const captured=revision;
        if(slow){slow=false;await new Promise(r=>release=r);}
        return {revision:captured};
      }
      return {revision, mode:'session', tasks:[], sessionStatus:'revision '+revision};
    }
  } };
  const source = (await fs.readFile(new URL('../../src/shelf/panel-mount.js',import.meta.url),'utf8')).replace(/^import[^;]+;\n/gm,'').replace('export function mount','function mount');
  const context = vm.createContext({ui,t,localizedError,document,
    window:{addEventListener:(n,h)=>events.set(n,h)},
    setInterval:fn=>{intervals.add(fn);return fn;},clearInterval:fn=>intervals.delete(fn),setTimeout,clearTimeout,console});
  vm.runInContext(source,context);context.mount(root,api,host);
  await settle();await settle();
  return {nodes,host,events,intervals,emit:()=>subscriber?.(),slow:()=>{slow=true;},bump:()=>revision++,release:()=>release(),calls:()=>versionCalls};
}

test('change events during an in-flight revision check coalesce into one immediate trailing refresh',async()=>{
 const h=await harness();try{
  const before=h.calls();h.slow();h.emit();await settle();
  h.bump();h.emit();h.emit();h.emit();h.release();await settle();await settle();
  assert.equal(h.calls()-before,2,'one initial check and one coalesced trailing check');
  assert.equal(h.nodes.get('warnings').textContent,'revision 2');
 }finally{h.events.get('pagehide')();}
});

test('hidden or disposed panels do not drain queued refreshes or restart polling',async()=>{
 for(const dispose of [false,true]){
  const h=await harness();h.slow();h.emit();await settle();h.bump();h.emit();
  const before=h.calls();
  if(dispose)h.events.get('pagehide')();else{h.host.hidden=true;h.events.get('visibilitychange')();}
  h.release();await settle();await settle();assert.equal(h.calls(),before);assert.equal(h.intervals.size,0);
  if(!dispose){h.host.hidden=false;h.events.get('visibilitychange')();await settle();assert.equal(h.nodes.get('warnings').textContent,'revision 2');h.events.get('pagehide')();}
 }
});
