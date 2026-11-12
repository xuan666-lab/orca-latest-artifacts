import { localizeStatic } from "./i18n.mjs";
export function scopeStyle(css) {
  return css.replace(/^body\s*\{/gm, ":host {").replace(/:root\b/g, ":host");
}
export async function mountView(host, directory, mount, api) {
  if (host.shadowRoot) return host.shadowRoot;
  const root = host.attachShadow({ mode: "open" });
  const [html, css] = await Promise.all([
    fetch(directory + "/panel.html").then((r) => r.text()),
    fetch(directory + "/panel.css").then((r) => r.text()),
  ]);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,link").forEach((e) => e.remove());
  const style = document.createElement("style");
  style.textContent = scopeStyle(css);
  root.append(style, ...parsed.body.childNodes);
  localizeStatic(root, api.locale);
  mount(root, api, host);
  return root;
}
