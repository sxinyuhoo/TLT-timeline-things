/**
 * 快捷命令（0.5）：登记/新建/归档/删除全套流程。
 * 跑法：node test/commands.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "tlt-cmd-")), "bundle.mjs");

await build({
  entryPoints: [join(root, "test/cmd-entry.ts")],
  bundle: true, format: "esm", platform: "node", target: "node18",
  outfile: out, external: ["obsidian"], logLevel: "silent",
  alias: { obsidian: join(root, "test/obsidian-stub.ts") },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

/* Obsidian 给 DOM 补的那套方法 */
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.toggleClass = function (c, on) { this.classList.toggle(c, on); };
EP.setCssProps = function (obj) { Object.entries(obj || {}).forEach(([k, v]) => this.style.setProperty(k, String(v))); };
EP.createEl = function (tag, o = {}) {
  const e = document.createElement(tag);
  if (o.text) e.textContent = o.text;
  if (o.cls) e.className = o.cls;
  this.appendChild(e);
  return e;
};
globalThis.createEl = (tag, o = {}) => {
  const e = dom.window.document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};
const mod = await import(out);
const { makeStore, fps } = mod;

const flush = (ms = 20) => new Promise((r) => dom.window.setTimeout(r, ms));
const clickText = (scope, label) => {
  const btn = [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  if (!btn) throw new Error(`找不到按钮「${label}」，实际有：${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
};
const clickRow = async (text) => {
  const row = [...document.querySelectorAll(".tlt-pickrow")].find((r) => r.textContent.includes(text));
  if (!row) throw new Error(`列表里没有「${text}」，实际有：${[...document.querySelectorAll(".tlt-pickrow")].map((r) => r.textContent).join(" | ")}`);
  row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(40);
};
const typeInto = async (input, v) => {
  input.value = v;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await flush(20);
};

let pass = 0, fail = 0;
const results = [];

async function t(name, fn) {
  const before = { ...fps.files };
  try {
    await fn();
    pass++; results.push(`  ✓ ${name}`);
  } catch (e) {
    fail++; results.push(`  ✗ ${name} \n      ${e.message}`);
  } finally {
    for (const k of Object.keys(fps.files)) if (!(k in before)) delete fps.files[k];
    for (const k of Object.keys(before)) fps.files[k] = before[k];
    document.body.innerHTML = "";
  }
}

const D = "2026-10-24";
const NEW = () => makeStore();

/* ---------------- ① 登记任务 ---------------- */
await t("登记任务：命令跑通并写进项目文件", async () => {
  const { app, store, refresh } = await NEW();
  // 先建一个项目
  assert.equal(await store.createProject("阿尔法"), true, "项目应建成功");
  await store.load();
  assert.ok(fps.files["TLT/tasks/阿尔法.md"], "项目文件应存在");

  const { taskRegisterFlow } = mod;
  taskRegisterFlow(app, store, refresh);
  await flush(30);
  const modal = document.querySelector(".modal");
  assert.ok(modal, "登记任务应弹出表单");
  const titleInput = modal.querySelector(".tlt-input-title, input.tlt-input");
  assert.ok(titleInput, "应有标题输入框");
  await typeInto(titleInput, "写一版接口文档");
  clickText(modal, "创建");
  await flush(60);
  const text = fps.files["TLT/tasks/阿尔法.md"];
  assert.ok(text.includes("写一版接口文档"), `项目文件里应写上这条任务：\n${text}`);
});

/* ---------------- ② 新建项目 / 新建里程碑 ---------------- */
await t("新建项目：PromptModal 落成一个文件", async () => {
  const { app, store, refresh } = await NEW();
  mod.newProjectFlow(app, store, refresh);
  await flush(30);
  const input = document.querySelector(".modal input.tlt-input-title");
  assert.ok(input, "应弹输入框");
  input.value = "贝塔项目";
  document.querySelector(".modal .tlt-btn.pri").click();
  await flush(80);
  assert.ok(fps.files["TLT/tasks/贝塔项目.md"], "应建出 TLT/tasks/贝塔项目.md");
  assert.ok(fps.files["TLT/tasks/贝塔项目.md"].startsWith("# 贝塔项目"), "文件首行应是 # 项目名");
});

await t("新建里程碑：选项目 → 输入名字 → ## 追加", async () => {
  const { app, store, refresh } = await NEW();
  await store.createProject("伽马");
  await store.load();
  void mod.newMilestoneFlow(app, store, refresh);
  await flush(30);
  // ① 选项目
  await clickRow("伽马");
  // ② 输入名字
  const input = document.querySelector(".modal input.tlt-input-title");
  assert.ok(input, "应弹输入框");
  input.value = "第二阶段";
  document.querySelector(".modal .tlt-btn.pri").click();
  await flush(80);
  assert.ok(fps.files["TLT/tasks/伽马.md"].includes("## 第二阶段"), `应加上里程碑：\n${fps.files["TLT/tasks/伽马.md"]}`);
});

/* ---------------- ③ 删除任务 ---------------- */
await t("删除任务：两级选择 + 确认后行被移除", async () => {
  const { app, store, refresh } = await NEW();
  fps.files["TLT/tasks/德尔塔.md"] = `# 德尔塔

## 一期

- [ ] 要删掉的任务 🛫 ${D} 📅 ${D}
- [ ] 要留下的任务 🛫 ${D} 📅 ${D}
`;
  await store.load();
  void mod.deleteTaskFlow(app, store, refresh);   // 不 await：流程要等我们点弹窗
  await flush(30);
  // ① 来源
  await clickRow("德尔塔");
  // ② 任务
  await clickRow("要删掉");
  // ③ 确认
  const confirm = document.querySelector(".modal .tlt-confirm-body");
  assert.ok(confirm, "应有确认框");
  assert.ok(confirm.textContent.includes("要删掉的任务"), "确认框应写清是哪条");
  clickText(document.querySelector(".modal"), "删除");
  await flush(80);
  const text = fps.files["TLT/tasks/德尔塔.md"];
  assert.ok(!text.includes("要删掉的任务"), `要删的那条应没了：\n${text}`);
  assert.ok(text.includes("要留下的任务"), "不该误删别的任务");
});

/* ---------------- ⑤ 归档项目 ---------------- */
await t("归档项目：文件搬进 archive/，原位置消失", async () => {
  const { app, store, refresh } = await NEW();
  fps.files["TLT/tasks/泽塔.md"] = `# 泽塔\n\n## 一期\n\n- [x] 都干完了 📅 ${D}\n`;
  await store.load();
  void mod.archiveProjectFlow(app, store, refresh);   // 不 await：流程要等我们点弹窗
  await flush(30);
  await clickRow("泽塔");
  const body = document.querySelector(".modal .tlt-confirm-body").textContent;
  assert.ok(body.includes("TLT/archive/泽塔.md"), `确认框应写明去哪：${body}`);
  clickText(document.querySelector(".modal"), "归档");
  await flush(80);
  assert.ok(!fps.files["TLT/tasks/泽塔.md"], "原位置应没了");
  assert.ok(fps.files["TLT/archive/泽塔.md"], "应搬到 archive/");
});

/* ---------------- ⑤b 随手记 ---------------- */
await t("随手记：写进 ideas.md，带 #标签", async () => {
  const { app, store, refresh } = await NEW();
  void mod.quickIdeaFlow(app, store, refresh);
  await flush(30);
  const title = document.querySelector(".modal .tlt-idea-title");
  assert.ok(title, "应弹出随手记表单");
  await typeInto(title, "把回归脚本整理成工具");
  clickText(document.querySelector(".modal"), "收录");
  await flush(80);
  const ideas = fps.files["TLT/ideas.md"] || "";
  assert.ok(ideas.includes("把回归脚本整理成工具"), `ideas.md 里应有这条：\n${ideas}`);
});

/* ---------------- ⑤c 新建消息 ---------------- */
await t("新建消息：写进消息源文件", async () => {
  const { app, store, refresh } = await NEW();
  void mod.newMessageFlow(app, store, refresh);
  await flush(30);
  const modal = document.querySelector(".modal");
  assert.ok(modal, "应弹出新建消息");
  const title = modal.querySelector("input.tlt-input-title") || modal.querySelector("input.tlt-input");
  await typeInto(title, "周五的评审会");
  clickText(modal, "创建");
  await flush(90);
  const files = Object.keys(fps.files).filter((k) => k.startsWith("TLT/feeds/"));
  const hit = files.find((k) => (fps.files[k] || "").includes("周五的评审会"));
  assert.ok(hit, `消息应写进某个源：${files.join(", ")}`);
});

/* ---------------- ⑥ 选择器键盘操作 ---------------- */
await t("选择器：打字过滤 + ↑↓ + 回车选中", async () => {
  const { app } = await makeStore();
  const { PickerModal } = mod;
  new PickerModal(app, "测试", [
    { label: "阿尔法", value: "a" },
    { label: "贝塔", value: "b" },
    { label: "伽马", value: "c" },
  ], "过滤", () => {}).open();
  await flush(30);
  const input = document.querySelector(".modal .tlt-picksearch");
  await typeInto(input, "贝");
  const rows = [...document.querySelectorAll(".tlt-pickrow")];
  assert.equal(rows.length, 1, `过滤后应只剩一项，实际 ${rows.length}`);
  await typeInto(input, "");
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await flush(10);
  const on = document.querySelector(".tlt-pickrow.on");
  assert.ok(on && on.textContent.includes("贝塔"), "↓ 之后应选中第二项");
});

/* ---------------- ⑦ 命令都注册上了 ---------------- */
await t("插件注册了八个快捷命令 + 一个总入口", async () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(/^0\.[5-9]\./.test(manifest.version), `版本应在 0.5~0.9 之间，实际 ${manifest.version}`);
  const src = readFileSync(join(root, "src/main.ts"), "utf8");
  for (const id of ["quick-menu", "new-task", "new-idea", "new-message", "new-project",
    "new-milestone", "archive-project", "delete-task"]) {
    assert.ok(src.includes(`this.cmd("${id}"`), `缺少命令 ${id}`);
  }
});

