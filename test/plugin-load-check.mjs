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

const realManifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8"));
const inst = new PluginClass(app, { ...realManifest, dir: PLUGIN_DIR });
if (process.env.TLT_LANG) settings.language = process.env.TLT_LANG;   // 想验英文就 TLT_LANG=en
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

/* 命令都要真的注册上（stub 里 addCommand 不进注册表，所以这里列出实例自己的记录） */
try {
  const cmds = inst.commands || inst._commands || [];
  const ids = (cmds).map((c) => c.id).filter(Boolean);
  const want = ["quick-menu", "new-task", "new-idea", "new-message", "new-project", "new-milestone", "archive-project", "delete-task"];
  const missing = want.filter((x) => !ids.includes(x));
  if (missing.length) { console.error("命令缺失 ✗ →", missing.join(", "), "实际：", ids.join(", ")); process.exitCode = 1; }
  else console.log(`命令注册 ✓  ${ids.length} 个（含快捷命令 ${want.length} 个）`);
  const names = cmds.map((c) => c.name);
  console.log("命令名：" + names.slice(0, 6).join(" / "));
  const cjk = names.filter((n) => /[\u4e00-\u9fff]/.test(n));
  if (process.env.TLT_LANG === "en" && cjk.length) { console.error("英文界面下命令名还有中文 ✗ →", cjk.join(", ")); process.exitCode = 1; }
  /* 顺带点一下「快捷命令…」看看弹窗能不能开 */
  const menu = cmds.find((c) => c.id === "quick-menu");
  menu?.callback?.();
  await new Promise((r) => w.setTimeout(r, 60));
  const rows = w.document.querySelectorAll(".tlt-pickrow").length;
  console.log(rows >= 6 ? `快捷命令面板 ✓  ${rows} 项` : `快捷命令面板 ✗  只有 ${rows} 项`);
  if (rows < 6) process.exitCode = 1;
} catch (e) {
  console.error("命令注册检查抛错 ✗ →", e && e.message ? e.message : e);
  process.exitCode = 1;
}

/* 切语言：走设置页真正走的那条路（setControlValue），断言命令名跟着换 */
try {
  const cmds = inst.commands || [];
  const zh = process.env.TLT_LANG !== "en";
  const target = zh ? "en" : "zh";
  const before = cmds.map((c) => c.name).join("|");
  await inst.settingTab.setControlValue("language", target);   // 与用户下拉切换等价
  await new Promise((r) => w.setTimeout(r, 80));
  const after = cmds.map((c) => c.name);
  console.log(`切语言 ${zh ? "zh→en" : "en→zh"} 后命令名：` + after.slice(0, 4).join(" / "));
  const wrong = after.filter((n) => (target === "en" ? /[\u4e00-\u9fff]/.test(n) : !/[\u4e00-\u9fff]/.test(n)));
  if (wrong.length) { console.error("切语言后命令名不对 ✗ →", wrong.join(", ")); process.exitCode = 1; }
  if (before === after.join("|")) { console.error("切语言后命令名没变 ✗"); process.exitCode = 1; }
} catch (e) {
  console.error("切语言检查抛错 ✗ →", e && e.message ? e.message : e);
  process.exitCode = 1;
}

/* 日记块：拿真数据渲染一次，确认真能用 */
try {
  const cb = (inst.codeBlocks || []).find((x) => x.lang === "tlt-daily");
  if (!cb) { console.error("没有注册 tlt-daily 代码块 ✗"); process.exitCode = 1; }
  else {
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const diaryDate = process.env.TLT_DIARY_DATE || "20261029";
    cb.fn(process.env.TLT_DIARY_OPTS || "date: auto", host, { sourcePath: `70-生活/diary/2026/${diaryDate}.md` });
    const rows = host.querySelectorAll(".tlt-daily-row").length;
    const heads = [...host.querySelectorAll(".tlt-daily-h")].map((h) => h.textContent).join(" / ");
    console.log(`日记块 ✓  ${rows} 条（分组：${heads || "无"}）`);
    if (!rows && !host.querySelector(".tlt-daily-empty")) { console.error("日记块既没内容也没空状态 ✗"); process.exitCode = 1; }
  }
} catch (e) {
  console.error("日记块渲染抛错 ✗ →", e && e.message ? e.message : e);
  process.exitCode = 1;
}

/* 完事就退出：onload 里注册的定时器会把进程挂住 */
process.exit(process.exitCode ?? 0);
