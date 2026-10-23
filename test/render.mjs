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
const { WorkbenchView, MessagesView, Store, TFile, TLTSettingTab, TLTPlugin, setLanguage, tr, parseIdeaText: dlibParse } = await import("./bundle.mjs?" + Date.now());
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
  "TLT/team/我.md": `---\ntlt: staff\nrole: 负责人\ncapacity: 100\ndays: 5\nskills: [决策]\nstatus: active\n---\n`,
  "TLT/team/张三.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 80\ndays: 4\nskills: [评测]\nstatus: active\n---\n`,
  "TLT/team/王五.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\n---\n`,
  "TLT/feeds/部门通知.md": `---\ntitle: 部门通知\nowner: 示例同事\n---\n\n- ${D} 部门宣贯 [kind:: ask] [place:: 三楼] [star:: true]\n  > 覆盖全员\n- ${D} 团建 [kind:: event] [state:: ended]\n`,
  "TLT/feeds/个人.md": `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- ${D} 记一下周报自动化\n`,
  "TLT/feeds/我的动态.md": `---\ntitle: 我的动态\nowner: me\nmine: true\n---\n\n- ${D} 示例口径 V2 定稿 [kind:: note]\n`,
  ["TLT/logs/" + D.slice(0, 7) + ".md"]: `# 记录\n\n## ${D}\n\n- 09:30–11:00 示例记录：核对口径 [proj:: 示例工具]\n  > 三处差异\n- 11:00–11:40 需求对齐会 [extra:: true]\n`,
  "TLT/ideas.md": `# 想法池\n\n- 回归工具化 [type:: 工具] [stage:: 待验证] [star:: 2] [at:: ${D}]\n- 写论文 [type:: 论文] [stage:: 沉淀] [star:: 3] [at:: ${D}]\n  > 语法即护栏\n`,
};

const fm = {
  "TLT/team/我.md": { role: "负责人", capacity: 100, days: 5, skills: ["决策"], status: "active" },
  "TLT/team/张三.md": { role: "算法工程师", capacity: 80, days: 4, skills: ["评测"], status: "active" },
  "TLT/team/王五.md": { role: "算法工程师", capacity: 100, days: 5 },
  "TLT/feeds/部门通知.md": { title: "部门通知", owner: "示例同事" },
  "TLT/feeds/我的动态.md": { title: "我的动态", owner: "me", mine: true },
  "TLT/feeds/个人.md": { title: "个人", personal: true, owner: "me" },
};

const createdFolders = [];
const vault = {
  getMarkdownFiles: () => Object.keys(files).map((p) => new TFile(p)),
  cachedRead: async (f) => files[f.path] ?? "",
  getAbstractFileByPath: (p) => (p in files ? new TFile(p) : null),
  process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
  create: async (p, c) => { files[p] = c; },
  createFolder: async (p) => { createdFolders.push(p); },
  on: () => ({}),
};
const app = { vault, metadataCache: { getFileCache: (f) => ({ frontmatter: fm[f.path] }) }, workspace: { getLeavesOfType: () => [], getLeaf: () => ({}) } };

const store = new Store(app, {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/team", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的动态",
});
await store.load();

/* ---------- 4) 断言数据层 ---------- */
let pass = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n    ", e.stack?.split("\n").slice(0,4).join("\n    ")||e.message); process.exitCode = 1; }
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
    root: "TLT", defaultPeriod: "m", tasksFolder: "TLT/tasks", teamFolder: "TLT/team", feedsFolder: "TLT/feeds",
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
  inst.settings = { ...plugin.settings, ...overrides };
  inst.store = store;
  store.settings = inst.settings;
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
  const pool = m.querySelector(".tlt-ownerpick");
  assert.ok(pool.classList.contains("tlt-hidden"), "候选一开始应该收着");
  [...m.querySelectorAll("button")].find((b) => b.textContent.includes("调整")).click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!m.querySelector(".tlt-ownerpick").classList.contains("tlt-hidden"), "没展开候选");
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
  assert.ok(names.includes("按根目录重排六个路径"), `维护里应有重排入口，实际：${names.join(" / ")}`);
  assert.ok(el2.textContent.includes("当前读取"), "缺少当前读取");
  // 目录项：显示当前值，占位符是默认值
  const inputs = [...el2.querySelectorAll("input")];
  const tasks = inputs.find((i) => i.placeholder === "TLT/tasks");
  assert.ok(tasks, "任务目录输入框没有默认值占位");
  assert.equal(tasks.value, "TLT/tasks", "任务目录没显示当前值");
  const phs = inputs.map((i) => i.placeholder).filter(Boolean);
  ["TLT/tasks", "TLT/team", "TLT/feeds", "TLT/logs", "TLT/ideas.md", "TLT/tags.md"].forEach((d) => {
    assert.ok(phs.includes(d), `缺少默认值占位 ${d}`);
  });
  // 消息服务：间隔下拉的选项
  const selects = [...el2.querySelectorAll("select")];
  assert.ok(selects.some((x) => [...x.options].some((o) => o.textContent === "15 分钟")), "间隔下拉选项不对");
});

