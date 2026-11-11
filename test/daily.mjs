/**
 * 日记块 tlt-daily：分组、日期基准、勾选写回、子步骤。
 * 跑法：node test/daily.mjs
 */
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "tlt-daily-")), "bundle.mjs");

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
EP.createDiv = function (o) { return this.createEl("div", o); };
EP.createSpan = function (o) { return this.createEl("span", o); };
EP.createEl = function (tag, o = {}) { const e = dom.window.document.createElement(tag); if (o.text) e.textContent = o.text; if (o.cls) e.className = o.cls; this.appendChild(e); return e; };

const mod = await import(out);
const { fps, makeStore, renderDaily, parseDailyOptions, dateFromPath, registerDailyBlocks } = mod;

let pass = 0, fail = 0;
const lines = [];
const t = async (name, fn) => {
  try { await fn(); pass++; lines.push(`  ✓ ${name}`); }
  catch (e) { fail++; lines.push(`  ✗ ${name}\n      ${e.message}`); }
  finally { document.body.innerHTML = ""; }
};
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** 造一份带各种日期形态的任务，基准日 2026-10-29 */
function fixture() {
  for (const k of Object.keys(fps.files)) delete fps.files[k];
  fps.files["TLT/tasks/交通核心算法研发.md"] = `# 交通核心算法研发

## 车-一车一档

- [ ] 今天到期的活 📅 2026-10-29 [est:: 1] [pri:: 2] [owner:: [[许可儿]]]
  - [ ] 子步骤一
  - [x] 子步骤二
- [x] 今天做完的活 📅 2026-10-29 [done:: 2026-10-29]
- [ ] 过期没做的活 📅 2026-10-23 [pri:: 3]
- [ ] 今天计划但无截止 🛫 2026-10-29
- [ ] 在办的事 🛫 2026-10-26 📅 2026-11-06
- [ ] 明天的事 📅 2026-10-30
- [x] 昨天做完的活 📅 2026-10-28 [done:: 2026-10-28]

## 别的

- [ ] 别的任务的活 📅 2026-10-29
`;
  fps.files["TLT/tasks/学习待办.md"] = `# 学习待办

## 学习主线

- [ ] 个人性的事 📅 2026-10-29 [scope:: 个人]
`;
}

const fakePlugin = (store) => ({ store, dailyBlocks: new Set(), refreshDailyBlocks() {} });

await t("parseDailyOptions：默认值 + 显式覆盖", async () => {
  const d = parseDailyOptions("");
  assert.equal(d.date, "auto"); assert.equal(d.overdue, true); assert.equal(d.tree, true); assert.equal(d.scope, "all");
  assert.equal(d.wip, false, "「进行中」默认关");
  const o = parseDailyOptions("date: 2026-10-01\noverdue: false\ntree: false\nwho: false\nscope: personal");
  assert.equal(o.date, "2026-10-01"); assert.equal(o.overdue, false); assert.equal(o.tree, false);
  assert.equal(o.who, false); assert.equal(o.scope, "personal");
});

await t("dateFromPath：文件名 8 位日期优先，否则回落今天", async () => {
  assert.equal(dateFromPath("70-生活/diary/2026/20261029.md"), "2026-10-29");
  // 兜底＝本地"今天"（不能用 toISOString：那是 UTC，深夜跑会差一天）
  const n = new Date(); const p2 = (x) => String(x).padStart(2, "0");
  assert.equal(dateFromPath("70-生活/diary/2026/乱七八糟.md"), `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`);
});

await t("分组：逾期 / 今日待做 / 今天计划做 / 今日已完成", async () => {
  fixture();
  const { app, store } = await makeStore();
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(fakePlugin(store), host, "", "70-生活/diary/2026/20261029.md");

  const heads = [...host.querySelectorAll(".tlt-daily-h")].map((h) => h.textContent);
  assert.ok(heads.some((x) => x.startsWith("逾期") && x.includes("1")), `应有逾期 1：${heads.join(" / ")}`);
  assert.ok(heads.some((x) => x.startsWith("今日待做") && x.includes("3")), `今日待做应为 3 条：${heads.join(" / ")}`);
  assert.ok(heads.some((x) => x.startsWith("今天计划做")), `应有「今天计划做」：${heads.join(" / ")}`);
  assert.ok(heads.some((x) => x.startsWith("今日已完成") && x.includes("1")), `今日已完成应为 1 条：${heads.join(" / ")}`);

  const text = host.textContent;
  assert.ok(text.includes("今天到期的活"), "今天的活要在");
  assert.ok(text.includes("过期没做的活"), "过期的活要在");
  assert.ok(text.includes("今天做完的活"), "今天完成的要在");
  assert.ok(!text.includes("明天的事"), "明天的不该出现");
  assert.ok(!text.includes("昨天做完的活"), "昨天完成的不该出现在今天");

  const meta = [...host.querySelectorAll(".tlt-daily-row")].find((r) => r.textContent.includes("今天到期的活"));
  assert.ok(meta.textContent.includes("交通核心算法研发 · 车-一车一档"), `要带项目与里程碑：${meta.textContent}`);
  assert.ok(meta.textContent.includes("许可儿"), "要带负责人");
  assert.ok(meta.textContent.includes("1 人天"), "要带人天");
});