await t("总入口列出全部动作（含随手记 / 新建消息）", async () => {
  const { app, store, refresh } = await NEW();
  mod.quickMenuFlow(app, store, refresh, { workbench: () => {}, messages: () => {} });
  await flush(30);
  const labels = [...document.querySelectorAll(".tlt-pickrow")].map((r) => r.querySelector(".tlt-pickname")?.textContent || "");
  for (const want of ["登记任务", "随手记", "新建消息", "新建项目", "新建里程碑", "归档项目", "删除任务"]) {
    assert.ok(labels.some((l) => l.includes(want)), `总入口缺「${want}」，实际：${labels.join(" / ")}`);
  }
});

/* ---------------- 里程碑重命名 ---------------- */
await t("里程碑重命名：改 ## 标题，任务跟着走；重名/空名不改", async () => {
  const { store } = await NEW();
  fps.files["TLT/tasks/米.md"] = `# 米\n\n## 一期\n\n- [ ] 甲 📅 2026-10-30\n\n## 二期\n\n- [ ] 乙 📅 2026-11-02\n`;
  await store.load();
  assert.equal(await store.renameMilestone("米", "一期", "第一阶段"), true, "应改名成功");
  await store.load();
  const text = fps.files["TLT/tasks/米.md"];
  assert.ok(text.includes("## 第一阶段"), `标题应改掉：\n${text}`);
  assert.ok(!text.includes("## 一期"), "旧标题不该还在");
  const ms = store.milestones("米").find((m) => m.name === "第一阶段");
  assert.ok(ms && ms.tasks.length === 1 && ms.tasks[0].title.includes("甲"), "任务应跟着新标题");
  // 重名
  assert.equal(await store.renameMilestone("米", "第一阶段", "二期"), false, "同名已存在应拒绝");
  // 空名
  assert.equal(await store.renameMilestone("米", "第一阶段", "   "), false, "空名应拒绝");
  // 不存在的小节
  assert.equal(await store.renameMilestone("米", "没有这个", "随便"), false, "找不到小节应返回 false");
  assert.ok(fps.files["TLT/tasks/米.md"].includes("## 第一阶段"), "拒绝时文件不能被动过");
});

