// 随手记标签问题的探针：在临时副本上跑，不碰用户库
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = process.cwd();
const out = join(mkdtempSync(join(tmpdir(), "tlt-ideas-")), "bundle.mjs");
await build({
  entryPoints: [join(root, "test/daily-entry.ts")],
  bundle: true, format: "esm", platform: "node", target: "node18",
  outfile: out, logLevel: "silent",
  alias: { obsidian: join(root, "test/obsidian-stub.ts") },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.createEl = (tag, o = {}) => {
  const e = document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.createEl = function (tag, o = {}) { const e = document.createElement(tag); if (o.text) e.textContent = o.text; if (o.cls) e.className = o.cls; this.appendChild(e); return e; };

const mod = await import(out);
const { Store, TFile } = mod;
const { readdirSync, readFileSync: rf, statSync, writeFileSync } = await import("node:fs");

const NB = process.argv[2] || "/Users/sean/Library/Mobile Documents/iCloud~md~obsidian/Documents/NewBrain/90-插件运营区/TLT";
const tmp = mkdtempSync(join(tmpdir(), "tlt-vault-"));
cpSync(NB, tmp, { recursive: true });
console.log("临时副本:", tmp);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".md")) acc.push(p);
  }
  return acc;
}
const files = new Map();
for (const p of walk(tmp)) files.set(p.slice(tmp.length + 1), rf(p, "utf8"));
function parseFm(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return undefined;
  const o = {};
  for (const ln of m[1].split(/\r?\n/)) {
    const i = ln.indexOf(":"); if (i < 0) continue;
    const k = ln.slice(0, i).trim(); let v = ln.slice(i + 1).trim();
    if (v === "true") v = true; else if (v === "false") v = false;
    o[k] = v;
  }
  return o;
}
const vault = {
  getMarkdownFiles: () => [...files.keys()].map((p) => new TFile(p)),
  getAbstractFileByPath: (p) => (files.has(p) ? new TFile(p) : null),
  cachedRead: async (f) => files.get(f.path) ?? "",
  read: async (f) => files.get(f.path) ?? "",
  process: async (f, fn) => { files.set(f.path, fn(files.get(f.path) ?? "")); },
  create: async (p, c) => { files.set(p, c); },
  createFolder: async () => {},
  adapter: { exists: async (p) => files.has(p), read: async (p) => files.get(p) ?? "" },
};
const app = {
  vault,
  metadataCache: { getFileCache: (f) => ({ frontmatter: parseFm(files.get(f.path) || "") }) },
  workspace: { getLeavesOfType: () => [], getLeaf: () => ({}), on: () => ({}) },
  fileManager: { trashFile: async () => {}, renameFile: async () => {} },
};

const store = new Store(app, {
  tasksFolder: "tasks", teamFolder: "crew", feedsFolder: "feeds", logsFolder: "logs",
  ideasFile: "ideas.md", tagsFile: "tags.md", defaultPeriod: "m", mineFeed: "个人",
});
await store.load();
store.onSettingsChange = async () => {};

const tasks = store.tasks.filter((t) => t.kind === "task");
const byScope = tasks.reduce((acc, t) => { acc[t.scope] = (acc[t.scope] || 0) + 1; return acc; }, {});
console.log("任务总数:", tasks.length, "· 按 scope 分:", JSON.stringify(byScope));
console.log("个人任务（前 8 条）:");
for (const t of tasks.filter((x) => x.scope === "个人").slice(0, 8)) console.log("  -", t.title.slice(0, 30), "| file:", t.file.split("/").pop());
rmSync(tmp, { recursive: true, force: true });