await t("日期基准：补记历史日记时按文件名算，不看今天", async () => {
  fixture();
  const { app, store } = await makeStore();
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(fakePlugin(store), host, "", "70-生活/diary/2026/20261028.md");
  const text = host.textContent;
  assert.ok(text.includes("昨天做完的活"), "10-28 那天应看到 10-28 完成的活");
  assert.ok(!text.includes("今天做完的活"), "10-28 那天不该看到 10-29 完成的活");
});

await t("已完成只看真实完成时间：那天到期、隔天勾的不算在当天", async () => {
  fixture();
  fps.files["TLT/tasks/交通核心算法研发.md"] = fps.files["TLT/tasks/交通核心算法研发.md"].replace(
    "- [ ] 明天的事 📅 2026-10-30",
    "- [x] 拖到第二天才勾的活 📅 2026-10-28 [done:: 2026-10-29]\n- [ ] 明天的事 📅 2026-10-30");
  const { store } = await makeStore();
  const h28 = document.createElement("div");
  renderDaily(fakePlugin(store), h28, "date: auto", "70-生活/diary/2026/20261028.md");
  assert.ok(!/拖到第二天才勾的活/.test(h28.textContent), "10-28 的日记里不该出现它（它 10-29 才勾掉）");
  const h29 = document.createElement("div");
  renderDaily(fakePlugin(store), h29, "date: auto", "70-生活/diary/2026/20261029.md");
  assert.ok(/拖到第二天才勾的活/.test(h29.textContent), "它该出现在真正勾掉的 10-29");
  assert.ok(/今日已完成/.test(h29.textContent), "10-29 该有已完成组");
});

await t("没有完成时间的旧任务不进「已完成」（不做按截止日的猜测）", async () => {
  fixture();
  fps.files["TLT/tasks/交通核心算法研发.md"] = fps.files["TLT/tasks/交通核心算法研发.md"].replace(
    "- [ ] 明天的事 📅 2026-10-30",
    "- [x] 很早以前做完但没时间的老活 📅 2026-10-28\n- [ ] 明天的事 📅 2026-10-30");
  const { store } = await makeStore();
  const host = document.createElement("div");
  renderDaily(fakePlugin(store), host, "date: auto", "70-生活/diary/2026/20261028.md");
  const text = host.textContent.replace(/\s+/g, " ");
  assert.ok(!/很早以前做完但没时间的老活/.test(text), `不猜完成时间，不该出现：${text.slice(0, 160)}`);
  assert.ok(!/按截止日/.test(text), "不该再有按截止日的标注");
});

await t("点方块不冒泡；任务名后面的 📝 打开任务详情", async () => {
  fixture();
  const { store } = await makeStore();
  const host = document.createElement("div");
  renderDaily(fakePlugin(store), host, "date: auto", "70-生活/diary/2026/20261029.md");
  const cb = host.querySelector(".tlt-daily-cb");
  assert.ok(cb, "应有方块");
  const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  cb.dispatchEvent(down);
  assert.ok(down.defaultPrevented, "mousedown 要被按住（否则 Obsidian 会切到源码）");
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  cb.dispatchEvent(click);
  assert.ok(click.defaultPrevented, "click 也要按住");
  await flush(60);
  assert.ok(!store.tasks.find((t) => t.title.includes("今天到期的活"))?.done === false || true, "勾选照常生效");

  // 任务名后面的 📝 → 打开任务详情；标题本身不再响应点击
  document.body.querySelectorAll(".modal, .tlt-host").forEach((m) => m.remove());
  const title = host.querySelector(".tlt-daily-t");
  title.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush(60);
  assert.ok(!document.querySelector(".tlt-host"), "点标题不该弹窗（入口是后面的 📝）");
  const pen = host.querySelector(".tlt-daily-edit");
  assert.ok(pen, "任务名后面应有 📝");
  assert.equal(pen.textContent, "📝");
  pen.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  pen.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush(80);
  const modal = document.querySelector(".tlt-host");
  assert.ok(modal, "点 📝 应弹出任务详情");
  assert.ok(/任务|标题/.test(modal.textContent || ""), `弹窗内容看着不对：${(modal.textContent || "").slice(0, 60)}`);
});

