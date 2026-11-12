export const THUMBNAIL_MESSAGES = {
  platform: ["当前版本仅支持 macOS 缩略图，仍可打开原文件", "This version supports thumbnails on macOS only. You can still open the file."],
  chrome: ["HTML/Markdown 缩略图需要 Chrome；仍可打开原文件", "HTML/Markdown thumbnails need Chrome. You can still open the file."],
  chromeConfig: ["配置的 Chrome 路径不可执行，请检查 ORCA_ARTIFACT_CHROME", "The configured Chrome path is not executable. Check ORCA_ARTIFACT_CHROME."],
  image: ["缩略图需要 macOS sips 工具，仍可打开原文件", "Thumbnails need the macOS sips tool. You can still open the file."],
  pdf: ["PDF 缩略图需要 Poppler（pdftoppm），仍可打开原文件", "PDF thumbnails need Poppler (pdftoppm). You can still open the file."],
  video: ["视频缩略图需要 FFmpeg（ffmpeg 和 ffprobe），仍可打开原文件", "Video thumbnails need FFmpeg (ffmpeg and ffprobe). You can still open the file."],
  failed: ["缩略图暂不可用，仍可打开原文件", "The thumbnail is unavailable. You can still open the file."],
};
