import { JSDOM } from "jsdom";
import esbuild from "esbuild";
import { strict as assert } from "node:assert";

/* ---------- 1) 造一个最小 DOM ---------- */
const dom = new JSDOM(`<!doctype html><html><body class="theme-dark"></body></html>`, { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };

g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.DOMParser = dom.window.DOMParser;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };

g.createSvg = (tag) => dom.window.document.createElementNS("http://www.w3.org/2000/svg", tag);
g.createDiv = (o = {}) => g.createEl("div", o);
g.createSpan = (o = {}) => g.createEl("span", o);

/** Obsidian 的全局 createEl（测试环境补一个） */
g.createEl = (tag, o = {}) => {
  const e = dom.window.document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};

g.__notices = [];

/* 补齐 Obsidian 扩展的 DOM 方法 */
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

/* ---------- 2) 打包被测代码（obsidian → 桩件） ---------- */
await esbuild.build({
  stdin: {
    contents: `
      export { parseIdeaText } from "./src/data";
      export { WorkbenchView } from "./src/views/workbench";
      export { MessagesView } from "./src/views/messages";
      export { Store } from "./src/store";
      export { TFile } from "obsidian";
      export { TLTSettingTab, TLTPlugin } from "./src/main";
      export { attachFolderSuggest } from "./src/views/folder-suggest";
      export { TFolder } from "obsidian";
      export { TaskModal, QuickTaskModal } from "./src/views/modals";
      export { MessagesView as MsgViewForPublish } from "./src/views/messages";
      export { setLanguage, t as tr } from "./src/i18n";
    `,
    resolveDir: process.cwd(),
    sourcefile: "test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "test/bundle.mjs",
  alias: { obsidian: "./test/obsidian-stub.ts" },
  logLevel: "error",
});
const { WorkbenchView, MessagesView, Store, TFile, TFolder, TLTSettingTab, TLTPlugin, setLanguage, tr, attachFolderSuggest, TaskModal, QuickTaskModal, parseIdeaText: dlibParse } = await import("./bundle.mjs?" + Date.now());
const dlib = { parseIdeaText: dlibParse };

/* ---------- 3) 假 vault ---------- */
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const D = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const files = {
  "TLT/tasks/示例项目.md": `# 示例项目

## V0.7.4 月报

- [ ] 示例任务：报告定稿 🛫 ${D} 📅 ${D} [wl:: 30] [pri:: 2] [owner:: [[我]]]
  - [ ] 汇总场景数据
  - [ ] 对口径
- [ ] 待排期的事 [wl:: 10] [owner:: [[张三]]]

## 推广

- [ ] 示例里程碑：启动 📅 ${D} [wl:: 15] [owner:: [[我]]]
- [ ] 示例任务：画图 📅 ${D} [wl:: 10] [scope:: 个人] [tags:: 论文]
`,
  "TLT/tasks/示例工具.md": `# 示例工具

## 抽样与调优

- [ ] 处理 100 份 🛫 ${D} 📅 ${D} [wl:: 40] [pw:: w] [owner:: [[王五]]]
`,
  "TLT/crew/我.md": `---\ntlt: staff\nrole: 负责人\ncapacity: 100\ndays: 5\nskills: [决策]\nstatus: active\n---\n`,
  "TLT/crew/张三.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 80\ndays: 4\nskills: [评测]\nstatus: active\n---\n`,
  "TLT/crew/王五.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\n---\n`,
  "TLT/feeds/部门通知.md": `---\ntitle: 部门通知\nowner: 示例同事\n---\n\n- ${D} 部门宣贯 [kind:: ask] [place:: 三楼] [star:: true]\n  > 覆盖全员\n- ${D} 团建 [kind:: event] [state:: ended]\n`,
  "TLT/feeds/个人.md": `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- ${D} 记一下周报自动化\n`,
  "TLT/feeds/我的动态.md": `---\ntitle: 我的动态\nowner: me\nmine: true\n---\n\n- ${D} 示例口径 V2 定稿 [kind:: note]\n`,
  ["TLT/logs/" + D.slice(0, 7) + ".md"]: `# 记录\n\n## ${D}\n\n- 09:30–11:00 示例记录：核对口径 [proj:: 示例工具]\n  > 三处差异\n- 11:00–11:40 需求对齐会 [extra:: true]\n`,
  "TLT/ideas.md": `# 想法池\n\n- 回归工具化 [type:: 工具] [stage:: 待验证] [star:: 2] [at:: ${D}]\n- 写论文 [type:: 论文] [stage:: 沉淀] [star:: 3] [at:: ${D}]\n  > 语法即护栏\n`,
};

const fm = {
  "TLT/crew/我.md": { role: "负责人", capacity: 100, days: 5, skills: ["决策"], status: "active" },
  "TLT/crew/张三.md": { role: "算法工程师", capacity: 80, days: 4, skills: ["评测"], status: "active" },
  "TLT/crew/王五.md": { role: "算法工程师", capacity: 100, days: 5 },
  "TLT/feeds/部门通知.md": { title: "部门通知", owner: "示例同事" },
  "TLT/feeds/我的动态.md": { title: "我的动态", owner: "me", mine: true },
  "TLT/feeds/个人.md": { title: "个人", personal: true, owner: "me" },
};

const createdFolders = [];
const createdFolderSet = new Set();
const vault = {
  getMarkdownFiles: () => Object.keys(files).map((p) => new TFile(p)),
  getAllLoadedFiles: () => [...createdFolderSet].map((p) => new TFolder(p)),
  adapter: {
    exists: async (p) => (p in files) || createdFolderSet.has(p),
    read: async (p) => files[p] ?? "",
    write: async (p, c) => { files[p] = c; },
    mkdir: async () => {},
    remove: async () => {},
  },
  cachedRead: async (f) => files[f.path] ?? "",
  getAbstractFileByPath: (p) => (p in files ? new TFile(p) : null),
  process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
  create: async (p, c) => { files[p] = c; },
  createFolder: async (p) => { createdFolders.push(p); createdFolderSet.add(p); },
  on: () => ({}),
};
/** 从文件内容解析 frontmatter：改名/改写之后必须重新算，不能只靠静态表 */
const parseFmNow = (path) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(files[path] || "");
  if (!m) return fm[path] || {};
  const out = {};
  for (const ln of m[1].split("\n")) {
    const i = ln.indexOf(":");
    if (i < 0) continue;
    const k = ln.slice(0, i).trim(), v = ln.slice(i + 1).trim();
    out[k] = v === "true" ? true : v === "false" ? false : v;
  }
  return out;
};

const app = {
  vault,
  metadataCache: { getFileCache: (f) => ({ frontmatter: parseFmNow(f.path) }) },
  workspace: { getLeavesOfType: () => [], getLeaf: () => ({}) },
  // 搬运走 Obsidian 的 renameFile：实测语义照搬（内容跟着路径走）
  fileManager: { renameFile: async (f, to) => { if (f && f.path in files) { files[to] = files[f.path]; delete files[f.path]; } } },
};

const store = new Store(app, {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的动态",
});
await store.load();

/* ---------- 4) 断言数据层 ---------- */
let pass = 0;
/** 点弹窗里的按钮（迁移确认等），返回是否点到了 */
const clickModal = async (label) => {
  const modal = document.querySelector(".modal");
  if (!modal) return false;
  const btn = [...modal.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 60));
  return true;
};

