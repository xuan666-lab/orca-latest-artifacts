import { latestProductiveArtifacts } from './latest-artifacts.mjs';
const MAX_VIEW_BYTES = 768 * 1024;
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const itemView = file => ({
  ...pick(file, ['path','relative','kind','mtime','size','signature','source','missing','unavailable','changed','delivered']),
  ...(file.sourceEvidence ? {sourceEvidence:pick(file.sourceEvidence,['kind','relation'])} : {}),
});
function taskView(task, active) {
  const basic = pick(task,['id','name','ended']);
  if (!active) return {...basic,items:{}};
  return {
    ...basic,
    roots: task.roots || [],
    ...pick(task,['workspace','sourceSession','terminalSource','watchError']),
    errors:(task.errors || []).slice(0,10).map(e=>({message:String(e.message||'').slice(0,1024),...(e.code?{code:e.code}:{})})),
    items:{},
  };
}
/** UI data only. The complete history/index remains in the worker and storage. */
export function shelfView(state, query = {}) {
  const selected = state.mode === 'session' ? latestProductiveArtifacts(state.sessionTask) : null;
  const tasks = state.mode === 'session' ? (state.sessionTask ? [state.sessionTask] : []) : state.tasks || [];
  const active = state.mode === 'session' ? state.sessionTask?.id || null : state.active || null;
  const task = tasks.find(t=>t.id===active);
  const search = String(query.search || '').toLowerCase();
  const kind = typeof query.kind === 'string' ? query.kind : '';
  const matches = Object.values(selected?.items || task?.items || {})
    .filter(file => file.path.toLowerCase().includes(search) && (!kind || kind==='全部' || file.kind===kind))
    .sort((a,b)=>Number(!!b.delivered)-Number(!!a.delivered) || b.mtime-a.mtime || a.path.localeCompare(b.path));
  const reset = (query.expectedTaskId != null && query.expectedTaskId !== active) ||
    (query.expectedRevision != null && query.expectedRevision !== (state.revision || 0));
  let offset = !reset && Number.isSafeInteger(query.offset) && query.offset >= 0 ? query.offset : 0;
  if (offset >= matches.length) offset = 0;
  const limit = Math.max(1,Math.min(100,Number.isSafeInteger(query.limit)?query.limit:100));
  const result = {
    ...pick(state,['mode','revision','sessionPinned','sessionStatus','sessionLoading','terminalStatus']),
    active,
    viewScope:selected?.scope || 'directory',
    productiveTurn:selected?.turn || null,
    tasks:tasks.map(t=>taskView(t,t.id===active)),
    pagination:{offset,limit,total:matches.length,nextOffset:offset,hasMore:false,taskId:active,revision:state.revision||0,reset},
  };
  const destination = result.tasks.find(t=>t.id===active)?.items;
  // Count bytes (not JS string length): multibyte filenames also respect the bridge.
  let bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > MAX_VIEW_BYTES) throw Error('Artifact task metadata exceeds the panel size limit');
  if (destination) for (const file of matches.slice(offset,offset+limit)) {
    const view = itemView(file);
    const added = Buffer.byteLength(JSON.stringify(file.path))+Buffer.byteLength(JSON.stringify(view))+2;
    if (bytes+added > MAX_VIEW_BYTES) break;
    destination[file.path]=view;
    bytes+=added;
    result.pagination.nextOffset++;
  }
  if (matches.length && result.pagination.nextOffset===offset)
    throw Error('Artifact metadata exceeds the panel size limit');
  result.pagination.hasMore=result.pagination.nextOffset<matches.length;
  return result;
}