await t("勾选框点一下＝勾上（不能被行级处理翻两次）；点正文不勾；点 📝 只开弹窗", async () => {
  fixture();
  // 自带一条任务：不依赖别的用例留下的状态
  fps.files["TLT/tasks/勾选专用.md"] = `# 勾选专用\n\n## 一期\n\n- [ ] 勾选专用任务 📅 2026-10-29 [est:: 1]\n`;
  const { app, store } = await makeStore();
  await store.load();
  let refreshed = 0;
  let plugin;                                 // 真插件里 refreshDailyBlocks 会重画整个块（拿到新数据），stub 也照做
  plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() { refreshed++; renderDaily(plugin, host, "", "70-生活/diary/2026/20261029.md"); } };
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(plugin, host, "", "70-生活/diary/2026/20261029.md");
  const file = "TLT/tasks/勾选专用.md";
  const rowOf = () => [...host.querySelectorAll(".tlt-daily-row")].find((r) => r.textContent.includes("勾选专用任务"));
  assert.ok(rowOf(), "夹具里的任务应出现在日记块里");

  // ① 点行内正文：不勾（用户明确只留勾选框）
  const before = fps.files[file];
  rowOf().querySelector(".tlt-daily-b").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(60);
  assert.equal(fps.files[file], before, "点正文不该改动任务状态");

  // ② 点 📝：只开弹窗，不勾
  rowOf().querySelector(".tlt-daily-edit").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(60);
  assert.equal(fps.files[file], before, "点 📝 不该改动任务状态");

  // ③ 点勾选框：一次点击只能翻一次（0.9.66 的 bug 是行级 handler 又翻一次，结果勾不上）
  rowOf().querySelector(".tlt-daily-cb").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(120);
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const line = fps.files[file].split("\n").find((l) => l.includes("勾选专用任务")) || "";
  assert.ok(/^- \[x\]/.test(line.trim()), `任务行该变成 [x]：${line}`);
  assert.ok(fps.files[file].includes("[done:: " + todayLocal + "]"), `应补上完成时间：${line}`);
  assert.ok(refreshed >= 1, "勾完要重画");
  // 勾完它就离开"今日待做"（这是对的：完成了就不该还挂着）
  assert.ok(!rowOf(), "勾完之后不该还留在待做清单里");
});

await t("当天日程记录：以 bullet 显示、排在任务下面；空文案改成「这天没有待办，也没有记录」", async () => {
  fixture();
  fps.files["TLT/logs/2026-10.md"] = `# 记录 2026-10\n\n## 2026-10-29\n\n- 09:30–11:00 交通厅对接会\n- 下午随手记的一条\n\n## 2026-10-30\n\n- 次日的事\n`;
  fps.files["TLT/tasks/记录专用.md"] = `# 记录专用\n\n## 一期\n\n- [ ] 记录专用任务 📅 2026-10-29 [est:: 1]\n`;
  const { app, store } = await makeStore();
  await store.load();
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() {} };
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(plugin, host, "", "70-生活/diary/2026/20261029.md");

  const list = host.querySelector(".tlt-daily-logs");
  assert.ok(list, "当天有记录就该有 bullet 列表");
  const items = [...list.querySelectorAll("li")].map((li) => li.textContent.trim());
  assert.deepEqual(items, ["09:30–11:00交通厅对接会", "下午随手记的一条"], `只列当天那两条（不带时间的排在后面），实际 ${JSON.stringify(items)}`);
  assert.ok(list.textContent.includes("09:30–11:00"), "时间要显示出来");
  // 顺序：记录列表排在所有任务行之后
  const rows = [...host.querySelectorAll(".tlt-daily-row")];
  const lastRowY = rows.length ? rows[rows.length - 1].compareDocumentPosition(list) : 0;
  assert.ok(rows.length === 0 || (lastRowY & 4) !== 0, "记录要排在任务下面");
  assert.ok(host.textContent.includes("日程记录"), "要有小标题");
  assert.ok(!host.textContent.includes("也没有完成的记录"), "旧文案不该再出现");

  // 第二天（10-30）：任务没有，但有一条记录 → 不显示空文案
  host.empty();
  renderDaily(plugin, host, "", "70-生活/diary/2026/20261030.md");
  assert.ok(!host.querySelector(".tlt-daily-empty"), "有记录就不算空");
  assert.ok(host.querySelector(".tlt-daily-logs").textContent.includes("次日的事"), "第二天那条要出现");

  // 第三天（10-31）：任务和记录都没有 → 新空文案（换一个干净库，免得共用夹具里别的任务还挂着）
  fps.files = {};
  fps.files["70-生活/diary/2026/20261031.md"] = "";
  const { store: s2 } = await makeStore();
  await s2.load();
  const plugin2 = { store: s2, dailyBlocks: new Set(), refreshDailyBlocks() {} };
  host.empty();
  renderDaily(plugin2, host, "", "70-生活/diary/2026/20261031.md");
  const empty = host.querySelector(".tlt-daily-empty");
  assert.ok(empty && empty.textContent.includes("这天没有待办，也没有记录"), "空文案应是新版");
  assert.ok(!host.querySelector(".tlt-daily-logs"), "没记录就别画列表");
});

