#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  trackerRoot,
  liveTerminals,
  beginTrackedLaunch,
  acceptTerminalHook,
  endTrackedLaunch,
  registerTerminalFile,
} from "./src/shelf/terminal-tracking.mjs";
const self = fileURLToPath(import.meta.url);
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const toml = (value) =>
  Array.isArray(value)
    ? "[" + value.map(toml).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .map(([k, v]) => JSON.stringify(k) + "=" + toml(v))
          .join(",") +
        "}"
      : JSON.stringify(value);
async function input() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 1024 * 1024) throw Error("hook 输入过大");
  }
  return JSON.parse(text);
}
try {
  const [mode, provider, ...rest] = process.argv.slice(2),
    env = process.env;
  if (mode === "hook") {
    const payload = await input(),
      live = await liveTerminals(env.ORCA_WORKTREE_ID);
    await acceptTerminalHook(provider, payload, env, live);
  } else if (mode === "register") {
    const file = provider === "--path" ? rest[0] : provider;
    const record = await registerTerminalFile(
      path.resolve(file),
      env,
      await liveTerminals(env.ORCA_WORKTREE_ID),
    );
    console.log(
      JSON.stringify({
        ok: true,
        path: record.artifact.path,
        sourceSession: record.sourceSession,
        evidence: record.sourceEvidence.kind,
      }),
    );
  } else if (mode === "disable") {
    await endTrackedLaunch(env.ARTIFACT_SHELF_LAUNCH_ID);
    console.log("本次终端追踪已撤销");
  } else if (mode === "launch") {
    const args = rest[0] === "--" ? rest.slice(1) : rest;
    const { record, proof } = await beginTrackedLaunch(
      provider,
      env,
      await liveTerminals(env.ORCA_WORKTREE_ID),
    );
    const command =
      quote(process.execPath) + " " + quote(self) + " hook " + provider;
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command, timeout: 10 }] }],
      PostToolUse: [
        {
          matcher:
            provider === "claude" ? "Write|Edit|MultiEdit" : "apply_patch",
          hooks: [{ type: "command", command, timeout: 10 }],
        },
      ],
      SessionEnd: [{ hooks: [{ type: "command", command, timeout: 10 }] }],
    };
    let prefix;
    if (provider === "claude") {
      const config = path.join(
        trackerRoot(),
        "launches",
        record.id + ".settings.json",
      );
      await fs.writeFile(config, JSON.stringify({ hooks }), { mode: 0o600 });
      prefix = ["--settings", config];
    } else prefix = ["-c", "hooks=" + toml(hooks)];
    const child = spawn(provider, [...prefix, ...args], {
      stdio: "inherit",
      env: {
        ...env,
        ARTIFACT_SHELF_LAUNCH_ID: record.id,
        ARTIFACT_SHELF_BINDING_PROOF: proof,
      },
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    await endTrackedLaunch(record.id);
    process.exitCode = code;
  } else {
    console.log(
      "在本机 Orca 终端中运行：\n  node terminal-track.mjs launch claude -- [Claude 参数]\n  node terminal-track.mjs launch codex -- [Codex 参数]\nCodex 首次需在 /hooks 审核这些具体 hooks；本启动器不绕过信任、不修改全局配置。\n脚本产物：node terminal-track.mjs register --path <产物路径>\n撤销：退出本次 Agent，或在同一 Agent 工具环境运行 disable。",
    );
  }
} catch (error) {
  console.error("产物追踪：" + String(error.message || error));
  process.exitCode = 1;
}
