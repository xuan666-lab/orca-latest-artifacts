import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { thumbnailTools, thumbnailFailure, THUMBNAIL_MESSAGES } from '../../src/shelf/runtime-support.mjs';
import { createThumbnailCache, renderThumbnail } from '../../src/shelf/thumbnails.mjs';

function available(files, extra = {}) {
  const paths = new Set(files);
  return { platform:'darwin', home:'/test', env:{PATH:'/custom/bin'},
    access: async p => { if (!paths.has(p)) throw Object.assign(Error('missing'), {code:'ENOENT'}); }, ...extra };
}
test('thumbnail dependencies are resolved per type, including configured Chrome and GUI Homebrew paths', async () => {
  const sips='/usr/bin/sips', chrome='/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.deepEqual(await thumbnailTools('图片',available([sips])), {sips});
  assert.equal((await thumbnailTools('HTML',available([sips,chrome]))).chrome,chrome);
  assert.equal((await thumbnailTools('HTML',available([sips,'/custom/chrome'],{env:{ORCA_ARTIFACT_CHROME:'/custom/chrome'}}))).chrome,'/custom/chrome');
  assert.equal((await thumbnailTools('PDF',available([sips,'/opt/homebrew/bin/pdftoppm']))).pdftoppm,'/opt/homebrew/bin/pdftoppm');
  assert.deepEqual(await thumbnailTools('视频',available([sips,'/custom/bin/ffmpeg','/usr/local/bin/ffprobe'])),{sips,ffprobe:'/usr/local/bin/ffprobe',ffmpeg:'/custom/bin/ffmpeg'});
});
test('missing tools and unsupported platforms have bounded bilingual messages', async () => {
  for(const [kind,code] of [['HTML','chrome'],['PDF','pdf'],['视频','video'],['图片','image']]) {
    try { await thumbnailTools(kind,available(kind==='图片'?[]:['/usr/bin/sips'])); assert.fail('dependency should be absent'); }
    catch(error) { assert.equal(error.code,'thumbnail_'+code); assert.equal(thumbnailFailure(error,'zh-CN'),THUMBNAIL_MESSAGES[code][0]); assert.equal(thumbnailFailure(error,'en-US'),THUMBNAIL_MESSAGES[code][1]); }
  }
  await assert.rejects(thumbnailTools('HTML',available([],{platform:'linux'})), {code:'thumbnail_platform'});
  assert.equal(thumbnailFailure(Error('spawn /private/customer/path ENOENT; SECRET STDERR'),'en'),THUMBNAIL_MESSAGES.failed[1]);
});
test('missing thumbnail dependency degrades to no preview without preventing artifact access', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-missing-tool-')));
  const file=path.join(root,'page.html'); await fs.writeFile(file,'<h1>Still available</h1>');
  const store=new Map();
  const cache=createThumbnailCache({get:async k=>store.get(k),set:async(k,v)=>store.set(k,v),delete:async k=>store.delete(k)}, {
    locale:'en', render:(file,root,kind)=>renderThumbnail(file,root,kind,{runtime:available(['/usr/bin/sips'])}),
  });
  try {const result=await cache.get({path:file,root,kind:'HTML'},[root]); assert.equal(result.preview,null); assert.equal(result.reason,THUMBNAIL_MESSAGES.chrome[1]); assert.equal(await fs.readFile(file,'utf8'),'<h1>Still available</h1>'); assert.equal(store.size,0);}
  finally {cache.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('thumbnail persistence stays within one MiB and a failed save keeps the preview usable', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-thumbnail-budget-'))), values=new Map();
  let rejectWrites=false, renders=0;
  const storage={get:async k=>values.get(k),set:async(k,v)=>{if(rejectWrites)throw Error('quota exceeded');values.set(k,v);},delete:async k=>values.delete(k)};
  const cache=createThumbnailCache(storage,{render:async()=>{renders++;return 'data:image/jpeg;base64,'+'A'.repeat(160000);}});
  try {
    for(let i=0;i<10;i++) {const file=path.join(root,i+'.png');await fs.writeFile(file,'image');assert.ok((await cache.get({path:file,root,kind:'图片'},[root])).preview);}
    const persisted=[...values].filter(([key])=>key.startsWith('thumbnail.v1.'));
    assert.ok(persisted.reduce((bytes,[,value])=>bytes+Buffer.byteLength(JSON.stringify(value)),0)<=1024*1024);
    assert.deepEqual(new Set(values.get('thumbnail.keys.v1')),new Set(persisted.map(([k])=>k)));
    rejectWrites=true;
    const file=path.join(root,'quota.png');await fs.writeFile(file,'image');const request={path:file,root,kind:'图片'};
    assert.ok((await cache.get(request,[root])).preview,'storage quota must not discard an already rendered preview');
    const count=renders;assert.ok((await cache.get(request,[root])).preview);assert.equal(renders,count,'memory cache survives unavailable storage');
    rejectWrites=false;
    const next=path.join(root,'recovered.png');await fs.writeFile(next,'image');assert.ok((await cache.get({path:next,root,kind:'图片'},[root])).preview);
    assert.ok(values.get('thumbnail.keys.v1').some(k=>values.has(k)), 'persistence queue recovers');
  } finally {cache.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('oversized legacy previews are regenerated before crossing the host message limit', async () => {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-legacy-preview-'))),file=path.join(root,'image.png'),values=new Map();
  await fs.writeFile(file,'image');let renders=0;
  const storage={get:async k=>values.get(k),set:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)};
  let cache=createThumbnailCache(storage,{render:async()=> 'data:image/jpeg;base64,/9j/'});
  try {
    const request={path:file,root,kind:'图片'};
    await cache.get(request,[root]);cache.dispose();
    const key=values.get('thumbnail.keys.v1')[0];values.set(key,'data:image/jpeg;base64,'+'A'.repeat(256*1024));
    cache=createThumbnailCache(storage,{render:async()=>{renders++;return 'data:image/jpeg;base64,/9j/';}});
    const result=await cache.get(request,[root]);assert.equal(renders,1);assert.ok(Buffer.byteLength(JSON.stringify(result))<256*1024);
  }finally{cache.dispose();await fs.rm(root,{recursive:true,force:true});}
});