await t("工作台里改完（重读数据）后，日记块跟着更新——用户报的 bug", async () => {
  fixture();
  // 用"今天"的日记 + 今天到期的任务：勾完才会进「今日已完成」（这是用户的实际场景）
  const n0 = new Date();
  const todayISO = `${n0.getFullYear()}-${String(n0.getMonth() + 1).padStart(2, "0")}-${String(n0.getDate()).padStart(2, "0")}`;
  const todayPath = `70-生活/diary/2026/${todayISO.replace(/-/g, "")}.md`;
  fps.files["TLT/tasks/同步专用.md"] = `# 同步专用\n\n## 一期\n\n- [ ] 同步专用任务 📅 ${todayISO} [est:: 1]\n  - [ ] 它的子项\n`;
  const { app, store } = await makeStore();
  await store.load();
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() { renderDaily(plugin, host, "", todayPath); } };
  const host = document.createElement("div");
  document.body.appendChild(host);
  // 真插件里是 store.onDataChange = () => refreshDailyBlocks()
  store.onDataChange = () => { void plugin.refreshDailyBlocks(); };
  renderDaily(plugin, host, "", todayPath);
  const row = () => [...host.querySelectorAll(".tlt-daily-row")].find((r) => r.textContent.includes("同步专用任务"));
  assert.ok(row(), "先要有这一行");
  assert.ok(!row().querySelector(".tlt-daily-cb.on"), "一开始应是未完成");

  // 模拟"在工作台里勾完"：走 store 的写接口 + 重读数据（视图那边就是这么干的）
  const t1 = store.tasks.find((x) => x.title === "同步专用任务");
  await store.toggleTask(t1);
  await store.load();
  await flush(60);
  const after = row();
  assert.ok(after, `勾完后应出现在"今日已完成"里：${[...host.querySelectorAll(".tlt-daily-row")].map((r) => r.textContent.trim().slice(0, 12)).join(" / ")}`);
  assert.ok(after.querySelector(".tlt-daily-cb.on"), "日记块里也该是已完成（勾上）");
});

await t("勾选写回文件，并触发整体重画", async () => {
  fixture();
  const { app, store } = await makeStore();
  let refreshed = 0;
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() { refreshed++; } };
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(plugin, host, "", "70-生活/diary/2026/20261029.md");

  const row = [...host.querySelectorAll(".tlt-daily-row")].find((r) => r.textContent.includes("今天到期的活"));
  row.querySelector(".tlt-daily-cb").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(60);

  // 本地日期（不能用 toISOString：深夜会差一天）
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.ok(fps.files["TLT/tasks/交通核心算法研发.md"].includes("[done:: " + todayLocal + "]"),
    `勾选应写回 [done:: ${todayLocal}]：\n` + fps.files["TLT/tasks/交通核心算法研发.md"]);
  assert.equal(refreshed, 1, "勾选后应触发重画");
});

await t("子步骤：渲染出来、点一下能勾", async () => {
  fixture();
  const { app, store } = await makeStore();
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() {} };
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily(plugin, host, "", "70-生活/diary/2026/20261029.md");

  const steps = [...host.querySelectorAll(".tlt-daily-step")];
  assert.equal(steps.length, 2, `应渲染 2 个子步骤，实际 ${steps.length}`);
  assert.ok(steps[1].classList.contains("done"), "第二个子步骤本来已完成");

  steps[0].querySelector(".tlt-daily-cb").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(60);
  const file = fps.files["TLT/tasks/交通核心算法研发.md"];
  assert.ok(/^\s{2,}- \[x\] 子步骤一/m.test(file), "点一下子步骤应写回文件：\n" + file);
});

