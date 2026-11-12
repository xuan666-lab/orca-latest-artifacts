import { THUMBNAIL_MESSAGES } from "./shelf/thumbnail-messages.mjs";
export const language = (locale) =>
  /^zh(?:-|$)/i.test(String(locale || "")) ? "zh" : "en";
export const MESSAGES = {
  workbench: ["工作台", "Workbench"],
  searchLabel: ["搜索", "Search"],
  outputRoots: ["输出目录", "Output directories"],
  loadingAnnotations: ["正在加载批注…", "Loading annotations…"],
  latestArtifacts: ["最新产物", "Latest artifacts"],
  annotations: ["批注", "Annotations"],
  latestRound: [
    "当前会话最新一轮的产物",
    "Artifacts from the latest turn in this session",
  ],
  sessionArtifacts: ["当前会话产物", "Artifacts from this session"],
  unknownRound: [
    "当前会话产物（轮次不可确认）",
    "Session artifacts (turn identity unavailable)",
  ],
  artifacts: ["产物", "Artifacts"],
  search: ["搜索产物", "Search artifacts"],
  all: ["全部", "All"],
  image: ["图片", "Image"],
  video: ["视频", "Video"],
  spreadsheet: ["表格", "Spreadsheet"],
  settings: ["任务设置", "Task settings"],
  currentTask: ["当前任务", "Current task"],
  types: ["文件类型", "File type"],
  follow: ["跟随当前会话", "Follow current session"],
  directory: ["目录发现", "Directory discovery"],
  refresh: ["核对文件", "Check files"],
  import: ["导入已有", "Import existing"],
  end: ["结束收集", "Stop collecting"],
  gallery: ["切换画廊", "Gallery view"],
  list: ["切换列表", "List view"],
  newTask: ["新建目录任务", "New directory task"],
  workspace: ["关联工作区", "Associated workspace"],
  chooseWorkspace: ["选择本机工作区", "Choose a local workspace"],
  associate: ["关联到当前任务", "Associate with current task"],
  taskName: ["任务名", "Task name"],
  roots: ["限定输出目录，每行一个", "Output directories, one per line"],
  start: ["开始收集", "Start collecting"],
  scopeNote: [
    "仅收集这些目录的新增和更新文件。目录发现不代表由当前聊天生成。",
    "Collect new and changed files only in these directories. Directory discovery does not prove which chat generated a file.",
  ],
  annotate: ["圈选修改", "Annotate"],
  retryAnnotation: ["重试圈选修改", "Retry annotation"],
  deliver: ["标为交付", "Mark delivered"],
  reveal: ["定位文件", "Reveal file"],
  remove: ["移出任务", "Remove from task"],
  copyPath: ["复制路径", "Copy path"],
  retryPreview: ["重试缩略图", "Retry preview"],
  details: ["文件详情", "File details"],
  toolWrite: ["工具写入", "Tool write"],
  registered: ["会话登记", "Session registration"],
  declared: ["会话交付", "Session delivery"],
  missing: ["已移动或删除", "Moved or deleted"],
  unavailable: ["暂时无法访问", "Temporarily unavailable"],
  changed: ["交付后有更新", "Changed after delivery"],
  delivered: ["✓ 已交付", "✓ Delivered"],
  emptySession: [
    "当前会话暂无可核实的写入或登记产物",
    "No verified writes or registered artifacts in this session",
  ],
  empty: ["暂无产物", "No artifacts"],
  emptyStart: [
    "把这次任务的产物放在一起",
    "Keep this task’s artifacts together",
  ],
  terminalUntracked: [
    "此终端尚未接入产物追踪",
    "This terminal is not connected to artifact tracking",
  ],
  refreshSession: ["刷新会话产物", "Refresh session artifacts"],
  importExisting: ["导入已有产物", "Import existing artifacts"],
  back: ["← 产物", "← Artifacts"],
  reposition: ["重新定位", "Rebind"],
  currentDocument: ["当前文档批注", "Current document annotations"],
  waitingDocument: [
    "等待主区域文档",
    "Waiting for a document in the main area",
  ],
  noSource: ["未绑定来源会话", "No source session bound"],
  sourceAuto: [
    "自动关联产出此文档的会话",
    "Automatically use the session that produced this document",
  ],
  send: ["发送修改", "Send changes"],
  copyRequest: ["复制修改要求", "Copy change request"],
  restoreDrafts: ["恢复旧批注", "Restore previous annotations"],
  waitingNotes: ["等待批注", "Waiting for annotations"],
  more: ["更多与详情", "More and details"],
  newRequest: ["新请求", "New request"],
  history: ["提交历史", "Submission history"],
  checkStatus: ["核实终端状态", "Check terminal status"],
  deleteMaterials: ["删除材料", "Delete materials"],
  deleteId: ["删除材料的 requestId", "Request ID for material deletion"],
  acceptPending: ["打开待处理产物", "Open pending artifact"],
  controllerHelp: [
    "网页与图片在内置浏览器批注；Markdown 在主编辑区批注。",
    "Annotate web pages and images in the built-in browser, and Markdown in the main editor.",
  ],
  mainArea: [
    "在主区域直接圈选或划选文字",
    "Select a region or text in the main area",
  ],
  routingHelp: [
    "修改只关联文档的来源会话。来源未知、繁忙、离线或原生 Chat 无公开续发接口时，不切换 Agent、不新建替代；可复制修改要求。",
    "Changes stay with the document’s source session. If it is unknown, busy, offline, or a Chat without a public continuation API, no other Agent is substituted. You can copy the request.",
  ],
  noDrafts: ["没有待恢复的未发备注", "No unsent annotations to restore"],
  copied: [
    "修改要求已复制，尚未发送",
    "Change request copied; nothing has been sent",
  ],
  newRequestStatus: ["新的修改请求", "New change request"],
  notesPlaceholder: ["修改要求", "Change request"],
  notePlaceholder: ["写下修改要求", "Describe the change"],
  selectRegion: ["圈选", "Select region"],
  browse: ["浏览页面", "Browse page"],
  exitAnnotation: ["退出批注", "Exit annotation"],
  delete: ["删除", "Delete"],
  addTextNote: ["为选中文字添加备注", "Annotate selected text"],
  openControls: ["打开修改面板", "Open annotation controls"],
  sourceChanged: [
    "原文件已变化，批注待重新定位",
    "The source file changed. Rebind the annotations.",
  ],
  notSent: ["未发送：", "Not sent: "],
  uncertain: [
    "提交结果不确定，勿重复发送：",
    "Submission is uncertain; do not send again: ",
  ],
  copiedHeader: ["请修改以下原文件：", "Please modify this source file:"],
  project: ["项目：", "Project: "],
  source: ["来源：", "Source: "],
  unknownSource: ["未知来源", "Unknown source"],
  originalText: ["原文：", "Original text: "],
  notSentFooter: [
    "这些要求尚未发送给 Agent。",
    "These instructions have not been sent to an Agent.",
  ],
  unknownError: [
    "操作未完成，请重试或查看诊断信息",
    "The operation could not be completed. Retry or review diagnostics.",
  ],
};
const reverse = new Map(
  Object.entries(MESSAGES).map(([key, value]) => [value[0], key]),
);
export function t(key, locale, params = {}) {
  const value = MESSAGES[key];
  if (!value) throw Error("Missing translation key: " + key);
  return value[language(locale) === "zh" ? 0 : 1].replace(
    /\{(\w+)\}/g,
    (_, name) => String(params[name] ?? ""),
  );
}
export function ui(text, locale) {
  if (language(locale) === "zh") return text;
  const key = reverse.get(text);
  return key ? t(key, locale) : text;
}
export function localizeStatic(root, locale) {
  const visit = (node) => {
    if (node.nodeType === 3) {
      const trimmed = node.textContent.trim().replace(/\s+/g, " "),
        translated = ui(trimmed, locale);
      if (translated !== trimmed) node.textContent = translated;
    } else if (node.nodeType === 1) {
      for (const attr of ["placeholder", "aria-label", "title"])
        if (node.hasAttribute(attr))
          node.setAttribute(attr, ui(node.getAttribute(attr), locale));
      for (const child of node.childNodes) visit(child);
    }
  };
  for (const child of root.childNodes) visit(child);
}
export function localizedError(error, locale) {
  const text =
    typeof error === "string" ? error : error?.message || String(error);
  if (language(locale) === "zh") return text;
  const exact = translateMessage(text, locale);
  if (exact !== text) return exact;
  if (!/^[\u3400-\u9fff]/u.test(text)) return text;
  return (
    t("unknownError", locale) + (error?.code ? " (" + error.code + ")" : "")
  );
}

