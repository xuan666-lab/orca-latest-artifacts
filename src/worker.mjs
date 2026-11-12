import { createShelf } from "./shelf/service.mjs";
import { createChunkedStorage } from "./shelf/storage.mjs";
let shelf;
let focusSubscription;
export default function activate(orca) {
  if (process.platform !== "darwin") {
    orca.panels.handle("shelf", () => ({
      mode: "session", revision: 0, tasks: [], active: null,
      sessionStatus: "当前版本仅支持 macOS；请在 macOS 上使用最新产物",
    }));
    return;
  }
  shelf = createShelf({ ...orca, storage: createChunkedStorage(orca.storage) }, { sessions: true });
  focusSubscription = orca.events?.on("workspace.changed", () => shelf?.checkFocus());
  orca.panels.handle("shelf", (input) => {
    // Older open frames can finish an ordinary open during a hot reload.
    const request = input || {};
    return shelf.action(request.action === "selection"
      ? { ...request, action: "open" }
      : request);
  });
}
export function deactivate() {
  focusSubscription?.dispose?.();
  if (typeof focusSubscription === "function") focusSubscription();
  focusSubscription = null;
  shelf?.dispose();
  shelf = null;
}