/* ---------------- 定时任务：关掉就真的不跑 ---------------- */
await t("定时任务：改成「关闭」后旧定时器被清掉", async () => {
  const { app, store } = await NEW();
  const { TLTPlugin } = mod;
  const plugin = new TLTPlugin(app, { id: "tlt-timeline-things", name: "TLT - Timeline & Tasks", version: "0.7.8" });
  plugin.app = app; plugin.store = store; plugin.settings = { ...store.settings, autoSyncMin: 15, autoPushMin: 0 };

  const made = [], cleared = [];
  const origSet = dom.window.setInterval, origClear = dom.window.clearInterval;
  dom.window.setInterval = (fn, ms) => { const id = 1000 + made.length; made.push({ id, ms }); return id; };
  dom.window.clearInterval = (id) => { cleared.push(id); };
  plugin.registerInterval = () => 0;
  try {
    plugin.setupTimers();
    assert.equal(made.length, 1, `sync=15 时应建 1 个定时器，实际 ${made.length}`);
    assert.equal(made[0].ms, 15 * 60000, "间隔应是 15 分钟");
    // 用户改成「关闭」
    plugin.settings.autoSyncMin = 0;
    plugin.setupTimers();
    assert.ok(cleared.includes(made[0].id), "旧的同步定时器应被清掉");
    assert.equal(made.length, 1, "关闭后不该再建新的定时器");
  } finally {
    dom.window.setInterval = origSet;
    dom.window.clearInterval = origClear;
  }
});