export const ERRORS = {
  "原生 Chat 暂无可验证的插件/用户来源续发接口；未发送，也不会新建替代":
    "This Chat has no verified plugin/user continuation API. Nothing was sent, and no replacement Agent will be created.",
  当前文档没有已确认的来源会话:
    "The current document has no verified source session.",
  "来源 Agent 尚未空闲或状态无法确认":
    "The source Agent is busy or its state cannot be verified.",
  "来源 Agent 无法安全续发：": "Cannot safely continue the source Agent: ",
  "来源surface未经确认，拒绝按ID前缀或同provider终端猜测":
    "The source surface is unverified. An ID prefix or matching provider is not enough.",
  "来源会话属于不同工作区，拒绝自动改投":
    "The source session belongs to a different workspace. No automatic rerouting is allowed.",
  来源终端状态已变化或正在等待菜单:
    "The source terminal changed state or is waiting at a menu.",
  "来源终端缺少一致的会话/工作区/进程证据":
    "The source terminal lacks consistent session, workspace, and process evidence.",
  "来源终端缺少独立providerSession ID":
    "The source terminal has no distinct provider session ID.",
  来源进程已退出或被替换: "The source process exited or was replaced.",
  "检查期间来源进程/会话发生变化":
    "The source process or session changed during verification.",
  "当前主区域不是文档或浏览器；不会选择最近文件":
    "The main area is not showing a document or browser. No recent file will be substituted.",
  当前文档绑定已变化: "The current document binding changed.",
  当前文件路径越界或已被替换:
    "The current file is outside the allowed scope or was replaced.",
  当前文件不是普通文件: "The current file is not a regular file.",
  当前描述文件未被此插件绑定: "This descriptor is not bound to this plugin.",
  当前编辑文件缺少明确身份: "The editor file has no verified identity.",
  当前浏览器页无法确认: "The current browser page cannot be verified.",
  当前浏览器页面已变化: "The current browser page changed.",
  "当前文档不可确认：": "Cannot verify the current document: ",
  实际浏览器页与焦点记录不一致:
    "The actual browser page differs from the focus record.",
  定位期间用户切换了文档: "The document changed while it was being located.",
  定位期间当前文档已切换: "The current document changed during binding.",
  当前分组与标签身份不一致: "The active group and tab identities disagree.",
  统一标签身份不一致: "The unified tab identity is inconsistent.",
  浏览器焦点身份不一致: "The browser focus identity is inconsistent.",
  浏览器地址无效: "The browser URL is invalid.",
  当前不是可验证的本机工作区:
    "The current workspace cannot be verified as local.",
  当前工作区不在本机列表:
    "The current workspace is not in the local workspace list.",
  工作区标识不一致: "Workspace identities do not match.",
  项目与明确本机工作区不匹配:
    "The project does not match the verified local workspace.",
  项目路径发生变化: "The project path changed.",
  缺少明确的本机工作区身份: "A verified local workspace identity is required.",
  交接工作区不可用或不是本机:
    "The artifact workspace is unavailable or not local.",
  交接项目与工作区不匹配: "The artifact project and workspace do not match.",
  "原文件已变化，旧批注待重新定位":
    "The source file changed. Previous annotations need rebinding.",
  "源文件已变化，请重新定位":
    "The source file changed. Rebind the annotations.",
  "源文件已变化，请重新载图并关联，或明确允许旧图":
    "The source file changed. Reload and rebind it before continuing.",
  原文绑定无效: "The source-text binding is invalid.",
  绑定或源文件版本已变化: "The binding or source-file version changed.",
  源文件路径或授权范围已变化: "The source path or allowed scope changed.",
  源文件在读取前被替换: "The source file was replaced before reading.",
  源文件尺寸在打开时变化: "The source size changed while opening.",
  读取时源文件发生变化: "The source file changed while being read.",
  源文件类型或尺寸无效: "The source file type or size is invalid.",
  源文件越界: "The source file is outside the allowed scope.",
  恢复时源文件版本发生变化: "The source version changed during restoration.",
  "页面已刷新或导航，批注绑定失效":
    "The page reloaded or navigated. Its annotation binding is no longer valid.",
  "页面布局已变化，请刷新并重新定位批注":
    "The page layout changed. Rebind the annotations.",
  "页面布局仍在变化，请稍后重新定位":
    "The page layout is still changing. Rebind after it settles.",
  "页面几何已变化，旧批注待重新定位":
    "Page geometry changed. Previous annotations need rebinding.",
  "页面存在未保存批注，未覆盖":
    "The page has unsaved annotations; they were not overwritten.",
  "页面批注已变化，请重新检查": "Page annotations changed. Review them again.",
  页面批注数据无效: "Page annotation data is invalid.",
  页面尺寸无效: "Page dimensions are invalid.",
  "图像显示布局已变化，请重新定位":
    "The image layout changed. Rebind the annotations.",
  图像格式不支持: "This image format is unsupported.",
  无法确认原图尺寸: "The original image dimensions cannot be verified.",
  "选区未覆盖图像，请在图像内圈选":
    "The selection does not cover the image. Select inside the image.",
  圈选定位信息已变化: "The region-location data changed.",
  选区坐标或说明无效: "Selection coordinates or notes are invalid.",
  "需要 1–100 个选区": "Between 1 and 100 selections are required.",
  无效图像尺寸: "Image dimensions are invalid.",
  无效图像: "The image is invalid.",
  截图尺寸不符或过大: "Screenshot dimensions do not match or exceed the limit.",
  "截图不是可识别的 PNG/JPEG":
    "The screenshot is not a recognizable PNG or JPEG.",
  "截图像素超出可处理范围，批注已保留":
    "The screenshot exceeds the pixel limit. Your annotations are preserved.",
  "截图文件超出处理范围，批注已保留":
    "The screenshot file exceeds the processing limit. Your annotations are preserved.",
  "截图期间页面或源文件变化，请重新定位":
    "The page or source changed during capture. Rebind it.",
  "截图期间图像或页面变化，请重新定位":
    "The image or page changed during capture. Rebind it.",
  "截图处理期间页面或源文件变化，请重新定位；批注已保留":
    "The page or source changed during capture processing. Rebind it; your annotations are preserved.",
  局部图必须来自已绑定网页: "Region images must come from a bound web page.",
  局部截图关联无效: "A region image has an invalid selection association.",
  局部截图总量超限: "Region images exceed the total size limit.",
  局部截图数量超限: "Too many region images.",
  局部图尺寸不一致: "Region-image dimensions do not match.",
  "局部图标注后仍超过预算，请缩小选区；批注已保留":
    "The annotated region image still exceeds the budget. Use a smaller selection; your annotations are preserved.",
  "局部截图总量超过预算，批注已保留":
    "Region images exceed the total budget. Your annotations are preserved.",
  "清晰截图压缩后仍超过大小预算；请缩小选区或分批处理，批注已保留":
    "Readable images still exceed the budget after compression. Use smaller selections or split the request; your annotations are preserved.",
  视口截图过大: "The viewport screenshot is too large.",
  请在主页面圈选并填写备注:
    "Select a region in the main page and enter a note.",
  请先填写修改要求: "Enter a change request first.",
  请填写文本批注: "Enter a text annotation.",
  "文本批注已变化，请重新检查": "Text annotations changed. Review them again.",
  文本批注位置或原文不匹配:
    "Text offsets or quoted text do not match the source.",
  文本批注超过数量或大小限制:
    "Text annotations exceed the count or size limit.",
  批注数据超过大小限制: "Annotation data exceeds the size limit.",
  批注数量无效: "The annotation count is invalid.",
  "原文件已变化，请从产物架重新打开再定位。":
    "The source changed. Reopen it from the artifact list and rebind.",
  正在打开批注: "Annotations are opening.",
  没有待接收产物: "There is no pending artifact.",
  绑定不存在: "The binding does not exist.",
  无效绑定: "The binding is invalid.",
  描述文件未绑定到已接受的产物:
    "The descriptor is not bound to an accepted artifact.",
  批注描述文件过大: "The annotation descriptor is too large.",
  "Markdown超过2 MiB": "Markdown exceeds the 2 MiB limit.",
  批注缓存目录不能是符号链接或普通文件:
    "The annotation cache must be a directory, not a symlink or regular file.",
  批注缓存目录权限必须为0700:
    "The annotation cache must have 0700 permissions.",
  缓存目录不属于本插件: "The cache directory does not belong to this plugin.",
  插件标识无效: "The plugin identity is invalid.",
  已有提交进行中: "A submission is already in progress.",
  发送前文档焦点已变化: "Document focus changed before sending.",
  "发送前目标状态改变，未发送":
    "The target state changed before sending. Nothing was sent.",
  "终端可能等待权限选择，拒绝发送":
    "The terminal may be waiting for a permission choice. Nothing was sent.",
  "请选择当前工作区内已完成的 Agent 终端":
    "A verified idle Agent terminal in this workspace is required.",
  未找到请求: "The request was not found.",
  "无效 requestId": "The request ID is invalid.",
  "没有可精确恢复的启动操作；禁止重新启动":
    "There is no exact launch operation to resume. A new launch is not allowed.",
  "缺少 Agent 启动授权": "Agent-launch permission is missing.",
  统一插件不新建替代会话:
    "This workbench does not create replacement sessions.",
  终端身份数据库路径不可信: "The terminal identity database path is untrusted.",
  终端身份版本未适配: "The terminal identity schema is unsupported.",
  "profile index版本不支持": "The profile index version is unsupported.",
  "profile index路径或大小无效": "The profile index path or size is invalid.",
  profile数据库不能是符号链接: "The profile database cannot be a symlink.",
  profile分片结构不完整: "The profile shard structure is incomplete.",
  profile版本未适配: "The profile schema version is unsupported.",
  workspaceSession版本未适配: "The workspace-session version is unsupported.",
  无权威workspaceSession: "There is no authoritative workspace-session record.",
  "正在迁移，请稍候": "Migration is in progress. Please wait.",
  "正在迁移，请稍候再操作": "Migration is in progress. Try again shortly.",
  迁移进行中: "Migration is in progress.",
  "有操作进行中，暂不能迁移":
    "An operation is in progress. Migration cannot start yet.",
  已有未完成的另一快照迁移: "Another snapshot migration is incomplete.",
  请先预检并确认同一份迁移摘要:
    "Preview and confirm this migration summary first.",
  "旧数据已变化，请重新预检": "Legacy data changed. Run the preview again.",
  迁移快照版本无效: "The migration snapshot version is invalid.",
  迁移快照校验失败: "Migration snapshot verification failed.",
  未知迁移来源: "The migration source is unknown.",
  重复迁移来源: "The migration source is duplicated.",
  无效旧任务: "A legacy task is invalid.",
  无效旧产物状态: "Legacy artifact state is invalid.",
  无效旧批注绑定: "A legacy annotation binding is invalid.",
  无效旧活动绑定: "The legacy active binding is invalid.",
  无效旧消费回执: "A legacy consumption receipt is invalid.",
  无效旧发送回执: "A legacy submission receipt is invalid.",
  旧任务产物范围不一致: "A legacy artifact is outside its task scope.",
  旧存储不是键值对象: "Legacy storage is not a key-value object.",
  "旧存储正在更新，请重试迁移":
    "Legacy storage is updating. Retry the migration.",
  旧存储路径不安全或过大: "The legacy storage path is unsafe or too large.",
  备份父链不能含符号链接: "Backup ancestor directories cannot be symlinks.",
  迁移备份目录不能包含符号链接:
    "The migration backup directory cannot contain symlinks.",
  迁移素材路径无效: "A migration material path is invalid.",
  迁移素材不是安全普通文件: "A migration material is not a safe regular file.",
  迁移descriptor超限: "The migration descriptor exceeds the size limit.",
  迁移descriptor身份不匹配: "The migration descriptor identity does not match.",
  迁移绑定不存在: "The migrated binding does not exist.",
  请选择更多菜单中的旧批注恢复项:
    "Choose a previous annotation from the More menu to restore.",
  旧批注需要按原文件版本重新绑定:
    "Previous annotations must be rebound to the original file version.",
  "当前主区域不是可确认的本地 HTML、图片或 Markdown":
    "The main area is not showing a verified local HTML, image, or Markdown file.",
  "此版本有多个明确来源会话，不能自动选人":
    "This version has multiple verified source sessions. An Agent cannot be chosen automatically.",
  "没有当前文件版本的确定来源；请从有来源的产物条目进入批注":
    "The current file version has no verified source. Enter annotations from an artifact with a known source.",
  没有批注: "There are no annotations.",
  未知tab: "Unknown tab.",
};
export function translateMessage(text, locale) {
  if (typeof text !== "string" || language(locale) === "zh") return text;
  if (ERRORS[text]) return ERRORS[text];
  const exact = ui(text, locale);
  if (exact !== text) return exact;
  for (const [prefix, value] of Object.entries(ERRORS))
    if (/[：:]$/.test(prefix) && text.startsWith(prefix))
      return value + localizedError(text.slice(prefix.length), locale);
  const crop = text.match(
    /^需要 (\d+) 张清晰局部图，超过 (\d+) 张上限；请缩小选区或分批处理，批注已保留$/,
  );
  if (crop)
    return `This selection needs ${crop[1]} readable crops, exceeding the limit of ${crop[2]}. Use smaller selections or split the request; annotations are preserved.`;
  return text;
}
export function localizeResult(value, locale) {
  if (Array.isArray(value)) return value.map((v) => localizeResult(v, locale));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      [
        "message",
        "reason",
        "error",
        "warning",
        "sessionStatus",
        "watchError",
      ].includes(key) && typeof v === "string"
        ? localizedError(v, locale)
        : v && typeof v === "object"
          ? localizeResult(v, locale)
          : v,
    ]),
  );
}
export function localizedApi(api) {
  return {
    ...api,
    get locale() {
      return api.locale;
    },
    plugin: {
      ...api.plugin,
      async request(name, input, options) {
        const result = await api.plugin.request(
          name,
          { ...(input || {}), _locale: api.locale },
          options,
        );
        return localizeResult(result, api.locale);
      },
    },
  };
}
export function overlayStrings(locale) {
  return {
    toolbar: t("overlayTools", locale),
    title: t("regionAnnotation", locale),
    select: t("selectRegion", locale),
    edit: t("moveResize", locale),
    browse: t("browse", locale),
    selection: t("selection", locale),
    exit: t("exitAnnotation", locale),
    remove: t("delete", locale),
    note: t("notesPlaceholder", locale),
    placeholder: t("describePosition", locale),
    hint: t("draftHint", locale),
    maximum: t("maxNotes", locale),
    invalidRestore: t("invalidRestore", locale),
  };
}

