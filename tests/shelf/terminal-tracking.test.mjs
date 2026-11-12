import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {beginTrackedLaunch,validateTrackedLaunch,acceptTerminalHook,registerTerminalFile,endTrackedLaunch,trackedTerminal} from '../../src/shelf/terminal-tracking.mjs';

test('terminal hooks bind real launch scope; clear/restart/incarnation reject old identities without storing secrets',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-terminal-'))),store=path.join(root,'tracking');
 const terminal={tabId:'tab',leafId:'leaf',handle:'term',incarnationId:'incarnation-1',worktreeId:'workspace',worktreePath:root,connected:true,orphaned:false,executionHostId:'local'};
 const env={ORCA_PANE_KEY:'tab:leaf',ORCA_TAB_ID:'tab',ORCA_WORKTREE_ID:'workspace',ORCA_AGENT_LAUNCH_TOKEN:'never-persist-this-token'};
 try{
  const {record,proof}=await beginTrackedLaunch('claude',env,[terminal],store);
  const bound={...env,ARTIFACT_SHELF_LAUNCH_ID:record.id,ARTIFACT_SHELF_BINDING_PROOF:proof};
  await assert.rejects(registerTerminalFile(path.join(root,'a.html'),bound,[terminal],store),/SessionStart/);
  await acceptTerminalHook('claude',{hook_event_name:'SessionStart',source:'startup',session_id:'A'},bound,[terminal],store);
  const file=path.join(root,'a.html');await fs.writeFile(file,'<h1>A</h1>');
  await acceptTerminalHook('claude',{hook_event_name:'PostToolUse',session_id:'A',tool_use_id:'write1',tool_name:'Write',tool_input:{file_path:file,content:'PRIVATE CONTENT'},tool_response:{type:'create'}},bound,[terminal],store);
  let view=await trackedTerminal({workspaceId:'workspace',tabId:'tab'},[terminal],store);assert.equal(view.session.id,'A');assert.equal(view.evidence.length,1);assert.equal(view.evidence[0].evidence.relation,'created');
  await acceptTerminalHook('claude',{hook_event_name:'SessionStart',source:'clear',session_id:'B'},bound,[terminal],store);
  await assert.rejects(acceptTerminalHook('claude',{hook_event_name:'PostToolUse',session_id:'A',tool_name:'Write'},bound,[terminal],store),/切换/);
  const registration=await registerTerminalFile(file,bound,[terminal],store);assert.equal(registration.sourceSession.id,'B');assert.equal(registration.sourceEvidence.kind,'session-registration');
  await assert.rejects(validateTrackedLaunch(bound,[{...terminal,incarnationId:'new'}],store),/实例/);
  await assert.rejects(validateTrackedLaunch({...bound,ORCA_AGENT_LAUNCH_TOKEN:'changed'},[terminal],store),/实例/);
  await assert.rejects(validateTrackedLaunch({...bound,ARTIFACT_SHELF_BINDING_PROOF:'wrong'},[terminal],store),/校验/);
  const saved=await fs.readFile(path.join(store,'launches',record.id+'.json'),'utf8');assert.equal(saved.includes(env.ORCA_AGENT_LAUNCH_TOKEN),false);assert.equal(saved.includes(proof),false);
  await endTrackedLaunch(record.id,store);await assert.rejects(validateTrackedLaunch(bound,[terminal],store),/撤销/);assert.equal((await trackedTerminal({workspaceId:'workspace',tabId:'tab'},[terminal],store)).status,'unavailable');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Codex hooks require successful apply_patch output; arbitrary shell text is never attributed',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-codex-hook-'))),store=path.join(root,'tracking');
 const terminal={tabId:'t',leafId:'l',handle:'term',incarnationId:'one',worktreeId:'w',worktreePath:root,connected:true,executionHostId:'local'};
 const env={ORCA_PANE_KEY:'t:l',ORCA_TAB_ID:'t',ORCA_WORKTREE_ID:'w'};
 try{
  const {record,proof}=await beginTrackedLaunch('codex',env,[terminal],store),bound={...env,ARTIFACT_SHELF_LAUNCH_ID:record.id,ARTIFACT_SHELF_BINDING_PROOF:proof};
  await acceptTerminalHook('codex',{hook_event_name:'SessionStart',source:'startup',session_id:'codex-A'},bound,[terminal],store);
  const file=path.join(root,'doc.md');await fs.writeFile(file,'# Hello');
  const input={hook_event_name:'PostToolUse',session_id:'codex-A',tool_use_id:'c',tool_name:'apply_patch',tool_input:{command:'*** Begin Patch\n*** Add File: '+file+'\n+# Hello\n*** End Patch'}};
  assert.equal((await acceptTerminalHook('codex',{...input,tool_response:'Failed'},bound,[terminal],store)).captured,0);
  assert.equal((await acceptTerminalHook('codex',{...input,tool_response:'Success. Updated the following files:\nA '+file},bound,[terminal],store)).captured,1);
  assert.equal((await acceptTerminalHook('codex',{...input,tool_name:'Bash',tool_input:{command:'cat '+file},tool_response:'Success. Updated the following files:'},bound,[terminal],store)).captured,0);
  assert.equal((await trackedTerminal({workspaceId:'w',tabId:'t'},[terminal],store)).evidence.length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
