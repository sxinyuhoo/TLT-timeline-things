/* 消息源生命周期：个人 →(发布)→ 我发布的 →(取消发布)→ 个人；订阅 →(退订)→ 删文件 */
import esbuild from "esbuild";
import assert from "node:assert/strict";

await esbuild.build({
  stdin: { contents: `export { Store } from "./src/store"; export { TFile } from "obsidian";`, resolveDir: process.cwd(), sourcefile: "s.ts", loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: "test/store-bundle.mjs",
  alias: { obsidian: "./test/obsidian-stub.ts" }, logLevel: "error",
});
const { Store, TFile } = await import("./store-bundle.mjs?" + Date.now());

/* ---------- 内存 vault ---------- */
function makeVault(files) {
  const trashed = [];
  const fileOf = (p) => new TFile(p);
  return {
    files,
    trashed,
    getAbstractFileByPath: (p) => (p in files ? fileOf(p) : null),
    getMarkdownFiles: () => Object.keys(files).map(fileOf),
    cachedRead: async (f) => files[f.path] ?? "",
    read: async (f) => files[f.path] ?? "",
    create: async (p, c) => { files[p] = c; },
    createFolder: async () => {},
    process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
    trash: async (f) => { trashed.push(f.path); delete files[f.path]; },
    delete: async (f) => { delete files[f.path]; },
    on: () => ({}),
  };
}

const D = "2026-10-22";
const personal = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n# 个人\n\n- ${D} 草稿一 [kind:: note]\n  > 正文一\n- ${D} 草稿二 [state:: ended]\n  > 正文二\n- ${D} 草稿三\n`;
const published = `---\ntitle: 我的工作动态\nowner: me\nmine: true\n---\n\n# 我的工作动态\n\n- ${D} 已发布的一条\n  > 说明\n`;

const vault = makeVault({ "TLT/feeds/个人.md": personal, "TLT/feeds/我的工作动态.md": published });
function parseFm(text = "") {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const out = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(":");
    if (i < 0) return;
    let v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (v === "true") v = true; else if (v === "false") v = false;
    out[line.slice(0, i).trim()] = v;
  });
  return out;
}
const app = {
  vault,
  fileManager: { trashFile: async (f) => { vault.trashed.push(f.path); delete vault.files[f.path]; } },
  metadataCache: { getFileCache: (f) => ({ frontmatter: parseFm(vault.files[f.path] || "") }) },
};
const store = new Store(app, {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", tagsFile: "TLT/tags.md",
  defaultPeriod: "m", mineFeed: "我的工作动态",
});
await store.load();

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ✓", name); }
  catch (e) { fail++; console.log("  ✗", name, "\n     " + e.message); }
};

const me = () => store.feeds.find((f) => f.personal);

await t("个人源被识别为 personal", async () => {
  assert.ok(me(), "没有个人源");
  assert.equal(me().items.length, 3);
});

await t("发布源：自动生成 id，全部搬过去，个人清空", async () => {
  const r = await store.publishSource(me(), { name: "部门动态", desc: "试试" });
  assert.equal(r.ok, true, "发布失败");
  assert.equal(r.id, "部门动态", `id 应来自名称，实际 ${r.id}`);
  assert.ok("TLT/feeds/部门动态.md" in vault.files, "新源文件没建出来");
  const text = vault.files["TLT/feeds/部门动态.md"];
  assert.ok(text.includes("草稿一") && text.includes("草稿三"), "草稿没搬全");
  assert.ok(/mine: true/.test(text), "新源应是 mine");
  const left = vault.files["TLT/feeds/个人.md"];
  assert.ok(!left.includes("草稿一"), "个人里还有草稿一（会重复）");
});

await t("再次发布：不重复写入，个人里新加的会被带过去", async () => {
  await store.load();
  vault.files["TLT/feeds/个人.md"] += `- ${D} 草稿四\n`;
  await store.load();
  const r = await store.publishSource(me(), { name: "部门动态" });
  assert.equal(r.id, "部门动态", "应沿用上次的 id");
  const text = vault.files["TLT/feeds/部门动态.md"];
  assert.equal((text.match(/草稿一/g) || []).length, 1, "重复写入了同一条");
  assert.ok(text.includes("草稿四"), "新草稿没带过去");
  assert.equal(r.moved, 1, `只该搬 1 条，实际 ${r.moved}`);
});

await t("同名不同源：自动加序号，不报占用", async () => {
  const other = store.feeds.find((f) => f.id === "部门动态");
  const r = await store.publishSource({ ...other, id: "another", file: "TLT/feeds/x.md", items: [] }, { name: "部门动态" });
  assert.equal(r.ok, true, "同名二次发布被拒了");
  assert.equal(r.id, "部门动态-2", `应加序号，实际 ${r.id}`);
});

await t("取消发布：内容并回个人，源文件进回收站", async () => {
  const pub = store.feeds.find((f) => f.id === "部门动态");
  const n = await store.foldBackToPersonal(pub, "个人");
  assert.ok(n >= 3, `应并回至少 3 条，实际 ${n}`);
  assert.ok(vault.trashed.includes("TLT/feeds/部门动态.md"), "文件没进回收站");
  await store.load();
  assert.equal(store.feeds.find((f) => f.id === "部门动态"), undefined, "源还在列表里");
  assert.ok(me().items.length >= 3, `个人里只有 ${me().items.length} 条`);
});

await t("退订：文件进回收站并从列表消失", async () => {
  vault.files["TLT/feeds/远程-部门通知.md"] = `---\ntitle: 部门通知\nremote: http://x/feed?id=1\n---\n\n- ${D} 远端一条\n`;
  await store.load();
  const sub = store.feeds.find((f) => f.id === "远程-部门通知");
  assert.ok(sub, "没识别到订阅源");
  await store.trashFeedFile(sub);
  await store.load();
  assert.equal(store.feeds.find((f) => f.id === "远程-部门通知"), undefined, "退订后还在");
  assert.ok(vault.trashed.includes("TLT/feeds/远程-部门通知.md"));
});

console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