Object.assign(MESSAGES, {
  regionAnnotation: ["区域批注", "Region notes"],
  openOrca: ["在 Orca 打开 ", "Open in Orca: "],
  moreActions: [" 更多操作", " more actions"],
  currentDisk: [" · 打开当前磁盘版本", " · Open current disk version"],
  stopped: ["已结束自动收集", "Automatic collection stopped"],
  collecting: ["正在收集", "Collecting"],
  unassociated: ["未关联工作区", "No workspace association"],
  chooseRoots: ["请选择限定输出目录", "Choose limited output directories"],
  loading: [" · 加载中", " · Loading"],
  fixed: [" · 已固定", " · Pinned"],
  fileDetails: [
    "{path}\n{size} 字节 · {source}\n更新：{date}",
    "{path}\n{size} bytes · {source}\nUpdated: {date}",
  ],
  updated: ["更新于 ", "Updated: "],
  currentDiskUpdate: [
    "打开当前磁盘版本；更新于 ",
    "Opens the current disk version; updated: ",
  ],
  declarationNote: [
    "助手在该会话明确列为交付文件，未核实工具写入。",
    "The assistant explicitly listed this file as a delivery; a tool write has not been verified.",
  ],
  waitingArtifact: [
    "从产物架点“圈选修改”，内容会在主区域打开。",
    "Choose Annotate on an artifact to open it in the main area.",
  ],
  pendingArtifact: [
    "有新产物待打开；当前批注已保留。",
    "A new artifact is pending. Current annotations are preserved.",
  ],
  selectMarkdown: [
    "请在主编辑区划选正文并备注。",
    "Select text and add notes in the main editor.",
  ],
  selectBrowser: [
    "页面默认可正常操作。区域批注请点“圈选”；使用 Orca Annotate 选元素时，请保持“浏览页面”。",
    "The page remains interactive. Choose Select region for region notes; keep Browse page active when using Orca Annotate to pick elements.",
  ],
  automaticSource: ["自动续发来源会话 · ", "Continue the source session · "],
  noConfirmedSource: [
    "当前文档没有确定的来源会话",
    "This document has no verified source session",
  ],
  directoryArtifact: [
    "目录产物 · 未提供来源会话",
    "Directory artifact · No source session provided",
  ],
  sourceName: ["来源：", "Source: "],
  writeRecord: ["写入记录", "File write"],
  editRecord: ["修改记录", "File modification"],
  registeredRecord: ["会话登记", "Session registration"],
  deliveryRecord: ["会话交付", "Session delivery"],
  notesReady: [
    "已有 {count} 条批注待发送",
    "{count} annotations ready to send",
  ],
  notesEmpty: ["请在主区域添加批注", "Add annotations in the main area"],
  nextRevision: [
    "新增批注可发送下一轮修改",
    "New annotations can be sent as a new request",
  ],
  confirmNew: [
    "确认已核实上一请求？新请求可能重复执行。",
    "Have you verified the previous request? A new request may repeat its effects.",
  ],
  confirmPending: [
    "保留任务记录并打开新产物？当前未发批注不会发送。",
    "Keep the current record and open the new artifact? Unsent annotations will not be sent.",
  ],
  confirmRebind: [
    "重新定位会建立新批注视图，旧批注保留在旧绑定记录中。继续？",
    "Rebinding opens a new annotation view. Previous annotations remain in the old binding. Continue?",
  ],
  confirmDelete: [
    "永久删除该请求的任务材料？",
    "Permanently delete this request’s task materials?",
  ],
  noteNumber: ["备注 {number}", "Note {number}"],
  locateNote: ["定位批注 {number}", "Locate annotation {number}"],
  restoreCount: [
    "恢复旧批注 ({count})",
    "Restore previous annotations ({count})",
  ],
  noteCount: ["{name} · {count} 条备注", "{name} · {count} notes"],
  markdownSaved: [
    "批注已保存；在修改面板确认发送",
    "Annotations saved. Confirm sending in the annotation panel.",
  ],
  markdownStale: [
    "原文已变化：旧批注保留，发送前需重新定位",
    "The source changed. Previous notes are preserved and must be rebound before sending.",
  ],
  addSelection: ["先选择一段文字", "Select some text first"],
  sourceVersion: [
    "原文版本已变化，请重新打开",
    "The source version changed. Reopen the document.",
  ],
  annotationNewHeader: ["在主区域直接批注", "Annotate in the main area"],
  markdownHeading: ["Markdown 正文批注", "Markdown annotations"],
  previewUnavailable: ["预览不可用", "Preview unavailable"],
  verifiedWrite: ["工具成功写入", "Verified tool write"],
  explicitImport: ["显式导入", "Imported"],
});
for (const [key, value] of Object.entries(MESSAGES)) reverse.set(value[0], key);
ERRORS["打开Chat或Agent终端后自动显示该会话产物"] =
  "Open a Chat or Agent terminal to display its artifacts.";
