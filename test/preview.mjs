/* 把真实渲染结果导出成静态 HTML，用于目视检查样式 */
import { JSDOM } from "jsdom";
import esbuild from "esbuild";
import fs from "node:fs";

const dom = new JSDOM(`<!doctype html><html><body class="theme-dark"></body></html>`, { pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
dom.window.Node.prototype.instanceOf = function (ctor) { return this instanceof ctor; };
 g.Element = dom.window.Element; g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent; g.KeyboardEvent = dom.window.KeyboardEvent;
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
  this.appendChild(e); return e;
};

await esbuild.build({
  stdin: { contents: `export { WorkbenchView } from "./src/views/workbench"; export { MessagesView } from "./src/views/messages"; export { Store } from "./src/store"; export { TFile } from "obsidian"; export { TLTSettingTab } from "./src/main";`, resolveDir: process.cwd(), sourcefile: "p.ts", loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: "test/bundle.mjs",
  alias: { obsidian: "./test/obsidian-stub.ts" }, logLevel: "error",
});
const { WorkbenchView, MessagesView, Store, TFile, TLTSettingTab } = await import("./bundle.mjs?" + Date.now());

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const D = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const tomorrow = new Date(now.getTime() + 864e5);
const T = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

const files = {
  "TLT/tasks/示例项目.md": `# 示例项目

## V0.7.4 月报

- [ ] 示例任务：报告定稿 🛫 ${D} 📅 ${D} [wl:: 30] [pri:: 2] [owner:: [[我]]]
  - [ ] 汇总 10 月场景数据
  - [ ] 与赵六对口径
- [ ] 汇总场景数据 📅 ${T} [wl:: 10] [owner:: [[我]]]
- [x] 示例任务：周报 📅 ${D} [wl:: 0] [owner:: [[我]]]

## 10 月场景推广

- [ ] 示例里程碑：启动 📅 ${T} [wl:: 15] [owner:: [[我]]] [pri:: 3]
- [ ] 推广物料清单 📅 ${T} [wl:: 10] [owner:: [[张三]]]

## 待排期

- [ ] 评审：监控指标命名口径 [wl:: 10] [owner:: [[我]]]
`,
  "TLT/tasks/论文示例.md": `# 论文示例

## 示例里程碑：基准与实验

- [ ] 示例里程碑任务：基准评测 · 数据集构建 🛫 ${D} 📅 ${T} [wl:: 50] [pw:: q] [owner:: [[张三]]]
  - [ ] 抽 50 条做人工校验
  - [ ] 冻结 benchmark 脚本
- [ ] 实验实施手册 定稿 📅 ${T} [wl:: 20] [owner:: [[我]]] [pri:: 2]

## 写作

- [ ] 第 4 章 实验协议 📅 ${T} [wl:: 20] [pw:: q] [owner:: [[我]]]
`,
  "TLT/tasks/示例工具.md": `# 示例工具

## 抽样与调优

- [ ] 解析质量处理 100 份 🛫 ${D} 📅 ${T} [wl:: 40] [pw:: w] [owner:: [[王五]]]
- [ ] 抽样结果 出报告 📅 ${T} [wl:: 10] [owner:: [[王五]]]
- [ ] 补：常用脚本回归（漏跑） 📅 ${D} [wl:: 10] [owner:: [[王五]]] [pri:: 2]
`,
  "TLT/crew/我.md": `---\ntlt: staff\nrole: 实验室负责人\ncapacity: 100\ndays: 5\nskills: [决策, 算法, 产品]\nstatus: active\n---\n`,
  "TLT/crew/张三.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: [评测, 数据集]\nstatus: active\n---\n`,
  "TLT/crew/李四.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 90\ndays: 5\nskills: [交通仿真, 接口]\nstatus: active\n---\n`,
  "TLT/crew/王五.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: [文档解析, 抽样]\nstatus: active\n---\n`,
  "TLT/crew/赵六.md": `---\ntlt: staff\nrole: 产品经理\ncapacity: 100\ndays: 5\nskills: [需求, 知识库]\nstatus: active\n---\n`,
  "TLT/feeds/我的动态.md": `---\ntitle: 我的动态\nowner: me\nmine: true\ncadence: 随手发\n---\n\n- ${D} 示例进展：方案已定稿 [kind:: note] [place:: 会议室] [star:: true]\n  > 三处差异写进 V2：表格跨页合并、公式回填、扫描页方向。周五前按新口径重跑。\n- ${T} 周会：先把 示例任务：写一页纸 [kind:: note]\n`,
  "TLT/feeds/部门通知.md": `---\ntitle: 部门通知\nowner: 示例同事\ncadence: 每周 2–3 条\ndesc: 宣贯、团建、制度变更、值班安排\n---\n\n- ${D} 部门宣贯：四季度安全与合规要求 [kind:: ask] [place:: 三楼会议室] [star:: true]\n  > 领导要求本周内完成，覆盖全员，保留签到记录。\n- ${T} 团建：秋季一日游（暂定杭州湾） [kind:: event] [place:: 杭州湾]\n  > 人数统计截止本周五。\n- ${D} 十一假期值班安排 [kind:: event] [state:: ended]\n`,
  "TLT/feeds/个人.md": `---
title: 个人
personal: true
owner: me
---

- ${D} 想把周报自动生成的想法记一下
  > 从 tasks 聚合 + 模板渲染，十分钟变一分钟。
`,
  "TLT/feeds/远程-部门RSS.md": `---\ntitle: 部门RSS\nremote: http://127.0.0.1:8787/feed?id=rss-demo\n---\n\n- ${D} 周会改到周四 10:00 [kind:: note]\n  > 来自 RSS：时间改成 10:00，地点三楼。\n- ${T} 周报模板 v3 已发群 [kind:: note]\n  > 来自 RSS：模板更新。\n`,
  "TLT/feeds/上级交办.md": `---\ntitle: 上级交办\nowner: 我\nmine: true\ncadence: 随时\n---\n\n- ${D} 示例项目 示例风险：排期提前 [kind:: risk] [place:: 周会] [star:: true]\n  > 需要重排 11 月排期，先确认 示例范围。\n`,
  ["TLT/logs/" + D.slice(0, 7) + ".md"]: `# 记录 ${D.slice(0, 7)}

## ${D}

- 09:30–11:00 示例记录：核对口径 [proj:: 示例工具]
  > 和冠宇对了三处口径：表格跨页合并、公式回填、扫描页方向。
- 11:00–11:40 需求对齐会 [proj:: 示例项目] [extra:: true]
  > 被叫去对齐 示例范围，对方要周五前一页纸说清边界。
- 14:00–15:30 接口评审 [proj:: 论文示例]
  > CTM 宏观引擎接口过了一遍，还差边界流参数。
`,
  "TLT/ideas.md": `# 想法池

- 把常用脚本做成通用回归工具 [type:: 工具] [stage:: 待验证] [star:: 2] [at:: ${D}] [src:: 抽样时]
  > 现在每次迭代都要人工抽 100 份，脚本散在各处。做成 CLI + 固定样本集，谁都能跑。
- 空间检索的「语法即护栏」能不能写成论文 [type:: 论文] [stage:: 沉淀] [star:: 3] [at:: ${D}] [src:: 写论文时]
  > DSL 约束 + 校验层，拒答率与误答率的权衡，可能是一篇短文。
- ETC 门架数据做路网健康度体检 [type:: 专利] [stage:: 沉淀] [star:: 2] [at:: ${D}] [src:: 外地项目]
- 示例项目的「知识缺口」主动提示 [type:: 产品] [stage:: 已验证] [star:: 3] [at:: ${D}] [src:: 客户访谈]
- 交通推演的 CTM 参数能不能自动标定 [type:: 预研] [stage:: 待验证] [star:: 2] [at:: ${D}] [src:: 推演平台]
- 个人：周报自动生成 [type:: 个人项目] [stage:: 已立项] [star:: 1] [at:: ${D}] [src:: 写周报时]
`,
};

const fm = {
  "TLT/crew/我.md": { role: "实验室负责人", capacity: 100, days: 5, skills: ["决策"], status: "active" },
  "TLT/crew/张三.md": { role: "算法工程师", capacity: 100, days: 5, skills: ["评测"], status: "active" },
  "TLT/crew/李四.md": { role: "算法工程师", capacity: 90, days: 5, skills: ["仿真"], status: "active" },
  "TLT/crew/王五.md": { role: "算法工程师", capacity: 100, days: 5, skills: ["解析"], status: "active" },
  "TLT/crew/赵六.md": { role: "产品经理", capacity: 100, days: 5, skills: ["需求"], status: "active" },
  "TLT/feeds/我的动态.md": { title: "我的动态", owner: "me", mine: true, cadence: "随手发" },
  "TLT/feeds/个人.md": { title: "个人", personal: true, owner: "me" },
  "TLT/feeds/部门通知.md": { title: "部门通知", owner: "示例同事", cadence: "每周 2–3 条" },
  "TLT/feeds/远程-部门RSS.md": `---\ntitle: 部门RSS\nremote: http://127.0.0.1:8787/feed?id=rss-demo\n---\n\n- ${D} 周会改到周四 10:00 [kind:: note]\n  > 来自 RSS：时间改成 10:00，地点三楼。\n- ${T} 周报模板 v3 已发群 [kind:: note]\n  > 来自 RSS：模板更新。\n`,
  "TLT/feeds/上级交办.md": { title: "上级交办", owner: "我", mine: true, cadence: "随时" },
};

const vault = {
  getMarkdownFiles: () => Object.keys(files).map((p) => new TFile(p)),
  cachedRead: async (f) => files[f.path] ?? "",
  getAbstractFileByPath: (p) => (p in files ? new TFile(p) : null),
  process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
  create: async (p, c) => { files[p] = c; },
  createFolder: async () => {},
  on: () => ({}),
};
const app = { vault, metadataCache: { getFileCache: (f) => ({ frontmatter: fm[f.path] }) }, workspace: { getLeavesOfType: () => [], getLeaf: () => ({}) } };
const store = new Store(app, { tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds", logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的动态" });
await store.load();

const plugin = {
  manifest: { id: "tlt-timeline-things", dir: "tlt-timeline-things", version: "preview" },
  settings: {
    defaultPeriod: "m", tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
    logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", tagsFile: "TLT/tags.md",
    theme: "auto", hubPublish: "http://127.0.0.1:8787", hubSync: "http://127.0.0.1:8788",
    autoSyncMin: 15, autoPushMin: 0, mineFeed: "我的动态", feedIds: {}, feedNames: {},
  },
  store, isLight: () => false, toggleTheme: () => {}, activateMessages: async () => {}, refreshAll: () => {},
  applyTheme: () => {}, publishAll: async () => {}, syncAll: async () => {}, seedDemo: async () => {},
  pingHub: async () => true,
  vaultName: () => "测试库", hubState: () => ({ publish: "http://127.0.0.1:8787", sync: "http://127.0.0.1:8788", lastSync: "15:04", lastResult: "新增 2 条", lastError: "" }),
  setHubState: () => {},
};
const css = fs.readFileSync("styles.css", "utf8");

function mount(cls) {
  const v = new cls({ app }, plugin);
  v.containerEl = document.createElement("div");
  v.contentEl = document.createElement("div");
  v.containerEl.appendChild(v.contentEl);
  document.body.appendChild(v.containerEl);
  return v;
}

async function shot(tab, theme, out) {
  document.body.empty();
  document.body.className = theme === "light" ? "theme-light" : "theme-dark";
  const v = mount(WorkbenchView);
  v.viewDate = D;
  await v.onOpen();
  v.viewDate = D; v.tab = tab;
  await v.render();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:${theme === "light" ? "#E4E6ED" : "#07070A"}}
    body{padding:16px}
    .frame{width:1248px;height:768px;border-radius:12px;overflow:hidden;border:1px solid ${theme === "light" ? "#D9DDE8" : "#26262E"}}
    ${css}
  </style></head><body class="${theme === "light" ? "theme-light" : "theme-dark"}"><div class="frame">${v.containerEl.innerHTML}</div></body></html>`;
  fs.writeFileSync(`test/${out}.html`, html);
  console.log("wrote", `test/${out}.html`);
}

await shot("today", "dark", "preview-today");
await shot("today", "light", "preview-today-light");
await shot("staff", "dark", "preview-staff");
await shot("month", "dark", "preview-month");
await shot("ideas", "dark", "preview-ideas");
await shot("ms", "dark", "preview-ms");
await shot("month", "light", "preview-month-light");

// 强制浅色：body 仍是 theme-dark，但加 tlt-light，验证覆盖优先级
{
  document.body.empty();
  document.body.className = "theme-dark tlt-light";
  const v = mount(WorkbenchView);
  v.viewDate = D;
  await v.onOpen();
  v.viewDate = D; v.tab = "staff";
  await v.render();
  const css2 = fs.readFileSync("styles.css", "utf8");
  fs.writeFileSync("test/preview-forced-light.html", `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#E4E6ED} body{padding:16px}
    .frame{width:1248px;height:768px;border-radius:12px;overflow:hidden;border:1px solid #D9DDE8}
    ${css2}
  </style></head><body class="theme-dark tlt-light"><div class="frame">${v.containerEl.innerHTML}</div></body></html>`);
  console.log("wrote test/preview-forced-light.html");
}

document.body.empty();
document.body.className = "theme-dark";

async function msgShot(mode, theme, out) {
  document.body.empty();
  document.body.className = theme === "light" ? "theme-light" : "theme-dark";
  const v = mount(MessagesView);
  await v.onOpen();
  v.mode = mode;
  await v.render();
  const inner = v.containerEl.innerHTML;
  fs.writeFileSync(`test/${out}.html`, `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:${theme === "light" ? "#E4E6ED" : "#07070A"}} body{padding:16px}
  .frame{width:1248px;height:768px;border-radius:12px;overflow:hidden;border:1px solid ${theme === "light" ? "#D9DDE8" : "#26262E"}}
  ${css}
</style></head><body class="${theme === "light" ? "theme-light" : "theme-dark"}"><div class="frame">${inner}</div></body></html>`);
  console.log("wrote", `test/${out}.html`);
}

await msgShot("card", "dark", "preview-messages");
await msgShot("axis", "light", "preview-messages-axis");
await msgShot("heat", "dark", "preview-messages-heat");
await msgShot("bands", "dark", "preview-messages-bands");

/* ---- 设置页 ---- */
for (const theme of ["dark", "light"]) {
  document.body.empty();
  document.body.className = theme === "light" ? "theme-light" : "theme-dark";
  const tab = new TLTSettingTab({ app }, plugin);
  tab.containerEl = document.createElement("div");
  tab.containerEl.className = "tlt-settings";
  tab.renderSettings();
  fs.writeFileSync(`test/preview-settings-${theme}.html`, `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:${theme === "light" ? "#E4E6ED" : "#07070A"}} body{padding:16px}
  .frame{width:760px;max-height:1180px;border-radius:12px;overflow:auto;border:1px solid ${theme === "light" ? "#D9DDE8" : "#26262E"};background:var(--tlt-bg2)}
  .tlt-settings{padding:18px 22px}
  /* 下面这段是模拟 Obsidian 设置容器自带的核心样式，预览里才需要 */
  .setting-item{display:flex;align-items:center;gap:18px;padding:13px 0;border-top:1px solid ${theme === "light" ? "#E2E5EE" : "#22222A"}}
  .setting-item:first-child,.setting-item-heading{border-top:0}
  .setting-item-info{flex:1 1 auto;min-width:0}
  .setting-item-name{font-size:13px;color:var(--tlt-ink);line-height:1.6}
  .setting-item-description{font-size:11.5px;color:var(--tlt-ink3);line-height:1.75;margin-top:4px;white-space:normal}
  .setting-item-heading{padding:20px 0 6px}
  .setting-item-heading .setting-item-name{font-size:14px;font-weight:650}
  .setting-item-control{flex:0 0 auto;display:flex;gap:8px;align-items:center}
  .setting-item-control input,.setting-item-control select{height:30px;border-radius:8px;border:1px solid var(--tlt-line2);background:var(--tlt-surface2);color:var(--tlt-ink);padding:0 9px;font-size:12px;font-family:inherit;min-width:180px}
  .setting-item-control button{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--tlt-line2);background:var(--tlt-surface2);color:var(--tlt-ink2);font-size:11.5px;font-family:inherit;cursor:pointer}
  .setting-item-control button:hover{color:var(--tlt-ink);border-color:var(--tlt-line3)}
  ${css}
</style></head><body class="${theme === "light" ? "theme-light" : "theme-dark"}"><div class="frame">${tab.containerEl.innerHTML}</div></body></html>`);
  console.log("wrote", `test/preview-settings-${theme}.html`);
}
