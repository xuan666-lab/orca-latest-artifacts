import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

/** Resolve a recorded workspace ID through Orca's exact public selector, never by path similarity. */
export async function exactWorkspace(id, known, runner = exec) {
  const direct = known.find(
    (w) => w.id === id && (!w.hostId || w.hostId === "local"),
  );
  if (direct) return direct;
  const { stdout } = await runner(
    "orca",
    ["worktree", "show", "--worktree", "id:" + id, "--json"],
    { timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  const response = JSON.parse(stdout),
    workspace = response.result?.worktree;
  if (
    !response.ok ||
    !workspace ||
    typeof workspace.path !== "string" ||
    (workspace.hostId && workspace.hostId !== "local")
  )
    throw Error("无法验证该本机工作区标识");
  return {
    id,
    canonicalId: workspace.id,
    path: workspace.path,
    name: workspace.displayName || workspace.branch || "工作区",
    hostId: "local",
  };
}