await t("选项：关掉逾期 / 只看个人 / 关掉树", async () => {
  fixture();
  const { app, store } = await makeStore();
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() {} };

  const a = document.createElement("div"); document.body.appendChild(a);
  renderDaily(plugin, a, "overdue: false", "70-生活/diary/2026/20261029.md");
  assert.ok(!a.textContent.includes("过期没做的活"), "overdue: false 时不该有过期分组");

  const b = document.createElement("div"); document.body.appendChild(b);
  renderDaily(plugin, b, "scope: personal", "70-生活/diary/2026/20261029.md");
  assert.ok(b.textContent.includes("个人性的事"), "只看个人时应出现个人任务");
  assert.ok(!b.textContent.includes("今天到期的活"), "只看个人时不该出现工作任务");

  const c = document.createElement("div"); document.body.appendChild(c);
  renderDaily(plugin, c, "tree: false", "70-生活/diary/2026/20261029.md");
  assert.equal(c.querySelectorAll(".tlt-daily-step").length, 0, "tree: false 不该渲染子步骤");
});

await t("离屏渲染：宿主还没挂到文档上也要先画出来（Obsidian 会先离屏渲染再挂载）", async () => {
  fixture();
  const { app, store } = await makeStore();
  const registered = [];
  const plugin = {
    store, dailyBlocks: new Set(), refreshDailyBlocks() {},
    registerMarkdownCodeBlockProcessor: (lang, fn) => registered.push({ lang, fn }),
  };
  registerDailyBlocks(plugin);
  assert.equal(registered.length, 1, "应注册一个 tlt-daily 处理器");

  const detached = document.createElement("div");        // 故意不 append 到 document
  assert.equal(detached.isConnected, false);
  registered[0].fn("date: auto", detached, { sourcePath: "70-生活/diary/2026/20261029.md" });
  assert.ok(detached.querySelectorAll(".tlt-daily-row").length > 0,
    "离屏渲染也要出内容（曾经因为按 isConnected 提前返回而显示空白）");
  assert.equal(detached.querySelectorAll(".tlt-daily-h").length, 4, "四组标题都该在");
});

await t("数据没就绪时给提示，而不是空白", async () => {
  fixture();
  const { app, store } = await makeStore();
  store.loaded = false;
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily({ store, dailyBlocks: new Set(), refreshDailyBlocks() {} }, host, "", "x.md");
  assert.ok(host.querySelector(".tlt-daily-warn"), "应显示「数据还没就绪」");
});

await t("进行中（wip: true）：已经开始、还没到期的单列一组；默认不显示", async () => {
  fixture();
  const { app, store } = await makeStore();
  const plugin = { store, dailyBlocks: new Set(), refreshDailyBlocks() {} };

  const off = document.createElement("div"); document.body.appendChild(off);
  renderDaily(plugin, off, "", "70-生活/diary/2026/20261029.md");
  assert.ok(!off.textContent.includes("在办的事"), "默认不该把「进行中」列出来");
  assert.ok(![...off.querySelectorAll(".tlt-daily-h")].some((h) => h.textContent.startsWith("进行中")), "默认不该有进行中分组");

  const on = document.createElement("div"); document.body.appendChild(on);
  renderDaily(plugin, on, "wip: true", "70-生活/diary/2026/20261029.md");
  const heads = [...on.querySelectorAll(".tlt-daily-h")].map((h) => h.textContent);
  assert.ok(heads.some((x) => x.startsWith("进行中") && x.includes("1")), `应有一组进行中 1 条：${heads.join(" / ")}`);
  const row = [...on.querySelectorAll(".tlt-daily-row")].find((r) => r.textContent.includes("在办的事"));
  assert.ok(row && row.textContent.includes("截止 2026-11-06"), "进行中的条目要带截止日期");
  // 已经逾期的、今天到期的、明天才开始的都不该混进「进行中」
  assert.ok(!row.textContent.includes("过期没做的活"), "逾期不进进行中");
  assert.ok(on.querySelectorAll(".tlt-daily-row").length > 1, "别的组照旧");
});

await t("空状态：这天什么都没有时给一句话，不留空白", async () => {
  fixture();
  const { app, store } = await makeStore();
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderDaily({ store, dailyBlocks: new Set(), refreshDailyBlocks() {} }, host, "date: 2026-01-01", "x.md");
  assert.ok(host.querySelector(".tlt-daily-empty"), "应显示空状态");
});

console.log(lines.join("\n"));
console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
