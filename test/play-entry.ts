/**
 * 浏览器里能真点的测试台：把真实 Store + 两个 View 挂到页面，暴露 window.__tlt
 * 只用于本机 CDP 验证（弹窗、滚动、多选这类 jsdom 测不出来的东西）
 */
import { WorkbenchView } from "../src/views/workbench";
import * as modals from "../src/views/modals";
import { MessagesView } from "../src/views/messages";
import { OverviewPanelView } from "../src/views/panel";
import { Store } from "../src/store";
import { TFile } from "obsidian";

(globalThis as any).createSvg = (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag);
(globalThis as any).createEl = (tag: string, o: any = {}) => {
  const e = document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};

(Node.prototype as any).instanceOf = function (ctor: any) { return this instanceof ctor; };

/* Obsidian 给 DOM 加的便捷方法（真机有，浏览器里要补） */
const EP: any = Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c: string[]) { c.forEach((x) => this.classList.add(x)); return this; };
EP.removeClass = function (...c: string[]) { c.forEach((x) => this.classList.remove(x)); return this; };
EP.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on); return this; };
EP.setCssProps = function (obj: Record<string, unknown>) {
  Object.entries(obj || {}).forEach(([k, v]) => (this as HTMLElement).style.setProperty(k, String(v)));
  return this;
};
EP.createEl = function (tag: string, o: any = {}) {
  const e = document.createElement(tag);
  if (o.text) e.textContent = o.text;
  if (o.cls) e.className = o.cls;
  this.appendChild(e); return e;
};
(HTMLElement.prototype as any).empty = EP.empty;
(HTMLElement.prototype as any).addClass = EP.addClass;
(HTMLElement.prototype as any).removeClass = EP.removeClass;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const D = iso(now);
const T = iso(new Date(now.getTime() + 864e5));
const MONTH = D.slice(0, 7);

const files: Record<string, string> = {
  "TLT/tasks/示例项目.md": `# 示例项目

## V0.7.4 月报

- [ ] 示例任务：报告定稿 🛫 ${D} 📅 ${D} [wl:: 30] [pri:: 2] [owner:: [[我]]]
  - [ ] 汇总 10 月场景数据
  - [ ] 与赵六对口径
- [ ] 汇总场景数据 📅 ${T} [wl:: 10] [owner:: [[我]]]

## 推广

- [ ] 示例里程碑：启动 📅 ${T} [wl:: 15] [owner:: [[我]]]
- [ ] 示例任务：画图 📅 ${D} [wl:: 10] [scope:: 个人] [tags:: 论文]
`,
  "TLT/tasks/示例工具.md": `# 示例工具

## 抽样与调优

- [ ] 处理 100 份 🛫 ${D} 📅 ${D} [wl:: 40] [pw:: w] [owner:: [[王五]]]
`,
  "TLT/crew/我.md": `---\ntlt: staff\nrole: 实验室负责人\ncapacity: 100\ndays: 5\nskills: [决策]\nstatus: active\n---\n`,
  "TLT/crew/张三.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: [评测]\nstatus: active\n---\n`,
  "TLT/crew/李四.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 90\ndays: 5\nskills: [仿真]\nstatus: active\n---\n`,
  "TLT/crew/王五.md": `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: [解析]\nstatus: active\n---\n`,
  "TLT/crew/赵六.md": `---\ntlt: staff\nrole: 产品经理\ncapacity: 100\ndays: 5\nskills: [需求]\nstatus: active\n---\n`,
  "TLT/feeds/个人.md": `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n- ${D} 记一下周报自动化\n  > 从 tasks 聚合 + 模板渲染。\n`,
  "TLT/feeds/我的动态.md": `---\ntitle: 我的动态\nowner: me\nmine: true\ncadence: 随手发\n---\n\n- ${D} 示例口径 V2 定稿 [kind:: note]\n`,
  "TLT/feeds/部门通知.md": `---\ntitle: 部门通知\nowner: 示例同事\ncadence: 每周 2–3 条\n---\n\n- ${D} 部门宣贯 [kind:: ask] [place:: 三楼] [star:: true]\n  > 覆盖全员\n- ${T} 团建 [kind:: event]\n`,
  "TLT/feeds/上级交办.md": `---\ntitle: 上级交办\nowner: 我\nmine: true\ncadence: 随时\n---\n\n- ${D} 示例风险：排期提前 [kind:: risk] [place:: 周会] [star:: true]\n`,
  [`TLT/logs/${MONTH}.md`]: `# 记录 ${MONTH}\n\n## ${D}\n\n- 09:30–11:00 示例记录：核对口径 [proj:: 示例工具]\n  > 三处差异\n- 11:00–11:40 需求对齐会 [extra:: true]\n`,
  "TLT/ideas.md": `# 想法池

- 把常用脚本做成通用回归工具 [type:: 工具] [stage:: 待验证] [at:: ${D}]
- 空间检索能不能写成论文 [type:: 论文] [stage:: 沉淀] [at:: ${D}]
- ETC 门架做路网体检 [type:: 专利] [stage:: 沉淀] [at:: ${D}]
`,
};