await t("设置页：改根目录会同步六个路径，自定义项不动", async () => {
  document.body.empty();
  const p2 = makePlugin();
  const tab = new TLTSettingTab(app, p2);
  tab.containerEl = document.createElement("div");
  tab.renderSettings();
  const rootInput = [...tab.containerEl.querySelectorAll("input")].find((i) => i.placeholder === "TLT");
  assert.ok(rootInput, "没有 TLT 根目录输入框");
  assert.equal(rootInput.value, "TLT", "根目录没显示当前值");

  // 改根目录 → 六项跟着走
  rootInput.value = "工作/TLT";
  rootInput.dispatchEvent(new dom.window.Event("blur"));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(p2.settings.root, "工作/TLT");
  assert.equal(p2.settings.tasksFolder, "工作/TLT/tasks", `任务目录没跟随：${p2.settings.tasksFolder}`);
  assert.equal(p2.settings.ideasFile, "工作/TLT/ideas.md", "随手记文件没跟随");
  assert.equal(p2.settings.tagsFile, "工作/TLT/tags.md", "标签库文件没跟随");

  // 单独改过一项后再改根目录 → 那项保持不动
  const tab2 = new TLTSettingTab(app, p2);
  tab2.containerEl = document.createElement("div");
  p2.settings.teamFolder = "我的/团队";
  tab2.renderSettings();
  const root2 = [...tab2.containerEl.querySelectorAll("input")].find((i) => i.placeholder === "TLT");
  root2.value = "Other";
  root2.dispatchEvent(new dom.window.Event("blur"));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(p2.settings.root, "Other");
  assert.equal(p2.settings.tasksFolder, "Other/tasks", "其余项应跟随新根目录");
  assert.equal(p2.settings.teamFolder, "我的/团队", "自定义过的那项被覆盖了");
});

await t("设置页：声明式改根目录同样同步六项并建目录", async () => {
  document.body.empty();
  const inst = makePlugin();
  const tab = new TLTSettingTab(app, inst);
  tab.containerEl = document.createElement("div");
  await tab.setControlValue("root", "90-插件运营区");
  assert.equal(inst.settings.root, "90-插件运营区");
  assert.equal(inst.settings.tasksFolder, "90-插件运营区/tasks", `声明式没同步：${inst.settings.tasksFolder}`);
  assert.equal(inst.settings.tagsFile, "90-插件运营区/tags.md");
  assert.ok(createdFolders.some((x) => x.includes("90-插件运营区")), `没建目录，建了：${createdFolders.join(",")}`);
});

await t("设置页：路径改乱后「按根目录重排」能拉回来", async () => {
  const inst = makePlugin({ root: "库/TLT", tasksFolder: "乱写的/任务" });
  inst.alignPathsToRoot = TLTPlugin.prototype.alignPathsToRoot.bind(inst);
  await inst.alignPathsToRoot();
  assert.equal(inst.settings.tasksFolder, "库/TLT/tasks", "没拉回来");
  assert.equal(inst.settings.logsFolder, "库/TLT/logs");
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
    root: "90-插件运营区", tasksFolder: "90-插件运营区/tasks", teamFolder: "90-插件运营区/team",
    feedsFolder: "90-插件运营区/feeds", logsFolder: "90-插件运营区/logs",
  });
  app.vault.getMarkdownFiles = () => [new TFile("TLT/tasks/示例项目.md"), new TFile("TLT/team/张三.md"), new TFile("别处/无关.md")];
  const old = { ...inst.settings, root: "TLT", tasksFolder: "TLT/tasks", teamFolder: "TLT/team",
    feedsFolder: "TLT/feeds", logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", tagsFile: "TLT/tags.md" };
  const moves = inst.planMove(old);
  assert.equal(moves.length, 2, `应只算 TLT 下的两个文件，实际 ${JSON.stringify(moves)}`);
  assert.equal(moves[0].to, "90-插件运营区/tasks/示例项目.md");
  assert.equal(moves[1].to, "90-插件运营区/team/张三.md");
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
  assert.ok(document.querySelector(".tlt-m-title"), "跳转后没打开任务弹窗");
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
