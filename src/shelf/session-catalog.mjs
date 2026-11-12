import { existingClaudeTerminal } from "./existing-terminal.mjs";
import { liveTerminals, trackedTerminal } from "./terminal-tracking.mjs";
import { exactWorkspace } from "./workspaces.mjs";
import {
  profilePaths,
  currentCandidate,
  verifySession,
  readEvidence,
} from "./session-adapter.mjs";
import { readRegistrations, scopedArtifact } from "./registrations.mjs";

const observed = (e) =>
  typeof e.observedAt === "number"
    ? e.observedAt
    : Date.parse(e.observedAt) || 0;
export function createSessionCatalog(orca, options = {}) {
  const cursors = new Map();
  async function focusIdentity() {
    return JSON.stringify(await currentCandidate(options.paths || (await profilePaths())));
  }
  async function refresh(previousTask) {
    let cacheWarning = false;
    try {
      const paths = options.paths || (await profilePaths());
      let candidate = await currentCandidate(paths);
      let pinnedReason = null;
      if (candidate.status !== "ok" && candidate.status !== "terminal")
        return { task: null, pinned: false, status: candidate.reason };
      const { workspaces } = await orca.host.call("workspace.list", {});
      if (!workspaces.some((w) => w.id === candidate.workspaceId))
        workspaces.push(
          await exactWorkspace(candidate.workspaceId, workspaces),
        );
      let session,
        result,
        registrations = [];
      if (candidate.status === "terminal") {
        const terminals = options.liveTerminals
          ? await options.liveTerminals(candidate.workspaceId)
          : await liveTerminals(candidate.workspaceId);
        let tracked = await trackedTerminal(
          candidate,
          terminals,
          options.trackerDirectory,
        );
        if (tracked.status !== "ok") {
          try {
            tracked =
              (await existingClaudeTerminal(
                candidate,
                terminals,
                orca.storage,
                {
                  ...(options.existingTerminal || {}),
                  liveTerminals: options.liveTerminals,
                },
              )) || tracked;
          } catch (error) {
            tracked = {
              status: "unavailable",
              reason: "终端身份核验失败：" + String(error.message || error),
            };
          }
        }
        if (tracked.status !== "ok")
          return {
            task: null,
            pinned: false,
            status: tracked.reason,
            terminalStatus: "untracked",
          };
        session = tracked.session;
        cacheWarning = !!tracked.cacheWarning;
        result = {
          status: tracked.loading ? "loading" : "ok",
          evidence: tracked.evidence,
          coverage: tracked.coverage,
          binding: tracked.binding,
        };
      } else {
        session = await verifySession(
          paths,
          candidate.id,
          workspaces,
          candidate,
        );
        const cacheKey = "session.cursor.v1." + session.id;
        const before =
          cursors.get(session.id) || (await (orca.storage.getCache || orca.storage.get)(cacheKey));
        result = await readEvidence(paths, session, before);
        if (result.cache !== before) {
          cursors.delete(session.id);
          cursors.set(session.id, result.cache);
          while (cursors.size > 8) cursors.delete(cursors.keys().next().value);
          if (orca.storage.setCache) {
            cacheWarning = !(await orca.storage.setCache(cacheKey, result.cache)).persisted;
          } else {
            try { await orca.storage.set(cacheKey, result.cache); }
            catch { cacheWarning = true; }
          }
        }
        registrations = await readRegistrations(
          session,
          [session.projectPath],
          options.registrationDirectory,
        );
      }
      const roots = [session.projectPath];
      const storeKey =
        session.surface === "terminal"
          ? "terminal.task.v1." + session.provider + "." + session.id
          : "session.task.v1." + session.id;
      const old =
        previousTask?.sourceSession?.id === session.id &&
        !!previousTask.terminalSource === (session.surface === "terminal")
          ? previousTask
          : await orca.storage.get(storeKey);
      const task = {
        id:
          (session.surface === "terminal"
            ? "terminal:" + session.provider + ":"
            : "session:") + session.id,
        storeKey,
        terminalSource: session.surface === "terminal",
        name: session.name,
        sourceSession: {
          surface: session.surface === "terminal" ? "terminal" : "chat",
          ...(session.surface === "terminal" ? { providerId: session.id } : {}),
          id: session.id,
          provider: session.provider,
          workspaceId: session.workspaceId,
          name: session.name,
        },
        workspace: {
          id: session.workspaceId,
          name:
            workspaces.find((w) => w.id === session.workspaceId)?.name ||
            session.name,
          path: session.projectPath,
        },
        roots,
        hidden: old?.hidden || [],
        items: {},
        errors: [],
        sessionMode: true,
        ...(!session.surface ? { turns: result.turns || [] } : {}),
        coverage: result.coverage || null,
        terminalBinding: result.binding
          ? {
              handle: result.binding.handle,
              incarnationId: result.binding.incarnationId,
              processId: result.binding.processId,
              processStart: result.binding.processStart,
            }
          : null,
      };
      const grouped = new Map();
      for (const proof of [...result.evidence, ...registrations]) {
        try {
          const file = await scopedArtifact(proof.path, roots);
          if (
            proof.evidence.kind === "session-delivery" &&
            file.missing &&
            !old?.items?.[file.path]
          )
            continue;
          if (task.hidden.includes(file.path)) continue;
          const group = grouped.get(file.path) || { file, proofs: [] };
          group.proofs.push(proof);
          grouped.set(file.path, group);
        } catch (error) {
          // No payloads or out-of-scope paths are copied to the gallery or logs.
          if (error.code === "EACCES" || error.code === "EPERM")
            task.errors.push({
              message: "部分会话产物暂时无法访问",
              code: error.code,
            });
        }
      }
      for (const [p, { file, proofs }] of grouped) {
        proofs.sort(
          (a, b) =>
            observed(a.evidence) - observed(b.evidence) ||
            (a.evidence.sequence || 0) - (b.evidence.sequence || 0),
        );
        const latest = proofs.at(-1),
          prior = old?.items?.[p];
        const contentHash =
          latest.registeredSignature === file.signature
            ? latest.registeredHash
            : prior?.signature === file.signature
              ? prior?.contentHash
              : null;
        task.items[p] = {
          ...prior,
          ...file,
          size: file.size ?? prior?.size ?? 0,
          mtime: file.mtime ?? prior?.mtime ?? observed(latest.evidence),
          contentHash,
          source:
            latest.evidence.kind === "session-registration"
              ? "会话登记"
              : latest.evidence.kind === "session-delivery"
                ? "会话交付"
                : "工具成功写入",
          sourceEvidence: latest.evidence,
          evidence: proofs.map((p) => p.evidence),
          currentVersion: true,
          changed:
            !!prior?.delivered &&
            (prior.deliveredSignature || prior.signature) !== file.signature,
        };
      }
      if (JSON.stringify(await currentCandidate(paths)) !== JSON.stringify(candidate))
        return { task: null, pinned: false, status: null, loading: true };
      if (JSON.stringify(task) !== JSON.stringify(old)) {
        try { await orca.storage.set(storeKey, task); }
        catch { cacheWarning = true; }
      }
      return {
        task,
        pinned: false,
        status: cacheWarning ? "部分产物缓存未能保存；当前列表仍可用，重启后会重新扫描" : null,
        loading: result.status === "loading",
        terminalStatus: session.surface === "terminal" ? "connected" : null,
      };
    } catch (error) {
      return {
        task: null,
        pinned: false,
        status: "自动会话关联暂不可用：" + String(error.message || error),
      };
    }
  }
  return { refresh, focusIdentity };
}
