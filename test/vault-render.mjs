/* 用真实 vault 的数据把工作台/消息中心渲染一遍（jsdom），确认不是只有解析对 */
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";

const VAULT = process.argv[2];
if (!VAULT) { console.error("用法: node test/vault-render.mjs <vault 路径>"); process.exit(2); }

await esbuild.build({
  stdin: {
    contents: `
      export { Store } from "./src/store";
      export { WorkbenchView } from "./src/views/workbench";
      export { MessagesView } from "./src/views/messages";
      export { TFile } from "obsidian";`,
    resolveDir: process.cwd(), sourcefile: "v.ts", loader: "ts",
  },
  bundle: true, format: "esm", platform: "node", outfile: "test/vault-render-bundle.mjs",
  external: ["obsidian"], logLevel: "error",
  plugins: [{
    name: "stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.resolve("test/obsidian-stub.ts") }));
    },
  }],
});
const lib = await import("./vault-render-bundle.mjs?" + Date.now());

const dom = new JSDOM(`<!doctype html><html><body class="theme-dark"></body></html>`, { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.DOMParser = dom.window.DOMParser;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };

g.createSvg = (tag) => dom.window.document.createElementNS("http://www.w3.org/2000/svg", tag);
g.createEl = (tag, o = {}) => {
  const e = dom.window.document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.toggleClass = function (c, on) { this.classList.toggle(c, on); };
EP.setCssProps = function (obj) { Object.entries(obj || {}).forEach(([k, v]) => this.style.setProperty(k, String(v))); };
EP.createDiv = function (o) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); };
EP.createSpan = function (o) { return this.createEl("span", typeof o === "string" ? { cls: o } : o); };
EP.createEl = function (tag, o = {}) {
  const e = dom.window.document.createElement(tag);
  if (o.text) e.textContent = o.text;
  if (o.cls) e.className = o.cls;
  this.appendChild(e);
  return e;
};
dom.window.moment = { locale: () => "zh-cn" };

const root = path.resolve(VAULT);
const md = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) md.push(p);
  }
})(root);

const files = new Map(md.map((p) => [path.relative(root, p), fs.readFileSync(p, "utf8")]));
const dataJson = path.join(root, ".obsidian/plugins/tlt-timeline-things/data.json");
const settings = JSON.parse(fs.readFileSync(dataJson, "utf8"));

const vault = {
  getMarkdownFiles: () => [...files.keys()].map((p) => new lib.TFile(p)),
  getAbstractFileByPath: (p) => (files.has(p) ? new lib.TFile(p) : null),
  cachedRead: async (f) => files.get(f.path) ?? "",
  read: async (f) => files.get(f.path) ?? "",
  create: async () => {}, createFolder: async () => {}, modify: async () => {},
  on: () => ({}), off: () => {},
};
const app = {
  vault,
  metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  workspace: { getLeavesOfType: () => [], getLeaf: () => ({ setViewState: async () => {} }) },
  fileManager: { renameFile: async () => {} },
};

const store = new lib.Store(app, settings);
await store.load();
const plugin = {
  settings, store, app,
  isLight: () => false,
  hubState: () => ({ publish: "", sync: "" }),
  saveSettings: async () => {},
  refreshAll: () => {},
};

const out = [];
for (const [name, Cls] of [["工作台", lib.WorkbenchView], ["消息中心", lib.MessagesView]]) {
  const el = window.document.createElement("div");
  window.document.body.appendChild(el);
  const leaf = { view: null, containerEl: el, app };
  const view = new Cls(leaf, plugin);
  view.app = app;
  view.containerEl = el;
  view.contentEl = el.createDiv();
  await view.onOpen();
  const text = el.textContent.replace(/\s+/g, " ").trim();
  out.push(`${name}: ${el.querySelectorAll("*").length} 个元素 / ${text.length} 字`);
  out.push(`  前 160 字: ${text.slice(0, 160)}`);
  const empties = [...el.querySelectorAll(".tlt-empty")].map((e) => e.textContent);
  out.push(`  空态: ${empties.length ? empties.join(" | ") : "（无）"}`);
  // 逐页签看一眼：每个页签真的渲染了多少内容
  if (name === "工作台") {
    for (const [tab, label] of [["ms", "里程碑"], ["month", "任务"], ["today", "日历"]]) {
      view.tab = tab;
      await view.render();
      const pane = el.querySelector(".tlt-pane");
      const txt = (pane?.textContent || "").replace(/\s+/g, " ").trim();
      out.push(`  [${label}] 元素 ${pane ? pane.querySelectorAll("*").length : 0} / 前 120 字: ${txt.slice(0, 120)}`);
    }
  }
}
console.log(out.join("\n"));
console.log(`\n数据：任务 ${store.tasks.length} / 人员 ${store.staff.length} / 源 ${store.feeds.length} / 消息 ${store.feeds.flatMap((f) => f.items).length} / 记录 ${store.logs.length} / 随手记 ${store.ideas.length}`);
