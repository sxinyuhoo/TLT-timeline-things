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

const NB = "/Users/sean/Library/Mobile Documents/iCloud~md~obsidian/Documents/NewBrain/90-插件运营区/TLT";
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

const ideasPath = "ideas.md";
const dump = () => files.get(ideasPath).split("\n").filter((l) => /^\s*[-*+]\s+/.test(l)).slice(0, 4).join("\n");

console.log("\n=== ① 标签库改名：patent → 专利");
await store.renameTag("patent", "专利");
await store.load();
console.log("库里还有 patent 吗:", store.tags.includes("patent"), "| 有 专利 吗:", store.tags.includes("专利"));
console.log("ideas 里 patent 出现次数:", (files.get(ideasPath).match(/\[type:: patent\]/g) || []).length);
console.log(dump());

console.log("\n=== ② 删掉某个 idea 的标签（模拟弹窗保存：tags 里去掉它）");
const it = store.ideas.find((x) => (x.tags || []).length);
console.log("选中的 idea:", it.title.slice(0, 20), "| 原 tags:", it.tags, "| type:", it.type);
it.tags = (it.tags || []).filter((t) => t !== it.tags[0]);
await store.updateIdea(it);
await store.load();
const after = store.ideas.find((x) => x.title === it.title);
console.log("保存后 tags:", after?.tags, "| type:", after?.type);
console.log(files.get(ideasPath).split("\n").find((l) => l.includes(it.title.slice(0, 12))));

console.log("\n=== ③ 带 [type::] 的 idea：弹窗里去掉这个标签再保存");
const it2 = store.ideas.find((x) => x.type === "sparkle");
console.log("选中:", it2.title.slice(0, 18), "| type:", it2.type);
it2.tags = [];                       // 弹窗里把显示出来的标签全删掉
await store.updateIdea(it2);
await store.load();
const after2 = store.ideas.find((x) => x.title === it2.title);
console.log("保存后 tags:", after2?.tags, "| type:", after2?.type, "→ 显示:", after2 ? [...(after2.tags || []), after2.type].filter(Boolean) : null);
console.log(files.get(ideasPath).split("\n").find((l) => l.includes(it2.title.slice(0, 12))));

rmSync(tmp, { recursive: true, force: true });
