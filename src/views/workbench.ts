import { t as T } from "../i18n";
import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type TLTPlugin from "../main";
import { Store, DEFAULT_SETTINGS, SORT_KEYS, DEFAULT_SORT, SORT_DEFAULT_DIR } from "../store";
import type { SortCfg, SortKey } from "../store";
import type { Idea } from "../data";
import {
  Task, Msg, Period, todayISO, addDays,
  hhmmToMin, minToHHMM, inPeriod, workloadBreakdown, staffWindowDays, D, parseIdeaText, ideaTags, ideaFilterTags, toggleMdCheckbox,
} from "../data";
import type { StaffDim } from "../data";
import { TaskModal, LogModal, QuickLogModal, QuickTaskModal, StaffModal, AddStaffModal, IdeaModal, MsgModal, TaskPeekModal, MilestonePeekModal, ProjectInfoModal, PromptModal, popMenu, el } from "./modals";
import { confirmArchiveProject, confirmDeleteTask, confirmRestoreProject } from "../archive";
import { ConfirmModal } from "./picker";
import { setSvgMarkup, miniMarkdown } from "./dom";
import { newProjectFlow } from "../actions";

export const VIEW_TYPE_WORKBENCH = "tlt-workbench";

/** 日历块的色相盘：低饱和、跟插件配色一路 */
const BLK_PALETTE = ["#5B6CFF", "#4FB59A", "#8B7CF6", "#D9A05F", "#D9755C", "#7C8BA1", "#B58BC4"];

/**
 * 概览面板的入口图标：一个"右侧栏"轮廓（描边、无填充，和插件整体一个脾气）。
 * 之前用的 ▤ 是个文字方块，太糙了。
 */
function panelIcon(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.35");
  svg.setAttribute("stroke-linecap", "round");
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("x", "1.7"); rect.setAttribute("y", "2.7");
  rect.setAttribute("width", "12.6"); rect.setAttribute("height", "10.6");
  rect.setAttribute("rx", "2.4");
  const divider = document.createElementNS(NS, "line");
  divider.setAttribute("x1", "10.4"); divider.setAttribute("y1", "2.7");
  divider.setAttribute("x2", "10.4"); divider.setAttribute("y2", "13.3");
  svg.append(rect, divider);
  // 右边那一栏里的两小段，表示读数
  for (const y of ["6.1", "8.6"]) {
    const tick = document.createElementNS(NS, "line");
    tick.setAttribute("x1", "11.7"); tick.setAttribute("y1", y);
    tick.setAttribute("x2", "12.9"); tick.setAttribute("y2", y);
    svg.appendChild(tick);
  }
  return svg;
}
const DAY_FROM = 7 * 60, DAY_TO = 23 * 60, HOUR_PX = 62;
/** 时间轴左边留给刻度、右边留边距（与 styles.css 里 .tlt-blk 的 left/right 保持一致） */
const GUTTER = 52, RIGHT_PAD = 8;
/** 周视图里一小时占多少像素（比日视图压得紧） */
const HOUR_css = () => 30;

/**
 * 一个任务的日程块挂在哪一天：排期日 → 完成日（已完成）→ 截止日。
 * 排期日和截止日是两件事，这里只决定"画在哪天的日历上"。
 */
function dayOfBlock(t: Task): string {
  if (t.plan) return t.plan;
  if (t.done && t.doneAt) return t.doneAt;
  return t.due || "";
}
type TaskDim = "d" | "run" | "w" | "m" | "q" | "all";
type CalView = "d" | "w" | "m" | "y";
type SortScope = "project" | "milestone" | "task";
/** 排序口径的中文名（下拉菜单和按钮上都用它） */
function sortLabel(k: SortKey): string {
  return { name: T("名称"), created: T("创建时间"), due: T("截止时间"), progress: T("完成进度"), pri: T("优先级") }[k];
}
const kindLabel = (k: string) => ({ ask: T("要求"), event: T("活动"), risk: T("风险"), note: T("通知") })[k] || k;
const KIND_COLOR: Record<string, string> = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
const weekday = (i: number) => [T("日"), T("一"), T("二"), T("三"), T("四"), T("五"), T("六")][i] || "";

