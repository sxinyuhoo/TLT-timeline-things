/**
 * 真库探针：把某个日记文件里的 tlt-daily 块按真实数据渲染一遍，看分组里到底有什么。
 * 用法：node tools/probe-daily.mjs "<vault>" "20261028" [任务目录]
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.argv[2];
const day = process.argv[3] || "20261028";
const out = join(mkdtempSync(join(tmpdir(), "tlt-probe-")), "bundle.mjs");

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
g.MouseEvent = dom.window.MouseEvent; g.KeyboardEvent = dom.window.KeyboardEvent; g.Event = dom.window.Event;
g.HTMLInputElement = dom.window.HTMLInputElement; g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };
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
EP.setCssProps = function () {};
EP.setText = function (t) { this.textContent = t; };
EP.createEl = function (tag, o = {}) { const e = dom.window.document.createElement(tag); if (o.text) e.textContent = o.text; if (o.cls) e.className = o.cls; this.appendChild(e); return e; };

const mod = await import(out);
const { renderDaily } = mod;

function walk(dir, out2 = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out2);
    else if (name.endsWith(".md")) out2.push(p);
  }
  return out2;
}

// ---- 真库适配器（只读）----
const dataDir = join(vault, "90-插件运营区/TLT");
const files = new Map();
for (const p of walk(dataDir)) files.set(p.slice(vault.length + 1), readFileSync(p, "utf8"));

function parseFm(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return undefined;
  const out2 = {};
  for (const ln of m[1].split(/\r?\n/)) {
    const i = ln.indexOf(":");
    if (i < 0) continue;
    const k = ln.slice(0, i).trim();
    let v = ln.slice(i + 1).trim();
    if (v === "true") v = true; else if (v === "false") v = false;
    out2[k] = v;
  }
  return out2;
}

const vaultStub = {
  getMarkdownFiles: () => [...files.keys()].map((p) => new mod.TFile(p)),
  getAbstractFileByPath: (p) => (files.has(p) ? new mod.TFile(p) : null),
  cachedRead: async (f) => files.get(f.path) ?? "",
  read: async (f) => files.get(f.path) ?? "",
  process: async () => {},
  adapter: { exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")), read: async (p) => files.get(p) ?? "" },
};
const app = {
  vault: vaultStub,
  metadataCache: { getFileCache: (f) => ({ frontmatter: parseFm(files.get(f.path) || "") }) },
  workspace: { getLeavesOfType: () => [], getLeaf: () => ({}), getActiveFile: () => null, on: () => ({}) },
  fileManager: { trashFile: async () => {}, renameFile: async () => {} },
};

const { Store } = mod;
const store = new Store(app, {
  tasksFolder: "90-插件运营区/TLT/tasks", teamFolder: "90-插件运营区/TLT/crew",
  feedsFolder: "90-插件运营区/TLT/feeds", logsFolder: "90-插件运营区/TLT/logs",
  ideasFile: "90-插件运营区/TLT/ideas.md", tagsFile: "90-插件运营区/TLT/tags.md",
  defaultPeriod: "m", mineFeed: "个人",
});
await store.load();

const plugin = { store, settings: store.settings, app, hubState: () => ({ publish: "", sync: "" }), saveSettings: async () => {}, refreshAll: () => {} };
const host = document.createElement("div");
renderDaily(plugin, host, "date: auto\noverdue: true\ntree: true\nwho: true\n", `${day}.md`);
const text = host.textContent.replace(/\s+/g, " ").trim();
console.log(`—— ${day}.md 的 tlt-daily 渲染 ——`);
console.log(text.slice(0, 600) || "（空）");

// 顺手看看那天的数据情况
const near = (t, d) => t.due === d || t.doneAt === d || t.created === d;
const all = store.tasks.filter((t) => t.kind !== "log");
for (const d of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]) {
  const due = all.filter((t) => t.due === d);
  console.log(`   ${d}: 截止该日 ${due.length} 条（未完成 ${due.filter((t) => !t.done).length} / 已完成 ${due.filter((t) => t.done).length}），doneAt=该日 ${all.filter((t) => t.doneAt === d).length} 条`);
}

const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const dueThatDay = all.filter((t) => t.due === iso);
const doneThatDay = all.filter((t) => t.done && t.doneAt === iso);
const doneNoAt = all.filter((t) => t.done && !t.doneAt);
console.log(`\n[数据] 任务 ${all.length}：截止=${iso} 的 ${dueThatDay.length} 条；那天完成的 ${doneThatDay.length} 条；已完成但没完成时间的 ${doneNoAt.length} 条`);
console.log(`[数据] 截止日期分布（前 8 天）:`);
const byDay = {};
for (const t of all) if (t.due) byDay[t.due] = (byDay[t.due] || 0) + 1;
Object.entries(byDay).sort().slice(-10).forEach(([d, n]) => console.log(`   ${d}: ${n}`));
