/**
 * 英文界面验收：数据全用英文，界面里只要还剩中文就是漏翻。
 * 跑法：node test/i18n.mjs
 */
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "tlt-i18n-")), "bundle.mjs");

await build({
  entryPoints: [join(root, "test/i18n-entry.ts")],
  bundle: true, format: "esm", platform: "node", target: "node18",
  outfile: out, logLevel: "silent",
  alias: { obsidian: join(root, "test/obsidian-stub.ts") },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent; g.KeyboardEvent = dom.window.KeyboardEvent; g.Event = dom.window.Event;
g.HTMLInputElement = dom.window.HTMLInputElement; g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.DOMParser = dom.window.DOMParser;
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };
g.createEl = (tag, o = {}) => {
  const e = dom.window.document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};
g.createDiv = (o) => g.createEl("div", o);
g.createSpan = (o) => g.createEl("span", o);
g.createSvg = (t) => dom.window.document.createElementNS("http://www.w3.org/2000/svg", t);
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.toggleClass = function (c, on) { this.classList.toggle(c, on); };
EP.setCssProps = function (o) { Object.entries(o || {}).forEach(([k, v]) => this.style.setProperty(k, String(v))); };
EP.setText = function (t) { this.textContent = t; };
EP.createEl = function (tag, o = {}) {
  const e = dom.window.document.createElement(tag);
  if (o.text) e.textContent = o.text;
  if (o.cls) e.className = o.cls;
  this.appendChild(e); return e;
};
EP.createDiv = function (o) { return this.createEl("div", typeof o === "string" ? { cls: o } : o); };
EP.createSpan = function (o) { return this.createEl("span", typeof o === "string" ? { cls: o } : o); };

const mod = await import(out);
const { fps, makeStore, setLanguage, t, WorkbenchView, MessagesView, TLTSettingTab, TLTPlugin,
  QuickTaskModal, TaskModal, QuickLogModal, IdeaModal, MsgModal, AddStaffModal, StaffModal,
  MilestonePeekModal, PromptModal, LogModal, TaskPeekModal } = mod;

const CJK = /[\u4e00-\u9fff\u3000-\u303f]/;

/** 英文夹具：所有"数据"都是英文，剩下的中文只可能是漏翻的界面文案 */
function englishVault() {
  for (const k of Object.keys(fps.files)) delete fps.files[k];
  fps.files["TLT/tasks/Alpha.md"] = `# Alpha

## Phase one

- [ ] Draft the interface doc 🛫 2026-10-20 📅 2026-10-26 [wl:: 30] [pri:: 2] [owner:: [[Ann]]]
  - [ ] collect numbers
- [ ] Book the room [wl:: 10] [owner:: [[Bob]]]

## Phase two

- [ ] Ship the beta 📅 2026-10-28 [wl:: 20]
`;
  fps.files["TLT/tasks/Beta.md"] = `# Beta

## Kick-off

- [ ] Line up partners 🛫 2026-10-20 📅 2026-10-27 [wl:: 40]
`;
  fps.files["TLT/crew/Ann.md"] = `---\ntlt: staff\nrole: Engineer\ncapacity: 100\ndays: 5\nskills: [review]\nstatus: active\n---\n`;
  fps.files["TLT/crew/Bob.md"] = `---\ntlt: staff\nrole: Analyst\ncapacity: 80\ndays: 4\n---\n`;
  fps.files["TLT/feeds/Team.md"] = `---\ntitle: Team\nowner: Chris\n---\n\n- 2026-10-21 Standup [kind:: ask] [place:: Room 3] [star:: true]\n  > all hands\n- 2026-10-22 Offsite [kind:: event] [state:: ended]\n`;
  fps.files["TLT/feeds/Me.md"] = `---\ntitle: Me\nowner: me\nmine: true\n---\n\n- 2026-10-21 Note to self [kind:: note]\n`;
  fps.files["TLT/feeds/Personal.md"] = `---\ntitle: Personal\npersonal: true\nowner: me\n---\n\n- 2026-10-20 A draft\n`;
  fps.files["TLT/logs/2026-10.md"] = `# Log\n\n## 2026-10-21\n\n- 09:30–11:00 Wrote the doc [proj:: Alpha]\n  > notes\n`;
  fps.files["TLT/ideas.md"] = `# Ideas\n\n- Turn the script into a tool [type:: tool] [stage:: new] [star:: 2] [at:: 2026-10-20]\n`;
}

let pass = 0, fail = 0;
const out2 = [];
async function t2(name, fn) {
  try { await fn(); pass++; out2.push(`  ✓ ${name}`); }
  catch (e) { fail++; out2.push(`  ✗ ${name}\n      ${e.message}`); }
  finally { document.body.innerHTML = ""; }
}

/** 收集一棵 DOM 里所有可见文案 + title/placeholder/aria-label */
function textsOf(el) {
  const bits = [];
  el.querySelectorAll("*").forEach((n) => {
    const own = Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(" ").trim();
    if (own && own !== "中文") bits.push(own);   // 语言下拉里的「中文」是语言自称，允许保留
    ["title", "placeholder", "aria-label"].forEach((a) => {
      const v = n.getAttribute?.(a);
      if (v) bits.push(v);
    });
  });
  if (el.textContent?.trim()) bits.push(el.textContent.trim());
  return bits;
}
function cjkReport(el) {
  const hits = [];
  // 全量文本节点扫描（含 option / 未挂载分支）
  const tw = document.createTreeWalker(el, dom.window.NodeFilter.SHOW_TEXT);
  [el, ...Array.from(el.querySelectorAll("*"))].forEach((n) => {
    const own = Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim();
    if (own && CJK.test(own) && own !== "中文") hits.push(`${n.tagName}.${n.className || ""} → ${own.slice(0, 60)}`);
    ["title", "placeholder", "aria-label"].forEach((a) => {
      const v = n.getAttribute?.(a);
      if (v && CJK.test(v)) hits.push(`[${a}] ${n.tagName}.${n.className || ""} → ${v.slice(0, 60)}`);
    });
  });
  let n; while ((n = tw.nextNode())) {
    const v = (n.textContent || "").trim();
    if (v && CJK.test(v) && v !== "中文") hits.push(`#text ${v.slice(0, 60)} ← ${n.parentElement?.tagName}.${n.parentElement?.className || ""}`);
  }
  return hits;
}
function firstCjk(el) {
  for (const s of textsOf(el)) {
    globalThis.__lastBad = s;
    const clean = s.replace(/中文/g, "");
    const m = CJK.exec(clean);
    if (m) return clean.length > 90 ? clean.slice(0, 90) + "…" : clean;
  }
  return null;
}

setLanguage("en");

await t2("命令名（英文）：全部是英文", async () => {
  const names = ["打开工作台", "打开消息中心（独立页）", "快捷命令…", "登记任务", "随手记", "新建消息",
    "新建项目", "新建里程碑", "归档项目", "删除任务", "切换明暗", "推送到发布服务", "从拉取服务同步"];
  for (const key of names) {
    const v = t(key);
    assert.ok(!CJK.test(v), `命令「${key}」没翻译：${v}`);
  }
});

await t2("工作台（英文数据）：界面无中文", async () => {
  setLanguage("en");
  englishVault();
  const { app, store } = await makeStore({ mineFeed: "Me" });
  const view = new WorkbenchView({ app }, { app, store, settings: store.settings, isLight: () => true, toggleTheme: () => {}, activateWorkbench: async () => {}, activateMessages: async () => {}, hubState: () => ({ publish: "", sync: "", syncMin: 0, pushMin: 0, lastSync: "", lastResult: "", lastError: "" }), setHubState: () => {} });
  view.containerEl = document.createElement("div");
  view.contentEl = document.createElement("div");
  view.containerEl.appendChild(view.contentEl);
  document.body.appendChild(view.containerEl);
  await view.onOpen();
  const tabs = ["today", "month", "ms", "staff", "ideas", "draw"];
  for (const tab of tabs) {
    view.tab = tab;
    await view.render();
    const bad = firstCjk(view.containerEl);
    assert.ok(!bad, `「${tab}」页签里还有中文：${bad}\n      ` + cjkReport(view.containerEl).slice(0, 5).join("\n      "));
  }
});

await t2("消息中心（英文数据）：界面无中文", async () => {
  setLanguage("en");
  englishVault();
  const { app, store } = await makeStore({ mineFeed: "Me" });
  delete fps.files["TLT/feeds/个人.md"];      // 自动补的个人源，文件名本身是中文（数据，不算漏翻）
  await store.load();
  const view = new MessagesView({ app }, { app, store, settings: store.settings, isLight: () => true, toggleTheme: () => {}, activateWorkbench: async () => {}, activateMessages: async () => {}, hubState: () => ({ publish: "", sync: "", syncMin: 0, pushMin: 0, lastSync: "", lastResult: "", lastError: "" }), setHubState: () => {} });
  view.containerEl = document.createElement("div");
  view.contentEl = document.createElement("div");
  view.containerEl.appendChild(view.contentEl);
  document.body.appendChild(view.containerEl);
  await view.onOpen();
  const bad = firstCjk(view.containerEl);
  assert.ok(!bad, `消息中心还有中文：${bad}`);
});

await t2("设置页（英文）：标题与描述无中文", async () => {
  setLanguage("en");
  englishVault();
  const { app, store } = await makeStore({ mineFeed: "Me" });
  const plugin = { app, store, settings: store.settings, manifest: { version: "0.7.0" }, saveSettings: async () => {}, applyTheme: () => {}, seedDemo: async () => {}, publishAll: async () => {}, syncAll: async () => {}, hubState: () => ({ publish: "", sync: "", lastSync: "", lastResult: "", lastError: "" }), versionLine: () => "", alignAndNotify: async () => {} };
  const tab = new TLTSettingTab(app, plugin);
  tab.containerEl = document.createElement("div");
  document.body.appendChild(tab.containerEl);
  tab.renderSettings();
  const bad = firstCjk(tab.containerEl);
  assert.ok(!bad, `设置页还有中文：${bad}\n      ` + cjkReport(tab.containerEl).slice(0, 5).join("\n      "));
});

await t2("弹窗（英文）：按钮与说明无中文", async () => {
  setLanguage("en");
  englishVault();
  const { app, store } = await makeStore({ mineFeed: "Me" });
  delete fps.files["TLT/feeds/个人.md"];
  await store.load();
  const task = store.tasks[0];
  const staff = store.staff[0];
  const log = store.logs[0];
  const idea = store.ideas[0];
  const live = store.feeds.find((f) => f.items.length);
  const msg = live.items[0];
  const cases = [
    ["新任务", () => new QuickTaskModal(app, store, () => {}).open()],
    ["任务详情", () => new TaskModal(app, store, task, () => {}).open()],
    ["记录", () => new QuickLogModal(app, store, "2026-10-21", () => {}).open()],
    ["改记录", () => new LogModal(app, store, log, () => {}).open()],
    ["随手记", () => new IdeaModal(app, store, undefined, () => {}).open()],
    ["改随手记", () => new IdeaModal(app, store, idea, () => {}).open()],
    ["消息", () => new MsgModal(app, store, msg, () => {}).open()],
    ["人员档案", () => new StaffModal(app, store, staff, () => {}).open()],
    ["添加成员", () => new AddStaffModal(app, store, () => {}).open()],
    ["里程碑", () => new MilestonePeekModal(app, store, store.milestones()[0], () => {}).open()],
    ["任务速览", () => new TaskPeekModal(app, store, task, () => {}).open()],
    ["输入框", () => new PromptModal(app, "New project", "Name", () => {}).open()],
  ];
  for (const [label, open] of cases) {
    document.body.innerHTML = "";
    try { open(); } catch (e) { throw new Error(`${label}：打开就抛错 ${e.message}`); }
    await new Promise((r) => setTimeout(r, 30));
    const box = document.querySelector(".modal");
    assert.ok(box, `${label}：没弹出`);
    const bad = firstCjk(box);
    assert.ok(!bad, `${label}：还有中文 → ${bad}${cjkReport(box).length ? " / " + cjkReport(box)[0] : ""}`);
  }
});

await t2("切语言：命令名 / 视图页签 / 设置页一起刷新", async () => {
  setLanguage("zh");
  const { app, store } = await makeStore();
  const plugin = new TLTPlugin(app, { id: "tlt-timeline-things", version: "0.7.1" });
  plugin.app = app; plugin.store = store; plugin.settings = store.settings;
  const calls = { header: 0, update: 0, renderTab: 0, render: 0 };
  const mkLeaf = () => {
    const box = document.createElement("div");
    const head = document.createElement("div");
    head.className = "view-header-title";
    box.appendChild(head);
    return {
      containerEl: box,
      view: { render: async () => { calls.render++; }, getDisplayText: () => t("时间线工作台") },
      updateHeader: () => { calls.header++; },
      titleEl: head,
    };
  };
  const leaves = [mkLeaf(), mkLeaf()];
  app.workspace.getLeavesOfType = () => leaves;
  plugin.settingTab = { update: () => { calls.update++; }, renderTab: () => { calls.renderTab++; }, containerEl: document.createElement("div") };
  plugin.cmdNames = [{ cmd: { name: "Open workbench" }, name: () => t("打开工作台") }];

  setLanguage("zh");
  plugin.relabel();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(plugin.cmdNames[0].cmd.name, "打开工作台", "命令名没跟着换");
  assert.ok(calls.header >= 2, "视图页签标题应刷新（getDisplayText 是缓存的）");
  assert.ok(calls.update >= 1, "设置页要先刷定义");
  assert.ok(calls.renderTab >= 1, "再重建 DOM——只 update() 时刚改的那一项还是旧语言");
  // 视图头部那条大标题（.view-header-title）也要换，updateHeader 只管标签页
  const headTexts = leaves.map((l) => l.titleEl.textContent);
  assert.ok(headTexts.every((x) => x === "时间线工作台"), `视图头部标题没换：${headTexts.join(" / ")}`);
  assert.ok(calls.render >= 2, "两个视图应重渲染");
});

/**
 * 按 Obsidian 1.14 的真实语义模拟声明式设置：
 *   update()      → 重新执行 getSettingDefinitions()（只刷数据）
 *   renderTab()   → 用 settingItems 重建 DOM（不重新取定义）
 * 所以只调其中一个都不够，必须 update() 后再 renderTab()。
 */
function fakeDeclarativeTab(tab, active) {
  tab.containerEl = document.createElement("div");
  document.body.appendChild(tab.containerEl);
  const paint = () => {
    tab.containerEl.innerHTML = "";
    const walk = (items) => items.forEach((it) => {
      if (!it) return;
      if (it.type === "group") {
        const h = document.createElement("div");
        h.className = "setting-item-heading";
        h.textContent = it.heading || "";
        tab.containerEl.appendChild(h);
        walk(it.items || []);
        return;
      }
      const row = document.createElement("div");
      row.className = "setting-item";
      const n = document.createElement("div");
      n.className = "setting-item-name";
      n.textContent = it.name || "";
      const d = document.createElement("div");
      d.className = "setting-item-description";
      d.textContent = it.desc || "";
      row.append(n, d);
      tab.containerEl.appendChild(row);
    });
    walk(tab.settingItems);
  };
  tab.update = () => { tab.settingItems = tab.getSettingDefinitions(); paint(); };
  tab.renderTab = () => paint();
  tab.settingItems = tab.getSettingDefinitions();
  paint();
  return tab;
}

await t2("设置页：切语言后整页跟着变（按 Obsidian 的 update→renderTab 语义）", async () => {
  setLanguage("zh");
  const { app, store } = await makeStore();
  const plugin = new TLTPlugin(app, { id: "tlt-timeline-things", version: "0.7.2" });
  plugin.app = app; plugin.store = store; plugin.settings = store.settings;
  plugin.refreshAll = () => {};
  const tab = fakeDeclarativeTab(new TLTSettingTab(app, plugin), true);
  plugin.settingTab = tab;

  const names = () => [...tab.containerEl.querySelectorAll(".setting-item-name")].map((n) => n.textContent);
  assert.ok(names().includes("界面语言"), `中文时应有「界面语言」，实际：${names().slice(0, 5).join(" / ")}`);

  setLanguage("en");
  plugin.relabel();
  const after = names();
  assert.ok(after.includes("Interface language"), `切英文后应有 Interface language，实际：${after.slice(0, 5).join(" / ")}`);
  assert.ok(!after.some((x) => /[\u4e00-\u9fff]/.test(x)), `设置页还有中文：${after.filter((x) => /[\u4e00-\u9fff]/.test(x)).slice(0, 3).join(" / ")}`);

  setLanguage("zh");
  plugin.relabel();
  assert.ok(names().includes("界面语言"), "切回中文后应回到中文");
});

console.log(out2.join("\n"));
console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
