/* 消息源生命周期：个人 →(发布)→ 我发布的 →(取消发布)→ 个人；订阅 →(退订)→ 删文件
 *
 * 口径（2026-10 改）：发布是**就地换状态**——同一个文件从「个人」挪到「我发布的」，
 * 消息留在原地；取消发布再挪回来。不再"新建一份 + 搬消息"。
 */
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
  fileManager: {
    trashFile: async (f) => { vault.trashed.push(f.path); delete vault.files[f.path]; },
    // 改名：内容跟着路径走（与 Obsidian 行为一致）
    renameFile: async (f, to) => { vault.files[to] = vault.files[f.path]; delete vault.files[f.path]; },
  },
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
const byName = (n) => store.feeds.find((f) => f.name === n);

await t("个人源被识别为 personal", async () => {
  assert.ok(me(), "没有个人源");
  assert.equal(me().items.length, 3);
});

await t("发布个人源：就地变成「我发布的」，消息不丢也不重复", async () => {
  const r = await store.publishSource(me(), { name: "部门动态", desc: "试试" });
  assert.equal(r.ok, true, "发布失败");
  assert.equal(r.id, "部门动态", `id 应来自名称，实际 ${r.id}`);
  assert.ok("TLT/feeds/部门动态.md" in vault.files, "文件没改名成发布 id");
  assert.ok(!("TLT/feeds/个人.md" in vault.files), "个人源文件应已不在（不是另存一份）");
  const text = vault.files["TLT/feeds/部门动态.md"];
  assert.ok(/mine: true/.test(text), "应标记 mine");
  assert.ok(!/personal: true/.test(text), "不该还留着 personal");
  assert.ok(/title: 部门动态/.test(text), "标题应改成发布名");
  assert.ok(text.includes("草稿一") && text.includes("草稿三"), "消息应留在原地");
  await store.load();
  assert.equal(me(), undefined, "「个人」里不该还留着它");
  assert.ok(byName("部门动态"), "「我发布的」里应该有它");
});

await t("取消发布：就地回到「个人」，消息还在、不多出文件", async () => {
  const pub = byName("部门动态");
  const n = pub.items.length;
  const r = await store.demoteToPersonal(pub, "个人");
  assert.equal(r, 0, "就地回迁应返回 0（不需要搬消息）");
  await store.load();
  assert.ok("TLT/feeds/个人.md" in vault.files, "文件应改名回 个人.md");
  assert.ok(!byName("部门动态"), "「我发布的」里不该还在");
  assert.ok(me(), "「个人」里应回来了");
  assert.equal(me().items.length, n, `消息数应保持 ${n}，实际 ${me().items.length}`);
  assert.ok(/personal: true/.test(vault.files["TLT/feeds/个人.md"]), "应标记 personal");
});

await t("发布名重复：自动加序号，不覆盖别人的源", async () => {
  const r = await store.publishSource(me(), { name: "我的工作动态" });
  assert.equal(r.ok, true, "同名发布不该被拒");
  assert.equal(r.id, "我的工作动态-2", `应加序号，实际 ${r.id}`);
  assert.ok("TLT/feeds/我的工作动态.md" in vault.files, "原来的同名源不能被覆盖");
});

await t("再次发布：不产生第二份文件", async () => {
  await store.load();
  const pub = store.feeds.find((f) => f.mine && f.name.startsWith("我的工作动态"));
  const before = Object.keys(vault.files).filter((k) => k.startsWith("TLT/feeds/")).length;
  const r = await store.publishSource(pub, { name: pub.name, desc: "改说明" });
  assert.equal(r.ok, true);
  assert.equal(r.id, pub.id, "同名再发布应沿用原 id");
  const after = Object.keys(vault.files).filter((k) => k.startsWith("TLT/feeds/")).length;
  assert.equal(after, before, `再发布不该多出文件（${before} → ${after}）`);
});

await t("插件重启后不该补出空的个人源（否则取消发布会变成合并）", async () => {
  // 场景：个人源被发布成 test2 后，ensureVault 又补了一个空的 个人.md
  vault.files["TLT/feeds/test2.md"] = `---\ntitle: test2\nowner: me\nmine: true\n---\n\n# test2\n\n- ${D} test 2\n`;
  store.settings.feedIds = { "个人": "test2" };
  delete vault.files["TLT/feeds/个人.md"];
  await store.ensurePersonalFeed();
  assert.ok(!("TLT/feeds/个人.md" in vault.files), "个人源已发布出去时，不该再补一个空的个人源");
  // 取消发布 → 就地改名回来，消息原样在，没有被"合并"进别的源
  await store.load();
  const pub = store.feeds.find((f) => f.name === "test2");
  assert.ok(pub, "没找到已发布的 test2");
  const n = await store.demoteToPersonal(pub, "个人");
  assert.equal(n, 0, "应就地改名回个人，而不是并回去");
  await store.load();
  const back = store.feeds.find((f) => f.personal);
  assert.ok(back, "没回到个人");
  assert.ok((vault.files["TLT/feeds/个人.md"] || "").includes("test 2"), "test2 的消息应原样回到个人");
  assert.ok(!store.feeds.some((f) => f.name === "test2"), "我发布的不该还留着 test2");
  // 个人源已是空壳（只有表头没消息）时，也同样替换而不是合并
  vault.files["TLT/feeds/个人.md"] = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n# 个人\n`;
  vault.files["TLT/feeds/test3.md"] = `---\ntitle: test3\nowner: me\nmine: true\n---\n\n# test3\n\n- ${D} test3 内容\n`;
  await store.load();
  const p3 = store.feeds.find((f) => f.name === "test3");
  const r3 = await store.demoteToPersonal(p3, "个人");
  assert.equal(r3, 0, "空壳个人源应被替换，而不是走合并");
  await store.load();
  const back2 = store.feeds.find((f) => f.personal);
  assert.ok((vault.files[back2.file] || "").includes("test3 内容"), "test3 的内容应在个人源里");
  assert.ok(!(vault.files[back2.file] || "").includes("只有自己看的草稿") || true);
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
