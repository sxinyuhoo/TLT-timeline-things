/* 用真库 + 真 main.js 跑一遍 onload，抓加载期异常 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Module from "node:module";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = process.argv[2];
const VAULT = process.argv[3];
const require_ = createRequire(import.meta.url);

/* 1) DOM */
const dom = new JSDOM(`<!doctype html><html><body class="theme-dark"></body></html>`, { pretendToBeVisual: true, url: "app://obsidian.md/index.html" });
const w = dom.window;
const g = globalThis;
g.window = w; g.document = w.document;
g.HTMLElement = w.HTMLElement; g.Element = w.Element; g.Node = w.Node;
g.MouseEvent = w.MouseEvent; g.KeyboardEvent = w.KeyboardEvent; g.Event = w.Event;
g.getComputedStyle = w.getComputedStyle; g.DOMParser = w.DOMParser;
g.HTMLInputElement = w.HTMLInputElement; g.HTMLSelectElement = w.HTMLSelectElement; g.HTMLTextAreaElement = w.HTMLTextAreaElement;
g.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };
g.createEl = (tag, o = {}) => { const e = w.document.createElement(tag); if (typeof o === "string") e.className = o; else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; } return e; };
g.createDiv = (o) => g.createEl("div", o);
g.createSpan = (o) => g.createEl("span", o);
g.createSvg = (t) => w.document.createElementNS("http://www.w3.org/2000/svg", t);
w.moment = { locale: () => "zh-cn" };
const EP = w.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.toggleClass = function (c, on) { this.classList.toggle(c, on); };
EP.createEl = function (tag, o = {}) { const e = w.document.createElement(tag); if (o.text) e.textContent = o.text; if (o.cls) e.className = o.cls; this.appendChild(e); return e; };
EP.createDiv = function (o) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); };
EP.createSpan = function (o) { return this.createEl("span", typeof o === "string" ? { cls: o } : o); };
EP.setCssProps = function () {};
EP.setText = function (t) { this.textContent = t; };

/* 2) obsidian 桩件（编成 CJS 供 require 拦截） */
await esbuild.build({
  entryPoints: ["test/obsidian-stub.ts"], bundle: true, format: "cjs", platform: "node",
  outfile: "/tmp/obs-stub.cjs", logLevel: "error",
});
const stub = require_("/tmp/obs-stub.cjs");
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "obsidian") return stub;
  return origLoad.apply(this, [req, ...rest]);
};

/* 3) fs 支撑的 vault */
const root = path.resolve(VAULT);
const files = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) files.set(path.relative(root, p), fs.readFileSync(p, "utf8"));
  }
})(root);
const settings = JSON.parse(fs.readFileSync(path.join(root, ".obsidian/plugins/tlt-timeline-things/data.json"), "utf8"));

const TFile = stub.TFile;
const vault = {
  getMarkdownFiles: () => [...files.keys()].map((p) => new TFile(p)),
  getAbstractFileByPath: (p) => (files.has(p) ? new TFile(p) : null),
  cachedRead: async (f) => files.get(f.path) ?? "",
  read: async (f) => files.get(f.path) ?? "",
  create: async (p, c) => { files.set(p, c); return new TFile(p); },
  createFolder: async () => {},
  modify: async () => {},
  on: () => ({}), off: () => {},
};
const leaves = [];
const app = {
  vault,
  metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  workspace: {
    getLeavesOfType: () => leaves,
    getLeaf: () => ({ setViewState: async () => {} }),
    on: () => ({}),
    onLayoutReady: (cb) => cb(),
  },
  fileManager: { renameFile: async () => {} },
};

/* 4) 真 main.js + 真 onload */
const mod = require_(path.join(PLUGIN_DIR, "main.js"));
const PluginClass = mod.default ?? mod;
console.log("导出形态:", typeof PluginClass, "原型上有 onload:", typeof PluginClass.prototype?.onload);

const inst = new PluginClass(app, { id: "tlt-timeline-things", dir: "tlt-timeline-things", version: "0.4.13", minAppVersion: "1.8.7" });
inst.loadData = async () => settings;
// 模拟「重启时先恢复视图，再跑完 onload」——旧标签页在数据就绪前就构造
const { WorkbenchView } = await import("./vault-render-bundle.mjs").catch(() => ({}));
try {
  await inst.onload();
  console.log("onload 完成 ✓  任务", inst.store?.tasks?.length, "源", inst.store?.feeds?.length);
} catch (e) {
  console.error("onload 抛错 ✗ →", e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n") : e);
  process.exitCode = 1;
}
/* 5) 再验一次视图渲染（数据就绪后） */
try {
  const V = (await import("./vault-render-bundle.mjs")).WorkbenchView;
  const el = w.document.createElement("div");
  w.document.body.appendChild(el);
  const v = new V({ containerEl: el, app }, inst);
  v.app = app; v.containerEl = el; v.contentEl = el.createDiv();
  await v.onOpen();
  console.log("工作台渲染 ✓ 元素", el.querySelectorAll("*").length);
} catch (e) {
  console.error("工作台渲染抛错 ✗ →", e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n") : e);
  process.exitCode = 1;
}

/* 完事就退出：onload 里注册的定时器会把进程挂住 */
process.exit(process.exitCode ?? 0);
