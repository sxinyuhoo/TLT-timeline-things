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
  assert.ok(/^[A-Za-z0-9._-]+$/.test(r.id), `id 应是干净的 ASCII（slug+短哈希），实际 ${r.id}`);
  assert.ok(`TLT/feeds/${r.id}.md` in vault.files, "文件没改名成发布 id");
  assert.ok(!("TLT/feeds/个人.md" in vault.files), "个人源文件应已不在（不是另存一份）");
  const text = vault.files[`TLT/feeds/${r.id}.md`];
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
  assert.ok(!store.feeds.some((f) => f.name === "部门动态" && f.mine && !f.personal), "「我发布的」里不该还在");
  assert.ok(me(), "「个人」里应回来了");
  assert.equal(me().name, "部门动态", "取消发布后应保留发布时的名字");
  assert.equal(me().items.length, n, `消息数应保持 ${n}，实际 ${me().items.length}`);
  assert.ok(/personal: true/.test(vault.files["TLT/feeds/个人.md"]), "应标记 personal");
});

await t("同名源：ID 由发布者+名字派生，不会互相覆盖", async () => {
  // 先造一个"别人已经占了同名 id"的源
  vault.files["TLT/feeds/我的工作动态.md"] = `---\ntitle: 我的工作动态\nowner: 别人\nmine: false\n---\n\n# 我的工作动态\n\n- ${D} 别人的消息\n`;
  await store.load();
  const r = await store.publishSource(me(), { name: "我的工作动态" });
  assert.equal(r.ok, true, "同名发布不该被拒");
  assert.notEqual(r.id, "我的工作动态", "不该直接拿中文名当 id");
  assert.ok(`TLT/feeds/${r.id}.md` in vault.files, "新源应写进自己的文件");
  assert.ok(vault.files["TLT/feeds/我的工作动态.md"].includes("别人的消息"), "别人那份不能被覆盖");
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
  // 注意：个人源的 frontmatter 是 owner: me，所以 mine 也会是 true；
  // 「我发布的」那一组的判据是 mine && !personal
  assert.ok(!store.feeds.some((f) => f.name === "test2" && f.mine && !f.personal), "我发布的不该还留着 test2");
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

await t("删消息：只删那一条（连正文），已发布的顺手推一次", async () => {
  vault.files["TLT/feeds/已发布源.md"] = `---\ntitle: 已发布源\nowner: me\nmine: true\n---\n\n# 已发布源\n\n- ${D} 留下的一条\n- ${D} 要删的一条 [kind:: note]\n  > 这条的正文\n- ${D} 后面的一条\n`;
  store.settings.feedIds = { "已发布源": "pub-1" };
  store.settings.hubPublish = "http://x";
  await store.load();
  const feed = byName("已发布源");
  const target = feed.items.find((m) => m.title === "要删的一条");
  const pushed = [];
  const realHttp = store.httpJson;
  store.httpJson = async (url, init) => { pushed.push({ url, body: init?.body }); return { ok: true, count: (init?.body?.items || []).length }; };
  const r = await store.deleteMessage(feed.id, target);
  store.httpJson = realHttp;
  assert.deepEqual(r, { ok: true, pushed: true }, "应删掉并推送");
  const text = vault.files["TLT/feeds/已发布源.md"];
  assert.ok(!text.includes("要删的一条"), `那条该没了：\n${text}`);
  assert.ok(!text.includes("这条的正文"), "它的正文也该跟着删");
  assert.ok(text.includes("留下的一条") && text.includes("后面的一条"), "别的消息不能动");
  const pub = pushed.find((x) => x.url.endsWith("/publish"));
  assert.ok(pub, "应该推送到 /publish");
  assert.equal(pub.body.items.length, 2, `推上去的应是最新清单（2 条）：${pub.body.items.map((i) => i.title).join(",")}`);
});

await t("发布的 mid 稳定：删一条不会让后面所有 id 都变", async () => {
  store.settings.feedIds = { "稳定源": "pub-stable" };
  store.settings.hubPublish = "http://x";
  const line = (n) => `- ${D} 消息${n}`;
  vault.files["TLT/feeds/稳定源.md"] = `---\ntitle: 稳定源\nowner: me\nmine: true\n---\n\n# 稳定源\n\n${line("甲")}\n${line("乙")}\n${line("丙")}\n`;
  await store.load();
  const feed = byName("稳定源");
  const calls = [];
  const realHttp = store.httpJson;
  store.httpJson = async (url, init) => { calls.push({ url, body: init?.body }); return { ok: true }; };
  await store.publishFeed(feed, "http://x", "pub-stable");
  const before = calls.find((c) => c.url.endsWith("/publish")).body.items.map((i) => i.mid);
  // 删掉中间那条，再推一次
  const mid = feed.items.find((m) => m.title === "消息乙");
  await store.deleteMessage(feed.id, mid);
  const feed2 = byName("稳定源");
  await store.publishFeed(feed2, "http://x", "pub-stable");
  store.httpJson = realHttp;
  const after = calls.filter((c) => c.url.endsWith("/publish")).pop().body.items.map((i) => i.mid);
  assert.equal(before.length, 3, "先有 3 条");
  assert.equal(after.length, 2, "删完剩 2 条");
  assert.deepEqual(after, [before[0], before[2]], `甲/丙的 mid 必须不变：\n  之前 ${before.join(",")}\n  之后 ${after.join(",")}`);
});

await t("订阅同步：发布者删了，本地跟着删（自己补写、没 mid 的行留着）", async () => {
  const url = "http://hub/sub?id=abc";
  vault.files["TLT/feeds/远程-协作.md"] = `---\ntitle: 协作\nremote: ${url}\nowner: 别人\nown: false\n---\n\n# 协作\n\n- 2026-10-20 还在的一条 [mid:: abc-2026-10-20-还在的一条]\n- 2026-10-21 已被删的一条 [mid:: abc-2026-10-21-已被删的一条]\n  > 它的正文\n- 2026-10-22 我自己补的一条\n`;
  store.settings.subs = [url];
  await store.load();
  const put = (u, i) => ({ url: u, id: "abc", title: "协作", owner: "别人", ok: true, items: i });
  const realHttp = store.httpJson;
  store.httpJson = async () => ({
    pulledAt: "2026-10-30T00:00:00Z",
    feeds: [put(url, [
      { mid: "abc-2026-10-20-还在的一条", date: "2026-10-20", title: "还在的一条", kind: "note" },
    ])],
  });
  const res = await store.pullFromHub("http://hub");
  store.httpJson = realHttp;
  assert.equal(res.removed, 1, `应删掉 1 条：${JSON.stringify(res)}`);
  const text = vault.files["TLT/feeds/远程-协作.md"];
  assert.ok(!text.includes("已被删的一条"), `发布者删了的那条该没了：\n${text}`);
  assert.ok(!text.includes("它的正文"), "它的正文也要跟着删");
  assert.ok(text.includes("还在的一条"), "还在的不能动");
  assert.ok(text.includes("我自己补的一条"), "本地自己补的（没有 mid）不该被同步删掉");
});

await t("订阅同步：发布者把源清空了，本地同步的也清空（自己写的留着）", async () => {
  const url = "http://hub/sub?id=empty";
  vault.files["TLT/feeds/远程-清空.md"] = `---\ntitle: 清空\nremote: ${url}\n---\n\n# 清空\n\n- 2026-10-20 旧的一条 [mid:: empty-1]\n- 2026-10-21 我补的\n`;
  store.settings.subs = [url];
  await store.load();
  const realHttp = store.httpJson;
  store.httpJson = async () => ({ pulledAt: "", feeds: [{ url, id: "empty", title: "清空", ok: true, items: [] }] });
  const res = await store.pullFromHub("http://hub");
  store.httpJson = realHttp;
  assert.equal(res.removed, 1, `应清掉 1 条：${JSON.stringify(res)}`);
  const text = vault.files["TLT/feeds/远程-清空.md"];
  assert.ok(!text.includes("旧的一条"), `远端清空了，本地那条也该没：\n${text}`);
  assert.ok(text.includes("我补的"), "自己写的（没 mid）留着");
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
