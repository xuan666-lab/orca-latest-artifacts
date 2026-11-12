import { ui, t, localizedError } from "../../src/i18n.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.value = "";
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this._text = "";
    this.disabled = false;
    this.open = false;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
    this._text = "";
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((n) => n.textContent || "").join("");
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  get selectedOptions() {
    return this.children.filter((c) => c.value === this.value).slice(0, 1);
  }
  get classList() {
    return {
      toggle: (name) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        const present = classes.has(name);
        present ? classes.delete(name) : classes.add(name);
        this.className = [...classes].join(" ");
        return !present;
      },
    };
  }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("gallery actions, filtering, safe text, thumbnail reuse, workspace choices and lifecycle cleanup", async () => {
  const html = await fs.readFile(
    new URL("../../src/shelf/panel.html", import.meta.url),
    "utf8",
  );
  const nodes = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      new Element("div"),
    ]),
  );
  nodes.filter.value = "全部";
  nodes.workspace.append(Object.assign(new Element("option"), { value: "" }));
  const paths = [
    "/out/<img onerror=alert(1)>.html",
    "/out/image.png",
    "/out/gone.pdf",
    "/out/movie.mp4",
  ];
  const kinds = ["HTML", "图片", "PDF", "视频"];
  let state = {
    revision: 1,
    active: "task",
    tasks: [
      {
        id: "task",
        name: "Test",
        roots: ["/out"],
        items: Object.fromEntries(
          paths.map((p, i) => [
            p,
            {
              path: p,
              relative: p.slice(5),
              kind: kinds[i],
              mtime: 1,
              signature: "s" + i,
              missing: i === 2,
            },
          ]),
        ),
      },
    ],
  };
  const calls = [],
    intervals = new Set(),
    events = {};
  let subscriber;
  const document = {
    hidden: false,
    getElementById: (id) => nodes[id],
    createElement: (tag) => new Element(tag),
    addEventListener: (event, handler) => (events[event] = handler),
    removeEventListener: (event) => delete events[event],
  };
  const window = {
    addEventListener: (event, handler) => (events[event] = handler),
  };
  const orca = {
    locale: "zh-CN",
    plugin: {
      on: (event, handler) => {
        subscriber = handler;
        return {
          dispose: () => {
            subscriber = null;
          },
        };
      },
      request: async (name, input = {}) => {
        calls.push(input);
        if (input.action === "workspaces")
          return {
            workspaces: [
              { id: "local", name: "Local", path: "/out", hostId: "local" },
              { id: "remote", name: "Remote", path: "/remote", hostId: "ssh" },
            ],
          };
        if (input.action === "preview")
          return { preview: "data:image/jpeg;base64,/9j/" };
        if (input.action === "version") return { revision: state.revision };
        if (input.action === "start") {
          state = {
            ...state,
            revision: 2,
            active: "new",
            tasks: [
              ...state.tasks,
              { id: "new", name: input.name, roots: [input.roots], items: {} },
            ],
          };
        }
        return structuredClone(state);
      },
    },
  };
  const context = vm.createContext({
    ui,
    t,
    localizedError,
    document,
    window,
    orca,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval: (fn) => {
      intervals.add(fn);
      return fn;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  vm.runInContext(
    (
      await fs.readFile(
        new URL("../../src/shelf/panel-mount.js", import.meta.url),
        "utf8",
      )
    ).replace(/^import[^;]+;\n/gm, "").replace("export function mount", "function mount"),
    context,
  );
  context.mount({ getElementById: document.getElementById }, orca, { hidden: false, addEventListener() {}, removeEventListener() {} });
  await settle();
  await settle();
  assert.equal(nodes.cards.children.length, 4);
  assert.equal(nodes.workspace.children.length, 2);
  const previewCount = calls.filter((c) => c.action === "preview").length;
  assert.equal(previewCount, 3);
  const gallery = walk(nodes.cards);
  assert.equal(
    gallery.filter((e) => e.textContent === "圈选修改" && e.tag === "button")
      .length,
    0,
  );
  const htmlOpen = gallery.find(
    (e) =>
      e.attributes["aria-label"] === "在 Orca 打开 <img onerror=alert(1)>.html",
  );
  await htmlOpen.onclick();
  assert.equal(calls.findLast(c => c.action === "open").path, paths[0]);
  assert.equal(
    gallery.some((e) => e.tag === "script"),
    false,
  );
  const missing = gallery.find(
    (e) => e.attributes["aria-label"] === "在 Orca 打开 gone.pdf",
  );
  assert.equal(missing.disabled, true);
  nodes.search.value = "image";
  nodes.search.oninput();
  await new Promise(r => setTimeout(r, 180));
  await settle();
  assert.equal(nodes.cards.children.length, 1);
  assert.equal(
    calls.filter((c) => c.action === "preview").length,
    previewCount,
  );
  nodes.search.value = "";
  nodes.search.oninput();
  nodes.filter.value = "PDF";
  nodes.filter.onchange();
  await settle();
  assert.equal(nodes.cards.children.length, 1);
  nodes.layout.onclick();
  assert.equal(nodes.cards.className, "list");
  nodes.name.value = "New";
  nodes.roots.value = "/limited/output";
  nodes.workspace.value = "local";
  await nodes.start.onclick();
  assert.equal(state.active, "new");
  assert.equal(nodes.settings.open, false);
  assert.equal(calls.find((c) => c.action === "start").workspace.id, "local");
  assert.equal(intervals.size, 1);
  events.pagehide();
  assert.equal(intervals.size, 0);
  assert.equal(subscriber, null);
});