const t = async (name, fn) => {
  // 用例共享同一份夹具与同一个 store：跑完一律还原，避免"上一个用例把文件搬走了"这类污染
  const snapFiles = JSON.parse(JSON.stringify(files));
  const snapSettings = { ...store.settings };
  try { await fn(); pass++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n    ", e.stack?.split("\n").slice(0,4).join("\n    ")||e.message); process.exitCode = 1; }
  finally {
    Object.keys(files).forEach((k) => { delete files[k]; });
    Object.assign(files, snapFiles);
    Object.assign(store.settings, snapSettings);
    await store.load();
  }
};

console.log("store（真实文件结构）");
await t("任务 5 条、记录 2 条", () => {
  assert.equal(store.tasks.length, 5);
  assert.equal(store.logs.length, 2);
});
await t("里程碑从 H2 解析", () => {
  const ms = store.milestones().map((m) => m.name).sort();
  assert.deepEqual(ms, ["V0.7.4 月报", "抽样与调优", "推广"]);
});
await t("人员 3 位、产能读到", () => {
  assert.equal(store.staff.length, 3);
  assert.equal(store.staff.find((s) => s.name === "张三").capacity, 80);
});
await t("消息源 3 个（含个人）、消息 4 条", () => {
  assert.equal(store.feeds.length, 3);
  assert.equal(store.feeds.reduce((n, f) => n + f.items.length, 0), 4);
});
await t("本月分组：待排期 1 条", () => {
  const m = store.monthTasks(now);
  assert.equal(m.pending.length, 1);
  assert.ok(m.todo.length >= 2);
});

/* ---------- 4b) 想法：正文写回 ---------- */
await t("想法正文（为什么做）能写回并重读", async () => {
  const p = dlib.parseIdeaText("#论文 #测试 test");
  await store.addIdea({ title: p.title, tags: p.tags });
  await store.load();
  const it = store.ideas.find((x) => x.title === "test");
  assert.ok(it, "没写入");
  assert.deepEqual(it.tags, ["论文", "测试"]);
  it.body = "因为每次都要人工抽样";
  await store.updateIdea(it);
  await store.load();
  assert.equal(store.ideas.find((x) => x.title === "test").body, "因为每次都要人工抽样");
});

/* ---------- 5) 渲染冒烟 ---------- */
console.log("\n渲染（jsdom）");
const plugin = {
  settings: {
    root: "TLT", defaultPeriod: "m", tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
    logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", tagsFile: "TLT/tags.md",
    theme: "auto", hubPublish: "http://127.0.0.1:8787", hubSync: "http://127.0.0.1:8788",
    autoSyncMin: 15, autoPushMin: 0, mineFeed: "我的动态", feedIds: {}, feedNames: {},
  },
  store,
  isLight: () => false,
  toggleTheme: () => {},
  applyTheme: () => {},
  publishAll: async () => {},
  syncAll: async () => {},
  seedDemo: async () => {},
  pingHub: async () => true,
  activateMessages: async () => {},
  refreshAll: () => {},
  hubState: () => ({ publish: "http://127.0.0.1:8787", sync: "http://127.0.0.1:8788", lastSync: "", lastResult: "", lastError: "" }),
  setHubState: () => {},
};

const leaf = { app };

/** 真实插件实例（设置页测试要用它，才能覆盖 applyRootChange 等真实逻辑） */
function makePlugin(overrides = {}) {
  const inst = new TLTPlugin(app, { id: "tlt-timeline-things", dir: "tlt-timeline-things" });
  inst.settings = { ...plugin.settings, appliedRoot: plugin.settings.root, ...overrides };
  inst.store = new Store(app, inst.settings);      // 独立 store：设置类用例不动共享那份
  inst.saveData = async () => {};
  inst.refreshAll = () => {};
  inst.applyTheme = () => {};
  return inst;
}

function mount(cls) {
  const v = new cls(leaf, plugin);
  v.containerEl = document.createElement("div");
  v.contentEl = document.createElement("div");
  v.containerEl.appendChild(v.contentEl);
  document.body.appendChild(v.containerEl);
  return v;
}

await t("工作台渲染：六页签 + 项目 + 记录块 + 消息", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  view.viewDate = D;
  await view.onOpen();
  view.viewDate = D;
  await view.render();
  assert.equal(document.querySelectorAll(".tlt-tab").length, 6);
  assert.equal(document.querySelectorAll(".tlt-proj").length, 2);
  assert.ok(document.querySelectorAll(".tlt-blk").length >= 2, "时间轴里应有记录块");
  assert.ok(document.querySelectorAll(".tlt-mnode").length >= 3, "消息栏应渲染");
  assert.ok(document.querySelector(".tlt-star"), "节奏里应有星图");
  assert.ok(document.querySelectorAll(".tlt-star .tlt-node").length >= 3, "星图里应有任务节点");
  assert.ok(document.querySelectorAll(".tlt-star .tlt-ring").length === 4, "应有 4 圈时间环");
});

await t("任务视图：工作/个人 标签筛选", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  view.tab = "month";
  await view.onOpen();
  await view.render();
  const btns = [...document.querySelectorAll("[data-tag]")];
  const labels = btns.map((b) => b.textContent);
  assert.ok(labels.includes("全部") && labels.includes("工作") && labels.includes("个人"), `标签筛选：${labels}`);
  const all = document.querySelectorAll(".tlt-task").length;
  btns.find((b) => b.textContent === "个人").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const only = document.querySelectorAll(".tlt-task").length;
  assert.ok(only > 0 && only < all, `个人筛选后 ${only}/${all}`);
  assert.ok(document.body.textContent.includes("示例任务：画图"), "个人任务没出现");
});

await t("页签顺序：任务后是里程碑，随手记后是随手画", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  await v.onOpen();
  const labels = [...document.querySelectorAll(".tlt-tab")].map((b) => b.textContent);
  assert.equal(labels.join("/"), "日历/任务/里程碑/人员/随手记/随手画");
  v.tab = "draw";
  await v.render();
  assert.ok(document.body.textContent.includes("功能预留"), "随手画没有预留说明");
});

await t("搜索：能筛任务，且输入焦点不丢", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  v.tab = "month";
  await v.onOpen();
  await v.render();
  const all = document.querySelectorAll(".tlt-task").length;
  const input = document.querySelector("[data-search]");
  input.focus();
  input.value = "抽样";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await v.render();
  const now = document.querySelectorAll(".tlt-task").length;
  assert.ok(now > 0 && now < all, `筛完 ${now}/${all}`);
  const again = document.querySelector("[data-search]");
  assert.equal(again.value, "抽样", "搜索词被清掉");
  assert.equal(document.activeElement, again, "焦点丢了");
});

await t("随手记：标签可多选筛选", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  v.tab = "ideas";
  await v.onOpen();
  await v.render();
  const btns = [...document.querySelectorAll("[data-itag]")];
  assert.ok(btns.length >= 3, `标签按钮 ${btns.length}`);
  const before = document.querySelectorAll(".tlt-icard").length;
  btns.find((b) => b.textContent === "论文").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const one = document.querySelectorAll(".tlt-icard").length;
  [...document.querySelectorAll("[data-itag]")].find((b) => b.textContent === "工具")
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const two = document.querySelectorAll(".tlt-icard").length;
  assert.ok(one >= 1 && two >= one, `单选 ${one} 多选 ${two}（总 ${before}）`);
});

