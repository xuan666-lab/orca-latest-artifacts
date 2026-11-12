#!/usr/bin/env node
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { profilePaths, sessionMetadata } from "./src/shelf/session-adapter.mjs";
import { registerArtifact } from "./src/shelf/registrations.mjs";

try {
  const args = process.argv.slice(2),
    file = args[0] === "--path" ? args[1] : args[0];
  if (!file || args.includes("--help"))
    throw Error(
      "用法：node register.mjs --path <生成的产物路径>；从生成该文件的 Orca Agent 会话运行",
    );
  const sessionId = process.env.ORCA_AGENT_SESSION_ID;
  if (!sessionId)
    throw Error("缺少可验证的 ORCA_AGENT_SESSION_ID；不接受猜测的会话身份");
  const paths = await profilePaths(),
    session = await sessionMetadata(paths, sessionId);
  const { stdout } = await promisify(execFile)(
    "orca",
    ["worktree", "show", "--worktree", "id:" + session.workspaceId, "--json"],
    { timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  const response = JSON.parse(stdout),
    workspace = response.result?.worktree;
  if (!response.ok || !workspace) throw Error("无法验证登记会话的工作区");
  const record = await registerArtifact({
    paths,
    sessionId,
    workspaces: [
      {
        id: session.workspaceId,
        path: workspace.path,
        name: workspace.displayName,
        hostId: workspace.hostId,
      },
    ],
    file: path.resolve(file),
  });
  console.log(
    JSON.stringify({
      ok: true,
      sessionId,
      artifactPath: record.artifact.path,
      contentHash: record.artifact.contentHash,
      evidence: "session-registration",
      registrationId: record.id,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ ok: false, error: String(error.message || error) }),
  );
  process.exitCode = 1;
}