const vault = {
  getMarkdownFiles: () => Object.keys(files).map((p) => new TFile(p)),
  cachedRead: async (f: any) => files[f.path] ?? "",
  getAbstractFileByPath: (p: string) => (p in files ? new TFile(p) : null),
  process: async (f: any, fn: any) => { files[f.path] = fn(files[f.path]); },
  create: async (p: string, c: string) => { files[p] = c; },
  createFolder: async () => {},
  trash: async (f: any) => { delete files[f.path]; },      // 测试台：删除＝直接从内存里去掉
  on: () => ({}),
};

/** 极简 frontmatter 解析（够测试用） */
function parseFm(text: string): Record<string, any> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return undefined;
  const out: Record<string, any> = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(":");
    if (i < 0) return;
    const k = line.slice(0, i).trim();
    let v: any = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean);
    else if (/^\d+$/.test(v)) v = parseInt(v, 10);
    else if (v === "true" || v === "false") v = v === "true";
    else v = v.replace(/^["']|["']$/g, "");
    out[k] = v;
  });
  return out;
}

const app = {
  vault,
  metadataCache: { getFileCache: (f: any) => ({ frontmatter: parseFm(files[f.path] || "") }) },
  workspace: {},
  fileManager: { trashFile: async (f: any) => { delete files[f.path]; }, renameFile: async (f: any, to: string) => { files[to] = files[f.path]; delete files[f.path]; } },
};

const store = new Store(app as any, {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的动态",
} as any);

const plugin = {
  settings: { defaultPeriod: "m", feedIds: {} },
  store,
  isLight: () => false,
  toggleTheme: () => {},
  activateMessages: async () => {},
  refreshAll: () => {},
  activeProject: null,
  setActiveProject(p: string | null) { (plugin as any).activeProject = p; },
  // 面板上的「全部工作」走这个：插件状态 + 工作台筛选一起清
  async clearActiveProject() {
    (plugin as any).setActiveProject(null);
    const wb = (window as any).__tlt?.workbench as { focusOn?: (o: { proj?: string | null }) => Promise<void> } | undefined;
    await wb?.focusOn?.({ proj: null });
  },
  togglePanel: async () => {},
  activateWorkbench: async () => {},
  saveSettings: async () => {},
  hubState: () => ({ publish: "http://127.0.0.1:8787", sync: "http://127.0.0.1:8788", lastSync: "", lastResult: "", lastError: "", syncMin: 0, pushMin: 0 }),
  setHubState: () => {},
};

const host = document.getElementById("host")!;
let cur: any = null;
let wbRef: any = null;

async function mount(kind: "workbench" | "messages" | "panel") {
  host.innerHTML = "";
  const View: any = kind === "messages" ? MessagesView : kind === "panel" ? OverviewPanelView : WorkbenchView;
  const v = new View({ app, workspace: {} }, plugin as any);
  v.containerEl = document.createElement("div");
  v.contentEl = document.createElement("div");
  v.containerEl.className = "tlt-root";
  v.containerEl.appendChild(v.contentEl);
  host.appendChild(v.containerEl);
  if (kind === "workbench") { v.viewDate = D; }
  await v.onOpen();
  if (kind === "workbench") { v.viewDate = D; await v.render(); }
  cur = v;
  if (kind === "workbench") wbRef = v;
  return v;
}

await store.load();
(window as any).__tlt = { store, mount, files, get view() { return cur; }, get workbench() { return wbRef; }, D, modals };
await mount("workbench");