/* ---------------- 发布 ID / 订阅判定 / 取消发布保名 ---------------- */
await t("发布 ID：纯 ASCII、同名稳定、跨库不撞", async () => {
  const { store } = await NEW();
  store.settings.publisherName = "小王的工作台";
  const id1 = store.publishIdFor("个人");
  const id2 = store.publishIdFor("个人");
  assert.equal(id1, id2, "同一个人同一个名字应得到同一个 ID");
  assert.ok(/^[A-Za-z0-9._-]+$/.test(id1), `ID 必须是 ASCII，实际：${id1}`);
  assert.ok(!id1.includes("%"), "ID 里不该有编码字符");
  assert.ok(id1.length <= 32, `ID 别太长：${id1}`);

  // 另一个人（不同发布者名 / 不同库）发同名源 → ID 不同
  const { store: other } = await NEW();
  other.settings.publisherName = "小李的工作台";
  other.settings.publisherSalt = "zzzz9999";
  const otherId = other.publishIdFor("个人");
  assert.notEqual(id1, otherId, "不同人发布同名源，ID 必须不同，否则会互相覆盖");
});

await t("发布一个中文名的源：文件与 ID 都是干净短 ID", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/部门通知.md"] = `---\ntitle: 部门通知\nowner: me\n---\n\n- 2026-10-20 一条消息\n`;
  await store.load();
  const src = store.feeds.find((f) => f.id === "部门通知");
  assert.ok(src, "夹具里的草稿源应被读到");
  const r = await store.publishSource(src, { name: "部门通知" });
  assert.ok(r.ok, "发布应成功");
  assert.ok(/^[A-Za-z0-9._-]+$/.test(r.id), `ID 应是干净的 ASCII：${r.id}`);
  assert.ok(fps.files[`TLT/feeds/${r.id}.md`], `文件应改名成 ${r.id}.md，实际有：${Object.keys(fps.files).join(", ")}`);
  assert.ok(!Object.keys(fps.files).some((k) => k.includes("部门通知")), "中文文件名不该留着");
});

await t("老的中文 ID：推送前会被换成短 ID（文件一起改名）", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/个人.md"] = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- 2026-10-20 草稿\n`;
  await store.load();
  const personal = store.feeds.find((f) => f.personal);
  const pub = await store.publishSource(personal, { name: "我的动态" });
  assert.ok(pub.ok);
  // 模拟"老版本用中文当 ID"的留言：把映射与文件名都改回中文
  fps.files["TLT/feeds/中文旧ID.md"] = fps.files[`TLT/feeds/${pub.id}.md`];
  delete fps.files[`TLT/feeds/${pub.id}.md`];
  store.settings.feedIds = { "个人": "中文旧ID" };
  await store.load();
  const feed = store.feeds.find((f) => f.mine);
  const clean = await store.ensureCleanPublishId(feed);
  assert.equal(clean.changed, true, "中文 ID 应被识别为需要迁移");
  assert.ok(/^[A-Za-z0-9._-]+$/.test(clean.id), `迁移后的 ID 要干净：${clean.id}`);
  assert.ok(fps.files[`TLT/feeds/${clean.id}.md`], "文件应改名到新 ID");
  assert.ok(!fps.files["TLT/feeds/中文旧ID.md"], "旧的中文文件名应没了");
});

await t("订阅判定：别人的同名源不算「我自己的」", async () => {
  const { store } = await NEW();
  store.settings.feedIds = { "个人": "mine-abc123" };
  // 别人发的源（ID 不同、名字相同）
  store.httpJson = async () => ({ subs: [] });     // 只测判定，别真发请求
  const other = await store.subscribeRemote("http://hub", "http://hub/feed?id=someone-else-999", "个人");
  assert.notEqual(other.reason, "self", "别人发布的同名源不该被当成自己的");
  // 自己发布的（ID 命中）
  const mine = await store.subscribeRemote("http://hub", "http://hub/feed?id=mine-abc123", "我的动态");
  assert.equal(mine.reason, "self", "自己发布的源应被识别出来");
});

await t("取消发布：保留改名后的名字（不再改回「个人」）", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/个人.md"] = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- 2026-10-20 草稿\n`;
  await store.load();
  const personal = store.feeds.find((f) => f.personal);
  const pub = await store.publishSource(personal, { name: "我的工作动态" });
  assert.ok(pub.ok);
  await store.load();
  const feed = store.feeds.find((f) => f.mine);
  assert.equal(feed.name, "我的工作动态", "发布后名字是新名字");
  const back = await store.demoteToPersonal(feed, "个人");
  assert.equal(back, 0, "应就地回到个人源");
  await store.load();
  const home = store.feeds.find((f) => f.personal);
  assert.ok(home, "应回到个人分组");
  assert.equal(home.name, "我的工作动态", `取消发布后应保留改名后的名字，实际：${home.name}`);
});

