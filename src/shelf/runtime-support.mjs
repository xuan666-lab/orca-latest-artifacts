import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";

// Stable public messages: never expose subprocess stderr or private file paths.
import { THUMBNAIL_MESSAGES } from "./thumbnail-messages.mjs";
export { THUMBNAIL_MESSAGES };
const unavailable = (code) => Object.assign(new Error(THUMBNAIL_MESSAGES[code][0]), { code: "thumbnail_" + code });

/** Resolve only the tools needed by this file; no automatic installs or shell execution. */
export async function thumbnailTools(kind, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") throw unavailable("platform");
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const access = options.access ?? ((file) => fs.access(file, constants.X_OK));
  async function first(candidates) {
    for (const file of [...new Set(candidates)]) {
      if (!path.isAbsolute(file)) continue;
      try { await access(file); return file; } catch { /* optional dependency */ }
    }
    return null;
  }
  const bin = (name) => first([
    ...(env.PATH || "").split(path.delimiter).filter(Boolean).map(p => path.join(p, name)),
    ...["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(p => path.join(p, name)),
  ]);
  const sips = await first(["/usr/bin/sips"]);
  if (!sips) throw unavailable("image");
  const tools = { sips };
  if (["HTML", "Markdown"].includes(kind)) {
    if (env.ORCA_ARTIFACT_CHROME) {
      tools.chrome = await first([env.ORCA_ARTIFACT_CHROME]);
      if (!tools.chrome) throw unavailable("chromeConfig");
    } else {
      tools.chrome = await first([
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        path.join(home, "Applications/Chromium.app/Contents/MacOS/Chromium"),
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ]);
      if (!tools.chrome) throw unavailable("chrome");
    }
  } else if (kind === "PDF") {
    tools.pdftoppm = await bin("pdftoppm");
    if (!tools.pdftoppm) throw unavailable("pdf");
  } else if (kind === "视频") {
    [tools.ffprobe, tools.ffmpeg] = await Promise.all([bin("ffprobe"), bin("ffmpeg")]);
    if (!tools.ffprobe || !tools.ffmpeg) throw unavailable("video");
  }
  return tools;
}

export function thumbnailFailure(error, locale = "zh-CN") {
  const key = String(error?.code || "").replace(/^thumbnail_/, "");
  const message = THUMBNAIL_MESSAGES[key];
  if (message) return message[/^zh(?:-|$)/i.test(locale) ? 0 : 1];
  // These validation messages are already translated by the panel API.
  const known = ["图片超过 64 MiB 预览限制", "HTML 超过 2 MiB 预览限制", "源文件写入中，请稍后重试", "缩略图超过大小限制", "不支持的缩略图类型"];
  if (known.includes(error?.message)) return error.message;
  return THUMBNAIL_MESSAGES.failed[/^zh(?:-|$)/i.test(locale) ? 0 : 1];
}
