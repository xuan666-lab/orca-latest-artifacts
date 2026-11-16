import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  deliveryPaths,
  readClaudeTail,
  existingClaudeTerminal,
} from "../../src/shelf/existing-terminal.mjs";
const declaration = (id, file, text = "产物已交付") => ({
  type: "assistant",
  sessionId: "S",
  uuid: id,
  timestamp: "2026-11-12T01:00:00Z",
  message: {
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: text + "\n```text\n" + file + "\n```\nPRIVATE NOTE NOT STORED",
      },
    ],
  },
});
const line = (row) => JSON.stringify(row) + "\n";

test("delivery extraction distinguishes explicit final blocks from ordinary references", () => {
  const root = "/project",
    file = root + "/中文 空格.xlsx";
  assert.deepEqual(deliveryPaths("产物：\n```text\n" + file + "\n```", root), [
    file,
  ]);
  assert.deepEqual(deliveryPaths("稍后读取 `" + file + "`", root), []);
  assert.deepEqual(deliveryPaths("参考资料：产物 `" + file + "`", root), []);
  assert.deepEqual(deliveryPaths("产物：`/elsewhere/file.html`", root), []);
});

test("bounded history scan handles UTF8, partial append, replacement and oversized lines", async () => {
  const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "shelf-tail-")),
    ),
    file = path.join(root, "S.jsonl");
  const identity = { sessionId: "S", transcript: file };
  try {
    const p = path.join(root, "一.html"),
      q = path.join(root, "二.xlsx");
    await fs.writeFile(
      file,
      line({ type: "system", padding: "汉".repeat(1800) }) +
        line(declaration("one", p)),
    );
    let result = await readClaudeTail(identity, root, null, { window: 1024 });
    for(let i=0;result.loading&&i<100;i++) result=await readClaudeTail(identity,root,result.cache,{window:1024});
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].path, p);
    assert.equal(result.coverage, "complete");
    const second = Buffer.from(line(declaration("two", q))),
      split = second.indexOf(Buffer.from("二")) + 1;
    await fs.appendFile(file, second.subarray(0, split));
    result = await readClaudeTail(identity, root, result.cache, {
      window: 1024,
    });
    assert.equal(result.evidence.length, 1);
    await fs.appendFile(file, second.subarray(split));
    result = await readClaudeTail(identity, root, result.cache, {
      window: 1024,
    });
    assert.equal(result.evidence.length, 2);
    assert.equal(JSON.stringify(result.cache).includes("PRIVATE NOTE"), false);
    const replacement = file + ".replacement";
    await fs.writeFile(replacement, line(declaration("new", q)));
    await fs.rename(replacement, file);
    result = await readClaudeTail(identity, root, result.cache, {
      window: 1024,
    });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].evidence.itemId, "new");
    await fs.writeFile(
      file,
      line({ type: "system", padding: "x".repeat(5000) }) +
        line(declaration("last", p)),
    );
    result = await readClaudeTail(identity, root, result.cache, {
      window: 1024,
    });
    for(let i=0;result.loading&&i<100;i++) result=await readClaudeTail(identity,root,result.cache,{window:1024});
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].evidence.itemId, "last");
    await fs.appendFile(
      file,
      line({
        type: "assistant",
        sessionId: "OTHER",
        uuid: "bad",
        message: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "产物 `" + q + "`" }],
        },
      }),
    );
    result = await readClaudeTail(identity, root, result.cache, {
      window: 1024,
    });
    assert.equal(result.evidence.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("existing terminal recovery requires exact pane/process/UTC start and a stable live incarnation", async () => {
  const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "shelf-existing-")),
    ),
    statusDb = path.join(root, "status.db"),
    transcript = path.join(root, "S.jsonl"),
    artifact = path.join(root, "交付.xlsx");
  const db = new DatabaseSync(statusDb);
  db.exec(
    "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('schema_version','202');CREATE TABLE rows(key TEXT PRIMARY KEY,seq INTEGER,value TEXT)",
  );
  const terminal = {
    handle: "term",
    incarnationId: "inc",
    tabId: "t",
    leafId: "l",
    worktreeId: "w",
    worktreePath: root,
    connected: true,
    orphaned: false,
    executionHostId: "local",
    agentIdentity: "claude",
  };
  const row = {
    providerSession: {
      id: "S",
      key: "session_id",
      transcriptPath: transcript,
      cwd: root,
    },
    agentPresence: {
      sessionOwner: true,
      process: {
        pid: 123,
        startTime: "Tue Nov 10 07:25:19 2026",
        platform: "darwin",
      },
    },
    hostTurn: { owner: "claude:S" },
    payload: { agentType: "claude", prompt: "PRIVATE PROMPT" },
    worktreeId: "w",
    tabId: "t",
    paneKey: "t:l",
    connectionId: null,
  };
  db.prepare("INSERT INTO rows VALUES(?,?,?)").run(
    "entry\0t:l",
    1,
    JSON.stringify(row),
  );
  const store = new Map(),
    storage = {
      get: async (k) => store.get(k),
      set: async (k, v) => store.set(k, v),
    };
  const options = {
    statusDb,
    allowFixturePaths: true,
    runner: async (cmd, args, options) => {
      assert.equal(options.env.TZ, "UTC");
      return { stdout: "Tue Nov 10 07:25:19 2026 claude\n" };
    },
    liveTerminals: async () => [terminal],
  };
  try {
    await fs.writeFile(artifact, "fixture metadata only");
    await fs.writeFile(transcript, line(declaration("delivery", artifact)));
    const result = await existingClaudeTerminal(
      { workspaceId: "w", tabId: "t" },
      [terminal],
      storage,
      options,
    );
    assert.equal(result.status, "ok");
    assert.equal(result.evidence[0].evidence.kind, "session-delivery");
    assert.equal(JSON.stringify([...store]).includes("PRIVATE"), false);
    await assert.rejects(
      existingClaudeTerminal(
        { workspaceId: "w", tabId: "t" },
        [terminal],
        storage,
        {
          ...options,
          runner: async () => ({ stdout: "Thu Nov 12 00:00:00 2026 claude" }),
        },
      ),
      /启动时间/,
    );
    await assert.rejects(
      existingClaudeTerminal(
        { workspaceId: "w", tabId: "t" },
        [terminal],
        storage,
        {
          ...options,
          liveTerminals: async () => [{ ...terminal, incarnationId: "new" }],
        },
      ),
      /实例/,
    );
    await fs.unlink(artifact);
    await fs.symlink("/etc/hosts", artifact);
    const escaped = await existingClaudeTerminal(
      { workspaceId: "w", tabId: "t" },
      [terminal],
      storage,
      options,
    );
    assert.equal(escaped.evidence.length, 0);
    row.hostTurn.owner = "claude:OTHER";
    db.prepare("UPDATE rows SET value=?").run(JSON.stringify(row));
    await assert.rejects(
      existingClaudeTerminal(
        { workspaceId: "w", tabId: "t" },
        [terminal],
        storage,
        options,
      ),
      /绑定/,
    );
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('bounded initial scan retains artifacts before the final window and rebuilds old tail-only caches', async () => {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-full-history-')));
  const transcript=path.join(root,'S.jsonl'),identity={sessionId:'S',transcript};
  try {
    const artifact=path.join(root,'earlier.html');
    await fs.writeFile(transcript,line(declaration('early',artifact))+Array.from({length:60},()=>line({type:'system',padding:'x'.repeat(90)})).join(''));
    let result=await readClaudeTail(identity,root,null,{window:1024});
    const first=result.cache.offset;
    assert.ok(first<=1024,'first scan must start at beginning and remain bounded');
    for(let i=0;result.loading&&i<100;i++)result=await readClaudeTail(identity,root,result.cache,{window:1024});
    assert.equal(result.loading,false);
    assert.deepEqual(result.evidence.map(x=>x.path),[artifact]);
    assert.equal(result.coverage,'complete');
    const legacy={...result.cache,startOffset:3000,evidence:{}};delete legacy.readerVersion;
    result=await readClaudeTail(identity,root,legacy,{window:1024});
    for(let i=0;result.loading&&i<100;i++)result=await readClaudeTail(identity,root,result.cache,{window:1024});
    assert.deepEqual(result.evidence.map(x=>x.path),[artifact]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a hook record without cwd is verified by the Claude project folder of its transcript', async () => {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shelf-nocwd-'))),
    project=path.join(root,'my.proj'),statusDb=path.join(root,'status.db'),artifact=path.join(project,'r.html');
  await fs.mkdir(project);
  const db=new DatabaseSync(statusDb);
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('schema_version','202');CREATE TABLE rows(key TEXT PRIMARY KEY,seq INTEGER,value TEXT)");
  const terminal={handle:'term',incarnationId:'inc',tabId:'t',leafId:'l',worktreeId:'w',worktreePath:project,connected:true,orphaned:false,executionHostId:'local',agentIdentity:'claude'};
  const put=(transcript)=>db.prepare("INSERT OR REPLACE INTO rows VALUES(?,?,?)").run('entry\0t:l',1,JSON.stringify({
    providerSession:{id:'S',key:'session_id',transcriptPath:transcript},
    agentPresence:{sessionOwner:true,process:{pid:123,startTime:'Tue Nov 10 07:25:19 2026',platform:'darwin'}},
    hostTurn:{owner:'claude:S'},payload:{agentType:'claude'},worktreeId:'w',tabId:'t',paneKey:'t:l',connectionId:null}));
  const options={statusDb,allowFixturePaths:true,runner:async()=>({stdout:'Tue Nov 10 07:25:19 2026 claude\n'}),liveTerminals:async()=>[terminal]};
  const store=new Map(),storage={get:async k=>store.get(k),set:async(k,v)=>store.set(k,v)};
  try{
    await fs.writeFile(artifact,'x');
    for(const dir of [project.replace(/[^A-Za-z0-9]/g,'-'),'-other-project']){
      await fs.mkdir(path.join(root,dir));
      await fs.writeFile(path.join(root,dir,'S.jsonl'),line(declaration('d',artifact)));
    }
    put(path.join(root,project.replace(/[^A-Za-z0-9]/g,'-'),'S.jsonl'));
    const result=await existingClaudeTerminal({workspaceId:'w',tabId:'t'},[terminal],storage,options);
    assert.equal(result.status,'ok');
    assert.deepEqual(result.evidence.map(e=>e.path),[artifact]);
    put(path.join(root,'-other-project','S.jsonl'));
    await assert.rejects(existingClaudeTerminal({workspaceId:'w',tabId:'t'},[terminal],new Map()&&{get:async()=>null,set:async()=>{}},options),/路径与项目不一致/);
  }finally{db.close();await fs.rm(root,{recursive:true,force:true});}
});