/** ISO 周号（第几周） */
function isoWeek(isoDate: string): number {
  const d = D(isoDate);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 把日期挪到所在周的第一天（周几开头由设置决定） */
function weekStartOf(isoDate: string, start: 0 | 1): string {
  const d = D(isoDate);
  const back = (d.getDay() - start + 7) % 7;
  return addDays(isoDate, -back);
}
/** 周的 7 天 */
function weekDays(isoDate: string, start: 0 | 1): string[] {
  const first = weekStartOf(isoDate, start);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}
/** 某个月的网格：从该月第一天所在周的第一天开始，铺满 6 行（月视图固定高度，不会跳） */
function monthGrid(isoDate: string, start: 0 | 1): string[] {
  const d = D(isoDate);
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const gridStart = weekStartOf(first, start);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** 一块日程（计划块或记录块）——日/周/月/年四种视图共用同一份口径 */
interface CalBlock {
  kind: "plan" | "log";
  item: Task;
  title: string;
  a: number;
  b: number;
  st?: string;
  en?: string;
  done: boolean;
}
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
/** 粗略估宽（星图标签 9.5px 字号）：中文按 10px，其余按 5.8px */
const labelWidth = (s: string) => Array.from(s).reduce((w, ch) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 10 : 5.8), 0);

/** 项目配色：星图扇形与侧栏色块共用，颜色一致才好认 */
const PROJ_COLORS = ["#5B6CFF", "#F0C24B", "#27C1A3", "#B57BFF", "#F2994A", "#FF7A9C", "#5FD6B4", "#7C8BA1"];

export class WorkbenchView extends ItemView {
  plugin: TLTPlugin;
  get store(): Store { return this.plugin.store; }

  /**
   * 视图有可能比插件的 store 先就绪（重启恢复标签页时会撞上），
   * 所以设置统一走这里：拿不到就用默认值，渲染绝不因此抛错。
   */
  private get cfg() { return (this.plugin as { store?: Store } | undefined)?.store?.settings ?? DEFAULT_SETTINGS; }
  private tab = "today";
  private viewDate = todayISO();
  /** 日历的档位：日 / 周 / 月 / 年 */
  private calView: CalView = "d";
  private period: Period;
  private proj: string | null = null;
  private q = "";
  private expanded = new Set<string>();
  private rhythmView: "bars" | "star" = "star";
  private taskDim: TaskDim = "m";
  private showArchived = false;
  /** 日历时间轴滚到哪了（按日期记）：同一天重渲要保住，换天才自动定位 */
  private dayScroll: { day: string; top: number } | null = null;
  private renderedDay = "";
  /** 最后点过的里程碑：新建任务时默认落在它下面 */
  private msSel: { project: string; name: string } | null = null;
  private expandedSteps = new Set<string>();
  private get sideOff() { return !!this.cfg.sideCollapsed; }
  private get railOff() { return !!this.cfg.railCollapsed; }
  private taskTag: string | null = null;
  /** 人员视图的时间窗口：本月 / 下个月 / 全部 */
  private staffDim: StaffDim = "m";
  private starZoom = 1;
  private scrollToMin: number | null = null;
  private ideaTags: Set<string> = new Set();
  private starPan = { x: 0, y: 0 };

  constructor(leaf: WorkspaceLeaf, plugin: TLTPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.period = plugin.settings.defaultPeriod;
  }

  getViewType() { return VIEW_TYPE_WORKBENCH; }
  getDisplayText() { return T("时间线工作台"); }
  getIcon() { return "tlt-timeline"; }

  /** 只在自己这个视图是活动叶子时生效；弹窗开着、或焦点在输入框里就交给它们自己处理 */
  private guardEscape(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    if (this.app.workspace.getActiveViewOfType(WorkbenchView) !== this) return;
    if (document.querySelector(".modal-container")) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && this.contentEl.contains(ae) &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
    this.contentEl.querySelectorAll<HTMLElement>(".tlt-pickpop:not(.tlt-hidden)")
      .forEach((pop) => pop.addClass("tlt-hidden"));
    ev.preventDefault();
    ev.stopPropagation();
  }

  async onOpen() {
    // 本视图里按 Esc：先收掉自己的浮层，然后吃掉这个键——别让 Obsidian 把活动标签页切走
    this.registerDomEvent(window, "keydown", (ev) => this.guardEscape(ev), true);
    this.contentEl.addEventListener("click", (ev) => { void this.onClick(ev); });
    await this.ensureData();
    await this.render();
  }
  async onClose() { this.contentEl.empty(); }

  async refresh() {
    await this.ensureData(true);
    await this.render();
  }

  /**
   * 视图可能比插件先就绪（重启时 Obsidian 会恢复上次打开的标签页），
   * 那时 plugin.store 还不存在——这里一律宽容处理，绝不往外抛。
   */
  private async ensureData(force = false) {
    const s = (this.plugin as { store?: Store } | undefined)?.store;
    if (!s) return;
    try {
      if (force) await s.load(); else await s.ensureLoaded();
    } catch (e) {
      console.error(T("TLT: 载入数据失败"), e);
    }
  }

  /* ================= 渲染 ================= */

  async render() {
    const root = this.contentEl;
    const prevScroll = root.querySelector<HTMLElement>(".tlt-work")?.scrollTop || 0;
    const prevSide = root.querySelector<HTMLElement>(".tlt-side-scroll")?.scrollTop || 0;
    const prevGrid = root.querySelector<HTMLElement>(".tlt-daygrid");
    if (prevGrid && this.renderedDay) this.dayScroll = { day: this.renderedDay, top: prevGrid.scrollTop };
    // 输入框在 render 里会被重建，先记下焦点与光标位置，建完再还回去
    const ae = document.activeElement;
    const focusKey = ae?.instanceOf(HTMLInputElement) && ae.dataset.focuskey
      ? { key: ae.dataset.focuskey, start: ae.selectionStart ?? 0, end: ae.selectionEnd ?? 0 }
      : null;
    // 项目被改名/删掉后，筛选里留着的旧名字会让整屏空着——先清掉（用户报告过这个）
    const aliveProjects = this.store.projects();
    if (this.proj && !aliveProjects.includes(this.proj)) this.proj = null;
    if (this.msSel && !aliveProjects.includes(this.msSel.project)) this.msSel = null;
    const aliveMs = new Set(this.store.milestones().map((m) => m.name));
    [...this.expanded].forEach((k) => { if (!aliveMs.has(k)) this.expanded.delete(k); });

    root.empty();
    root.addClass("tlt-root");

    const app = el("div", "tlt");
    app.appendChild(this.sidebar());
    app.appendChild(this.main());
    app.appendChild(this.rail());
    root.appendChild(app);

    this.bindInputs(app);
    const work = app.querySelector<HTMLElement>(".tlt-work");
    if (work) work.scrollTop = prevScroll;
    const side = app.querySelector<HTMLElement>(".tlt-side-scroll");
    if (side) side.scrollTop = prevSide;

    if (focusKey) {
      const again = root.querySelector<HTMLInputElement>(`[data-focuskey="${focusKey.key}"]`);
      if (again) {
        again.focus();
        try { again.setSelectionRange(focusKey.start, focusKey.end); } catch { /* number 型 input 不支持 */ }
      }
    }

    // 日历时间轴：挂上 DOM 后同步设 scrollTop（元素还没挂载时设是无效的）
    const grid = root.querySelector<HTMLElement>(".tlt-daygrid");
    if (grid?.dataset.scrollTop) {
      grid.scrollTop = Number(grid.dataset.scrollTop) || 0;
      delete grid.dataset.scrollTop;
    }
  }

  /* ---------- 左栏 ---------- */

  /* ---------- 排序：项目 / 里程碑 / 任务各排各的 ---------- */

  private sortCfg(scope: SortScope): SortCfg {
    const k = scope === "project" ? "sortProjects" : scope === "milestone" ? "sortMilestones" : "sortTasks";
    const cfg = (this.cfg as unknown as Record<string, SortCfg | undefined>)[k];
    if (!cfg || !cfg.by || !SORT_KEYS[scope].includes(cfg.by)) return { ...DEFAULT_SORT };
    return cfg;
  }

  /**
   * 通用排序：名称走中文比较；数字（进度、优先级）按数值；取不到值的一律排最后；
   * 打平时按名称兜底，免得同值的时候顺序乱跳。
   */
  private sortBy<T>(scope: SortScope, items: T[], nameOf: (x: T) => string, keyOf: (x: T) => string | number | null): T[] {
    const { by, dir } = this.sortCfg(scope);
    if (by === "name") {
      return [...items].sort((x, y) => nameOf(x).localeCompare(nameOf(y), "zh") * dir);
    }
    return [...items].sort((x, y) => {
      const a = keyOf(x), b = keyOf(y);
      if (a === null && b === null) return nameOf(x).localeCompare(nameOf(y), "zh");
      if (a === null) return 1;                       // 没有值的永远垫底（不跟方向走）
      if (b === null) return -1;
      const c = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b));
      return c !== 0 ? c * dir : nameOf(x).localeCompare(nameOf(y), "zh");
    });
  }

  /** 一组任务里最早/最晚的那个日期（项目、里程碑用它的任务推算） */
  private edgeDate(list: Task[], pick: "created" | "due", min: boolean): string | null {
    const vals = list.map((t) => (pick === "created" ? t.created : t.due) || "").filter(Boolean).sort();
    if (!vals.length) return null;
    return min ? vals[0] : vals[vals.length - 1];
  }

  /** 进度：已完成 ÷ 全部（0–100，没任务算 null＝排最后） */
  private pctOf(list: Task[]): number | null {
    if (!list.length) return null;
    return Math.round((list.filter((t) => t.done).length / list.length) * 100);
  }

  private sortTasks(list: Task[]): Task[] {
    return this.sortBy("task", list, (t) => t.title, (t) => (
      this.sortCfg("task").by === "pri" ? t.pri : this.sortCfg("task").by === "created" ? (t.created || null) : null
    ));
  }

  private sortControl(scope: SortScope): HTMLElement {
    const btn = el("button", "tlt-btn tiny tlt-sortbtn");
    const { by, dir } = this.sortCfg(scope);
    btn.textContent = T("排序：{label} {dir}", { label: sortLabel(by), dir: dir === 1 ? "↑" : "↓" });
    btn.title = T("排序（只管这一栏）：点开选口径，再点同一个换方向");
    btn.dataset.sort = scope;
    btn.onclick = (ev) => { ev.stopPropagation(); this.sortMenu(btn, scope); };
    return btn;
  }

  /** 排序菜单：三类东西的候选口径不一样（项目能按进度/截止，任务只能按名称/优先级/创建） */
  private sortMenu(anchor: HTMLElement, scope: SortScope) {
    const { by, dir } = this.sortCfg(scope);
    const mark = (k: SortKey) => (by === k ? (dir === 1 ? " ↑" : " ↓") : "");
    const items = SORT_KEYS[scope].map((k) => ({
      label: sortLabel(k) + mark(k),
      onClick: () => void this.pickSort(scope, k),
    }));
    items.push({ label: T("反向排列"), onClick: () => void this.pickSort(scope, by, true) });
    popMenu(anchor, items, "right");
  }

  private async pickSort(scope: SortScope, by: SortKey, flip = false) {
    const cur = this.sortCfg(scope);
    const next: SortCfg = by === cur.by && !flip
      ? { by, dir: cur.dir === 1 ? -1 : 1 }          // 点同一个＝换方向
      : { by, dir: flip ? (cur.dir === 1 ? -1 : 1) : SORT_DEFAULT_DIR[by] };
    const k = scope === "project" ? "sortProjects" : scope === "milestone" ? "sortMilestones" : "sortTasks";
    (this.cfg as unknown as Record<string, SortCfg>)[k] = next;
    const p = this.plugin as unknown as { saveSettings?: () => Promise<void> };
    try { await p.saveSettings?.(); } catch { /* 存不下也不影响这次排序 */ }
    await this.render();
  }

  private sidebar(): HTMLElement {
    const s = el("aside", "tlt-side");
    if (this.sideOff) {
      s.addClass("off");
      const reopen = el("button", "tlt-fold-btn", "›");
      reopen.title = T("展开项目栏");
      reopen.onclick = () => { void this.setPanels({ sideCollapsed: false }); };
      s.appendChild(reopen);
      return s;
    }
    const top = el("div", "tlt-brand");
    const dot = el("span", "tlt-mark");
    top.append(dot, el("b", "", "TLT"));
    const folder = el("span", "tlt-fold", "TLT/");
    folder.title = `${this.cfg.tasksFolder} · ${this.cfg.teamFolder}`;
    top.appendChild(folder);
    const fold = el("button", "tlt-fold-btn", "‹");
    fold.title = T("收起项目栏");
    fold.onclick = () => { void this.setPanels({ sideCollapsed: true }); };
    top.appendChild(fold);
    s.appendChild(top);

    const scroll = el("div", "tlt-side-scroll");
    const shead = el("div", "tlt-shead tlt-shead-proj");
    shead.appendChild(el("span", "tlt-shead-t", T("项目 · 进度")));
    const acts = el("div", "tlt-shead-acts");
    const psort = el("button", "tlt-padd", "⇅");
    psort.title = T("项目排序：名称 / 完成进度 / 创建时间 / 截止时间");
    psort.dataset.sortproj = "1";
    psort.onclick = (ev) => { ev.stopPropagation(); this.sidebarSortMenu(psort); };
    const padd = el("button", "tlt-padd", "＋");
    padd.title = T("新建项目");
    padd.dataset.newproj = "1";
    padd.onclick = () => newProjectFlow(this.app, this.store, () => this.render());
    acts.append(psort, padd);
    shead.appendChild(acts);
    scroll.appendChild(shead);
    const all = this.store.tasks;
    const projTasks = (name: string) => all.filter((t) => t.project === name);
    const projKey = (p2: string): string | number | null => {
      const list2 = projTasks(p2);
      const by = this.sortCfg("project").by;
      if (by === "progress") return this.pctOf(list2);
      if (by === "created") return this.edgeDate(list2, "created", true);
      if (by === "due") return this.edgeDate(list2, "due", false);
      return null;
    };
    const projects = this.sortBy("project", this.store.projects(), (p2) => p2, projKey)
      .sort((a, b) => Number(this.store.isPinned(b)) - Number(this.store.isPinned(a)));   // 置顶的永远在最上面
    if (!projects.length) {
      // 空态也得有入口，否则新库里根本没有"新建项目"可点
      const empty = el("div", "tlt-pempty");
      empty.appendChild(el("span", "", T("还没有项目")));
      const add = el("button", "tlt-btn tiny", T("＋ 新建项目"));
      add.dataset.newproj = "1";
      add.onclick = () => newProjectFlow(this.app, this.store, () => this.render());
      empty.appendChild(add);
      scroll.appendChild(empty);
    }
    projects.forEach((p) => {
      const list = all.filter((t) => t.project === p);
      const pct = list.length ? Math.round((list.filter((t) => t.done).length / list.length) * 100) : 0;
      const pinned = this.store.isPinned(p);
      const card = el("div", "tlt-proj" + (this.proj === p ? " on" : "") + (pinned ? " pin" : ""));
      if (pinned) card.title = T("已置顶");
      card.dataset.proj = p;
      const row = el("div", "tlt-prow");
      const sw = el("span", "tlt-sw");
      sw.setCssProps({ "--tlt-sw": this.projColor(p) });
      const nameEl = el("span", "tlt-pname", p);
      const pdesc = this.store.projectDesc(p);
      if (pdesc) nameEl.title = pdesc;
      // 名称边上一个小笔：改名称 / 写描述（点卡片整体仍然是筛选）
      const edit = el("button", "tlt-pedit", "✎");
      edit.title = T("项目信息（名称 / 描述）");
      edit.dataset.projedit = p;
      row.append(sw, nameEl, edit, el("span", "tlt-ppct", pct + "%"));
      // 项目级动作：悬停出现「…」，右键也可以
      const more = el("button", "tlt-pmore", "⋯");
      more.title = T("新建里程碑 / 归档项目");
      more.dataset.projmenu = p;
      more.onclick = (ev) => { ev.stopPropagation(); this.projectMenu(more, p); };
      row.appendChild(more);
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.projectMenu(card, p, { x: ev.clientX, y: ev.clientY });
      });
      const bar = el("div", "tlt-pbar");
      const fill = el("i"); fill.style.width = pct + "%"; bar.appendChild(fill);
      const meta = el("div", "tlt-pmeta", T("{a} 项未完成 · {b} 个里程碑任务", { a: list.filter((t) => !t.done).length, b: list.filter((t) => t.milestone).length }));
      card.append(row, bar, meta);
      if (pdesc) card.appendChild(el("div", "tlt-pdesc", pdesc));   // 有描述就直接显示一行，不用悬停
      scroll.appendChild(card);
    });
    // 已归档：和里程碑视图一样分组，默认收起
    const archived = this.store.archivedProjects();
    if (archived.length) {
      const head = el("div", "tlt-shead tlt-shead-arch");
      const caret = el("span", "tlt-caret", this.showArchived ? "▾" : "▸");
      head.append(caret, el("span", "", `${T("已归档")} · ${archived.length}`));
      const listBox = el("div", "tlt-archlist");
      if (!this.showArchived) listBox.addClass("tlt-hidden");
      head.onclick = () => {
        this.showArchived = !this.showArchived;
        listBox.toggleClass("tlt-hidden", !this.showArchived);
        caret.setText(this.showArchived ? "▾" : "▸");
      };
      scroll.append(head, listBox);
      {
        archived.forEach((f) => {
          const card = el("div", "tlt-proj arch");
          card.dataset.archproj = f.path;
          const row = el("div", "tlt-prow");
          row.append(el("span", "tlt-sw arch"), el("span", "tlt-pname", f.basename));
          const more = el("button", "tlt-pmore", "⋯");
          more.title = T("还原 / 打开文件");
          more.onclick = (ev) => { ev.stopPropagation(); this.archivedMenu(more, f); };
          row.appendChild(more);
          const meta = el("div", "tlt-pmeta", `${this.cfg.tasksFolder.replace(/\/tasks$/, "")}/archive`);
          card.append(row, meta);
          card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.archivedMenu(card, f, { x: ev.clientX, y: ev.clientY }); });
          card.addEventListener("click", (ev) => {
            if ((ev.target as HTMLElement).closest(".tlt-pmore")) return;
            this.openProjectFile(f);
          });
          listBox.appendChild(card);
        });
      }
    }

    const idea = this.store.ideas;
    const box = el("div", "tlt-ideabox");
    box.dataset.tab = "ideas";
    box.append(el("span", "", T("✦ 随手记")), el("b", "", String(idea.length)));
    const stale = idea.filter((i) => i.stage !== "已立项" && (Date.now() - D(i.at).getTime()) / 864e5 > 14).length;
    if (stale) box.append(el("span", "tlt-stale", T("{n} 条待回看", { n: stale })));
    scroll.appendChild(box);
    s.appendChild(scroll);

    // 底部进度：跟着当前选中的项目走（没选就是全库）
    const scope = this.proj ? all.filter((t) => t.project === this.proj) : all;
    const done = scope.filter((t) => t.done).length;
    const foot = el("div", "tlt-sfoot");
    const footLine = el("span", "", T("完成 {a}/{b}", { a: done, b: scope.length }));
    footLine.title = this.proj ? T("当前项目的完成情况（点侧栏顶部的项目名回到全部）") : T("全部任务的完成情况");
    foot.appendChild(footLine);
    s.appendChild(foot);
    return s;
  }

  /* ---------- 主区 ---------- */

  private main(): HTMLElement {
    const m = el("main", "tlt-main");
    const top = el("div", "tlt-top");
    const crumbs = el("div", "tlt-crumbs");
    const who = this.proj
      ? el("b", "tlt-crumb-proj", this.proj)
      : el("b", "", T("全部工作"));
    if (this.proj) {
      who.dataset.projclear = "1";
      who.title = T("只看这一个项目，点击回到全部");
    }
    crumbs.append(who, el("span", "tlt-sep", "/"), el("span", "", this.tabName()));
    if (this.proj) crumbs.appendChild(el("span", "tlt-hint2", T("已按项目筛选")));
    top.appendChild(crumbs);
    top.appendChild(el("div", "tlt-spacer"));

    const search = el("div", "tlt-search");
    const input = el("input");
    input.placeholder = { today: T("搜索任务 / 记录"), month: T("搜索任务"), ms: T("搜索里程碑"), staff: T("搜索人员"), ideas: T("搜索随手记"), draw: "" }[this.tab] || T("搜索");
    input.value = this.q;
    input.dataset.search = "1";
    input.dataset.focuskey = "search";
    search.appendChild(input);
    top.appendChild(search);

    // 概览面板入口：放在明暗切换左边（挨着日常要用的那几个小按钮，别丢在左边的面包屑尾巴上）
    const panelBtn = el("button", "tlt-btn tlt-icobtn");
    panelBtn.title = T("TLT 概览面板（右侧栏）");
    panelBtn.dataset.panelopen = "1";
    panelBtn.setAttribute("aria-label", T("TLT 概览面板（右侧栏）"));
    panelBtn.appendChild(panelIcon());
    // 注意：不要在这里再挂 onclick——视图根部有个委托点击（[data-panelopen]）已经在处理，
    // 两边都挂会"开一次又关一次"，表现就是点了没反应。
    const theme = el("button", "tlt-btn", this.plugin.isLight() ? "☾" : "☀");
    theme.dataset.tltTheme = "1";
    theme.title = T("切换明暗");
    theme.onclick = (ev) => { ev.stopPropagation(); this.plugin.toggleTheme(); };
    const add = el("button", "tlt-btn pri lg", T("＋ 新建"));
    add.dataset.newtask = "1";
    top.append(panelBtn, theme, add);
    m.appendChild(top);

    const tabs = el("div", "tlt-tabs");
    [["today", T("日历")], ["month", T("任务")], ["ms", T("里程碑")], ["staff", T("人员")], ["ideas", T("随手记")], ["draw", T("随手画")]].forEach(([k, label]) => {
      const b = el("button", "tlt-tab" + (this.tab === k ? " on" : ""), T(label));
      b.dataset.tab = k;
      tabs.appendChild(b);
    });
    m.appendChild(tabs);

    const work = el("div", "tlt-work");
    if (this.tab === "today") {
      if (this.calView === "d") work.appendChild(this.paneToday());
      else if (this.calView === "w") work.appendChild(this.paneCalWeek());
      else if (this.calView === "m") work.appendChild(this.paneCalMonth());
      else work.appendChild(this.paneCalYear());
    }
    if (this.tab === "month") work.appendChild(this.paneMonth());
    if (this.tab === "staff") work.appendChild(this.paneStaff());
    if (this.tab === "ideas") work.appendChild(this.paneIdeas());
    if (this.tab === "ms") work.appendChild(this.paneMilestones());
    if (this.tab === "draw") work.appendChild(this.paneDraw());
    m.appendChild(work);
    return m;
  }

  private tabName() {
    const names: Record<string, string> = { today: T("日历"), month: T("任务"), ms: T("里程碑"), staff: T("人员"), ideas: T("随手记"), draw: T("随手画") };
    return names[this.tab] ? T(names[this.tab]) : "";
  }

  /* ---------- 日历 ---------- */

  /** 项目色：与侧栏色块、星图扇形保持一致 */
  projColor(name: string): string {
    const list = this.store.projects();
    const i = list.indexOf(name);
    return PROJ_COLORS[(i < 0 ? 0 : i) % PROJ_COLORS.length];
  }

  private tasksForDay(k: string) {
    return this.store.tasks
      .filter((t) => !this.proj || t.project === this.proj)          // 侧栏选中的项目
      .filter((t) => t.due === k || (t.start && t.due && t.start <= k && t.due >= k));
  }

  private paneToday(): HTMLElement {
    const p = el("div", "tlt-pane");
    const sel = this.viewDate;


    // 7 天条
    const strip = el("div", "tlt-strip");
    for (let i = -3; i <= 3; i++) {
      const k = addDays(sel, i);
      const cell = el("div", "tlt-ds" + (k === sel ? " sel" : "") + (k === todayISO() ? " today" : ""));
      cell.dataset.day = k;
      cell.append(el("span", "tlt-dw", weekday(D(k).getDay())), el("span", "tlt-dn", String(D(k).getDate())));
      const b = el("span", "tlt-db" + (this.tasksForDay(k).length ? " on" : ""));
      cell.appendChild(b);
      strip.appendChild(cell);
    }
    // 节奏在上：档位切换 + 日期导航 + 7 天条
    p.appendChild(this.rhythm());
    p.appendChild(this.calBar());
    p.appendChild(strip);

    // 时间轴 + 右栏
    const wrap = el("div", "tlt-daywrap");
    const grid = el("div", "tlt-daygrid");
    grid.dataset.slotgrid = "1";
    const inner = el("div", "tlt-dayinner");
    inner.style.height = `${((DAY_TO - DAY_FROM) / 60) * HOUR_PX}px`;
    for (let mnt = DAY_FROM; mnt <= DAY_TO; mnt += 60) {
      const h = el("div", "tlt-hour");
      h.style.top = `${((mnt - DAY_FROM) / 60) * HOUR_PX}px`;
      h.appendChild(el("span", "", minToHHMM(mnt)));
      inner.appendChild(h);
    }
    const logs = this.logsOn(sel);
    // 计划块：任务自己带了时间。完成的任务也留着它的计划块——勾完就"日程消失"会让人以为记录丢了
    // 计划块挂在哪天，按优先级：排期日（[plan::]）→ 完成日（已完成）→ 截止日。
    // 排期日和截止日**是两回事**：排期说"打算哪天做"，截止说"最晚什么时候交"，
    // 所以「排进时间表」只写排期日，不动截止日。
    const plans = this.store.tasks.filter((t) => t.st && dayOfBlock(t) === sel)
      .map((t) => {
        const a = hhmmToMin(t.st) || DAY_FROM;
        const b = hhmmToMin(t.en) || a + 60;
        return { kind: "plan" as const, id: t.id, item: t, title: t.title, a, b,
          meta: `${t.st}–${t.en} · ${t.done ? T("已完成") : T("计划")}${t.wl ? " · " + t.wl + "%" : ""}`,
          done: t.done };
      });
    const recs = logs.map((l) => {
      const a = hhmmToMin(l.st) || DAY_FROM;
      const b = hhmmToMin(l.en) || a + 30;
      return { kind: "log" as const, id: l.id, item: l, title: l.title, a, b,
        meta: `${l.st}–${l.en} · ${T("记录")}${l.project ? " · " + l.project : ""}`,
        done: false };
    });
    // 重叠的块并排（同一簇共用车道数），每块配一个稳定的色相
    const all = [...plans, ...recs].sort((x, y) => x.a - y.a || x.b - y.b);
    const lay = this.laneLayout(all.map((x) => ({ a: x.a, b: x.b })));
    const usedHues = new Set<string>();
    all.forEach((x, i) => {
      const { lane, lanes } = lay[i];
      const blk = el("div", `tlt-blk ${x.kind}` + (x.done ? " done" : ""));
      if (x.kind === "plan") blk.dataset.task = x.id; else blk.dataset.log = x.id;
      blk.style.top = `${((x.a - DAY_FROM) / 60) * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, ((x.b - x.a) / 60) * HOUR_PX)}px`;
      if (lanes > 1) {
        // 并排：在"刻度右侧的可用区"里等分——左边 52px 留给时间刻度、右边 8px 留边距，
        // 不能按整条宽度算，否则第一栏会盖住刻度（这就是之前并排时块压住时间的原因）
        blk.style.left = `calc(${GUTTER}px + (100% - ${GUTTER + RIGHT_PAD}px) * ${(lane / lanes).toFixed(4)})`;
        blk.style.width = `calc((100% - ${GUTTER + RIGHT_PAD}px) / ${lanes} - 4px)`;
        blk.classList.add("tlt-blk-lane");
        if (lanes >= 3) blk.classList.add("tlt-blk-narrow");     // 特别窄的：标题给两行，副信息收起来
      }
      blk.style.setProperty("--hue", this.hueFor(x.id, usedHues));
      blk.title = `${x.title}\n${x.meta}`;
      const c = el("div", "tlt-blk-c");
      c.append(el("div", "tlt-blk-t", x.title), el("div", "tlt-blk-m", x.meta));
      blk.appendChild(c);
      this.wireDrag(blk, c, {
        kind: x.kind, id: x.id, a: x.a, b: x.b,
        onMenu: (at) => this.blockMenu(x.kind, x.item, at),
      });
      inner.appendChild(blk);
    });
    if (sel === todayISO()) {
      const now = new Date();
      const nm = now.getHours() * 60 + now.getMinutes();
      if (nm > DAY_FROM && nm < DAY_TO) {
        const line = el("div", "tlt-now");
        line.style.top = `${((nm - DAY_FROM) / 60) * HOUR_PX}px`;
        line.appendChild(el("b", "", T("现在 {t}", { t: minToHHMM(nm) })));
        inner.appendChild(line);
      }
    }
    grid.appendChild(inner);
    wrap.appendChild(grid);

    // 右栏
    const side = el("div", "tlt-dayside");
    const uns = this.unscheduled(sel);
    const b1 = el("div", "tlt-box");
    const h1 = el("div", "tlt-box-h");
    h1.append(el("span", "", T("这天要做的")), el("span", "tlt-hint2", T("点一下排进时间表")));
    b1.appendChild(h1);
    if (uns.length) {
      const chips = el("div", "tlt-chips");
      uns.forEach((t) => {
        const c = el("span", "tlt-chipq");
        c.dataset.sched = t.id;
        c.title = T("点一下排进这天的时间表");
        c.textContent = `${t.title}${t.wl ? " · " + t.wl + "%" : ""}`;
        chips.appendChild(c);
      });
      b1.appendChild(chips);
    } else b1.appendChild(el("div", "tlt-empty", T("都排上了")));
    side.appendChild(b1);

    const plan = this.store.tasks.filter((t) => t.due === sel && t.st).length;
    const b2 = el("div", "tlt-box");
    b2.appendChild(el("div", "tlt-box-h", T("这天 · 计划与实际")));
    [[T("计划"), plan], [T("记录"), logs.length]].forEach(([n, v]) => {
      const r = el("div", "tlt-sum");
      r.append(el("span", "tlt-sum-n", String(n)));
      const bar2 = el("span", "tlt-sum-b");
      const fill = el("i"); fill.style.width = `${Math.min(100, (Number(v) / 6) * 100)}%`;
      bar2.appendChild(fill);
      r.append(bar2, el("span", "tlt-sum-v", T("{n} 条", { n: v })));
      b2.appendChild(r);
    });
    side.appendChild(b2);
    wrap.appendChild(side);
    p.appendChild(wrap);

    // 时间轴定位：刚排期的任务 → 它的开始时间；同一天重渲 → 保住你滚到的位置；
    // 换了日子才自动定位（今天＝此刻前 1.5 小时，别的天＝9:00）
    const jump = this.scrollToMin;
    this.scrollToMin = null;
    const d0 = new Date();
    const nowMin = d0.getHours() * 60 + d0.getMinutes();
    const pxOf = (min: number) => ((min - DAY_FROM) / 60) * HOUR_PX - 90;
    let target: number;
    if (jump !== null) target = pxOf(jump);
    else if (this.dayScroll && this.dayScroll.day === sel) target = this.dayScroll.top;
    else target = pxOf(sel === todayISO() ? Math.max(DAY_FROM, nowMin) : 9 * 60);
    this.renderedDay = sel;
    grid.dataset.scrollTop = String(Math.max(0, target));
    return p;
  }

  private logsOn(k: string): Task[] {
    return this.store.logs.filter((l) => l.due === k).sort((a, b) => (hhmmToMin(a.st) || 0) - (hhmmToMin(b.st) || 0));
  }
  private unscheduled(k: string) {
    return this.store.tasks.filter((t) => !t.done && t.due === k && !t.st);
  }

  private rhythm(): HTMLElement {
    const wrap = el("div", "tlt-rhythm");
    const days: string[] = [];
    for (let i = -3; i <= 17; i++) days.push(addDays(todayISO(), i));
    const load = (k: string) => this.store.tasks.filter((t) => t.due && t.start ? t.start <= k && t.due >= k : t.due === k).length;
    const max = Math.max(1, ...days.map(load));
    const dueN = this.store.tasks.filter((t) => !t.done && t.due && t.due >= todayISO() && t.due <= days[days.length - 1]).length;
    const msN = this.store.milestones().filter((m) => m.tasks.some((t) => t.due && t.due >= todayISO())).length;
    let busy = days[0], bn = -1;
    days.forEach((k) => { const n = load(k); if (n > bn) { bn = n; busy = k; } });

    const head = el("div", "tlt-rhythm-h");
    head.append(el("span", "tlt-rhythm-t", T("节奏 · 21 天")));
    head.appendChild(el("span", "tlt-rhythm-s", T("{a} 个到期 · {b} 个里程碑 · 最挤 {c}（{d} 件）", { a: dueN, b: msN, c: `${D(busy).getMonth() + 1}/${D(busy).getDate()}`, d: bn })));
    head.appendChild(el("span", "tlt-spacer"));
    const seg = el("div", "tlt-seg tlt-rhythm-seg");
    ([["bars", T("条带")], ["star", T("星图")]] as const).forEach(([k, t]) => {
      const b = el("button", "tlt-seg-b" + (this.rhythmView === k ? " on" : ""), t);
      b.dataset.rhythm = k;
      seg.appendChild(b);
    });
    head.appendChild(seg);
    wrap.appendChild(head);

    if (this.rhythmView === "star") {
      wrap.appendChild(this.starMap());
      return wrap;
    }

    const mini = el("div", "tlt-mini");
    days.forEach((k) => {
      const n = load(k);
      const c = el("span", "tlt-mcell" + (k === todayISO() ? " today" : ""));
      c.dataset.day = k;
      const i = el("i");
      i.style.height = `${n ? 6 + Math.round((n / max) * 22) : 3}px`;
      i.style.opacity = String(n ? 0.35 + Math.min(0.55, n * 0.13) : 0.08);
      c.appendChild(i);
      c.title = T("{k} · {n} 件", { k, n });
      mini.appendChild(c);
    });
    wrap.appendChild(mini);
    return wrap;
  }

  /** 极坐标时间线：半径=时间，扇区=项目，连线=同一个人 */
  private starMap(): HTMLElement {
    const box = el("div", "tlt-star-box");
    const wrap = el("div", "tlt-star-wrap");
    const svg = createSvg("svg");
    svg.setAttribute("class", "tlt-star");
    svg.setAttribute("viewBox", "0 0 560 240");
    const redraw = () => { setSvgMarkup(svg, this.starBody(560, 240)); };
    redraw();
    wrap.appendChild(svg);
    box.appendChild(wrap);
    // 图例：带样张，摆到右侧把横向留白用起来
    const legend = el("div", "tlt-star-legend");
    const item = (mark: string, text: string) => {
      const r = el("div", "tlt-lg");
      const i = el("i", mark);
      r.append(i, el("span", "", text));
      legend.appendChild(r);
    };
    item("dot", T("任务：未完成"));
    item("dot done", T("任务：已完成"));
    item("dia", T("里程碑"));
    item("line", T("同一个人"));
    item("ring", T("半径＝时间，一圈 7 天"));
    legend.appendChild(el("div", "tlt-lg-sec", T("内圈是今天；扇区＝项目；滚轮缩放、拖动平移")));
    box.appendChild(legend);

    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = this.starZoom * (e.deltaY < 0 ? 1.12 : 0.89);
      this.starZoom = Math.max(0.6, Math.min(2.6, next));
      redraw();
    }, { passive: false });

    let dragging = false, sx = 0, sy = 0, px = 0, py = 0;
    svg.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("[data-peek],[data-mspeek]")) return;
      dragging = true; sx = e.clientX; sy = e.clientY; px = this.starPan.x; py = this.starPan.y;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.starPan = { x: px + (e.clientX - sx), y: py + (e.clientY - sy) };
      redraw();
    });
    svg.addEventListener("pointerup", () => { dragging = false; });
    svg.addEventListener("pointercancel", () => { dragging = false; });
    return box;
  }

  /** 星图的 SVG 内容（随缩放/平移变化） */
  private starBody(W: number, H: number): string {
    const cx = W / 2 + this.starPan.x, cy = H / 2 + this.starPan.y;
    const r0 = 30 * this.starZoom, R = 76 * this.starZoom;
    const FROM = -3, TO = 21;
    const tasks = this.store.tasks.filter((t) => t.due);
    // 全部项目都画：扇形数 = 项目数（之前只取前 8 个，项目多了会悄悄少画）
    const projects = Array.from(new Set(tasks.map((t) => t.project)))
      .sort((a, b) => Number(this.store.isPinned(b)) - Number(this.store.isPinned(a)));   // 置顶的项目排在前面
    const span = 360 / Math.max(1, projects.length);
    const at = (d: string) => {
      const diff = Math.round((D(d).getTime() - D(todayISO()).getTime()) / 864e5);
      const f = Math.max(0, Math.min(1, (diff - FROM) / (TO - FROM)));
      return r0 + f * (R - r0);
    };
    const pos: Record<string, [number, number]> = {};
    const byP: Record<string, Task[]> = {};
    tasks.forEach((t) => { if (t.due) (byP[t.project] = byP[t.project] || []).push(t); });

    let body = "";
    /** 标签占位框：两圈交错时用来判断会不会压住 */
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    // 每个项目一块扇形底（颜色与侧栏色块一致），这样"哪块属于哪个项目"一眼可见
    projects.forEach((p, i) => {
      const a0 = ((-90 + i * span) * Math.PI) / 180;
      const a1 = ((-90 + (i + 1) * span) * Math.PI) / 180;
      const rr = R + 10;
      const x0 = cx + Math.cos(a0) * rr, y0 = cy + Math.sin(a0) * rr;
      const x1 = cx + Math.cos(a1) * rr, y1 = cy + Math.sin(a1) * rr;
      const list = byP[p] || [];
      const open = list.filter((t) => !t.done).length;
      body += `<path class="tlt-wedge" data-proj="${escapeXml(p)}" d="M${cx.toFixed(1)} ${cy.toFixed(1)} L${x0.toFixed(1)} ${y0.toFixed(1)} A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${this.projColor(p)}" opacity=".1"><title>${escapeXml(p)} · ${T("未完成")} ${open} / ${T("共")} ${list.length}</title></path>`;
    });
    [0, 7, 14, 21].forEach((d) => {
      const r = r0 + (d / 21) * (R - r0);
      body += `<circle class="tlt-ring" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/>`;
      body += `<text class="tlt-rlab" x="${(cx + 3).toFixed(1)}" y="${(cy - r + 9).toFixed(1)}">${d === 0 ? T("今天") : "+" + d + " " + T("天")}</text>`;
    });
    projects.forEach((p, i) => {
      const a = ((-90 + i * span) * Math.PI) / 180;
      body += `<line class="tlt-spoke" x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * (R + 8)).toFixed(1)}" y2="${(cy + Math.sin(a) * (R + 8)).toFixed(1)}"/>`;
    });

    // 标签：两圈交错 + 先到先得。
    // 项目一多，同一圈的字会互相压住；撞到已放好的就往外挪一圈，两圈都放不下才不画
    //（不画也不丢信息：扇形上有 tooltip，左侧栏也列着全部项目）。
    // 摆放顺序按任务数从多到少——忙的项目优先拿到位置，被挤掉的总是小项目。
    const maxLen = projects.length > 12 ? 10 : projects.length > 8 ? 14 : 18;
    const labelOrder = projects.map((p, i) => i).sort((a, b) => (byP[projects[b]] || []).length - (byP[projects[a]] || []).length);
    labelOrder.forEach((i) => {
      const p = projects[i];
      const am = ((-90 + (i + 0.5) * span) * Math.PI) / 180;
      const anchor = Math.abs(Math.cos(am)) < 0.3 ? "middle" : Math.cos(am) > 0 ? "start" : "end";
      const chars = Array.from(p);
      const label = chars.length > maxLen ? chars.slice(0, maxLen - 1).join("") + "…" : p;
      const w = labelWidth(label);
      for (const ring of [R + 16, R + 34]) {
        const lx = cx + Math.cos(am) * ring, ly = cy + Math.sin(am) * ring;
        const x0 = anchor === "end" ? lx - w : anchor === "middle" ? lx - w / 2 : lx;
        const box = { x0: x0 - 3, x1: x0 + w + 3, y0: ly - 11, y1: ly + 5 };
        if (boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue;
        boxes.push(box);
        body += `<text class="tlt-plab" data-proj="${escapeXml(p)}" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" fill="${this.projColor(p)}">${escapeXml(label)}<title>${escapeXml(p)}</title></text>`;
        break;
      }
    });

    projects.forEach((p, i) => {
      const list = (byP[p] || []).slice().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      list.forEach((t, j) => {
        const base = -90 + i * span;
        const off = list.length > 1 ? (j / (list.length - 1) - 0.5) * span * 0.62 : 0;
        const a = ((base + off) * Math.PI) / 180;
        const r = at(t.due);
        pos[t.id] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      });
    });

    const owners = Array.from(new Set(tasks.flatMap((t) => t.owners)));
    owners.forEach((o) => {
      const list = tasks.filter((t) => t.owners.includes(o) && t.due).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      if (list.length < 2) return;
      for (let i = 0; i < list.length - 1; i++) {
        const a = pos[list[i].id], b2 = pos[list[i + 1].id];
        if (!a || !b2) continue;
        body += `<path class="tlt-plink" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b2[0].toFixed(1)} ${b2[1].toFixed(1)}"/>`;
      }
    });

    tasks.forEach((t) => {
      const p = pos[t.id];
      if (!p) return;
      const r = (2.2 + Math.min(3, (t.est || 0) * 0.4)) * Math.max(0.85, this.starZoom);
      body += `<g class="tlt-node-g" data-peek="${t.id}">
        <circle class="tlt-hit" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r + 7).toFixed(1)}"/>
        <circle class="tlt-node" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}"
          fill="${t.done ? "var(--tlt-ink4)" : "var(--tlt-acc)"}" opacity="${t.done ? 0.45 : 0.9}"/>
        <title>${escapeXml(t.title)}</title></g>`;
    });

    this.store.milestones().forEach((m) => {
      const dues = m.tasks.map((t) => t.due).filter((d): d is string => !!d).sort();
      if (!dues.length) return;
      const i = projects.indexOf(m.project);
      if (i < 0) return;
      const a = ((-90 + i * span) * Math.PI) / 180;
      const r = at(dues[dues.length - 1]);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      body += `<g class="tlt-ms-g" data-mspeek="${escapeXml(m.project)}::${escapeXml(m.name)}">
        <rect class="tlt-hit" x="${(x - 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="16" height="16"/>
        <rect class="tlt-ms-dia" x="${(x - 3.2).toFixed(1)}" y="${(y - 3.2).toFixed(1)}" width="6.4" height="6.4"
          transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>
        <title>${escapeXml(m.name)}</title></g>`;
    });
    return body;
  }

  /* ---------- 本月 ---------- */

  private qChip(host: HTMLElement) {
    if (!this.q) return;
    const chip = el("button", "tlt-qchip", T("搜索：{q} ✕", { q: this.q }));
    chip.dataset.qclear = "1";
    chip.title = T("清掉搜索词");
    host.appendChild(chip);
  }

  private paneMonth(): HTMLElement {
    const p = el("div", "tlt-pane");
    const m = this.tasksInDim();
    const head = el("div", "tlt-pane-h");
    const label = { d: T("今天"), run: T("开展中"), w: T("本周"), m: T("本月"), q: T("本季度"), all: T("全部") }[this.taskDim];
    head.append(el("span", "", this.taskDim === "run"
      ? T("{l} · {a} 逾期 / {b} 有截止 / {c} 没截止", { l: label, a: m.late.length, b: m.todo.length, c: m.pending.length })
      : T("{l} · {a} 逾期 / {b} 要做 / {c} 已完成 / {d} 待排期", { l: label, a: m.late.length, b: m.todo.length, c: m.done.length, d: m.pending.length })));
    head.appendChild(el("span", "tlt-spacer"));
    const tags = Array.from(new Set(["工作", "个人", ...this.store.tasks.flatMap((t) => t.tags || [])]));
    const tf = el("div", "tlt-seg tlt-tag-seg");
    [{ v: null, t: T("全部") }, ...tags.map((t) => ({ v: t, t: t === "工作" ? T("工作") : t === "个人" ? T("个人") : t }))].forEach(({ v: tv, t }) => {
      const b = el("button", "tlt-seg-b" + (this.taskTag === tv ? " on" : ""), t);
      b.dataset.tag = tv ?? "";
      tf.appendChild(b);
    });
    head.appendChild(tf);
    const seg = el("div", "tlt-seg tlt-dim-seg");
    ([["d", T("今天")], ["run", T("开展中")], ["w", T("本周")], ["m", T("本月")], ["q", T("本季度")], ["all", T("全部")]] as const).forEach(([k, t]) => {
      const b2 = el("button", "tlt-seg-b" + (this.taskDim === k ? " on" : ""), t);
      b2.dataset.dim = k;
      seg.appendChild(b2);
    });
    head.appendChild(seg);
    head.appendChild(this.sortControl("task"));
    p.appendChild(head);
    this.qChip(p);
    const selDesc = this.proj ? this.store.projectDesc(this.proj) : "";
    if (selDesc) p.appendChild(el("div", "tlt-pane-sub", selDesc));
    const groups: [string, Task[], string][] = this.taskDim === "run" ? [
      [T("已逾期"), m.late, "#D98B5F"],
      [T("进行中 · 有截止"), m.todo, "#5B6CFF"],
      [T("进行中 · 没截止"), m.pending, "#8B7CF6"],
    ] : [
      [T("{l}逾期", { l: label }), m.late, "#D98B5F"],
      [T("{l}要做", { l: label }), m.todo, "#5B6CFF"],
      [T("{l}已完成", { l: label }), m.done, "#4FB59A"],
      [T("待排期（未分配时间）"), m.pending, "#8B7CF6"],
    ];
    groups.forEach(([name, list, color]) => {
      const g = el("div", "tlt-mgrp");
      const h = el("div", "tlt-mgh");
      const dot = el("span", "tlt-dot"); dot.style.background = color;
      h.append(dot, el("span", "", name), el("span", "tlt-mgc", String(list.length)));
      g.appendChild(h);
      if (!list.length) g.appendChild(el("div", "tlt-empty", T("没有")));
      const shown = this.taskDim === "run"
        ? [...list].sort((x, y) => (x.due || "9999-99-99").localeCompare(y.due || "9999-99-99"))
        : this.sortTasks(list);
      shown.forEach((t) => g.appendChild(this.taskRow(t)));
      p.appendChild(g);
    });
    return p;
  }

  /** 任务视图的维度：本周 / 本月 / 本季度 / 全部 */
  private tasksInDim() {
    const all = this.store.tasks.filter((t) => t.kind === "task")
      .filter((t) => !this.proj || t.project === this.proj)
      .filter((t) => !this.q || t.title.includes(this.q) || (t.project || "").includes(this.q) || (t.milestone || "").includes(this.q))
      .filter((t) => !this.taskTag ||
        (this.taskTag === "工作" || this.taskTag === "个人" ? t.scope === this.taskTag : (t.tags || []).includes(this.taskTag)));
    const dim = this.taskDim;
    const period = (dim === "all" || dim === "run" ? "all" : dim) as Period;
    const inDim = (d?: string) => (dim === "all" ? true : dim === "d" ? d === todayISO() : !!d && inPeriod(d, period));
    const today = todayISO();
    // 「开展中」：没完成的、排过期的；只有截止日的也算（时间轨按今天起算）
    if (dim === "run") {
      const open = all.filter((t) => !t.done && (t.start || t.due) && (!t.start || t.start <= today));
      return {
        late: open.filter((t) => t.due && t.due < today),
        todo: open.filter((t) => t.due && t.due >= today),
        done: [],
        pending: open.filter((t) => !t.due),
      };
    }
    // 「今天」：逾期的一律算今天的活儿；已完成的按"今天完成的"算
    const lateIn = (d: string) => (dim === "d" ? d < today : inDim(d));
    const doneIn = (t: Task) => (dim === "d" ? t.doneAt === today || t.due === today : inDim(t.due));
    return {
      late: all.filter((t) => !t.done && t.due && t.due < today && lateIn(t.due)),
      todo: all.filter((t) => !t.done && t.due && t.due >= today && inDim(t.due)),
      done: all.filter((t) => t.done && doneIn(t)),
      pending: all.filter((t) => !t.done && !t.due),
    };
  }

  /**
   * 子项进度环：只有带子项的任务才画；点一下就地展开子项。
   * 环里写百分比（不再只是悬停才看得到 3/7）——环＝活干完了多少，时间轨＝日历走了多少。
   */
  private stepRing(t: Task): HTMLElement {
    const total = t.steps.length;
    const done = t.steps.filter((x) => x.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const ring = el("span", "tlt-stepring" + (t.done ? " all" : done === total ? " ready" : ""));
    ring.dataset.steps = t.id;
    ring.title = T("子项 {a}/{b}（{p}%）· 点一下展开", { a: done, b: total, p: pct });
    const R = 10.2, C = 2 * Math.PI * R, CX = 13;
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 26 26");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    const bg = createSvg("circle");
    bg.setAttribute("class", "tlt-sr-bg");
    bg.setAttribute("cx", String(CX)); bg.setAttribute("cy", String(CX)); bg.setAttribute("r", String(R));
    const fg = createSvg("circle");
    fg.setAttribute("class", "tlt-sr-fg");
    fg.setAttribute("cx", String(CX)); fg.setAttribute("cy", String(CX)); fg.setAttribute("r", String(R));
    fg.setAttribute("stroke-dasharray", String(C));
    fg.setAttribute("stroke-dashoffset", String(Math.max(0, C * (1 - pct / 100))));
    const txt = createSvg("text");
    txt.setAttribute("class", "tlt-sr-t");
    txt.setAttribute("x", String(CX)); txt.setAttribute("y", String(CX + 2.6));
    txt.setAttribute("text-anchor", "middle");
    txt.textContent = `${pct}%`;
    svg.append(bg, fg, txt);
    ring.appendChild(svg);
    return ring;
  }

  /**
   * 时间轨：开始 → 截止这条轴上，今天走到哪儿了。
   * 跟上面的环分工明确——环看"活干完了多少"，这条看"日历走了多少"。
   * 没填开始日期的按今天算起点（用户口径：只有截止日也算开展中）。
   * 开始、截止两个日期就住在这条轨道的两端，不再散在标签堆里。
   */
  private timeRail(t: Task): HTMLElement | null {
    const today = todayISO();
    const start = t.start || "";
    const due = t.due || "";
    if (!start && !due) return null;
    const DAY = 86400000;
    const days = (x: string, y: string) => Math.round((Date.parse(y) - Date.parse(x)) / DAY);
    const from = start || today;
    const box = el("span", "tlt-rail" + (t.done ? " done" : ""));
    box.appendChild(el("span", "tlt-rail-d", start ? start.slice(5) : T("今")));
    if (due) {
      const bar = el("span", "tlt-rail-bar");
      const a = Date.parse(from), b = Date.parse(due);
      const span = Math.max(1, b - a);
      const pct = Math.min(100, Math.max(0, Math.round(((Date.parse(today) - a) / span) * 100)));
      const fill = el("i");
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      const now = el("span", "tlt-rail-now");
      now.style.left = pct + "%";
      bar.appendChild(now);
      box.appendChild(bar);
      box.appendChild(el("span", "tlt-rail-d", due.slice(5)));
    }
    const left = due ? days(today, due) : 0;
    const hasStart = !!start;
    let text: string, mod = "";
    if (t.done) {
      text = t.doneAt ? T("完成于 {d}", { d: t.doneAt.slice(5) }) : T("已完成");
    } else if (due && left < 0) {
      text = T("逾期 {n} 天", { n: -left }); mod = "late";
    } else if (due && left === 0) {
      text = T("今天到期"); mod = "warn";
    } else if (due && hasStart && start > today) {
      text = T("{n} 天后开始", { n: days(today, start) });
    } else if (due) {
      text = T("剩 {n} 天", { n: left });
    } else {
      text = T("进行中 · 第 {n} 天", { n: Math.max(1, days(start, today) + 1) });
    }
    box.appendChild(el("span", "tlt-rail-s" + (mod ? " " + mod : ""), text));
    box.title = due
      ? T("开始 {a} · 截止 {b} · 今天走了 {p}%", { a: start || T("（未填，按今天算）"), b: due, p: Math.min(100, Math.max(0, Math.round(((Date.parse(today) - Date.parse(from)) / Math.max(1, Date.parse(due) - Date.parse(from))) * 100))) })
      : T("开始 {a} · 没有截止", { a: start });
    return box;
  }

  private stepBlock(t: Task): HTMLElement {
    const box = el("div", "tlt-steps");
    t.steps.forEach((st, i) => {
      const row = el("div", "tlt-step" + (st.done ? " done" : ""));
      const cb = el("i", "tlt-scb" + (st.done ? " on" : ""));
      cb.dataset.step = `${t.id}|${i}`;
      const txt = el("span", "tlt-step-t", st.text);
      txt.dataset.steptext = `${t.id}|${i}`;
      const del = el("button", "tlt-step-del", "×");
      del.dataset.stepdel = `${t.id}|${i}`;
      del.title = T("删掉这条子项");
      row.append(cb, txt, del);
      box.appendChild(row);
    });
    const add = el("input", "tlt-step-add");
    add.dataset.stepadd = t.id;
    add.placeholder = T("加一条子项，回车");
    box.appendChild(add);
    return box;
  }

  /** 项目菜单：新建里程碑 / 归档项目 / 打开文件 */
  /** 侧栏窄，排序用一个小菜单（只排项目，跟里程碑/任务互不影响） */
  private sidebarSortMenu(anchor: HTMLElement) {
    this.sortMenu(anchor, "project");
  }

  private projectMenu(anchor: HTMLElement, p: string, at?: { x: number; y: number }) {
    const file = this.app.vault.getAbstractFileByPath(`${this.cfg.tasksFolder}/${p}.md`);
    popMenu(anchor, [
      { label: this.store.isPinned(p) ? T("取消置顶") : T("置顶项目"), onClick: () => { void (async () => {
        await this.store.setProjectPin(p, !this.store.isPinned(p));
        await this.store.load();
        await this.render();
      })(); } },
      { label: T("新建里程碑"), onClick: () => this.promptMilestone(p) },
      { label: T("归档项目"), onClick: () => { if (file instanceof TFile) confirmArchiveProject(this.app, this.store, file, () => this.render()); } },
      { label: T("打开项目文件"), onClick: () => {
        if (!(file instanceof TFile)) return;
        const leaf = this.app.workspace.getLeaf(true) as unknown as { openFile?: (f: TFile) => Promise<void> };
        if (leaf && typeof leaf.openFile === "function") void leaf.openFile(file);
        else new Notice(T("当前窗口不支持打开文件"));
      } },
    ], "right", at);
  }

  /** 已归档项目：还原 / 打开文件 */
  private archivedMenu(anchor: HTMLElement, f: TFile, at?: { x: number; y: number }) {
    popMenu(anchor, [
      { label: T("还原到开展中"), onClick: () => confirmRestoreProject(this.app, this.store, f, () => this.render()) },
      { label: T("打开项目文件"), onClick: () => this.openProjectFile(f) },
    ], "right", at);
  }

  private openProjectFile(f: TFile) {
    const leaf = this.app.workspace.getLeaf(true) as unknown as { openFile?: (x: TFile) => Promise<void> };
    if (leaf && typeof leaf.openFile === "function") void leaf.openFile(f);
    else new Notice(T("当前窗口不支持打开文件"));
  }

  /** 两侧栏折叠：写进设置（重开 Obsidian 也记得），然后重画 */
  private async setPanels(patch: { sideCollapsed?: boolean; railCollapsed?: boolean }) {
    Object.assign(this.cfg, patch);
    const p = this.plugin as unknown as { saveSettings?: () => Promise<void> };
    try { await p.saveSettings?.(); } catch { /* 存不下也不影响这次折叠 */ }
    await this.render();
  }

  /** 里程碑菜单：重命名 / 打开详情 / 展开收起 */
  private milestoneMenu(anchor: HTMLElement, m: { name: string; project: string; tasks: Task[] }, at?: { x: number; y: number }) {
    popMenu(anchor, [
      { label: T("重命名里程碑"), onClick: () => this.promptRenameMilestone(m) },
      { label: T("打开详情"), onClick: () => new MilestonePeekModal(this.app, this.store, m, () => {
        this.tab = "ms"; this.proj = m.project; void this.render();
      }).open() },
      { label: this.expanded.has(m.name) ? T("收起") : T("展开"), onClick: async () => {
        if (this.expanded.has(m.name)) this.expanded.delete(m.name); else this.expanded.add(m.name);
        await this.render();
      } },
    ], "right", at);
  }

  private promptRenameMilestone(m: { name: string; project: string }) {
    new PromptModal(this.app, T("重命名里程碑"), T("里程碑名（项目文件里的 ## 小节）"), async (name) => {
      const ok = await this.store.renameMilestone(m.project, m.name, name);
      if (!ok) { new Notice(T("没改成：名字空了、同名已存在，或原来的小节已不在")); return; }
      if (this.expanded.delete(m.name) ) this.expanded.add(name);
      await this.store.load();
      await this.render();
      new Notice(T("已重命名为：{n}", { n: name }), 3000);
    }, m.name).open();
  }

  /** 面板跳转入口：切页签 / 维度（可选） */
  async focusOn(opts: { tab?: string; dim?: string; proj?: string | null }) {
    if (opts.tab) this.tab = opts.tab;
    if (opts.dim) this.taskDim = opts.dim as TaskDim;
    if (opts.proj !== undefined) {
      this.proj = opts.proj;
      this.plugin.setActiveProject(this.proj);        // 两边同步，但不再回调渲染（setActiveProject 只画面板）
    }
    await this.render();
  }

  /** 新建任务：已经点了项目 / 里程碑就把它们带上（不用再手选一遍） */
  private openNewTask() {
    const proj = this.proj || this.msSel?.project || undefined;
    const milestone = proj && this.msSel && this.msSel.project === proj ? this.msSel.name : undefined;
    new QuickTaskModal(this.app, this.store, () => this.refresh(), { project: proj, milestone }).open();
  }

  private promptMilestone(p: string) {
    new PromptModal(this.app, T("新建里程碑"), T("里程碑名（项目文件里的 ## 小节）"), async (name) => {
      const ok = await this.store.addMilestone(p, name);
      if (!ok) { new Notice(T("没加成：名字空了，或者这个里程碑已经在了")); return; }
      await this.store.load();
      await this.render();
      new Notice(T("已在 {p} 加了里程碑：{n}", { p, n: name }), 3000);
    }).open();
  }

  /** 任务菜单：详情 / 删除（任务不做归档，归档是项目级的） */
  private taskMenu(t: Task, at?: { x: number; y: number }, anchor?: HTMLElement) {
    const file = this.app.vault.getAbstractFileByPath(t.file);
    if (!(file instanceof TFile)) return;
    popMenu(anchor ?? this.contentEl, [
      { label: T("打开详情"), onClick: () => new TaskModal(this.app, this.store, t, () => this.render()).open() },
      { label: T("标记完成（连同子项）"), onClick: () => { void (async () => {
        for (let i = 0; i < t.steps.length; i++) {
          if (!t.steps[i].done) await this.store.setStepDone(t, i, true);
        }
        const fresh = this.findTask(t.id);
        if (fresh && !fresh.done) await this.store.toggleTask(fresh);
        await this.refresh();
      })(); } },
      { label: T("删除任务"), danger: true, onClick: () => confirmDeleteTask(this.app, this.store, { file, line: t.line, title: t.title, milestone: t.milestone, done: t.done }, () => this.render()) },
    ], "right", at);
  }

  private taskRow(t: Task): HTMLElement {
    const r = el("div", "tlt-task" + (t.done ? " done" : ""));
    r.dataset.task = t.id;
    const cb = el("i", "tlt-cb" + (t.done ? " on" : ""));
    cb.dataset.ck = t.id;
    r.appendChild(cb);
    const body = el("div", "tlt-task-b");
    const title = el("div", "tlt-task-t");
    if (t.pri >= 2) {
      // 高＝橙色点，紧急＝红点（更大一圈）；紧急另外在元信息里写一个「紧急」小标签，
      // 光靠颜色分不清高与紧急（用户提过）
      const pr = el("i", "tlt-pd" + (t.pri >= 3 ? " u" : ""));
      title.appendChild(pr);
    }
    title.appendChild(document.createTextNode(t.title));
    body.appendChild(title);
    const meta = el("div", "tlt-task-m");
    if (t.milestone) meta.appendChild(el("span", "tlt-tag", t.milestone));
    // 开始 / 截止不再写在标签堆里——它们住在右边的时间轨上；只有两边都没有才写「待排期」
    if (!t.start && !t.due) meta.appendChild(el("span", "", T("待排期")));
    if (t.est !== undefined) meta.appendChild(el("span", "tlt-wl", `${t.est} ${T("人天")}`));
    else if (t.wl) meta.appendChild(el("span", "tlt-wl", `${t.wl}%`));
    if (t.scope === "个人") meta.appendChild(el("span", "tlt-tag own", T("个人")));
    (t.tags || []).forEach((tg) => meta.appendChild(el("span", "tlt-tag", tg)));
    if (t.owners.length) meta.appendChild(el("span", "", t.owners.join(T("、"))));
    if (t.files.length) meta.appendChild(el("span", "", `▤ ${t.files.length}`));
    body.appendChild(meta);
    r.appendChild(body);
    // 右列：环（子项完成度）＋ 时间轨（时间走到哪了）
    const aside = el("div", "tlt-task-x");
    if (t.steps.length) aside.appendChild(this.stepRing(t));
    const rail = this.timeRail(t);
    if (rail) aside.appendChild(rail);
    if (aside.childElementCount) r.appendChild(aside);
    if (this.expandedSteps.has(t.id)) r.appendChild(this.stepBlock(t));
    r.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.taskMenu(t, { x: ev.clientX, y: ev.clientY }, r);
    });
    return r;
  }

  /* ---------- 人员 ---------- */

  private paneStaff(): HTMLElement {
    const p = el("div", "tlt-pane");
    const dim = this.staffDim;
    const rows = this.store.staff.map((s) => ({
      s, sat: workloadBreakdown(this.store.tasks, s.name, dim, { capacity: s.capacity, days: s.days }),
    }));
    const over = rows.filter((r) => r.sat.pct >= 100).length;
    const idle = rows.filter((r) => r.sat.pct < 60).length;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.sat.pct, 0) / rows.length) : 0;
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", T("{n} 人 · 平均 {a}% · {o} 人超载 · {i} 人偏闲", { n: rows.length, a: avg, o: over, i: idle })));
    head.appendChild(el("span", "tlt-src", this.cfg.teamFolder));
    head.appendChild(el("span", "tlt-spacer"));
    const add = el("button", "tlt-btn", T("＋ 添加成员"));
    add.dataset.addstaff = "1";
    head.appendChild(add);
    p.appendChild(head);
    // 时间筛选：本月 / 下个月 / 全部
    const seg = el("div", "tlt-seg tlt-dim-seg");
    ([["m", T("本月")], ["nm", T("下个月")], ["all", T("全部")]] as const).forEach(([k, label]) => {
      const b = el("button", "tlt-seg-b" + (dim === k ? " on" : ""), label);
      b.dataset.staffdim = k;
      seg.appendChild(b);
    });
    const segRow = el("div", "tlt-pane-h");
    segRow.appendChild(seg);
    p.appendChild(segRow);
    p.appendChild(el("div", "tlt-hint", T("档案来自 crew/<姓名>.md 的 frontmatter——岗位、产能、在岗天数都在文件里改；TLT 只读，任务侧只负责分配与统计。")));
    p.appendChild(el("div", "tlt-hint", dim === "all"
      ? T("口径「全部」：所有未完成任务都算，分母＝一个季度的产能（每人 {n} 人天）。同一套算法：任务要填了工作量才进得去。", { n: staffWindowDays("all", 5, 100) })
      : T("百分比＝{w}内未完成任务的人天 ÷ 该月可用人天。任务要同时满足：派给了这个人、有截止日（落在{w}）、填了工作量；缺哪样卡片上会写出来。", { w: dim === "nm" ? T("下个月") : T("本月") })));

    const grid = el("div", "tlt-staffgrid");
    rows.forEach(({ s, sat }) => {
      const card = el("div", "tlt-scard" + (sat.pct >= 100 ? " hot" : ""));
      card.dataset.staff = s.name;
      const h = el("div", "tlt-sh");
      const av = el("span", "tlt-av", s.name.slice(-2));
      av.style.background = s.color;
      const who = el("div", "tlt-who");
      who.append(el("div", "tlt-sname", s.name), el("div", "tlt-srole", `${s.role || "—"}${s.days < 5 ? T(" · 每周 {n} 天", { n: s.days }) : ""}`));
      // 没有可算的数据就显示 —，别拿一个假的 0% 糊人
      const pct = el("span", "tlt-spct", sat.hasEst ? sat.pct + "%" : "—");
      if (!sat.hasEst) pct.title = T("本周期没有能算的工作量（任务没截止日或没填工作量）");
      h.append(av, who, pct);
      card.appendChild(h);
      const bar = el("div", "tlt-sbar");
      const fill = el("i"); fill.style.width = `${Math.min(100, sat.pct)}%`;
      if (sat.pct >= 100) fill.addClass("hot"); else if (sat.pct < 60) fill.addClass("idle");
      bar.appendChild(fill);
      card.appendChild(bar);
      const meta = el("div", "tlt-smeta");
      meta.append(el("span", "", T("{n} 项任务", { n: sat.mine.length })),
        el("span", "", T("本周期 {k} 项", { k: sat.inWin.length })),
        el("span", "", T("{a} / {b} 人天", { a: sat.sum, b: sat.avail })));
      card.appendChild(meta);
      // 缺什么就说什么：不然 0% 永远像个 bug
      const gaps: string[] = [];
      if (sat.noEst.length) gaps.push(T("{n} 项没填工作量", { n: sat.noEst.length }));
      // 「全部」口径下，没排期的任务本来就都算进来了，不用再当缺口报
      if (dim !== "all" && sat.noDue.length) gaps.push(T("{n} 项没排期", { n: sat.noDue.length }));
      if (sat.otherPeriod) gaps.push(T("{n} 项不在本周期", { n: sat.otherPeriod }));
      if (gaps.length) card.appendChild(el("div", "tlt-sgap", gaps.join(" · ")));
      grid.appendChild(card);
    });
    p.appendChild(grid);
    if (!rows.length) p.appendChild(el("div", "tlt-empty", T("{dir} 里还没有人员档案", { dir: this.cfg.teamFolder })));
    return p;
  }

  /* ---------- 想法 ---------- */

  private paneIdeas(): HTMLElement {
    const p = el("div", "tlt-pane");
    const cap = el("div", "tlt-cap");
    const i = el("input");
    i.placeholder = T("随手记一句，前面可以加 #标签，例：#论文 #灵感 把常用脚本整理成工具");
    i.dataset.ideanew = "1";
    const plus = el("button", "tlt-btn lg", T("＋ 随手记"));
    plus.dataset.ideanewmodal = "1";
    cap.append(el("span", "tlt-plus", "✦"), i, plus);
    p.appendChild(cap);
    p.appendChild(el("div", "tlt-hint", T("用 # 打标签，想打几个打几个。回车收录；也可以点「＋ 随手记」用表单。")));
    const prev = el("div", "tlt-idea-prev");
    prev.dataset.ideaprev = "1";
    p.appendChild(prev);

    const allTags = Array.from(new Set([...this.store.tags, ...this.store.ideas.flatMap((i) => ideaFilterTags(i))]));
    const shown = this.store.ideas
      .filter((i) => !this.q || i.title.includes(this.q) || (i.body || "").includes(this.q))
      .filter((i) => !this.ideaTags.size || ideaFilterTags(i).some((t) => this.ideaTags.has(t)));
    const stale = this.store.ideas.filter((x) => (Date.now() - D(x.at).getTime()) / 864e5 > 14).length;
    const meta = el("div", "tlt-ideas-meta");
    meta.append(el("span", "", T("{n} 条随手记", { n: shown.length })),
      el("span", "tlt-sep-dot", "·"),
      el("span", "", stale ? T("{n} 条超过两周没动", { n: stale }) : T("没有搁太久的")));
    p.appendChild(meta);

    if (allTags.length) {
      const tf = el("div", "tlt-tagpick");
      const all = el("button", "tlt-tagp" + (this.ideaTags.size ? "" : " on"), T("全部"));
      all.dataset.itag = "";
      tf.appendChild(all);
      allTags.forEach((t) => {
        const b = el("button", "tlt-tagp" + (this.ideaTags.has(t) ? " on" : ""), t);
        b.dataset.itag = t;
        tf.appendChild(b);
      });
      p.appendChild(tf);
    }

    const grid = el("div", "tlt-ideagrid");
    shown.forEach((it) => {
      const c = el("div", "tlt-icard");
      c.dataset.idea = it.id;
      const h = el("div", "tlt-ih");
      ideaTags(it).forEach((tg) => h.append(el("span", "tlt-chip-s", tg)));
      if (!ideaTags(it).length) h.append(el("span", "tlt-itype", T("未打标签")));
      c.append(h, el("div", "tlt-it", it.title));
      if (it.body) {
        const b = el("div", "tlt-ib");
        // 标题 / 列表 / 待办 都能认；待办可以**直接点**，点一下就写回文件
        miniMarkdown(it.body, b, {
          onCheck: (i) => { void this.checkIdeaBox(it, i); },
        });
        c.appendChild(b);
      }
      const meta = el("div", "tlt-im");
      meta.append(el("span", "", it.at));
      c.appendChild(meta);
      grid.appendChild(c);
    });
    p.appendChild(grid);
    if (!this.store.ideas.length) p.appendChild(el("div", "tlt-empty", T("还没有随手记。一行就能记，正文可以永远不写。")));
    return p;
  }

  /** 卡片上点待办：翻转正文里第 i 个勾选并写回 */
  private async checkIdeaBox(it: Idea, i: number) {
    const next = toggleMdCheckbox(it.body || "", i);
    if (next === it.body) return;
    it.body = next;
    await this.store.updateIdea(it);
    await this.render();
  }

  /* ---------- 里程碑 ---------- */

  /** 随手画：功能预留 */
  private paneDraw(): HTMLElement {
    const p = el("div", "tlt-pane");
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", T("随手画 · 功能预留")));
    p.appendChild(head);
    const box = el("div", "tlt-emptybox");
    box.append(
      el("div", "tlt-empty-k", T("随手画")),
      el("div", "tlt-empty-d", T("先占个位置：随手记里的草图、白板、截图批注会在这里。还没有实现，标记为预留。")),
    );
    const chips = el("div", "tlt-quick");
    [T("手绘草图"), T("思维导图"), T("截图批注"), T("与随手记互转")].forEach((t) => chips.appendChild(el("span", "tlt-chip off", t)));
    box.appendChild(chips);
    p.appendChild(box);
    return p;
  }

  /** 一天里每块一个色相：散列取色（稳定），撞了就往下一个顺延，保证相邻/重叠的块不撞色 */
  private hueFor(key: string, used: Set<string>): string {
    let i = 0;
    for (let k = 0; k < key.length; k++) i = (i * 31 + key.charCodeAt(k)) >>> 0;
    let h = BLK_PALETTE[i % BLK_PALETTE.length];
    let guard = 0;
    while (used.has(h) && guard < BLK_PALETTE.length) {
      h = BLK_PALETTE[(BLK_PALETTE.indexOf(h) + 1) % BLK_PALETTE.length];
      guard += 1;
    }
    used.add(h);
    return h;
  }

  /**
   * 时间段重叠的块并排显示，互不遮挡。
   * 做法：按开始时间扫一遍——每个块放进"最早空出来的那条车道"，
   * 同一簇（互相重叠的一串）共用车道数，最后每块拿到 lane / lanes。
   */
  private laneLayout(items: { a: number; b: number }[]): { lane: number; lanes: number }[] {
    const res = items.map(() => ({ lane: 0, lanes: 1 }));
    const order = items.map((_, i) => i).sort((x, y) => items[x].a - items[y].a || items[x].b - items[y].b);
    let cluster: number[] = [];
    let clusterEnd = -1;
    let laneEnds: number[] = [];
    const flush = () => {
      const n = Math.max(1, laneEnds.length);
      cluster.forEach((i) => { res[i].lanes = n; });
      cluster = []; laneEnds = []; clusterEnd = -1;
    };
    for (const i of order) {
      const it = items[i];
      if (cluster.length && it.a >= clusterEnd) flush();          // 跟上一簇不搭界：收掉
      let L = laneEnds.findIndex((end) => end <= it.a);
      if (L < 0) { L = laneEnds.length; laneEnds.push(it.b); } else laneEnds[L] = it.b;
      res[i].lane = L;
      cluster.push(i);
      clusterEnd = Math.max(clusterEnd, it.b);
    }
    if (cluster.length) flush();
    return res;
  }

  /** 某天的所有日程块：计划块（排期日优先）+ 记录块，按开始时间排 */
  private blocksOn(date: string): CalBlock[] {
    const plans: CalBlock[] = this.store.tasks
      .filter((t) => t.st && dayOfBlock(t) === date)
      .map((t) => ({
        kind: "plan" as const, item: t, title: t.title,
        a: hhmmToMin(t.st) || DAY_FROM, b: hhmmToMin(t.en) || (hhmmToMin(t.st) || DAY_FROM) + 30,
        st: t.st, en: t.en, done: t.done,
      }));
    const recs: CalBlock[] = this.store.logs
      .filter((l) => l.due === date)
      .map((l) => ({
        kind: "log" as const, item: l, title: l.title,
        a: hhmmToMin(l.st) || DAY_FROM, b: hhmmToMin(l.en) || (hhmmToMin(l.st) || DAY_FROM) + 30,
        st: l.st, en: l.en, done: false,
      }));
    return [...plans, ...recs].sort((x, y) => x.a - y.a || x.b - y.b);
  }

  /** 一整年每天的块数（年视图热力图用；一次算好，别一天一天去扫） */
  private yearCounts(year: number): Map<string, number> {
    const map = new Map<string, number>();
    const bump = (d?: string) => { if (d && d.startsWith(`${year}-`)) map.set(d, (map.get(d) || 0) + 1); };
    this.store.tasks.filter((t) => t.st).forEach((t) => bump(dayOfBlock(t)));
    this.store.logs.forEach((l) => bump(l.due));
    return map;
  }

  /** 打开一块日程对应的详情 */
  private openBlock(b: CalBlock) {
    if (b.kind === "plan") new TaskModal(this.app, this.store, b.item, () => this.refresh()).open();
    else new LogModal(this.app, this.store, b.item, () => this.refresh()).open();
  }

  /** 日历顶部的档位切换 + 导航标签 */
  private calBar(): HTMLElement {
    const p = this.store.settings.weekStart === 0 ? 0 : 1;
    const sel = this.viewDate;
    const bar = el("div", "tlt-dbar");
    const seg = el("div", "tlt-seg tlt-calview");
    ([["d", T("日")], ["w", T("周")], ["m", T("月")], ["y", T("年")]] as const).forEach(([k, label]) => {
      const b = el("button", "tlt-seg-b" + (this.calView === k ? " on" : ""), label);
      b.dataset.calview = k;
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    const prev = el("button", "tlt-dnav", "‹"); prev.dataset.dnav = "-1";
    const next = el("button", "tlt-dnav", "›"); next.dataset.dnav = "1";
    const lab = el("div", "tlt-dlabel");
    if (this.calView === "d") {
      const dl = D(sel);
      lab.append(T("{m} 月 {d} 日", { m: dl.getMonth() + 1, d: dl.getDate() }));
      lab.createEl("em", { text: T("周{w}", { w: weekday(dl.getDay()) }) + (sel === todayISO() ? T(" · 今天") : "") });
    } else if (this.calView === "w") {
      const days = weekDays(sel, p);
      const a = D(days[0]), b = D(days[6]);
      lab.append(T("{y} 年 {m} 月 {d} 日", { y: a.getFullYear(), m: a.getMonth() + 1, d: a.getDate() }));
      lab.createEl("em", { text: T("到 {m} 月 {d} 日（第 {w} 周）", { m: b.getMonth() + 1, d: b.getDate(), w: isoWeek(days[0]) }) });
    } else if (this.calView === "m") {
      const dl = D(sel);
      lab.append(T("{y} 年 {m} 月", { y: dl.getFullYear(), m: dl.getMonth() + 1 }));
      const inMonth = monthGrid(sel, p).filter((k) => k.startsWith(`${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, "0")}-`));
      lab.createEl("em", { text: T("{n} 条日程", { n: inMonth.reduce((n, k) => n + this.blocksOn(k).length, 0) }) });
    } else {
      const dl = D(sel);
      lab.append(T("{y} 年", { y: dl.getFullYear() }));
      lab.createEl("em", { text: T("{n} 条日程", { n: [...this.yearCounts(dl.getFullYear()).values()].reduce((a, b) => a + b, 0) }) });
    }
    const todayBtn = el("button", "tlt-btn", T("回到今天")); todayBtn.dataset.today = "1";
    bar.append(prev, lab, next, todayBtn, el("span", "tlt-spacer"));
    if (this.calView === "d") {
      bar.appendChild(el("span", "tlt-dhint", T("{a} 条记录 · {b} 未排", { a: this.logsOn(sel).length, b: this.unscheduled(sel).length })));
    }
    return bar;
  }

  /**
   * 周视图：7 列 × 同一条时间轴，列头可点（切到那天）。
   * 块的写法照 macOS 日历：标题 + 起止时间；计划块实线左边条、记录块虚线。
   */
  private paneCalWeek(): HTMLElement {
    const p = el("div", "tlt-pane");
    const start = this.store.settings.weekStart === 0 ? 0 : 1;
    const days = weekDays(this.viewDate, start);
    const HOUR = 30, GUTTER = 52;

    p.appendChild(this.rhythm());          // 节奏保持在上面：切视图它不动
    p.appendChild(this.calBar());          // 档位切换 + 导航，四个视图共用
    const head = el("div", "tlt-whead");
    head.appendChild(el("div", "tlt-wgut"));
    days.forEach((k) => {
      const d = D(k);
      const c = el("div", "tlt-wd" + (k === todayISO() ? " today" : ""));
      c.dataset.day = k;                       // 点列头＝切到那天（沿用日视图的日期点击逻辑）
      c.append(el("span", "tlt-wdw", weekday(d.getDay())), el("span", "tlt-wdn", String(d.getDate())));
      head.appendChild(c);
    });
    p.appendChild(head);

    const scroll = el("div", "tlt-wscroll");
    const inner = el("div", "tlt-winner");
    inner.style.height = `${((DAY_TO - DAY_FROM) / 60) * HOUR}px`;
    for (let mnt = DAY_FROM; mnt <= DAY_TO; mnt += 60) {
      const h = el("div", "tlt-hour");
      h.style.top = `${((mnt - DAY_FROM) / 60) * HOUR}px`;
      h.appendChild(el("span", "", minToHHMM(mnt)));
      inner.appendChild(h);
    }
    const cols = el("div", "tlt-wcols");
    cols.appendChild(el("div", "tlt-wgut2"));        // 第一格留给左侧刻度，别让周一到周五挤进 52px 里
    inner.appendChild(cols);
    days.forEach((k) => {
      const col = el("div", "tlt-wcol" + (k === todayISO() ? " today" : "") + (k === this.viewDate ? " sel" : ""));
      col.dataset.day = k;
      cols.appendChild(col);
      const blocks = this.blocksOn(k);
      const lay = this.laneLayout(blocks.map((x) => ({ a: x.a, b: x.b })));
      blocks.forEach((x, i) => {
        const { lane, lanes } = lay[i];
        const blk = el("div", `tlt-wblk ${x.kind}` + (x.done ? " done" : "") + (lanes > 1 ? " lane" : ""));
        blk.dataset.task = x.kind === "plan" ? x.item.id : "";
        blk.dataset.log = x.kind === "log" ? x.item.id : "";
        blk.dataset.day = k;
        blk.style.top = `${((x.a - DAY_FROM) / 60) * HOUR}px`;
        blk.style.height = `${Math.max(20, ((x.b - x.a) / 60) * HOUR)}px`;
        if (lanes > 1) {
          blk.style.left = `calc((100% - 3px) * ${(lane / lanes).toFixed(4)})`;
          blk.style.width = `calc((100% - 3px) / ${lanes} - 2px)`;
        }
        blk.style.setProperty("--hue", this.hueFor(x.item.id, new Set<string>()));
        blk.title = `${x.title}\n${x.st || ""}${x.en ? "–" + x.en : ""} · ${x.kind === "plan" ? T("计划") : T("记录")}`;
        blk.append(el("b", "tlt-wbt", x.title),
          el("span", "tlt-wbm", `${x.st || ""}${x.en ? "–" + x.en : ""}`));
        this.wireWeekDrag(blk, x, k);
        col.appendChild(blk);
      });
    });
    scroll.appendChild(inner);
    p.appendChild(scroll);
    void GUTTER;
    return p;
  }

  /** 周视图里拖块：上下改时间、左右换天（任务→改排期日；完成的连带把完成日挪过去；记录→换到那天的记录里） */
  private wireWeekDrag(blk: HTMLElement, x: CalBlock, day: string) {
    let mode: "move" | null = null;
    let moved = false;
    let y0 = 0, x0 = 0, a0 = x.a, b0 = x.b;
    let curA = x.a, shiftDay = 0;
    const col = blk.parentElement;
    // 列宽拿不到（还没布局）时按 120px 估，免得横向拖一下跳到很远的天
    const colW = () => { const w = col ? col.getBoundingClientRect().width : 0; return w > 8 ? w : 120; };
    const dayAt = (dx: number) => {
      const start = this.store.settings.weekStart === 0 ? 0 : 1;
      const days = weekDays(this.viewDate, start);
      const idx = days.indexOf(day);
      const move = Math.round(dx / colW());
      return days[Math.max(0, Math.min(6, idx + move))] || day;
    };
    const onMove = (ev: PointerEvent) => {
      if (!mode) return;
      ev.preventDefault();
      const dy = ev.clientY - y0;
      const dx = ev.clientX - x0;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;      // 动过就不当点击了
      const snap = (m: number) => Math.round(m / 15) * 15;
      curA = Math.max(DAY_FROM, Math.min(DAY_TO - 15, snap(a0 + (dy / HOUR_css()) * 60)));
      blk.style.top = `${((curA - DAY_FROM) / 60) * HOUR_css()}px`;
      const target = dayAt(dx);
      shiftDay = target === day ? 0 : (D(target).getTime() - D(day).getTime()) / 86400000;
      blk.classList.toggle("shifting", shiftDay !== 0);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!mode) return;
      mode = null;
      blk.classList.remove("dragging", "shifting");
      void (async () => {
        const st = minToHHMM(curA), en = minToHHMM(curA + (b0 - a0));
        if (x.kind === "plan") {
          if (shiftDay) {
            const target = addDays(day, shiftDay);
            await this.store.setField(x.item, "plan", target);
            // 已经完成的：完成日也跟着挪——用户就是这么理解这块的（"哪天做了这件事"）
            if (x.item.done) await this.store.setDoneAt({ ...x.item, plan: target }, target);
          }
          if (curA !== a0 || shiftDay) { await this.store.setField(x.item, "st", st); await this.store.setField(x.item, "en", en); }
          new Notice(shiftDay ? T("已挪到 {d} {a}–{b}", { d: addDays(day, shiftDay), a: st, b: en }) : T("已改到 {a}–{b}", { a: st, b: en }), 2500);
        } else {
          if (shiftDay) await this.store.moveLogToDate(x.item, addDays(day, shiftDay));
          await this.store.setLogTime(x.item, st, en);
          new Notice(shiftDay ? T("记录已挪到 {d}", { d: addDays(day, shiftDay) }) : T("已改到 {a}–{b}", { a: st, b: en }), 2500);
        }
        await this.refresh();
      })();
    };
    blk.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      mode = "move";
      y0 = ev.clientY; x0 = ev.clientX; a0 = x.a; b0 = x.b; curA = x.a;
      blk.classList.add("dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    blk.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (moved) { moved = false; return; }                   // 刚才是拖，不是点
      this.openBlock(x);                                      // 点击＝看详情、直接改
    });
    blk.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); this.blockMenu(x.kind, x.item, { x: ev.clientX, y: ev.clientY }); });
  }

  /**
   * 月视图：6×7 格，每格最多 4 行（前 3 条 + 「+N 个」）。
   * 格子里只做"看一眼密度 + 点开详情"，不给拖拽（macOS 也是切到日/周再动）。
   */
  private paneCalMonth(): HTMLElement {
    const p = el("div", "tlt-pane");
    const start = this.store.settings.weekStart === 0 ? 0 : 1;
    const sel = D(this.viewDate);
    const monthKey = `${sel.getFullYear()}-${String(sel.getMonth() + 1).padStart(2, "0")}`;
    p.appendChild(this.rhythm());
    p.appendChild(this.calBar());
    const grid = el("div", "tlt-mgrid");
    const head = el("div", "tlt-mhead");
    for (let i = 0; i < 7; i++) head.appendChild(el("div", "tlt-mhd", weekday((start + i) % 7)));
    p.appendChild(head);
    monthGrid(this.viewDate, start).forEach((k) => {
      const d = D(k);
      const cell = el("div", "tlt-mcell"
        + (k.startsWith(monthKey) ? "" : " out")
        + (k === todayISO() ? " today" : "")
        + (k === this.viewDate ? " sel" : ""));
      cell.dataset.day = k;
      const num = el("div", "tlt-mdnum");
      num.append(el("span", "", String(d.getDate())));
      const blocks = this.blocksOn(k);
      if (blocks.length) num.appendChild(el("span", "tlt-mdc", T("{n} 条", { n: blocks.length })));
      cell.appendChild(num);
      const list = el("div", "tlt-mlist");
      const shown = blocks.slice(0, blocks.length > 4 ? 3 : 4);
      shown.forEach((b) => {
        const row = el("div", "tlt-mrow " + b.kind + (b.done ? " done" : ""));
        row.style.setProperty("--hue", this.hueFor(b.item.id, new Set<string>()));
        row.append(el("span", "tlt-mrt", b.st ? b.st : T("全天")), el("span", "tlt-mrn", b.title));
        row.title = `${b.title}\n${b.st || ""}${b.en ? "–" + b.en : ""}`;
        row.onclick = (ev) => { ev.stopPropagation(); this.openBlock(b); };
        list.appendChild(row);
      });
      if (blocks.length > 4) {
        const more = el("div", "tlt-mmore", T("+{n} 个", { n: blocks.length - 3 }));
        more.title = blocks.slice(3).map((b) => b.title).join("\n");
        more.onclick = (ev) => { ev.stopPropagation(); this.viewDate = k; this.calView = "d"; void this.render(); };
        list.appendChild(more);
      }
      cell.appendChild(list);
      grid.appendChild(cell);
    });
    p.appendChild(grid);
    return p;
  }

  /**
   * 年视图：一整年铺成一张热力图——**一列一周、一行一周里的第几天**（GitHub 那种）。
   * 好处是 53 周 × 7 天只占一百来像素高，正常窗口一屏放得下，不用滚；
   * 窗口窄了才会横向滚动，那时自动把**当月**带到中间来。
   * 颜色四档：空 / 1–2 条 / 3–4 条 / 5 条以上。
   */
  private paneCalYear(): HTMLElement {
    const p = el("div", "tlt-pane");
    const year = D(this.viewDate).getFullYear();
    const start = this.store.settings.weekStart === 0 ? 0 : 1;
    const counts = this.yearCounts(year);
    const lvl = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3);

    p.appendChild(this.rhythm());
    p.appendChild(this.calBar());

    const legend = el("div", "tlt-ylg");
    legend.append(el("span", "", T("淡＝没有日程，越深越忙：")),
      el("i", "tlt-ycell lg l0"), el("span", "tlt-ylgt", T("1–2 条")), el("i", "tlt-ycell lg l1"),
      el("span", "tlt-ylgt", T("3–4 条")), el("i", "tlt-ycell lg l2"),
      el("span", "tlt-ylgt", T("5 条以上")), el("i", "tlt-ycell lg l3"),
      el("span", "tlt-ylgt", T("（点某天进那一天）")));
    p.appendChild(legend);

    // 从"这一年第一周的第一天"铺到"最后一周的最后一天"
    const jan1 = `${year}-01-01`, dec31 = `${year}-12-31`;
    const firstDay = weekStartOf(jan1, start);
    const lastDay = addDays(weekStartOf(dec31, start), 6);
    const weeks: string[][] = [];
    for (let d = firstDay; d <= lastDay; d = addDays(d, 7)) {
      weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    }

    const scroll = el("div", "tlt-yheat-scroll");
    const heat = el("div", "tlt-yheat");
    const mrow = el("div", "tlt-yhrow tlt-yhm");
    mrow.appendChild(el("i", "tlt-yhgut"));
    // 月份标签：从某月第一天所在的那一列开始写
    const monthAt = new Map<number, number>();
    weeks.forEach((w, i) => {
      w.forEach((k) => {
        if (!k.startsWith(`${year}-`)) return;
        const m = Number(k.slice(5, 7));
        if (!monthAt.has(m)) monthAt.set(m, i);
      });
    });
    weeks.forEach((_, i) => {
      const m = [...monthAt.entries()].find(([, col]) => col === i)?.[0];
      mrow.appendChild(el("i", "tlt-yhmtxt", m ? T("{n} 月", { n: m }) : ""));
    });
    heat.appendChild(mrow);
    for (let row = 0; row < 7; row++) {
      const r = el("div", "tlt-yhrow");
      r.appendChild(el("i", "tlt-yhgut", weekday((start + row) % 7)));
      weeks.forEach((w) => {
        const k = w[row];
        const inYear = k.startsWith(`${year}-`);
        const n = counts.get(k) || 0;
        const cell = el("i", `tlt-ycell l${lvl(n)}`
          + (inYear ? " in" : " out")
          + (k === todayISO() ? " today" : ""));
        cell.dataset.day = k;
        cell.title = `${k} · ${n ? T("{n} 条日程", { n }) : T("没有日程")}`;
        r.appendChild(cell);
      });
      heat.appendChild(r);
    }
    scroll.appendChild(heat);
    p.appendChild(scroll);

    // 窗口放得下就不滚；窄了才会横滚——滚的时候把**当月**带到中间（不是从 1 月开始看）。
    // 注意：回调里现查 DOM——视图可能已经被重画过一轮，闭包里的元素会变成"拆下来的旧节点"。
    const centerOnMonth = (): number => {
      try {
        const box = this.contentEl.querySelector<HTMLElement>(".tlt-yheat-scroll");
        if (!box) return 0;
        const mid = `${year}-${String(D(this.viewDate).getMonth() + 1).padStart(2, "0")}-15`;
        const cur = box.querySelector<HTMLElement>(`.tlt-ycell[data-day="${mid}"]`);
        if (!cur || box.scrollWidth <= box.clientWidth + 4) return 0;      // 放得下就不动
        const r = cur.getBoundingClientRect(), b = box.getBoundingClientRect();
        const delta = (r.left + r.width / 2) - (b.left + b.width / 2);
        if (Math.abs(delta) < 2) return 0;
        box.scrollLeft = Math.max(0, box.scrollLeft + delta);
        return Math.abs(delta);
      } catch { return 0; }
    };
    window.setTimeout(() => {
      // 布局可能还没稳、视图也可能刚被重画：差得远就再对一次，之后交给用户自己滚
      if (centerOnMonth() > 60) window.setTimeout(centerOnMonth, 240);
    }, 40);
    return p;
  }

  private paneMilestones(): HTMLElement {
    const p = el("div", "tlt-pane");
    const ms = this.store.milestones(this.proj || undefined)
      .filter((m) => !this.q || m.name.includes(this.q) || (m.project || "").includes(this.q) || m.tasks.some((t) => t.title.includes(this.q)));
    const isDone = (m: { tasks: Task[] }) => m.tasks.length > 0 && m.tasks.every((t) => t.done);
    const active = ms.filter((m) => !isDone(m));
    const finished = ms.filter(isDone);

    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", T("{a} 个里程碑 · {b} 开展中 · {c} 已完成", { a: ms.length, b: active.length, c: finished.length })));
    head.appendChild(el("span", "tlt-spacer"));
    head.appendChild(this.sortControl("milestone"));
    p.appendChild(head);
    this.qChip(p);
    const selDesc = this.proj ? this.store.projectDesc(this.proj) : "";
    if (selDesc) p.appendChild(el("div", "tlt-pane-sub", selDesc));
    if (!ms.length) p.appendChild(el("div", "tlt-empty", T("任务文件里用「## 里程碑名」分节，这里就会出现里程碑。")));

    // 开展中的放上面，已完成的收在下面
    const paintGroup = (group: string, list: { name: string; project: string; tasks: Task[] }[]) => {
      if (!list.length) return;
      const gh = el("div", "tlt-ms-group");
      gh.append(el("span", "", group), el("span", "tlt-mgc", String(list.length)));
      p.appendChild(gh);
      list.forEach((m) => {
        const done = m.tasks.filter((t) => t.done).length;
        const pct = Math.round((done / m.tasks.length) * 100);
        const card = el("div", "tlt-ms" + (this.expanded.has(m.name) ? " open" : ""));
        card.dataset.ms = m.name;
        card.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          this.milestoneMenu(card, m, { x: ev.clientX, y: ev.clientY });
        });
        const h = el("div", "tlt-ms-h");
        const dot = el("span", "tlt-dot"); dot.addClass("k-ms");
        const nameEl = el("span", "tlt-ms-n", m.name);
        const edit = el("button", "tlt-ms-edit", "✎");
        edit.title = T("重命名里程碑");
        edit.onclick = (ev) => { ev.stopPropagation(); this.promptRenameMilestone(m); };
        h.append(dot, nameEl, el("span", "tlt-ms-p", m.project), edit);
        const bar = el("span", "tlt-pbar small");
        const fill = el("i"); fill.style.width = pct + "%";
        bar.appendChild(fill);
        h.append(el("span", "tlt-spacer"), bar, el("span", "tlt-ms-c", `${done}/${m.tasks.length}`));
        card.appendChild(h);
        if (this.expanded.has(m.name)) {
          const body = el("div", "tlt-ms-b");
          this.sortTasks(m.tasks).forEach((t) => body.appendChild(this.taskRow(t)));
          card.appendChild(body);
        }
        p.appendChild(card);
      });
    };
    const sortMs = (list: { name: string; project: string; tasks: Task[] }[]) =>
      this.sortBy("milestone", list, (m) => m.name, (m) => {
        const by = this.sortCfg("milestone").by;
        if (by === "progress") return this.pctOf(m.tasks);
        if (by === "created") return this.edgeDate(m.tasks, "created", true);
        if (by === "due") return this.edgeDate(m.tasks, "due", false);
        return null;
      });
    paintGroup(T("开展中"), sortMs(active));
    paintGroup(T("已完成"), sortMs(finished));
    return p;
  }

  /* ---------- 右栏：消息 ---------- */

  private rail(): HTMLElement {
    const r = el("aside", "tlt-msgs");
    if (this.railOff) {
      r.addClass("off");
      const reopen = el("button", "tlt-fold-btn", "‹");
      reopen.title = T("展开消息栏");
      reopen.onclick = () => { void this.setPanels({ railCollapsed: false }); };
      r.appendChild(reopen);
      return r;
    }
    const head = el("div", "tlt-msgs-h");
    const unread = this.allMsgs().filter((m) => !m.read_ && m.state !== "ended").length;
    head.append(el("b", "", T("消息")));
    const badge = el("span", "tlt-badge", String(unread));
    head.appendChild(badge);
    const expand = el("button", "tlt-expand-btn");
    expand.dataset.expand = "1";
    expand.title = T("在独立页打开消息中心");
    expand.append(el("span", "tlt-expand-i", "⤢"), el("span", "", T("消息中心")));
    head.appendChild(expand);
    const fold = el("button", "tlt-fold-btn", "›");
    fold.title = T("收起消息栏");
    fold.onclick = () => { void this.setPanels({ railCollapsed: true }); };
    head.appendChild(fold);
    r.appendChild(head);

    const list = el("div", "tlt-mtl");
    // 搜索只作用在工作区（任务/里程碑/随手记），右栏消息永远看全部
    const items = this.allMsgs().sort((a, b) => a.date.localeCompare(b.date));
    let last = "";
    items.forEach((m) => {
      if (m.date !== last) {
        const d = D(m.date);
        list.appendChild(el("div", "tlt-mday" + (m.date === todayISO() ? " today" : ""), `${d.getMonth() + 1}/${d.getDate()} · ${T("周{w}", { w: weekday(d.getDay()) })}`));
        last = m.date;
      }
      const n = el("div", "tlt-mnode" + (m.star ? " star" : "") + (m.read_ ? " read" : "") + (m.state === "ended" ? " ended" : ""));
      n.dataset.msg = m.id;
      const dot = el("span", "tlt-nd"); dot.style.background = KIND_COLOR[m.kind];
      n.appendChild(dot);
      const nh = el("div", "tlt-nh");
      nh.append(el("span", "tlt-nm", m.title));
      if (m.star) nh.appendChild(el("span", "tlt-sk", "★"));
      n.appendChild(nh);
      n.appendChild(el("div", "tlt-nm2",
        `${kindLabel(m.kind)}${m.place ? " · " + m.place : ""}${m.state === "ended" ? T(" · 已结束") : ""}`));
      list.appendChild(n);
    });
    if (!items.length) list.appendChild(el("div", "tlt-empty", T("还没有消息。在 feeds/ 里建一个源，或点 ＋ 发布一条。")));
    r.appendChild(list);

    const foot = el("div", "tlt-mfoot", T("源 {s} · 消息 {m}", { s: this.store.feeds.length, m: items.length }));
    r.appendChild(foot);
    return r;
  }

  private allMsgs(): (Msg & { read_?: boolean })[] {
    return this.store.feeds.flatMap((f) => f.items);
  }

  /* ---------- 交互 ---------- */

  private bindInputs(root: HTMLElement) {
    // 就地加子项：回车落盘
    root.querySelectorAll<HTMLInputElement>("[data-stepadd]").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const v = input.value.trim();
        if (!v) return;
        const task = this.findTask(input.dataset.stepadd ?? "");
        if (!task) return;
        input.value = "";
        void (async () => {
          await this.store.addStep(task, v);
          await this.refresh();
          // 光标回到子项输入框：连着登记第二条不用再点一次
          const again = this.contentEl.querySelector<HTMLInputElement>(`[data-stepadd="${task.id}"]`);
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        })();
      });
    });

    const search = root.querySelector<HTMLInputElement>("[data-search]");
    if (search) {
      let composing = false;
      search.addEventListener("compositionstart", () => { composing = true; });
      search.addEventListener("compositionend", () => {
        composing = false;
        this.q = search.value.trim();
        void this.render();
      });
      search.addEventListener("input", () => {
        if (composing) return;           // 拼音还没选字，别拿半成品去筛
        this.q = search.value.trim();
        void this.render();
      });
    }

    const ideaNew = root.querySelector<HTMLInputElement>("[data-ideanew]");
    const ideaPrev = root.querySelector<HTMLElement>("[data-ideaprev]");
    if (ideaNew && ideaPrev) {
      // 只回显命中的标签；没标签就不出现（正文本身不需要预览）
      const paint = () => {
        const c = parseIdeaText(ideaNew.value.trim());
        if (!c.tags.length) { ideaPrev.empty(); ideaPrev.addClass("hide"); return; }
        ideaPrev.removeClass("hide");
        ideaPrev.empty();
        ideaPrev.createSpan({ cls: "tlt-pv-l", text: T("识别到") });
        c.tags.forEach((tg) => {
          ideaPrev.createSpan({ cls: "tlt-pv on", text: `#${tg}` });
        });
      };
      ideaNew.addEventListener("input", paint);
      paint();
    }
    if (ideaNew) {
      ideaNew.addEventListener("keydown", (e) => { void (async () => {
        if (e.key !== "Enter") return;
        const v = (e.target as HTMLInputElement).value.trim();
        if (!v) return;
        const parsed = parseIdeaText(v);
        await this.store.addIdea({ title: parsed.title, tags: parsed.tags });
        await this.refresh();
        new Notice(T("已收进想法池"));
      })(); });
    }
  }

  /** 空白处点击 → 按坐标算时间 */
  private async onClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    // 只认视图内部的命中：closest() 会一路走到 body，
    // 而 body / workspace 上可能带着同名的 data-* 属性（实测 data-theme 会让"点哪都切主题"）
    const pick = (sel: string) => {
      const hit = t.closest<HTMLElement>(sel);
      return hit && this.contentEl.contains(hit) ? hit : null;
    };

    const tab = pick("[data-tab]");
    if (tab) { this.tab = tab.dataset.tab!; await this.render(); return; }

    const day = pick("[data-day]");
    if (day && !pick("[data-slotgrid]")) {
      const k = day.dataset.day ?? "";
      // 周/月/年视图里点某天＝进那天的日视图（macOS 的手感）；日视图里就是切日子
      if (this.calView !== "d") this.calView = "d";
      this.viewDate = k;
      await this.render(); return;
    }

    const calview = pick("[data-calview]");
    if (calview) { this.calView = (calview.dataset.calview || "d") as CalView; await this.render(); return; }

    const dnav = pick("[data-dnav]");
    if (dnav) {
      const step = Number(dnav.dataset.dnav);
      if (this.calView === "w") this.viewDate = addDays(this.viewDate, 7 * step);
      else if (this.calView === "m") {
        const d = D(this.viewDate);
        const m = new Date(d.getFullYear(), d.getMonth() + step, 1);
        this.viewDate = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
      } else if (this.calView === "y") {
        const d = D(this.viewDate);
        this.viewDate = `${d.getFullYear() + step}-01-01`;
      } else this.viewDate = addDays(this.viewDate, step);
      await this.render(); return;
    }
    if (pick("[data-today]")) { this.viewDate = todayISO(); await this.render(); return; }

    const msCard = pick("[data-ms]");
    // 点的是卡片里的任务/勾选框时，不要当成"折叠这个里程碑"
    if (msCard && !(ev.target as Element).closest("[data-task],[data-ck]")) {
      const key = msCard.dataset.ms ?? "";
      const hit = this.store.milestones().find((m) => m.name === key);
      // 记下"最后点的里程碑"：接着点新建任务时直接落到它下面
      this.msSel = hit ? { project: hit.project, name: hit.name } : null;
      if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
      await this.render();
      return;
    }

    const itag = pick("[data-itag]");
    if (itag) {
      const v = itag.dataset.itag || "";
      if (!v) this.ideaTags.clear();
      else if (this.ideaTags.has(v)) this.ideaTags.delete(v);
      else this.ideaTags.add(v);
      await this.render();
      return;
    }

    const tagBtn = pick("[data-tag]");
    if (tagBtn) { this.taskTag = tagBtn.dataset.tag || null; await this.render(); return; }
    const staffDim = pick("[data-staffdim]");
    if (staffDim) { this.staffDim = (staffDim.dataset.staffdim || "m") as StaffDim; await this.render(); return; }

    const dim = pick("[data-dim]");
    if (dim) { this.taskDim = dim.dataset.dim as TaskDim; await this.render(); return; }

    const rv = pick("[data-rhythm]");
    if (rv) { this.rhythmView = rv.dataset.rhythm as "bars" | "star"; await this.render(); return; }

    const period = pick("[data-period]");
    if (period) { this.period = period.dataset.period as Period; await this.render(); return; }

    const pedit = pick("[data-projedit]");
    if (pedit) {
      const name = pedit.dataset.projedit ?? "";
      new ProjectInfoModal(this.app, this.store, name, (info) => {
        if (info?.renamed && this.proj === info.from) { this.proj = info.to; this.plugin.setActiveProject(this.proj); }
        void this.render();
      }).open();
      return;
    }
    const proj = pick("[data-proj]");
    if (proj) {
      const name = proj.dataset.proj ?? "";
      this.proj = this.proj === name ? null : name;
      this.plugin.setActiveProject(this.proj);
      await this.render();
      return;
    }
    if (pick("[data-projclear]")) { this.proj = null; this.plugin.setActiveProject(null); await this.render(); return; }


    if (pick("[data-qclear]")) { this.q = ""; await this.render(); return; }
    if (pick("[data-panelopen]")) { void this.plugin.togglePanel(); return; }
    if (pick("[data-newtask]")) { this.openNewTask(); return; }

    if (pick("[data-ideanewmodal]")) { new IdeaModal(this.app, this.store, undefined, () => this.refresh()).open(); return; }

    if (pick("[data-expand]")) { await this.plugin.activateMessages(); return; }

    const ck = pick("[data-ck]");
    if (ck) {
      ev.stopPropagation();
      const task = this.findTask(ck.dataset.ck ?? "");
      if (task) {
        // 勾完成时如果还有没勾的子项，只提醒、不拦着
        if (!task.done && task.steps.length) {
          const open = task.steps.filter((x) => !x.done).length;
          if (open) new Notice(T("还有 {n} 个子项没勾（这次先记完成）", { n: open }), 4000);
        }
        await this.store.toggleTask(task);
        await this.refresh();
      }
      return;
    }

    const log = pick("[data-log]");
    if (log) {
      const l = this.store.logs.find((x) => x.id === log.dataset.log);
      if (l) new LogModal(this.app, this.store, l, () => this.refresh()).open();
      return;
    }

    const idea = pick("[data-idea]");
    if (idea) {
      const it = this.store.ideas.find((x) => x.id === idea.dataset.idea);
      new IdeaModal(this.app, this.store, it, () => this.refresh()).open();
      return;
    }

    if (pick("[data-addstaff]")) {
      new AddStaffModal(this.app, this.store, () => this.refresh()).open();
      return;
    }

    const staff = pick("[data-staff]");
    if (staff) {
      const s = this.store.staff.find((x) => x.name === staff.dataset.staff);
      if (s) new StaffModal(this.app, this.store, s, () => this.refresh()).open();
      return;
    }

    const msg = pick("[data-msg]");
    if (msg) {
      const m = this.allMsgs().find((x) => x.id === msg.dataset.msg);
      if (m) new MsgModal(this.app, this.store, m, () => this.refresh()).open();
      return;
    }

    const sched = pick("[data-sched]");
    if (sched) {
      const t = this.findTask(sched.dataset.sched ?? "");
      if (t) await this.scheduleTask(t);
      return;
    }

    const msPeek = pick("[data-mspeek]");
    if (msPeek) {
      const [proj, name] = (msPeek.dataset.mspeek ?? "").split("::");
      const ms = this.store.milestones(proj).find((m) => m.name === name);
      if (ms) {
        new MilestonePeekModal(this.app, this.store, ms, () => {
          this.tab = "ms"; this.proj = proj || null; this.expanded.add(name); void this.render();
        }).open();
      }
      return;
    }

    const peek = pick("[data-peek]");
    if (peek) {
      const t = this.findTask(peek.dataset.peek ?? "");
      if (t) new TaskPeekModal(this.app, this.store, t, () => {
        new TaskModal(this.app, this.store, t, () => this.refresh()).open();
      }).open();
      return;
    }

    // 子项：先处理，别落到"打开任务详情"上
    const ring = pick("[data-steps]");
    if (ring) {
      const id = ring.dataset.steps ?? "";
      if (this.expandedSteps.has(id)) this.expandedSteps.delete(id); else this.expandedSteps.add(id);
      await this.render();
      return;
    }
    const scb = pick("[data-step]");
    if (scb) {
      ev.stopPropagation();
      const [tid, idx] = (scb.dataset.step ?? "").split("|");
      const tk = this.findTask(tid);
      if (tk && tk.steps[Number(idx)]) {
        await this.store.setStepDone(tk, Number(idx), !tk.steps[Number(idx)].done);
        await this.refresh();
      }
      return;
    }
    const sdel = pick("[data-stepdel]");
    if (sdel) {
      ev.stopPropagation();
      const [tid, idx] = (sdel.dataset.stepdel ?? "").split("|");
      const tk = this.findTask(tid);
      if (tk) await this.confirmDeleteStep(tk, Number(idx));
      return;
    }
    const stext = pick("[data-steptext]");
    if (stext) {
      ev.stopPropagation();
      this.editStepText(stext);
      return;
    }

    const task = pick("[data-task]");
    if (task) {
      const tk = this.findTask(task.dataset.task ?? "");
      if (tk) new TaskModal(this.app, this.store, tk, () => this.refresh()).open();
      return;
    }

    const grid = pick("[data-slotgrid]");
    if (grid && !pick(".tlt-blk")) {
      const rect = grid.getBoundingClientRect();
      const y = ev.clientY - rect.top + grid.scrollTop;
      const mins = Math.max(DAY_FROM, Math.min(DAY_TO - 30, Math.round((DAY_FROM + (y / HOUR_PX) * 60) / 15) * 15));
      new QuickLogModal(this.app, this.store, this.viewDate, () => this.refresh(), minToHHMM(mins)).open();
    }
  }

  /**
   * 日程块：拖动改时间、拖底边改结束时间、右键出菜单。
   * 时间只按 5 分钟吸附；松手才落盘（拖的过程中只动画面）。
   */
  private wireDrag(
    blk: HTMLElement,
    body: HTMLElement,
    opts: { kind: "plan" | "log"; id: string; a: number; b: number; onMenu: (at: { x: number; y: number }) => void },
  ) {
    const grip = el("div", "tlt-blk-grip");
    grip.title = T("拖动改结束时间");
    blk.appendChild(grip);
    let mode: "move" | "resize" | null = null;
    let y0 = 0, a0 = opts.a, b0 = opts.b, curA = opts.a, curB = opts.b;
    const snap = (m: number) => Math.round(m / 5) * 5;
    const clamp = (a: number, b: number) => {
      const A = Math.max(DAY_FROM, Math.min(DAY_TO - 15, a));
      const B = Math.max(A + 15, Math.min(DAY_TO, b));
      return { A, B };
    };
    const paint = (A: number, B: number) => {
      blk.style.top = `${((A - DAY_FROM) / 60) * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, ((B - A) / 60) * HOUR_PX)}px`;
      const m = body.querySelector(".tlt-blk-m");
      if (m) m.textContent = m.textContent?.replace(/^\d{2}:\d{2}[–-]\d{2}:\d{2}/, `${minToHHMM(A)}–${minToHHMM(B)}`) ?? m.textContent;
    };

    blk.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      opts.onMenu({ x: ev.clientX, y: ev.clientY });
    });
    blk.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      mode = (ev.target as HTMLElement).classList.contains("tlt-blk-grip") ? "resize" : "move";
      y0 = ev.clientY; a0 = curA; b0 = curB;
      blk.addClass("dragging");
      try { blk.setPointerCapture(ev.pointerId); } catch { /* 老客户端 */ }
      ev.stopPropagation();          // 别触发"点空白新建"，也别顺手打开弹窗
      ev.preventDefault();
    });
    blk.addEventListener("pointermove", (ev) => {
      if (!mode) return;
      const d = snap(((ev.clientY - y0) / HOUR_PX) * 60);
      const r = mode === "move" ? clamp(a0 + d, a0 + d + (b0 - a0)) : clamp(a0, b0 + d);
      curA = r.A; curB = r.B;
      paint(curA, curB);
    });
    let dragged = false;
    // 拖完那一下的 click 不该再打开弹窗（拖 = 改时间，不是点开）
    blk.addEventListener("click", (ev) => {
      if (!dragged) return;
      dragged = false;
      ev.stopPropagation();
      ev.preventDefault();
    }, true);
    const finish = () => {
      if (!mode) return;
      const moved = curA !== opts.a || curB !== opts.b;
      mode = null;
      blk.removeClass("dragging");
      if (moved) { dragged = true; void this.saveBlockTime(opts.kind, opts.id, curA, curB); }
    };
    blk.addEventListener("pointerup", finish);
    blk.addEventListener("pointercancel", finish);
  }

  /** 落盘：计划块写回任务的 [st::]/[en::]，记录块改行首的时间段 */
  private async saveBlockTime(kind: "plan" | "log", id: string, a: number, b: number) {
    const st = minToHHMM(a), en = minToHHMM(b);
    if (kind === "plan") {
      const t = this.store.tasks.find((x) => x.id === id);
      if (!t) return;
      await this.store.setField(t, "st", st);
      await this.store.setField(t, "en", en);
      t.st = st; t.en = en;                 // 内存里同步好，下次渲染自然是对的
      new Notice(T("已改到 {a}–{b}", { a: st, b: en }), 2500);
    } else {
      const l = this.store.logs.find((x) => x.id === id);
      if (!l) return;
      await this.store.setLogTime(l, st, en);
      l.st = st; l.en = en;
      new Notice(T("已改到 {a}–{b}", { a: st, b: en }), 2500);
    }
    // 拖动只改了这一个块的时间：块自己已经画好了，**不要整页重画**——
    // 重画会重建侧栏与星图，用户看到的就是"拖一下，左边和星图跳一下"。
    // 改了时间段不影响项目进度、星图（按截止日）与统计数据，所以这里不需要刷新别的面板。
  }

  /** 日程块右键菜单：编辑 / 删除（计划块是"取消排期"） */
  private blockMenu(kind: "plan" | "log", item: Task, at: { x: number; y: number }) {
    const items: { label: string; onClick: () => void | Promise<void>; danger?: boolean }[] = [];
    if (kind === "plan") {
      items.push({ label: T("打开任务"), onClick: () => new TaskModal(this.app, this.store, item, () => this.refresh()).open() });
      items.push({
        label: T("调整时间…"),
        onClick: () => {
          new PromptModal(this.app, T("调整时间段"), T("09:30–11:00"), async (v) => {
            const m = /^(\d{1,2}):(\d{2})\s*(?:–|-|~)\s*(\d{1,2}):(\d{2})$/.exec(v.trim());
            if (!m) { new Notice(T("格式像 09:30–11:00")); return; }
            await this.saveBlockTime("plan", item.id, Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4]));
          }, `${item.st || "09:00"}–${item.en || "10:00"}`).open();
        },
      });
      items.push({ label: T("取消排期"), danger: true, onClick: async () => {
        await this.store.setField(item, "plan", null);
        await this.store.setField(item, "st", null);
        await this.store.setField(item, "en", null);
        new Notice(T("已取消排期"), 2500);
        await this.refresh();
      } });
    } else {
      items.push({ label: T("编辑记录"), onClick: () => new LogModal(this.app, this.store, item, () => this.refresh()).open() });
      items.push({
        label: T("调整时间…"),
        onClick: () => {
          new PromptModal(this.app, T("调整时间段"), T("09:30–11:00"), async (v) => {
            const m = /^(\d{1,2}):(\d{2})\s*(?:–|-|~)\s*(\d{1,2}):(\d{2})$/.exec(v.trim());
            if (!m) { new Notice(T("格式像 09:30–11:00")); return; }
            await this.saveBlockTime("log", item.id, Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4]));
          }, `${item.st || "09:00"}–${item.en || "10:00"}`).open();
        },
      });
      items.push({ label: T("删除这条记录"), danger: true, onClick: async () => {
        await this.store.deleteLog(item);
        new Notice(T("已删除记录"), 2500);
        await this.refresh();
      } });
    }
    const anchor = this.contentEl.querySelector<HTMLElement>(".tlt-daygrid") ?? this.contentEl;
    popMenu(anchor, items, "left", at);
  }

  /** 把一条任务排进当前日期的第一个空档（排完写回 [st::] [en::]） */
  private async scheduleTask(t: Task) {
    const day = this.viewDate;
    const spans = [
      ...this.store.logs.filter((l) => l.due === day),
      ...this.store.tasks.filter((x) => x.st && !x.done && x.id !== t.id && dayOfBlock(x) === day),
    ]
      .map((b) => ({ a: hhmmToMin(b.st) || DAY_FROM, b: hhmmToMin(b.en) || (hhmmToMin(b.st) || DAY_FROM) + 30 }))
      .filter((r) => r.b > r.a)
      .sort((x, y) => x.a - y.a);

    // 今天：从"现在"开始（向上取到下一个 15 分钟），而不是固定 9 点
    let start = 9 * 60;
    if (day === todayISO()) {
      const now = new Date();
      start = Math.max(start, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
    }
    // 往后挪到第一个不撞的空档
    for (const r of spans) {
      if (start + 30 <= r.a) break;
      if (start < r.b) start = r.b;
    }
    start = Math.round(start / 5) * 5;
    if (start >= 22 * 60) { new Notice(T("这天排满了，换一天试试")); return; }
    const end = Math.min(23 * 60, start + 30);        // 默认半小时，细化的自己在日历上拖
    // 只排时间：截止日是"什么时候要交"，跟"哪天做"没有关系，一个字都不动
    await this.store.setField(t, "plan", day);
    await this.store.setField(t, "st", minToHHMM(start));
    await this.store.setField(t, "en", minToHHMM(end));
    this.scrollToMin = start;
    await this.refresh();
    new Notice(T("已排入 {a}–{b}", { a: minToHHMM(start), b: minToHHMM(end) }));
  }

  private async confirmDeleteStep(t: Task, index: number) {
    const st = t.steps[index];
    if (!st) return;
    new ConfirmModal(this.app, {
      title: T("删掉这条子项"),
      body: `${st.text}\n\n${T("只删子项，任务本身不动。")}`,
      ok: T("删除"),
    }, async (ok) => {
      if (!ok) return;
      await this.store.deleteStep(t, index);
      await this.refresh();
    }).open();
  }

  /** 点文字就地改：换成输入框，回车保存、Esc 取消 */
  private editStepText(span: HTMLElement) {
    const [tid, idxRaw] = (span.dataset.steptext ?? "").split("|");
    const task = this.findTask(tid);
    if (!task) return;
    const idx = Number(idxRaw);
    const input = el("input", "tlt-step-edit");
    input.value = span.textContent ?? "";
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save: boolean) => { void (async () => {
      if (done) return;
      done = true;
      if (save) await this.store.setStepText(task, idx, input.value);
      await this.refresh();
    })(); };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing || e.key === "Process") return;
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  private findTask(id: string): Task | undefined {
    return [...this.store.tasks, ...this.store.logs].find((t) => t.id === id);
  }
}
