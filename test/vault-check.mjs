/* 用真实 vault 文件跑一遍 store.load（不需要 Obsidian） */
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import { strict as assert } from "node:assert";

const VAULT = process.argv[2];
if (!VAULT) { console.error("用法: node test/vault-check.mjs <vault 路径>"); process.exit(2); }

await esbuild.build({
  stdin: { contents: `export { Store } from "./src/store";`, resolveDir: process.cwd(), sourcefile: "v.ts", loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: "test/store-bundle.mjs",
  external: ["obsidian"],
  logLevel: "error",
  plugins: [{
    name: "stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: `export class TFile{};export class TFolder{};export const normalizePath=p=>p.replace(/^\\/+|\\/+$/g,"");`,
        loader: "js",
      }));
    },
  }],
});
const { Store } = await import("./store-bundle.mjs?" + Date.now());

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
};

const all = walk(VAULT);
const rel = (p) => path.relative(VAULT, p).split(path.sep).join("/");

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^-?\d+$/.test(v)) v = Number(v);
    else v = v.replace(/^["']|["']$/g, "");
    fm[kv[1]] = v;
  }
  return fm;
}

const files = all.map((p) => ({ full: p, path: rel(p), basename: path.basename(p, ".md") }));
const vault = {
  getMarkdownFiles: () => files,
  cachedRead: async (f) => fs.readFileSync(f.full ?? path.join(VAULT, f.path), "utf8"),
  getAbstractFileByPath: (p) => {
    const hit = files.find((f) => f.path === p);
    return hit ? { path: hit.path, full: hit.full } : null;
  },
  process: async () => {},
  create: async () => {},
  createFolder: async () => {},
  on: () => ({}),
};
const app = {
  vault,
  metadataCache: {
    getFileCache: (f) => {
      const p = f.full ?? path.join(VAULT, f.path);
      try { return { frontmatter: frontmatter(fs.readFileSync(p, "utf8")) }; } catch { return { frontmatter: {} }; }
    },
  },
};

const store = new Store(app, {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/team", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的工作动态",
});
await store.load();

let pass = 0;
const t = (n, fn) => { try { fn(); pass++; console.log("  ✓", n); } catch (e) { console.log("  ✗", n, "\n    ", e.message); process.exitCode = 1; } };

console.log(`vault: ${VAULT}`);
console.log(`  ${store.tasks.length} 任务 · ${store.logs.length} 记录 · ${store.staff.length} 人 · ${store.feeds.length} 源 · ${store.ideas.length} 想法\n`);

t("任务能解析（有标题、有截止）", () => {
  assert.ok(store.tasks.length > 0);
  store.tasks.forEach((x) => { assert.ok(x.title.length > 0, "空标题"); assert.ok(x.file.startsWith("TLT/tasks/"), x.file); });
});
t("里程碑从 ## 解析出来", () => {
  const ms = store.milestones();
  assert.ok(ms.length >= 4, `只有 ${ms.length} 个`);
  console.log("      里程碑:", ms.map((m) => `${m.project}/${m.name}(${m.tasks.length})`).join(" · "));
});
t("人员档案读到岗位与产能", () => {
  assert.ok(store.staff.length >= 3);
  assert.ok(store.staff.every((s) => s.capacity > 0));
  console.log("      人员:", store.staff.map((s) => `${s.name}(${s.role || "?"} ${s.capacity}%)`).join(" · "));
});
t("消息源与消息", () => {
  assert.ok(store.feeds.length >= 2);
  const n = store.feeds.reduce((a, f) => a + f.items.length, 0);
  assert.ok(n >= 3, `只有 ${n} 条消息`);
  console.log("      源:", store.feeds.map((f) => `${f.name}(${f.items.length}${f.mine ? ",我发布" : ""})`).join(" · "));
});
t("记录按天分节", () => {
  assert.ok(store.logs.length >= 2);
  store.logs.forEach((l) => assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(l.due), l.due));
  console.log("      记录:", store.logs.map((l) => `${l.due} ${l.st}-${l.en} ${l.title}`).join(" | "));
});
t("想法读到类型/阶段", () => {
  assert.ok(store.ideas.length >= 3);
  assert.ok(store.ideas.some((i) => i.type !== "想法"));
});
t("本月分组不为空", () => {
  const m = store.monthTasks();
  assert.ok(m.todo.length + m.pending.length + m.late.length > 0);
  console.log(`      本月: 逾期 ${m.late.length} / 要做 ${m.todo.length} / 完成 ${m.done.length} / 待排期 ${m.pending.length}`);
});

console.log(`\n${pass} 项通过${process.exitCode ? "，有失败" : "，全部通过"}`);