/* ---------------- 并发读盘不该出现"同一个源两遍" ---------------- */
await t("并发 load()：源不会出现两份", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/测试.md"] = `---\ntitle: 测试\nowner: me\nmine: true\n---\n\n- 2026-10-26 test\n`;
  fps.files["TLT/feeds/个人.md"] = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- 2026-10-26 test 2\n`;
  await store.load();
  // 模拟真实场景：保存设置 + 文件变动几乎同时触发多次 load
  await Promise.all([store.load(), store.load(), store.load(), store.load()]);
  const ids = store.feeds.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, `源出现重复：${ids.join(", ")}`);
  assert.equal(store.feeds.length, 2, `应恰好 2 个源（测试 + 个人），实际 ${store.feeds.length}：${store.feeds.map((f) => f.id).join(", ")}`);
  const taskIds = store.tasks.map((t) => `${t.file}#${t.line}`);
  assert.equal(new Set(taskIds).size, taskIds.length, "任务也不该重复");
});

await t("并发 load()：第二轮要等第一轮读完，不会交错读盘", async () => {
  const { app, store } = await NEW();
  fps.files["TLT/feeds/甲.md"] = `---\ntitle: 甲\nowner: me\n---\n\n- 2026-10-26 一\n`;
  fps.files["TLT/feeds/乙.md"] = `---\ntitle: 乙\nowner: me\n---\n\n- 2026-10-26 二\n`;
  await store.load();

  // 记录读盘顺序：交错读 → 甲,甲,乙,乙…；排队读 → 甲,乙,甲,乙…（成组）
  const seq = [];
  const orig = app.vault.cachedRead;
  app.vault.cachedRead = async (f) => {
    seq.push(f.path.split("/").pop().replace(".md", ""));
    await new Promise((r) => setTimeout(r, 1));      // 让出事件循环，制造交错机会
    return orig(f);
  };
  const p1 = store.load();
  const p2 = store.load();
  await Promise.all([p1, p2]);
  app.vault.cachedRead = orig;

  const ids = seq.join(",");
  const dupAdj = seq.some((x, i) => i > 0 && seq[i - 1] === x);
  assert.ok(!dupAdj, `两个 load 交错读盘（同一文件连读两次）：${ids}`);
  assert.equal(store.feeds.filter((f) => f.id === "甲").length, 1, "甲 不该出现两份");
  assert.equal(store.feeds.filter((f) => f.id === "乙").length, 1, "乙 不该出现两份");
});

await t("并发 load() 时写入不丢：排队执行，最后一次能读到新内容", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/甲.md"] = `---\ntitle: 甲\npersonal: true\nowner: me\n---\n\n- 2026-10-26 一\n`;
  await store.load();
  const p1 = store.load();
  fps.files["TLT/feeds/甲.md"] = `---\ntitle: 甲\npersonal: true\nowner: me\n---\n\n- 2026-10-26 一\n- 2026-10-26 二\n`;
  const p2 = store.load();
  await Promise.all([p1, p2]);
  const jia = store.feeds.find((f) => f.id === "甲");
  assert.ok(jia, "没读到 甲 这个源");
  assert.equal(jia.items.length, 2, `最后一次 load 应读到两条，实际 ${jia.items.length}`);
  assert.equal(store.feeds.filter((f) => f.id === "甲").length, 1, "源不该变两个");
});


/* ---------------- 子项：只有内容与完成态（0.9.0） ---------------- */
const STEPS_FIX = `---
tlt: project
status: active
---
# 伽马

## 一期

- [ ] 收数据 [pri:: 2]
  - [x] 导出清单
  - [ ] 核对口径
- [ ] 另一条
`;

