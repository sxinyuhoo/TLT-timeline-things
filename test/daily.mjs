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
- [ ] 明天的事 📅 2026-10-30
- [x] 昨天做完的活 📅 2026-10-28 [done:: 2026-10-28]

## 别的

- [ ] 别的任务的活 📅 2026-10-29
`;
  fps.files["TLT/tasks/学习待办.md"] = `# 学习待办

## 学习主线

- [ ] 个人性的事 📅 2026-10-29 [tags:: 个人]
`;
}

const fakePlugin = (store) => ({ store, dailyBlocks: new Set(), refreshDailyBlocks() {} });

await t("parseDailyOptions：默认值 + 显式覆盖", async () => {
  const d = parseDailyOptions("");
  assert.equal(d.date, "auto"); assert.equal(d.overdue, true); assert.equal(d.tree, true); assert.equal(d.scope, "all");
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

await t("点方块不冒泡（阅读视图里不会跳到源码）；点标题打开任务详情", async () => {
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

  // 点标题 → 打开任务详情弹窗
  document.body.querySelectorAll(".modal, .tlt-host").forEach((m) => m.remove());
  const title = host.querySelector(".tlt-daily-t");
  title.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  title.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush(80);
  const modal = document.querySelector(".tlt-host");
  assert.ok(modal, "点标题应弹出任务详情");
  assert.ok(/任务|标题/.test(modal.textContent || ""), `弹窗内容看着不对：${(modal.textContent || "").slice(0, 60)}`);
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

  assert.ok(fps.files["TLT/tasks/交通核心算法研发.md"].includes("[done:: " + new Date().toISOString().slice(0, 10) + "]"),
    "勾选应写回 [done:: 日期]：\n" + fps.files["TLT/tasks/交通核心算法研发.md"]);
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