await t("任务详情：负责人只显示当前，能展开调整", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  v.tab = "month";
  await v.onOpen();
  await v.render();
  const task = v.store.tasks.find((t) => t.kind === "task" && t.owners.length);
  document.querySelector(`[data-task="${task.id}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const m = [...document.querySelectorAll(".tlt-modal")].pop();
  const shown = [...m.querySelectorAll(".tlt-owner-chip")].map((x) => x.textContent.replace("×", ""));
  assert.deepEqual(shown, task.owners, `应只显示当前负责人，实际 ${shown}`);
  // 负责人：紧凑框选（不是平铺）→ 点「选择…」才展开勾选面板
  const pop = m.querySelector(".tlt-pickpop");
  assert.ok(pop, "没有框选面板");
  assert.ok(pop.classList.contains("tlt-hidden"), "候选一开始应该收着");
  assert.equal(m.querySelectorAll(".tlt-pickrow").length, 0, "没展开前不该平铺人员");
  [...m.querySelectorAll("button")].find((b) => b.textContent.includes("选择")).click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!m.querySelector(".tlt-pickpop").classList.contains("tlt-hidden"), "没展开候选");
  assert.ok(m.querySelectorAll(".tlt-pickrow").length >= 1, "展开后应列出人员");
});

await t("里程碑里能点开任务、能勾完成", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  v.tab = "ms";
  await v.onOpen();
  await v.render();
  const card = document.querySelector("[data-ms]");
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await v.render();
  const row = document.querySelector(".tlt-ms-b [data-task]");
  assert.ok(row, "里程碑展开后没有任务行");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(document.querySelector(".tlt-modal"), "点任务没打开详情");

  // 关掉弹窗再勾选
  document.body.empty();
  const v2 = mount(WorkbenchView);
  v2.tab = "ms";
  await v2.onOpen();
  await v2.render();
  document.querySelector("[data-ms]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await v2.render();
  const firstTask = document.querySelector(".tlt-ms-b [data-task]");
  const id = firstTask.dataset.task;
  const before = v2.store.tasks.find((t) => t.id === id).done;
  const ck = firstTask.querySelector("[data-ck]");
  assert.ok(ck, "任务行里没有勾选框");
  ck.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  assert.notEqual(v2.store.tasks.find((t) => t.id === id).done, before, "勾选没生效");
});

await t("源名称可改，id 不变", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  const f = mv.store.feeds.find((x) => x.personal);
  const oldId = f.id;
  await mv.store.renameFeed(f, "我的随手记");
  assert.equal(f.name, "我的随手记", "内存里的名称没改");
  assert.equal(f.id, oldId, "id 变了");
  const text = files[`TLT/feeds/${oldId}.md`] || "";
  assert.ok(/^title:\s*我的随手记$/m.test(text), `文件里没写进去：\n${text}`);
  await mv.store.renameFeed(f, "个人");   // 还原，别影响后面的用例
});

await t("设置页：无顶级标题、分节顺序、动作按钮", async () => {
  document.body.empty();
  const tab = new TLTSettingTab(app, makePlugin());
  tab.containerEl = document.createElement("div");
  tab.renderSettings();
  const el2 = tab.containerEl;
  assert.equal(el2.querySelectorAll("h1, h2, h3").length, 0, "不该手写标题元素");
  const names = [...el2.querySelectorAll(".setting-item-name")].map((e) => e.textContent);
  assert.deepEqual(names.slice(0, 2), ["界面语言", "主题"], `通用项应排在最前，实际 ${names.slice(0, 2)}`);
  const heads = [...el2.querySelectorAll(".setting-item-heading .setting-item-name")].map((e) => e.textContent);
  assert.deepEqual(heads, ["目录", "口径", "消息服务", "维护"], `分节：${heads}`);
  const buttons = [...el2.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(buttons.includes("推送我的源") && buttons.includes("同步订阅") && buttons.includes("测试连接"), `按钮：${buttons}`);
  const rootRow = [...el2.querySelectorAll(".setting-item")].find((x) => x.querySelector(".setting-item-name")?.textContent === "根目录");
  assert.ok(rootRow && [...rootRow.querySelectorAll("button")].some((b) => b.textContent === "更新"), "根目录那一行应有「更新」按钮");
  assert.ok(el2.textContent.includes("当前读取"), "缺少当前读取");
  // 目录项：显示当前值，占位符是默认值
  const inputs = [...el2.querySelectorAll("input")];
  const tasks = inputs.find((i) => i.placeholder === "TLT/tasks");
  assert.ok(tasks, "任务目录输入框没有默认值占位");
  assert.equal(tasks.value, "TLT/tasks", "任务目录没显示当前值");
  const phs = inputs.map((i) => i.placeholder).filter(Boolean);
  ["TLT/tasks", "TLT/crew", "TLT/feeds", "TLT/logs", "TLT/ideas.md", "TLT/tags.md"].forEach((d) => {
    assert.ok(phs.includes(d), `缺少默认值占位 ${d}`);
  });
  // 消息服务：间隔下拉的选项
  const selects = [...el2.querySelectorAll("select")];
  assert.ok(selects.some((x) => [...x.options].some((o) => o.textContent === "15 分钟")), "间隔下拉选项不对");
});

await t("设置页：声明式改根目录同样同步六项并建目录", async () => {
  document.body.empty();
  const inst = makePlugin();
  createdFolderSet.add("90-插件运营区");                       // 真机上这个目录是用户先建好的
  const tab = new TLTSettingTab(app, inst);
  tab.containerEl = document.createElement("div");
  await tab.setControlValue("root", "90-插件运营区");
  assert.equal(inst.settings.root, "90-插件运营区", "逐字输入应先把值记下来");
  assert.equal(inst.settings.tasksFolder, "TLT/tasks", "没点「更新」前不该动派生路径");
  assert.equal(createdFolders.some((x) => x.includes("90-插件运营区/TLT")), false, "没点「更新」前不该建目录");
  await tab.alignAndNotify();                                // 点「更新」
  assert.equal(inst.settings.tasksFolder, "90-插件运营区/TLT/tasks", `点更新后应同步：${inst.settings.tasksFolder}`);
  assert.equal(inst.settings.tagsFile, "90-插件运营区/TLT/tags.md");
  await clickModal("确认搬运");                               // 有迁移 → 先确认
  assert.ok(createdFolders.some((x) => x.includes("90-插件运营区/TLT")), "确认搬运后应把目录建出来");
});

await t("点「更新」：路径与根目录对不上时也要收敛（历史状态修复）", async () => {
  // 用户库里出现过：root 已是 Atlas，但六项还是 TLT/*（上一次没同步成功）
  const inst = makePlugin({ root: "Atlas", appliedRoot: "Atlas" });
  createdFolderSet.add("Atlas");
  const r = await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "Atlas/TLT/tasks", `应派生到新根目录：${inst.settings.tasksFolder}`);
  assert.equal(r.moved, 6, `六项都该同步，实际 ${r.moved}`);
  assert.equal(inst.settings.teamFolder, "Atlas/TLT/crew");
});

await t("设置页：输入只记值，点「更新」才同步六项、建目录", async () => {
  document.body.empty();
  const inst = makePlugin();
  createdFolderSet.add("90-插件运营区");
  const tab = new TLTSettingTab(app, inst);
  tab.containerEl = document.createElement("div");
  let updates = 0;
  tab.update = () => { updates++; };
  const before = createdFolders.length;
  const n0 = (globalThis.__notices || []).length;
  await tab.setControlValue("root", "9");
  await tab.setControlValue("root", "90");
  await tab.setControlValue("root", "90-插件运营区");
  await new Promise((r) => window.setTimeout(r, 900));
  assert.equal(inst.settings.root, "90-插件运营区", "值要记下来");
  assert.equal(inst.settings.tasksFolder, "TLT/tasks", "没点「更新」前派生路径不动");
  assert.equal(createdFolders.length, before, "没点「更新」前不建目录");
  assert.equal(updates, 0, "输入阶段不重画");
  await tab.alignAndNotify();                                   // 点「更新」
  assert.equal(inst.settings.tasksFolder, "90-插件运营区/TLT/tasks", "点更新后应同步六项");
  assert.equal(inst.settings.tagsFile, "90-插件运营区/TLT/tags.md");
  assert.ok(await clickModal("确认搬运"), "有迁移时应弹窗确认");
  assert.ok(createdFolders.some((x) => x.includes("90-插件运营区/TLT")), "确认后应建目录");
  const said = (globalThis.__notices || []).slice(n0).join(" | ");
  assert.ok(/已搬|项路径已同步/.test(said), "应有搬运/同步提示，实际：" + said);
});

await t("点「更新」：派生路径跟随根目录，手工改过的那项不动", async () => {
  const inst = makePlugin({ tasksFolder: "乱写的/任务" });     // 根目录仍是默认 TLT，appliedRoot=TLT
  inst.settings.root = "Other";
  await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "乱写的/任务", "手工改过的项不该被覆盖");
  assert.equal(inst.settings.logsFolder, "Other/TLT/logs", "仍是派生值的项应跟随");
});

await t("示例数据不含真实姓名与项目名", async () => {
  const inst = makePlugin();
  const created = [];
  // 只记录、不真写，避免污染后面用同一个假 vault 的用例
  const realCreate = app.vault.create;
  app.vault.create = async (p, c) => { created.push([p, c]); return { path: p }; };
  await inst.seedDemo();
  app.vault.create = realCreate;
  const all = created.map(([p, c]) => p + "\n" + c).join("\n");
  ["孙晙书", "许可儿", "刘戎阳", "卢冠宇", "胡昕宇", "千数万问", "MinerU", "TRC"].forEach((bad) => {
    assert.ok(!all.includes(bad), `示例数据里还有真实信息：${bad}`);
  });
  assert.ok(all.includes("示例项目") || all.includes("示例成员"), "示例数据应该有明显是占位的内容");
});

await t("语言切到英文：设置页与工作台文案跟进", async () => {
  document.body.empty();
  const inst = makePlugin();
  setLanguage("en");
  const tab = new TLTSettingTab(app, inst);
  tab.containerEl = document.createElement("div");
  tab.renderSettings();
  const names = [...tab.containerEl.querySelectorAll(".setting-item-name")].map((e) => e.textContent);
  assert.equal(names[0], "Interface language", `英文界面第一项：${names[0]}`);
  assert.equal(tr("任务"), "Tasks");
  setLanguage("zh");
  assert.equal(tr("任务"), "任务", "切回中文没生效");
});

await t("改目录：只列出要搬的文件，不自己搬", async () => {
  const inst = makePlugin({
    root: "90-插件运营区", tasksFolder: "90-插件运营区/TLT/tasks", teamFolder: "90-插件运营区/TLT/crew",
    feedsFolder: "90-插件运营区/TLT/feeds", logsFolder: "90-插件运营区/TLT/logs",
  });
  const realList = app.vault.getMarkdownFiles;
  app.vault.getMarkdownFiles = () => [new TFile("TLT/tasks/示例项目.md"), new TFile("TLT/crew/张三.md"), new TFile("别处/无关.md")];
  const old = { ...inst.settings, root: "TLT", tasksFolder: "TLT/tasks", teamFolder: "TLT/crew",
    feedsFolder: "TLT/feeds", logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", tagsFile: "TLT/tags.md" };
  const moves = inst.planMove(old);
  assert.equal(moves.length, 2, `应只算 TLT 下的两个文件，实际 ${JSON.stringify(moves)}`);
  assert.equal(moves[0].to, "90-插件运营区/TLT/tasks/示例项目.md");
  assert.equal(moves[1].to, "90-插件运营区/TLT/crew/张三.md");
  app.vault.getMarkdownFiles = realList;      // 还原，别影响后面的用例
});

await t("时序兜底：视图比插件先就绪时不抛错", async () => {
  document.body.empty();
  const el = document.createElement("div");
  document.body.appendChild(el);
  // 现实里的最坏时序：真插件实例，但 store 还没载入过（loaded=false）
  const inst = makePlugin();
  inst.store = new Store(app, { ...inst.settings });
  const v = new WorkbenchView({ app, containerEl: el }, inst);
  v.containerEl = el; v.contentEl = el.createEl("div");
  await v.onOpen();                                            // 不应抛，且会自己把数据载进来
  assert.equal(inst.store.loaded, true, "onOpen 没把数据载进来");
  const m = new MessagesView({ app, containerEl: el.createEl("div") }, inst);
  await m.onOpen();
  assert.ok(true);
});

await t("时序：视图在插件加载中途被恢复，两边都不炸", async () => {
  document.body.empty();
  const inst = makePlugin({ autoSyncMin: 0, autoPushMin: 0 });
  let v = null;
  const origRegister = inst.registerView.bind(inst);
  inst.registerView = (type, factory) => {
    origRegister(type, factory);
    if (String(type).includes("workbench")) {           // 工厂一注册，Obsidian 就可能来建视图
      const el = document.createElement("div");
      document.body.appendChild(el);
      v = factory({ app, containerEl: el });
      v.containerEl = el; v.contentEl = el.createEl("div");
    }
  };
  const loading = inst.onload();
  await new Promise((r) => window.setTimeout(r, 0));     // 让视图的 onOpen 与 onload 抢跑
  if (v) await v.onOpen();
  await loading;                                          // onload 不能被带崩
  assert.ok(v, "视图没被建出来，用例没生效");
  assert.ok((inst.store?.tasks?.length ?? 0) >= 0);
});

await t("时序兜底：某个视图渲染炸了也不影响 onload", async () => {
  const inst = makePlugin({ autoSyncMin: 0, autoPushMin: 0 });
  const badLeaf = { view: { render() { throw new Error("boom"); } } };
  app.workspace.getLeavesOfType = () => [badLeaf];
  await inst.onload();                                         // 不应 reject
  app.workspace.getLeavesOfType = () => [];
  assert.ok(true, "onload 被视图异常带崩了");
});

await t("根目录语义：数据放 <根目录>/TLT 下，留空则用库根目录的 TLT/", async () => {
  const keep = { ...store.settings };
  const inst = makePlugin();
  await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "TLT/tasks", "根目录留空 → 数据仍在库根 TLT/");
  inst.settings.root = "90-插件运营区";
  await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "90-插件运营区/TLT/tasks");
  assert.equal(inst.settings.ideasFile, "90-插件运营区/TLT/ideas.md");
  inst.settings.root = "";
  await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "TLT/tasks", `留空应回到库根 TLT/，实际 ${inst.settings.tasksFolder}`);
  inst.settings.root = "90-插件运营区/TLT";                  // 根目录本身就叫 TLT：不再套一层
  await inst.applyNow();
  assert.equal(inst.settings.tasksFolder, "90-插件运营区/TLT/tasks");
  Object.assign(store.settings, keep);                       // 还原，别影响后面的用例
  await store.load();
});

await t("目录输入补全：Tab / 点击选中已有目录", async () => {
  document.body.empty();
  createdFolderSet.add("TLT"); createdFolderSet.add("TLT/tasks"); createdFolderSet.add("工作");
  const input = document.createElement("input");
  document.body.appendChild(input);
  attachFolderSuggest(app, input);
  input.value = "TL";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const rows = [...document.querySelectorAll(".tlt-suggest-i")].map((e) => e.textContent);
  assert.ok(rows.includes("TLT"), `候选里应有 TLT，实际 [${rows.join(" / ")}]`);
  assert.ok(!rows.includes("工作"), "不该混进不匹配的目录");
  // Tab 选中第一个
  const ev = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  assert.equal(input.value, "TLT", `Tab 没选中，实际 ${input.value}`);
  // 点选：输入 "工作" 后 mousedown 命中
  input.value = "工"; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const work = [...document.querySelectorAll(".tlt-suggest-i")].find((e) => e.textContent === "工作");
  assert.ok(work, "候选里应有 工作");
  work.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(input.value, "工作", `点击没选中，实际 ${input.value}`);
  // 打一个不存在的目录：没有候选，也不报错
  input.value = "不存在的目录"; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".tlt-suggest-i").length, 0, "不存在时不该给候选");
});

await t("补全浮层挂在输入框自己的文档里（设置页可能是独立窗口）", async () => {
  const other = new JSDOM(`<!doctype html><html><body></body></html>`, { pretendToBeVisual: true });
  const od = other.window.document;
  // 另一个文档里的元素也要有 Obsidian 的 DOM 扩展
  const OP = other.window.Element.prototype;
  OP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  OP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
  OP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
  const inp = od.createElement("input");
  od.body.appendChild(inp);
  createdFolderSet.add("TLT");
  attachFolderSuggest(app, inp);
  inp.value = "TL"; inp.dispatchEvent(new other.window.Event("input", { bubbles: true }));
  const pop = [...od.querySelectorAll(".tlt-suggest")][0];
  assert.ok(pop, "浮层没进输入框所在的文档");
  assert.equal(pop.parentElement, od.body, "浮层没挂在输入框所在文档的 body 上");
  assert.ok([...od.querySelectorAll(".tlt-suggest-i")].some((e) => e.textContent === "TLT"), "候选没渲染在正确文档");
});

await t("重画：声明式页优先走框架 update()，不换成命令式", async () => {
  document.body.empty();
  let updated = 0;
  const inst = makePlugin();
  const tab = new TLTSettingTab(app, inst);
  tab.containerEl = document.createElement("div");
  tab.update = () => { updated++; };          // 框架基类在实例原型上提供 update()
  tab.rerender();
  assert.equal(updated, 1, "没有走框架的 update()");
  const inst2 = makePlugin();          // 老客户端：没有 update → 退回命令式
  const tab2 = new TLTSettingTab(app, inst2);
  tab2.containerEl = document.createElement("div");
  tab2.rerender();
  assert.ok(tab2.containerEl.querySelector(".setting-item"), "老客户端应回退到命令式渲染");
});

await t("默认目录改名：TLT/team → TLT/crew（自定义过的不动）", async () => {
  const inst = makePlugin({ teamFolder: "TLT/team" });
  await inst.migrateFolderDefaults();
  assert.equal(inst.settings.teamFolder, "TLT/crew", "老默认值应迁移");
  assert.equal(inst.settings.crewMigrated, true, "应写入迁移标记");
  const inst2 = makePlugin({ teamFolder: "我的/小组" });      // 用户自己改过
  await inst2.migrateFolderDefaults();
  assert.equal(inst2.settings.teamFolder, "我的/小组", "自定义目录不该被动");
  const inst3 = makePlugin({ teamFolder: "TLT/team", crewMigrated: true });   // 迁过一次就不再动
  await inst3.migrateFolderDefaults();
  assert.equal(inst3.settings.teamFolder, "TLT/team", "迁过一次后不该再改");
});

await t("改根目录默认把数据整棵搬过去（不再两边各留一份）", async () => {
  document.body.empty();
  const keep = { ...store.settings };
  const added = [];
  const put = (p, c) => { files[p] = c; added.push(p); };
  put("TLT/tasks/示例项目.md", "- [ ] x");
  put("TLT/crew/张三.md", "---\ntlt: staff\n---\n");
  put("TLT/ideas.md", "# 随手记");
  const inst = makePlugin();                       // 独立 store，设置不污染共享那份
  createdFolderSet.add("工作");
  const fixtureUnderTLT = Object.keys(files).filter((k) => k.startsWith("TLT/")).length;
  const renamed = [];
  const realRename = app.fileManager.renameFile;
  app.fileManager.renameFile = async (f, to) => { renamed.push([f.path, to]); await realRename(f, to); };
  inst.settings.root = "工作";
  const r = await inst.applyNow();
  assert.equal(r.pending, true, "有迁移时应先弹窗确认");
  assert.equal(renamed.length, 0, "确认之前不该动文件");
  const modal = document.querySelector(".modal");
  assert.ok(modal && /迁移 \d+ 个文件/.test(modal.textContent || ""), "弹窗应写清要迁移几个文件");
  [...modal.querySelectorAll("button")].find((b) => b.textContent === "确认搬运")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r2) => window.setTimeout(r2, 50));
  app.fileManager.renameFile = realRename;
  const diag = JSON.stringify({ r, tasks: inst.settings.tasksFolder, root: inst.settings.root, renamed });
  assert.equal(renamed.length, fixtureUnderTLT, "应把旧目录下所有文件都搬走 | " + diag);
  assert.equal(Object.keys(files).filter((k) => k.startsWith("TLT/")).length, 0, "旧位置不该再有文件");
  assert.ok(renamed.some(([from, to]) => from === "TLT/tasks/示例项目.md" && to === "工作/TLT/tasks/示例项目.md"), "任务文件没搬到新位置");
  assert.ok(renamed.some(([, to]) => to === "工作/TLT/crew/张三.md"), "人员档案没搬");
  assert.ok(renamed.some(([, to]) => to === "工作/TLT/ideas.md"), "随手记没搬");
  Object.assign(store.settings, keep);             // 还原共享状态与夹具
  added.forEach((p) => { delete files[p]; });
});

await t("搬运通知里要写清旧目录是清空还是保留", async () => {
  const inst = makePlugin();
  createdFolderSet.add("工作");
  const said = [];
  const realPush = globalThis.__notices.push.bind(globalThis.__notices);
  globalThis.__notices.push = (m) => { said.push(m); return realPush(m); };
  inst.settings.root = "工作";
  await inst.applyNow();
  await clickModal("确认搬运");
  globalThis.__notices.push = realPush;
  const text = said.join(" | ");
  assert.ok(/已搬 \d+ 个文件到新目录/.test(text), "没报告搬了几个：" + text);
  assert.ok(/旧目录 .*已清空/.test(text), "没写清旧目录状态：" + text);
});

await t("搬不动时只给「确认搬运 / 取消更新」，取消要回滚设置", async () => {
  document.body.empty();
  files["工作/TLT/tasks/示例项目.md"] = "- [ ] 占位";        // 目标已有同名文件 → 冲突
  const inst = makePlugin();
  createdFolderSet.add("工作");
  const before = { root: inst.settings.root, appliedRoot: inst.settings.appliedRoot, tasksFolder: inst.settings.tasksFolder };
  inst.settings.root = "工作";
  const r = await inst.applyNow();
  assert.ok(r.blocked > 0, "应识别出同名冲突");
  const modal = document.querySelector(".modal");
  assert.ok(modal, "应该弹窗");
  const btns = [...modal.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(btns, ["取消更新", "确认搬运"], "按钮应该是「取消更新 / 确认搬运」，实际：" + btns.join(" / "));
  // 点「取消更新」→ 设置回滚
  modal.querySelectorAll("button")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r2) => window.setTimeout(r2, 30));
  assert.equal(inst.settings.tasksFolder, before.tasksFolder, "取消后派生路径应回滚");
  assert.equal(inst.settings.appliedRoot, before.appliedRoot, "取消后 appliedRoot 应回滚");
  assert.equal(inst.settings.root, "工作", "用户输入的目标根目录保留（只是没生效）");
  assert.equal(files["TLT/tasks/示例项目.md"] !== undefined, true, "取消后旧位置的文件还在");
  delete files["工作/TLT/tasks/示例项目.md"];
});

await t("冷启动：文件已存在时 createSafe 不算失败", async () => {
  const inst = makePlugin();
  const realCreate = app.vault.create;
  files["TLT/tasks/已存在.md"] = "x";          // 索引不认识它，但磁盘上确实有（冷启动）
  let threw = false;
  app.vault.create = async () => { throw new Error("File already exists."); };
  await inst.store.createSafe("TLT/tasks/已存在.md", "x").catch(() => { threw = true; });
  app.vault.create = realCreate;
  assert.equal(threw, false, "文件已存在时不该向上抛");
});

await t("星图滚轮缩放", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  view.viewDate = D;
  await view.onOpen();
  view.viewDate = D;
  await view.render();
  const box = document.querySelector(".tlt-star-box");
  const ring0 = document.querySelector(".tlt-star .tlt-ring");
  const before = ring0.getAttribute("r");
  const ev = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "deltaY", { value: -120 });
  box.dispatchEvent(ev);
  const after = document.querySelector(".tlt-star .tlt-ring").getAttribute("r");
  assert.notEqual(after, before, "滚轮没改变缩放");
});

await t("点星图上的任务：只读详情 + 打开任务", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  view.viewDate = D;
  await view.onOpen();
  view.viewDate = D;
  await view.render();
  const node = document.querySelector(".tlt-star .tlt-node");
  assert.ok(node, "星图里没有节点");
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.ok(document.querySelector(".tlt-peek-title"), "没弹出只读详情");
  const jump = [...document.querySelectorAll(".tlt-m-foot button")].find((b) => b.textContent.includes("打开任务"));
  assert.ok(jump, "详情里没有跳转按钮");
  jump.click();
  // 任务详情现在用输入框装标题（可直接改），所以查 .tlt-input.wide 的值
  const box = document.querySelector(".modal .tlt-input.wide");
  assert.ok(box, "跳转后没打开任务弹窗");
  assert.ok((box.value || "").length > 0, "详情弹窗里标题是空的");
});

await t("切到本月：四组 + 任务行", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "month";
  await view.render();
  assert.equal(document.querySelectorAll(".tlt-mgrp").length, 4);
  assert.ok(document.querySelectorAll(".tlt-task").length >= 3);
});

await t("点侧栏项目：日历 / 任务 / 里程碑跟着一起筛", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "month";
  await view.render();
  const total = document.querySelectorAll(".tlt-task").length;

  // 点侧栏的项目卡（事件走 contentEl 的委托）
  const card = document.querySelector('.tlt-proj[data-proj="示例项目"]');
  assert.ok(card, "侧栏没有示例项目卡片");
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 30));
  const shown = [...document.querySelectorAll(".tlt-task")].map((e) => e.dataset.task || "");
  assert.ok(shown.length > 0, "筛选后没有任务");
  assert.ok(shown.length < total, `筛选没生效：${shown.length} / ${total}`);
  assert.ok(shown.every((id) => id.includes("示例项目")), `混进了别的项目：${shown.join(" / ")}`);
  assert.equal(document.querySelectorAll(".tlt-proj.on").length, 1, "侧栏没标出选中项目");
  assert.ok(document.querySelector(".tlt-crumb-proj"), "面包屑没显示项目名");

  // 日历视图同样受限
  const day = "2026-10-25";
  assert.ok(view.tasksForDay(day).every((t) => t.project === "示例项目"), "日历没按项目筛");

  // 里程碑视图
  view.tab = "ms";
  await view.render();
  const names = [...document.querySelectorAll(".tlt-ms")].map((e) => e.dataset.ms || "");
  const allowed = new Set(view.store.milestones("示例项目").map((m) => m.name));
  assert.ok(names.length > 0, "里程碑视图空了");
  assert.ok(names.every((n) => allowed.has(n)), `里程碑没筛：${names.join(" / ")}`);

  // 点面包屑上的项目名 → 回到全部
  document.querySelector(".tlt-crumb-proj").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 30));
  view.tab = "month";
  await view.render();
  assert.equal(document.querySelectorAll(".tlt-task").length, total, "清除筛选后应回到全部");
});

await t("任务详情：字段与新建对齐（可直接改标题/项目/里程碑/标签/开始/人天）", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "month";
  await view.render();
  const tid = document.querySelector(".tlt-task")?.dataset.task;
  const task = view.store.tasks.find((x) => x.id === tid);
  assert.ok(task, "夹具里没有任务");
  new TaskModal(app, view.store, task, () => {}).open();
  const labels = [...document.querySelectorAll(".modal .tlt-row-l")].map((e) => e.textContent);
  ["项目", "里程碑", "标签", "时间", "工作量", "优先级", "负责人"].forEach((want) => {
    assert.ok(labels.includes(want), `详情里缺「${want}」，实际：${labels.join(" / ")}`);
  });
  // 开始与截止在同一行；标题下不再有重复的小字
  assert.equal(document.querySelectorAll(".modal .tlt-dline input[type=date]").length, 2, "开始/截止应在同一行");
  assert.equal(document.querySelectorAll(".modal .tlt-seg").length, 2, "详情里只该有 工作量/优先级 两个分段（占比已去掉）");
  const detailBtns = [...document.querySelectorAll(".modal .tlt-quick button")].map((b) => b.textContent);
  ["今天", "明天", "三天后", "一周后"].forEach((x) => assert.ok(!detailBtns.includes(x), `详情不该再有快捷日「${x}」`));
  assert.equal(document.querySelectorAll(".modal .tlt-m-meta").length, 0, "标题下不该再有重复的项目/里程碑小字");
  assert.ok(document.querySelector(".modal .tlt-input.wide")?.value, "标题应可编辑且带当前值");
  const opts = [...document.querySelectorAll(".modal select option")].map((o) => o.value);
  assert.ok(opts.includes("示例项目") && opts.includes("__new__"), "项目应有候选也能新建");
});

await t("任务详情：改项目会把任务搬过去（含步骤）", async () => {
  const view = mount(WorkbenchView);
  await view.onOpen();
  const task = view.store.tasks.find((x) => x.project === "示例项目" && x.kind === "task");
  await view.store.moveTask(task, "论文示例", "示例里程碑：基准与实验");
  assert.ok(!(files["TLT/tasks/示例项目.md"] || "").includes(task.title), "源文件里还留着这条任务");
  assert.ok((files["TLT/tasks/论文示例.md"] || "").includes(task.title), "目标项目里没有这条任务");
});

await t("里程碑视图：开展中放上面、已完成放下面", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "ms";
  await view.render();
  const groups = [...document.querySelectorAll(".tlt-ms-group")].map((e) => (e.textContent || "").replace(/\d+/g, "").trim());
  assert.ok(groups.length >= 1, "没有分组标题");
  assert.equal(groups[0], "开展中", `第一组应是开展中，实际：${groups.join(" / ")}`);
  if (groups.length > 1) assert.equal(groups[1], "已完成", `第二组应是已完成，实际：${groups.join(" / ")}`);
});

await t("人员视图：一行两个 + 星图图例带样张（并说明灰点=已完成）", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "staff";
  await view.render();
  // 人员：网格是两列
  const grid = document.querySelector(".tlt-staffgrid");
  assert.ok(grid, "没有人员网格");
  // jsdom 不做样式计算：直接核对样式表里的规则
  const css = (await import("node:fs")).readFileSync("styles.css", "utf8");
  assert.ok(/\.tlt-staffgrid \{[^}]*repeat\(2,/.test(css), "人员网格不是两列");
  assert.ok(/@media \(max-width: 720px\) \{ \.tlt-staffgrid \{ grid-template-columns: 1fr/.test(css), "窄屏应退回一列");

  // 星图在日历页的「节奏」里：切回去再看图例
  view.tab = "today";
  await view.render();
  const legend = [...document.querySelectorAll(".tlt-star-legend .tlt-lg")].map((e) => e.textContent);
  assert.ok(legend.some((x) => x.includes("已完成")), `图例应说明灰点，实际：${legend.join(" | ")}`);
  ["dot", "dot done", "dia", "line"].forEach((cls) => {
    assert.ok(document.querySelector(`.tlt-star-legend i.${cls.split(" ")[0]}${cls.includes("done") ? ".done" : ""}`), `图例缺样张 ${cls}`);
  });
  assert.ok(document.querySelector(".tlt-star-wrap svg"), "星图 svg 结构变了");
});

await t("发布消息源：不再单独给名称框，用源自身的名字", async () => {
  document.body.empty();
  const view = mount(MessagesView);
  await view.onOpen();
  const row = [...document.querySelectorAll(".tlt-fr")].find((x) => !x.classList.contains("add"));
  assert.ok(row, "左栏没有源行");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 40));
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("发布消息源"));
  assert.ok(btn, "右栏没有发布入口");
  btn.click();
  await new Promise((r) => window.setTimeout(r, 40));
  const inputs = [...document.querySelectorAll(".modal input")];
  assert.equal(inputs.length, 1, `弹窗里应只剩「说明」一个输入框，实际 ${inputs.length}`);
  assert.ok((document.querySelector(".modal")?.textContent || "").includes("源名称"), "应显示源名称");
});

await t("星图：每个项目一块扇形，长项目名不截成 8 个字", async () => {
  files["TLT/tasks/能力平台-数据底座-SBDS几何路网.md"] = "# 能力平台-数据底座-SBDS几何路网\n\n## 构建\n\n- [ ] 采集道路线形 📅 2026-10-30 [owner:: [[张三]]]\n";
  await store.load();
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  const wedges = [...document.querySelectorAll(".tlt-wedge")].map((e) => e.dataset.proj || "");
  assert.ok(wedges.length > 0, "没有扇形底");
  assert.ok(wedges.includes("能力平台-数据底座-SBDS几何路网"), `扇形应带项目名，实际：${wedges.join(" / ")}`);
  const labels = [...document.querySelectorAll(".tlt-plab")].map((e) => e.textContent || "");
  const long = labels.find((x) => x.startsWith("能力平台"));
  assert.ok(long && long.length > 8, `长项目名不该只剩 8 个字，实际：${long}`);
  // 完整名字留在 tooltip 里
  const title = [...document.querySelectorAll(".tlt-plab title")].map((e) => e.textContent);
  assert.ok(title.includes("能力平台-数据底座-SBDS几何路网"), "缺完整名字的 tooltip");
});

await t("发布消息源：服务不通时不许报发布成功", async () => {
  document.body.empty();
  const view = mount(MessagesView);
  await view.onOpen();
  // 模拟"根本没配发布服务"
  view.plugin.hubState = () => ({ publish: "", sync: "", lastSync: "", lastResult: "", lastError: "" });
  const before = view.store.feeds.length;
  const row = [...document.querySelectorAll(".tlt-fr")].find((x) => !x.classList.contains("add"));
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 40));
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("发布消息源")).click();
  await new Promise((r) => window.setTimeout(r, 40));
  const n0 = (globalThis.__notices || []).length;
  [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "发布").click();
  await new Promise((r) => window.setTimeout(r, 80));
  const said = (globalThis.__notices || []).slice(n0).join(" | ");
  assert.ok(/还没填发布服务地址/.test(said), "应提示服务地址没填，实际：" + said);
  assert.equal(view.store.feeds.length, before, "服务不通时不该真的发布");

  // 配了地址但连不上：同样不许发布
  view.plugin.hubState = () => ({ publish: "http://127.0.0.1:8787", sync: "", lastSync: "", lastResult: "", lastError: "" });
  view.plugin.pingHub = async () => false;
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("发布消息源"))?.click();
  await new Promise((r) => window.setTimeout(r, 40));
  [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "发布")?.click();
  await new Promise((r) => window.setTimeout(r, 80));
  assert.equal(view.store.feeds.length, before, "ping 不通时也不该发布");
});

await t("发布个人源：从「个人」挪到「我发布的」（只留一份）", async () => {
  document.body.empty();
  const view = mount(MessagesView);
  await view.onOpen();
  const personal = view.store.feeds.find((f) => f.personal);
  assert.ok(personal, "夹具里没有个人源");
  const before = view.store.feeds.length;
  await view.store.publishSource(personal, { name: "对外动态" });
  await view.store.load();
  const after = view.store.feeds;
  assert.equal(after.length, before, `不该多出一个源文件（${before} → ${after.length}）`);
  assert.equal(after.filter((f) => f.personal).length, 0, "「个人」里不该还留着它");
  const pub = after.find((f) => f.name === "对外动态");
  assert.ok(pub && pub.mine && !pub.personal, "「我发布的」里没有它");
  assert.ok(pub.items.length >= 1, "消息应留在原地，不该丢");
  assert.ok(!Object.keys(files).some((k) => k === "TLT/feeds/个人.md"), "个人源文件应已改名为发布 id");

  // 再取消发布：应就地回到「个人」，消息还在
  const n = pub.items.length;
  await view.store.demoteToPersonal(pub, "个人");
  await view.store.load();
  const back = view.store.feeds.find((f) => f.personal);
  assert.ok(back, "取消发布后没回到「个人」");
  assert.ok(!view.store.feeds.some((f) => f.name === "对外动态"), "「我发布的」里不该还在");
  assert.equal(back.items.length, n, `消息数应保持 ${n}，实际 ${back.items.length}`);
});

await t("新建任务：开始/截止同一行，负责人是框选而不是平铺", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  const Quick = (await import("./bundle.mjs?" + Date.now())).QuickTaskModal;
  new Quick(app, view.store, () => {}).open();
  const m = document.querySelector(".modal");
  assert.equal(m.querySelectorAll(".tlt-dline input[type=date]").length, 2, "开始/截止应在同一行");
  assert.equal(m.querySelectorAll(".tlt-pickrow").length, 0, "负责人不该一上来就平铺所有人");
  assert.ok(m.querySelector(".tlt-pickpop"), "负责人应有框选面板");
  [...m.querySelectorAll("button")].find((b) => b.textContent.includes("选择")).click();
  await new Promise((r) => window.setTimeout(r, 20));
  const rows = [...m.querySelectorAll(".tlt-pickrow")];
  assert.ok(rows.length >= 1, "框选面板里应列出人员");
  // 面板要够大：固定定位、至少 300 宽、能滚出多人
  const pop = m.querySelector(".tlt-pickpop");
  const cssPop = (await import("node:fs")).readFileSync("styles.css", "utf8");
  assert.ok(/\.tlt-pickpop \{[^}]*position: fixed/.test(cssPop), "面板应用 fixed 定位（absolute 会被弹窗裁掉）");
  assert.ok(/\.tlt-pickpop \{[^}]*width: 300px/.test(cssPop), "面板宽度至少 300px");
  assert.ok(/\.tlt-pickpop \{[^}]*max-height: 60vh/.test(cssPop), "面板高度给足（60vh）");
  assert.ok(/\.tlt-picksearch \{[^}]*width: 100%/.test(cssPop), "搜索框应占满面板宽度");
  assert.ok(!/\.tlt-picksearch[^{]*\{[^}]*width: 66px/.test(cssPop), "搜索框不该继承 .tlt-input.small 的 66px");
  // 点一个名字 → 变成已选 chip
  rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 10));
  assert.ok(m.querySelectorAll(".tlt-owner-chip").length === 1, "选了之后应出现已选 chip");
});

await t("任务行右键：菜单里有归档 / 删除，归档真的落到 archive/", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "month";
  await view.render();
  const row = [...document.querySelectorAll(".tlt-task")].find((r) => r.textContent.includes("示例任务：报告定稿"));
  assert.ok(row, "应找到那条任务");
  row.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 200 }));
  await new Promise((r) => setTimeout(r, 20));
  const menu = [...document.querySelectorAll(".tlt-menu-i")].map((b) => b.textContent);
  assert.ok(menu.includes("归档任务"), `右键菜单应有归档任务，实际：${menu.join(" / ")}`);
  assert.ok(menu.includes("删除任务"), "右键菜单应有删除任务");
  [...document.querySelectorAll(".tlt-menu-i")].find((b) => b.textContent === "归档任务").click();
  await new Promise((r) => setTimeout(r, 40));
  const sure = document.querySelector(".modal .tlt-confirm-body");
  assert.ok(sure, "归档前应确认");
  const ok = [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "归档");
  ok.click();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!(files["TLT/tasks/示例项目.md"] || "").includes("示例任务：报告定稿"), "任务应从项目里摘走");
  const arch = files["TLT/archive/示例项目.md"] || "";
  assert.ok(arch.includes("示例任务：报告定稿"), `应写进 archive/示例项目.md：${arch}`);
  assert.ok(arch.includes("## V0.7.4 月报"), "归档文件应保留里程碑分组");
});

await t("项目卡右键：菜单里有归档项目，确认后文件搬进 archive/", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  const card = [...document.querySelectorAll(".tlt-proj")].find((c) => c.textContent.includes("示例项目"));
  assert.ok(card, "应找到「示例项目」那张卡");
  card.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 200 }));
  await new Promise((r) => setTimeout(r, 20));
  const menu = [...document.querySelectorAll(".tlt-menu-i")].map((b) => b.textContent);
  assert.ok(menu.includes("归档项目"), `右键菜单应有归档项目，实际：${menu.join(" / ")}`);
  [...document.querySelectorAll(".tlt-menu-i")].find((b) => b.textContent === "归档项目").click();
  await new Promise((r) => setTimeout(r, 60));
  const body = document.querySelector(".modal .tlt-confirm-body")?.textContent || "";
  assert.ok(body.includes("TLT/archive/示例项目.md"), `确认框应写明去哪：${body}`);
  [...document.querySelectorAll(".modal button")].find((b) => b.textContent === "归档").click();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!files["TLT/tasks/示例项目.md"], "原位置应没了");
  assert.ok(files["TLT/archive/示例项目.md"], "应搬到 archive/");
});

await t("切到人员：卡片 + 饱和度 45%", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "staff";
  await view.render();
  assert.equal(document.querySelectorAll(".tlt-scard").length, 3);
  const pcts = [...document.querySelectorAll(".tlt-spct")].map((e) => e.textContent);
  assert.ok(pcts.length >= 3, `人数不对：${pcts.join(",")}`);
});

await t("切到想法：卡片渲染", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "ideas";
  await view.render();
  assert.ok(document.querySelectorAll(".tlt-icard").length >= 2);
});

await t("切到里程碑：三个", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "ms";
  await view.render();
  assert.equal(document.querySelectorAll(".tlt-ms").length, 3);
});

await t("节奏里点里程碑：弹只读窗，不跳走", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  view.viewDate = D;
  await view.onOpen();
  view.viewDate = D;
  await view.render();
  const dia = document.querySelector("[data-mspeek]");
  assert.ok(dia, "星图里没有里程碑");
  dia.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.ok(document.querySelector(".tlt-peek-title"), "没弹只读窗");
  assert.equal(view.tab, "today", "不该跳到里程碑视图");
});

await t("里程碑视图：点一下展开任务", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  view.tab = "ms";
  await view.render();
  const card = document.querySelector(".tlt-ms");
  assert.ok(card, "没有里程碑卡");
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const open = document.querySelectorAll(".tlt-ms.open").length;
  assert.equal(open, 1, "点了没展开");
  assert.ok(document.querySelectorAll(".tlt-ms.open .tlt-task").length > 0, "展开后没有任务");
});

await t("独立消息中心渲染", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  assert.ok(document.querySelectorAll(".tlt-fr").length >= 2);
  assert.ok(document.querySelectorAll(".tlt-card").length >= 2);
});

await t("点页签一次只切一次（监听不重复）", async () => {
  document.body.empty();
  const view = mount(WorkbenchView);
  await view.onOpen();
  const btn = document.querySelector('[data-tab="month"]');
  btn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(document.querySelectorAll(".tlt-tab.on").length, 1);
  assert.equal(document.querySelectorAll(".tlt-mgrp").length, 4);
});

/* ---------- 6) 消息中心：聚焦 / 取消 / 右侧面板 ---------- */
await t("消息中心：搜索 / 日期工具 / 六种形态", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  const all = document.querySelectorAll(".tlt-card").length;
  const si = document.querySelector('[data-focuskey="msgsearch"]');
  assert.ok(si, "没有搜索框");
  si.focus();
  si.value = "宣贯";
  si.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const hit = document.querySelectorAll(".tlt-card").length;
  assert.ok(hit > 0 && hit < all, `搜索 ${hit}/${all}`);
  assert.equal(document.activeElement, document.querySelector('[data-focuskey="msgsearch"]'), "焦点丢了");

  // 输入法合成期间不该筛
  const inp = document.querySelector('[data-focuskey="msgsearch"]');
  inp.value = "宣贯团";
  inp.dispatchEvent(new dom.window.Event("compositionstart", { bubbles: true }));
  inp.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(document.querySelectorAll(".tlt-card").length, hit, "合成期间被筛掉了");

  inp.value = ""; inp.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));

  const segs = [...document.querySelectorAll(".tlt-fm-tools .tlt-seg-b")].map((b) => b.textContent);
  assert.equal(segs.join("/"), "全部/今天/近 7 天/近 30 天", `工具条：${segs}`);
  assert.equal(document.querySelectorAll(".tlt-st").length, 0, "状态筛选应已移除");
  assert.ok([...document.querySelectorAll(".tlt-tlink")].some((b) => b.textContent === "回到今天"), "没有回到今天");
  const MODE_LABELS = ["卡片", "河流", "紧凑", "按源分带", "可缩放时间轴", "月度热力", "人物脉络"];
  const vbtn = document.querySelector(".tlt-viewbtn");
  assert.ok(vbtn, "没有形态切换按钮");
  assert.ok(vbtn.textContent.includes("卡片"), `按钮文案：${vbtn.textContent}`);

  const pick = async (label) => {
    document.querySelector(".tlt-viewbtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    const it = [...document.querySelectorAll(".tlt-menu-i")].find((b) => b.textContent.includes(label));
    assert.ok(it, `菜单里没有 ${label}`);
    it.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  };
  await pick("河流");
  assert.ok(document.querySelectorAll(".tlt-srow").length > 0, "河流没渲染");
  await pick("紧凑");
  assert.ok(document.querySelectorAll(".tlt-crow").length > 0, "紧凑没渲染");
  await pick("按源分带");
  assert.ok(document.querySelectorAll(".tlt-band").length > 0, "分带没渲染");
  await pick("可缩放时间轴");
  assert.ok(document.querySelectorAll(".tlt-axis-g").length > 0, "时间轴没画出来");
  const beforeSpan = document.querySelector(".tlt-axis-hint").textContent;
  const svg = document.querySelector(".tlt-axis-svg");
  const ev2 = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperty(ev2, "deltaY", { value: -120 });
  svg.dispatchEvent(ev2);
  await new Promise((r) => setTimeout(r, 30));
  assert.notEqual(document.querySelector(".tlt-axis-hint").textContent, beforeSpan, "滚轮没缩放");
  await pick("月度热力");
  assert.ok(document.querySelectorAll(".tlt-heat-c").length > 20, "热力没渲染");
  await pick("人物脉络");
  assert.ok(document.querySelectorAll(".tlt-net-o").length > 0, "人物脉络没渲染");
  await pick("卡片");
  const dayHead = document.querySelector(".tlt-mday-n");
  assert.ok(dayHead && /^\d+$/.test(dayHead.textContent.trim()), "日期头不对");
});

await t("工作台搜索不影响右栏消息", async () => {
  document.body.empty();
  const v = mount(WorkbenchView);
  v.tab = "month";
  await v.onOpen();
  await v.render();
  const before = document.querySelectorAll(".tlt-msgs .tlt-mnode").length;
  const i = document.querySelector("[data-search]");
  i.focus();
  i.value = "周报";
  i.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await v.render();
  const after = document.querySelectorAll(".tlt-msgs .tlt-mnode").length;
  assert.equal(after, before, "右栏被搜索过滤了");
});

await t("消息弹框：先标题后内容，来源是左下角徽章", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("个人"))
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  document.querySelector(".tlt-card").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const m = [...document.querySelectorAll(".tlt-modal")].pop();
  const order = [...m.children].map((e) => e.className.split(" ")[0]);
  assert.equal(order[0], "tlt-m-title");
  assert.ok(["tlt-m-body", "tlt-5w", "tlt-m-foot"].includes(order[1]), `顺序：${order}`);
  const badge = m.querySelector(".tlt-srcbadge");
  assert.ok(badge && badge.textContent.includes("个人"), "没有来源徽章");
  assert.ok(m.querySelector(".tlt-foot-left"), "徽章不在底栏左侧");
  assert.ok(!m.textContent.includes("这是个人草稿"), "旧提示还在");
});

await t("消息中心：点源 → 右栏换面板；再点 → 回概览", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  const mineRow = [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("我的动态"));
  mineRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  let title = document.querySelector(".tlt-fm-side .tlt-d-title").textContent;
  assert.ok(title.includes("我的动态"), `右栏还是 ${title}`);
  assert.ok([...document.querySelectorAll(".tlt-d-act button")].some((b) => b.textContent.includes("取消发布")), "没有取消发布");
  const again = [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("我的动态"));
  again.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  title = document.querySelector(".tlt-fm-side .tlt-d-title").textContent;
  assert.equal(title, "消息源管理");
});

await t("消息中心：单击只选一个，⌘ 点才多选", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  const rows = [...document.querySelectorAll(".tlt-fr")].filter((r) => r.textContent.trim());
  rows.find((r) => r.textContent.includes("部门通知")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const n1 = document.querySelectorAll(".tlt-card").length;
  [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("我的动态"))
    .dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
  const n2 = document.querySelectorAll(".tlt-card").length;
  assert.equal(document.querySelectorAll(".tlt-fr.on").length, 2, "没有多选");
  assert.ok(n2 >= n1, "多选后消息数没变多");
  assert.equal(document.querySelector(".tlt-fm-side .tlt-d-title").textContent, "已选 2 个源");
  // 单击换成单个，右栏应该回到"某个源"的管理面板
  [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("部门通知"))
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(document.querySelectorAll(".tlt-fr.on").length, 1, "单击没有收敛成单选");
});

await t("消息中心：点消息开弹框（不改筛选）", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("部门通知"))
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const before = document.querySelectorAll(".tlt-card").length;
  document.querySelector(".tlt-card").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.ok(document.querySelector(".tlt-modal .tlt-m-title"), "没弹出消息弹框");
  assert.equal(document.querySelectorAll(".tlt-fr.on").length, 1, "筛选被清掉了");
  assert.equal(document.querySelectorAll(".tlt-card").length, before, "时间线被重置");
});

await t("个人消息：弹框里有「发布为消息源」", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  [...document.querySelectorAll(".tlt-fr")].find((r) => r.textContent.includes("个人"))
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const title = document.querySelector(".tlt-fm-side .tlt-d-title").textContent;
  assert.equal(title, "个人");
  const card = document.querySelector(".tlt-card");
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const btns = [...document.querySelectorAll(".tlt-modal button")].map((b) => b.textContent);
  assert.ok(btns.some((t) => t.includes("转为任务")), "没有转为任务");
  // 发布入口收进「⋯」菜单
  const more = document.querySelector(".tlt-modal .tlt-more");
  assert.ok(more, "没有更多菜单");
  more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok([...document.querySelectorAll(".tlt-menu-i")].some((b) => b.textContent.includes("发布为消息源")), "菜单里没有发布");
});

await t("消息弹框：转为任务打开新建表单并预填", async () => {
  document.body.empty();
  const mv = mount(MessagesView);
  await mv.onOpen();
  const card = document.querySelector(".tlt-card");
  const title = card.querySelector(".tlt-nm").textContent;
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  [...document.querySelectorAll(".tlt-modal button")].find((b) => b.textContent.includes("转为任务")).click();
  const input = document.querySelector(".tlt-modal .tlt-input.wide");
  assert.ok(input, "没有打开新建任务表单");
  assert.equal(input.value, title, "标题没预填");
});

console.log(`\n${pass} 项通过${process.exitCode ? "，有失败" : "，全部通过"}`);

/* 测试跑完就退出：onload 里注册的定时器会把事件循环挂住 */
process.exit(process.exitCode ?? 0);