ERRORS["当前不是原生 Chat；保留已明确关联的会话"] =
  "Open a Chat or Agent terminal to display its artifacts.";
ERRORS["自动会话关联暂不可用："] =
  "Automatic session association is unavailable: ";
ERRORS["暂时无法连接产物架："] = "Cannot connect to the artifact shelf: ";
ERRORS["终端身份核验失败："] = "Terminal identity verification failed: ";
ERRORS["迁移前后回执冲突，请核实，禁止自动重复投递"] =
  "Migration receipts conflict. Verify the previous result; automatic resubmission is disabled.";
Object.assign(MESSAGES, {
  overlayTools: ["页面批注工具", "Page annotation tools"],
  moveResize: ["移动/调整", "Move / resize"],
  selection: ["选区", "Selection"],
  describePosition: [
    "描述这个位置要怎样修改",
    "Describe the change at this location",
  ],
  draftHint: [
    "备注保留在草稿中；回到插件确认发送",
    "Notes are saved as a draft. Confirm sending in the plugin.",
  ],
  selectionNumber: ["选区 #{number}", "Selection #{number}"],
  maxNotes: ["最多100条批注", "Maximum 100 annotations"],
  invalidRestore: ["恢复批注无效", "Invalid annotation restoration"],
  markdownTitle: ["Markdown 批注", "Markdown annotations"],
  validatingBinding: ["正在校验文件绑定…", "Verifying the file binding…"],
  markdownGuide: [
    "选中正文文字后添加备注；原文件不会因批注而改变",
    "Select text and add a note. Annotations do not modify the source file.",
  ],
  markdownChanged: [
    "原文件已变化，发送前需要重新定位。",
    "The source changed. Rebind before sending.",
  ],
  markdownOldNotes: [
    "原文件已变化：旧批注保留，发送前需重新定位。",
    "The source changed. Existing notes are preserved and must be rebound before sending.",
  ],
  textDescriptor: ["描述文件必须为文本", "The descriptor must contain text"],
  regionPosition: [
    "区域：x={x}, y={y}, w={w}, h={h}（CSS文档坐标）",
    "Region: x={x}, y={y}, w={w}, h={h} (CSS document coordinates)",
  ],
});
for (const [key, value] of Object.entries(MESSAGES)) reverse.set(value[0], key);
Object.assign(MESSAGES, {
  unnamedSession: ["未命名会话", "Untitled session"],
  association: [
    "项目：{project}\n源文件：{path}{note}",
    "Project: {project}\nSource file: {path}{note}",
  ],
  deliveryDetail: [
    "\n来源为会话交付声明，不代表工具成功写入或用户登记。",
    "\nThe source is a delivery declaration, not a verified tool write or explicit registration.",
  ],
  regionSummary: ["区域 {x}, {y} · {w} × {h}", "Region {x}, {y} · {w} × {h}"],
  missingNote: ["尚未填写要求", "No change request entered"],
  previewTemporarilyUnavailable: [
    "缩略图暂不可用",
    "Preview temporarily unavailable",
  ],
  selectTextFirst: ["先在正文中选中文字", "Select text in the document first"],
  oldNotesReference: [
    "原文已变化，旧批注仅供参考",
    "The source changed. Previous annotations are for reference only.",
  ],
  annotationSuffix: [" · 批注", " · Annotations"],
});
for (const [key, value] of Object.entries(MESSAGES)) reverse.set(value[0], key);
Object.assign(ERRORS, {
  "Orca 数据库版本不匹配，自动关联已关闭":
    "The Orca database version is unsupported. Automatic association is disabled.",
  "此会话 outcome/prefix 格式未适配，自动归属已关闭":
    "This session outcome/prefix format is unsupported. Automatic attribution is disabled.",
  当前工作区身份不一致: "The active workspace identity is inconsistent.",
  当前分组和会话标签不一致: "The active group and session tab disagree.",
  终端未接入追踪: "Terminal tracking is not connected.",
  "终端未接入或拆分 pane 无法唯一确认":
    "Terminal tracking is unavailable or the split pane cannot be identified uniquely.",
  终端追踪未激活或实例已更换:
    "Terminal tracking is inactive or the terminal instance changed.",
});
Object.assign(MESSAGES,{latestProductive:['当前会话最近一次生成的产物','Artifacts from the most recent productive turn in this session'],noProductive:['当前会话还没有已完成轮次的可核实产物','No verified artifacts from a completed turn in this session yet'],directoryCaption:['所选输出目录中的产物','Artifacts from the selected output directories'],waitingSession:['等待可确认的当前会话','Waiting for a verified current session']});for(const [key,value]of Object.entries(MESSAGES))reverse.set(value[0],key);

Object.assign(MESSAGES, {
  loadMoreArtifacts: ["加载更多", "Load more"],
  loadingMoreArtifacts: ["加载中…", "Loading…"],
  artifactPageCount: ["已显示 {loaded} / {total} 个产物", "Showing {loaded} of {total} artifacts"],
  noMatchingArtifacts: ["没有匹配的产物", "No matching artifacts"],
});

Object.assign(ERRORS, Object.fromEntries(Object.values(THUMBNAIL_MESSAGES)));

Object.assign(ERRORS, {"部分产物缓存未能保存；当前列表仍可用，重启后会重新扫描": "Some artifact caches could not be saved. The current list remains available; it will be rescanned after restarting."});
Object.assign(ERRORS, {"当前版本仅支持 macOS；请在 macOS 上使用最新产物": "This release supports macOS only. Please use Latest Artifacts on macOS."});
Object.assign(ERRORS, {"产物列表已更新，请在当前列表重新操作": "The artifact list has changed. Please retry from the current list."});
