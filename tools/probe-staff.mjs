// 人员饱和度为什么是 0：拿真库数据跑一遍插件自己的算法，看清每一层过滤掉了什么
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = process.cwd();
const out = join(mkdtempSync(join(tmpdir(), "tlt-staff-")), "bundle.mjs");
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
g.createEl = (tag, o = {}) => { const e = document.createElement(tag); if (typeof o === "string") e.className = o; else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; } return e; };
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };

const mod = await import(out);
const { Store, TFile, saturation, inPeriod, workloadBreakdown } = mod;
const IP = inPeriod || ((d, p) => true);

const SRC = process.argv[2];
const tmp = mkdtempSync(join(tmpdir(), "tlt-vault-"));
cpSync(SRC, tmp, { recursive: true });

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
for (const p of walk(tmp)) files.set(p.slice(tmp.length + 1), readFileSync(p, "utf8"));
function parseFm(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return undefined;
  const o = {};
  for (const ln of m[1].split(/\r?\n/)) {
    const i = ln.indexOf(":"); if (i < 0) continue;
    o[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
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
console.log("任务总数:", tasks.length, "· 人员:", store.staff.length);
console.log("有 due 的任务:", tasks.filter((t) => t.due).length, "· 没 due 的:", tasks.filter((t) => !t.due).length);
console.log("有 est 的:", tasks.filter((t) => t.est !== undefined).length, "· 有 wl 的:", tasks.filter((t) => t.wl).length);
console.log("\n人员 → 卡片上会显示的内容（人数 / 任务数 / 人天 / 缺什么）:");
for (const s of store.staff) {
  const b = (workloadBreakdown || ((ts, n, p, o) => ({ ...saturation(ts, n, p, o), mine: [], inWin: [], noDue: [], noEst: [], otherPeriod: 0 })))(
    tasks, s.name, "m", { capacity: s.capacity, days: s.days });
  const gaps = [];
  if (b.noEst.length) gaps.push(`${b.noEst.length} 项没填工作量`);
  if (b.noDue.length) gaps.push(`${b.noDue.length} 项没排期`);
  if (b.otherPeriod) gaps.push(`${b.otherPeriod} 项不在本周期`);
  console.log(`  ${s.name.padEnd(6, "　")} ${String(b.mine.length).padStart(2)} 项 · ${b.sum} / ${b.avail} 人天（${b.pct}%）  ${gaps.length ? "· " + gaps.join(" · ") : ""}`);
}
console.log("\n几个样例（owner / due / est / pw / wl）:");
for (const t of tasks.filter((x) => !x.done && x.owners.length).slice(0, 8)) {
  console.log(`  ${t.owners.join(",")} | due=${t.due || "-"} | est=${t.est ?? "-"} | pw=${t.pw} | wl=${t.wl || "-"} | ${t.title.slice(0, 26)}`);
}
rmSync(tmp, { recursive: true, force: true });