await t("子项：加 / 勾 / 改 / 删都写回原来那一行", async () => {
  const { store } = await NEW();
  fps.files["TLT/tasks/伽马.md"] = STEPS_FIX;
  await store.load();
  const task = store.tasks.find((x) => x.title === "收数据");
  assert.ok(task, "夹具任务没解析出来");
  assert.equal(task.steps.length, 2, `应解析出 2 个子项，实际 ${task.steps.length}`);
  assert.equal(task.steps[0].done, true, "第一条应是已完成");
  assert.equal(task.steps[1].done, false);

  await store.addStep(task, "与标注组对齐");
  let text = fps.files["TLT/tasks/伽马.md"];
  assert.ok(/^  - \[ \] 与标注组对齐$/m.test(text), `新子项应缩进两格：\n${text}`);
  const lines = text.split("\n");
  assert.ok(lines.findIndex((l) => l.includes("与标注组对齐")) < lines.findIndex((l) => l.trim() === "- [ ] 另一条"),
    "子项不能插到下一条任务下面");

  await store.load();
  const t2 = store.tasks.find((x) => x.title === "收数据");
  await store.setStepDone(t2, 1, true);
  await store.setStepText(t2, 1, "核对口径（含口径表）");
  text = fps.files["TLT/tasks/伽马.md"];
  assert.ok(/^  - \[x\] 核对口径（含口径表）$/m.test(text), `勾选与改文字应落在同一行：\n${text}`);

  await store.load();
  const t3 = store.tasks.find((x) => x.title === "收数据");
  await store.deleteStep(t3, 0);
  text = fps.files["TLT/tasks/伽马.md"];
  assert.ok(!/导出清单/.test(text), "删掉的子项应从文件里消失");
  assert.ok(/核对口径（含口径表）/.test(text), "其它子项要留着");
  assert.ok(/- \[ \] 另一条/.test(text), "下一条任务不能受影响");
});

/* ---------------- 时间戳：创建 / 完成（0.9.0） ---------------- */
const todayYmd = () => { const d = new Date(); const p2 = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

await t("时间戳：新建写 [created::]，勾选写 [done::]，取消勾选去掉", async () => {
  const { store } = await NEW();
  await store.createProject("贝塔");
  await store.load();
  await store.addTask("贝塔", undefined, { title: "写一版接口文档" });
  const ymd = todayYmd();
  let text = fps.files["TLT/tasks/贝塔.md"];
  assert.ok(text.includes(`[created:: ${ymd}]`), `新建任务应带创建日：\n${text}`);

  await store.load();
  const task = store.tasks.find((x) => x.title === "写一版接口文档");
  assert.equal(task.created, ymd, "created 应被解析出来");
  await store.toggleTask(task);
  text = fps.files["TLT/tasks/贝塔.md"];
  assert.ok(text.includes(`[done:: ${ymd}]`), `勾完应补完成日：\n${text}`);

  await store.load();
  const done = store.tasks.find((x) => x.title === "写一版接口文档");
  assert.equal(done.doneAt, ymd, "doneAt 应被解析出来");
  await store.toggleTask(done);
  text = fps.files["TLT/tasks/贝塔.md"];
  assert.ok(!text.includes("[done::"), `取消勾选应去掉完成日：\n${text}`);
  assert.ok(text.includes(`[created:: ${ymd}]`), "创建日不能被顺手抹掉");
});

/* ---------------- 事件流：TLT/events/YYYY-MM.md（0.9.0） ---------------- */
const evKey = () => Object.keys(fps.files).find((k) => /^TLT\/events\/\d{4}-\d{2}\.md$/.test(k));

await t("事件流：建项目 / 建任务 / 完成 / 重开各留一行", async () => {
  const { store } = await NEW();
  await store.createProject("伽马");
  await store.load();
  await store.addTask("伽马", "一期", { title: "写文档" });
  await store.load();
  const tk = store.tasks.find((x) => x.title === "写文档");
  await store.toggleTask(tk);
  await store.load();
  const tk2 = store.tasks.find((x) => x.title === "写文档");
  await store.toggleTask(tk2);          // 重开

  const key = evKey();
  assert.ok(key, `应建出事件文件，实际文件：${Object.keys(fps.files).join(", ")}`);
  const txt = fps.files[key];
  for (const kind of ["project.created", "task.created", "task.done", "task.reopen"]) {
    assert.ok(txt.includes(kind), `缺 ${kind}：\n${txt}`);
  }
  assert.ok(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} /m.test(txt), `行首应是「日期 时:分」：\n${txt}`);
  const dup = txt.trim().split("\n").filter((l) => l.includes("task.done"));
  assert.equal(dup.length, 1, `同一条事件不该写两遍：\n${txt}`);
});

await t("里程碑：刚做完那一刻才记 ms.done（不伪造历史）", async () => {
  const { store } = await NEW();
  fps.files["TLT/tasks/德尔塔.md"] = `---\ntlt: project\nstatus: active\n---\n# 德尔塔\n\n## 一期\n\n- [ ] 收尾 [pri:: 1]\n`;
  await store.load();                                   // 第一次读盘＝基线
  assert.ok(!evKey(), `第一次读盘不该凭空写事件，实际：${evKey()}`);
  const tk = store.tasks.find((x) => x.title === "收尾");
  await store.toggleTask(tk);
  await store.load();                                   // 这一轮才观察到"刚变成完成"
  const key = evKey();
  assert.ok(key, "应写出事件文件");
  assert.ok(fps.files[key].includes("ms.done"), `应记一次 ms.done：\n${fps.files[key]}`);
});

/* ---------------- 项目信息：改名 + 描述（0.9.2） ---------------- */
await t("项目信息：描述写进 frontmatter，改名连文件与日志一起改", async () => {
  const { store } = await NEW();
  fps.files["TLT/tasks/阿尔法.md"] = `# 阿尔法\n\n## 一期\n\n- [ ] 一条任务 [pri:: 1]\n`;
  fps.files["TLT/logs/2026-10.md"] = `# 2026-10\n\n## 2026-10-20\n\n- 09:30–10:30 写方案 [proj:: 阿尔法]\n- 11:00–12:00 别的事 [proj:: 别的项目]\n`;
  await store.load();

  const r = await store.setProjectInfo("阿尔法", "阿尔法平台", "做演示用的项目");
  assert.ok(r.ok, "应保存成功");
  assert.ok(r.renamed, "改了名字就该搬文件");
  const text = fps.files["TLT/tasks/阿尔法平台.md"];
  assert.ok(text, `项目文件应改名成阿尔法平台.md，实际有：${Object.keys(fps.files).filter((k) => k.includes("tasks")).join(", ")}`);
  // 描述统一存 frontmatter 的 desc；正文标题跟着改名
  assert.ok(/^# 阿尔法平台$/m.test(text), `正文标题应跟着改名：\n${text.slice(0, 80)}`);
  assert.ok(/^desc: 做演示用的项目$/m.test(text), `描述应写进 frontmatter：\n${text.slice(0, 140)}`);
  assert.ok(!fps.files["TLT/tasks/阿尔法.md"], "旧文件不该还在");
  const logs = fps.files["TLT/logs/2026-10.md"];
  assert.ok(/\[proj:: 阿尔法平台\]/.test(logs), `日志里的项目名应一起改：\n${logs}`);
  assert.ok(!/\[proj:: 阿尔法\]/.test(logs.replace(/阿尔法平台/g, "")), "旧名不该留着");
  assert.ok(/\[proj:: 别的项目\]/.test(logs), "别的项目不能被动");

  await store.load();
  assert.equal(store.projectDesc("阿尔法平台"), "做演示用的项目", "重新读盘应能读到描述");
  assert.ok(store.projects().includes("阿尔法平台"), "项目列表应换成新名");
});

await t("项目信息：只改描述（不改名）也能存", async () => {
  const { store } = await NEW();
  fps.files["TLT/tasks/贝塔.md"] = `# 贝塔\n\n## 一期\n\n- [ ] 一条\n`;
  await store.load();
  const r = await store.setProjectInfo("贝塔", "贝塔", "只加一段描述");
  assert.ok(r.ok && !r.renamed, "同名应只写描述");
  assert.ok(/^desc: 只加一段描述$/m.test(fps.files["TLT/tasks/贝塔.md"]), fps.files["TLT/tasks/贝塔.md"]);
  assert.ok(fps.files["TLT/tasks/贝塔.md"].includes("# 贝塔"), "正文不能被吃掉");
});

/* ---------------- 订阅来的源：只能起别名，不能改发布者的名字 ---------------- */
await t("订阅别人的源：改名只写本地别名，对方 title 不动", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/远程-部门通知.md"] =
    `---\ntitle: 部门通知\nremote: http://hub/feed?id=dept-123\nowner: 小王\nown: false\n---\n\n# 部门通知\n\n- 2026-10-26 一条\n`;
  await store.load();
  const f = store.feeds.find((x) => x.id === "远程-部门通知");
  assert.ok(f && f.remote, "夹具里的订阅源应被识别为 remote");
  const r = await store.renameFeed(f, "部门动态（我看的）");
  assert.equal(r.alias, true, "订阅源改名应走别名");
  const text = fps.files["TLT/feeds/远程-部门通知.md"];
  assert.ok(/^title: 部门通知$/m.test(text), `发布者的 title 不该被改：\n${text}`);
  assert.ok(/^alias: 部门动态（我看的）$/m.test(text), `应写入本地别名：\n${text}`);
  await store.load();
  const after = store.feeds.find((x) => x.id === "远程-部门通知");
  assert.equal(after.name, "部门动态（我看的）", "界面名用别名");
  assert.equal(after.remoteTitle, "部门通知", "原名要留着对照");
});

await t("拉取时：发布者改名不多出一个源，别名也不丢", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/远程-部门通知.md"] =
    `---\ntitle: 部门通知\nremote: http://hub/feed?id=dept-123\nowner: 小王\nalias: 部门动态\nown: false\n---\n\n# 部门通知\n\n`;
  await store.load();
  store.httpJson = async () => ({
    feeds: [{
      url: "http://hub/feed?id=dept-123", ok: true, id: "dept-123", title: "部门通知（新版）", owner: "小王",
      items: [{ mid: "m1", date: "2026-10-26", title: "一条", kind: "note", place: "", who: [], star: false, state: "live", until: "", body: "" }],
    }],
  });
  await store.pullFromHub("http://hub");
  await store.load();
  const feeds = store.feeds.filter((f) => f.remote);
  assert.equal(feeds.length, 1, `不该多出一个源，实际 ${feeds.length}：${feeds.map((f) => f.id).join(", ")}`);
  assert.equal(feeds[0].id, "远程-部门通知", "应写回原来那个文件");
  assert.equal(feeds[0].remoteTitle, "部门通知（新版）", "原名应更新成发布者的新名字");
  assert.equal(feeds[0].name, "部门动态", "本地别名要保留");
  assert.equal(feeds[0].items.length, 1, "消息应写进来");
});

await t("自己的源：改名就是改 title（照旧）", async () => {
  const { store } = await NEW();
  fps.files["TLT/feeds/个人.md"] = `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- 2026-10-26 草稿\n`;
  await store.load();
  const f = store.feeds.find((x) => x.personal);
  const r = await store.renameFeed(f, "我的草稿本");
  assert.equal(r.alias, false, "自己的源不该走别名");
  assert.ok(/^title: 我的草稿本$/m.test(fps.files["TLT/feeds/个人.md"]), "应改 title");
});

/* ---------------- 市场可检索性（README / manifest 关键词） ---------------- */
await t("manifest 描述：够短、且带上主要检索词", async () => {
  const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const d = m.description || "";
  assert.ok(d.length <= 250, `描述应 ≤250 字符，实际 ${d.length}`);
  for (const kw of ["task", "tasks", "schedule", "calendar", "milestone", "message", "任务", "日程", "里程碑"]) {
    assert.ok(d.toLowerCase().includes(kw.toLowerCase()), `manifest 描述里缺关键词「${kw}」：${d}`);
  }
});

await t("manifest 合规：名字标点、描述结尾（目录会按这两条隐藏插件）", async () => {
  const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const name = m.name || "";
  const bad = [...name].filter((c) => !/^[A-Za-z0-9 \-+()]$/.test(c));
  assert.equal(bad.length, 0, `名字里只允许字母数字与 - + ( )，实际多了：${bad.join("")}（${name}）`);
  assert.ok(!/obsidian/i.test(name), "名字里不能有 Obsidian");
  assert.ok(!/plugin$/i.test(name.trim()), "名字不能以 Plugin 结尾");
  const d = m.description || "";
  assert.ok(!/obsidian/i.test(d), "描述里不能有 Obsidian");
  assert.ok(/[.?!)]$/.test(d), `描述必须以 . ? ! ) 结尾，实际结尾：${JSON.stringify(d.slice(-1))}`);
  assert.ok(d.length <= 250, `描述 ≤250 字符，实际 ${d.length}`);
  assert.ok(!/\bthis plugin\b/i.test(d), "描述别写 this plugin");
  const keys = Object.keys(m);
  const ok = ["id", "name", "description", "author", "version", "minAppVersion", "isDesktopOnly", "authorUrl", "fundingUrl", "helpUrl"];
  const extra = keys.filter((k) => !ok.includes(k));
  assert.equal(extra.length, 0, `manifest 里出现目录不认的字段：${extra.join(", ")}`);
});

await t("README（中英）：有关键词对照表，且覆盖 tasks/timeline/schedule", async () => {
  for (const f of ["README.md", "README.en.md"]) {
    const s = readFileSync(join(root, f), "utf8").toLowerCase();
    for (const kw of ["tasks", "timeline", "schedule", "calendar", "milestone"]) {
      assert.ok(s.includes(kw), `${f} 里没提到「${kw}」`);
    }
    assert.ok(/甘特|gantt/.test(s), `${f} 里没提甘特/gantt`);
    assert.ok(/看板|kanban/.test(s), `${f} 里没提看板/kanban`);
    assert.ok(/工时|workload/.test(s), `${f} 里没提工时/workload`);
  }
});

console.log(results.join("\n"));
console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
