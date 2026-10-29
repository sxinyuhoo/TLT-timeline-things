import { t as T } from "../i18n";
import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type TLTPlugin from "../main";
import { Store, DEFAULT_SETTINGS } from "../store";
import {
  Task, Msg, Period, todayISO, addDays,
  hhmmToMin, minToHHMM, inPeriod, saturation, D, parseIdeaText, ideaTags, ideaFilterTags,
} from "../data";
import { TaskModal, LogModal, QuickLogModal, QuickTaskModal, StaffModal, AddStaffModal, IdeaModal, MsgModal, TaskPeekModal, MilestonePeekModal, ProjectInfoModal, PromptModal, popMenu, el } from "./modals";
import { confirmArchiveProject, confirmDeleteTask, confirmRestoreProject } from "../archive";
import { ConfirmModal } from "./picker";
import { setSvgMarkup } from "./dom";
import { newProjectFlow } from "../actions";

export const VIEW_TYPE_WORKBENCH = "tlt-workbench";
const DAY_FROM = 7 * 60, DAY_TO = 23 * 60, HOUR_PX = 62;
type TaskDim = "d" | "w" | "m" | "q" | "all";
const periodLabel = (p: Period) => ({ w: T("本周"), m: T("本月"), q: T("本季度") }[p]);
const kindLabel = (k: string) => ({ ask: T("要求"), event: T("活动"), risk: T("风险"), note: T("通知") })[k] || k;
const KIND_COLOR: Record<string, string> = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
const weekday = (i: number) => [T("日"), T("一"), T("二"), T("三"), T("四"), T("五"), T("六")][i] || "";
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
  getIcon() { return "activity"; }

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

  /* ---------- 排序：项目 / 里程碑 / 任务通用 ---------- */

  private sortKey(): "name" | "created" | "due" { return this.cfg.sortBy || "name"; }
  private sortDir(): 1 | -1 { return this.cfg.sortDir === -1 ? -1 : 1; }

  /** 一组东西按「名称 / 创建 / 截止」排序；取不到时间的排最后，同名时按名称兜底 */
  private sortItems<T>(items: T[], keyOf: (x: T) => string, nameOf: (x: T) => string): T[] {
    const dir = this.sortDir();
    const byName = this.sortKey() === "name";
    return [...items].sort((a, b) => {
      const va = keyOf(a), vb = keyOf(b);
      if (!va && !vb) return nameOf(a).localeCompare(nameOf(b), "zh");
      if (!va) return 1;
      if (!vb) return -1;
      const c = byName ? va.localeCompare(vb, "zh") : va.localeCompare(vb);
      return c !== 0 ? c * dir : nameOf(a).localeCompare(nameOf(b), "zh");
    });
  }

  /** 一组任务里最早/最晚的那个日期（项目、里程碑用它的任务推算） */
  private edgeDate(list: Task[], pick: "min" | "max"): string {
    const k = this.sortKey();
    if (k === "name") return "";
    const vals = list.map((t) => (k === "created" ? t.created : t.due) || "").filter(Boolean).sort();
    if (!vals.length) return "";
    return pick === "min" ? vals[0] : vals[vals.length - 1];
  }

  private sortTasks(list: Task[]): Task[] {
    const k = this.sortKey();
    return this.sortItems(list,
      (t) => (k === "created" ? t.created || "" : k === "due" ? t.due || "" : t.title),
      (t) => t.title);
  }

  /** 工具条上的排序按钮：当前口径写在按钮上，点开选口径、再点同一个换方向 */
  private sortControl(): HTMLElement {
    const btn = el("button", "tlt-btn tiny tlt-sortbtn");
    const label = { name: T("名称"), created: T("创建"), due: T("截止") }[this.sortKey()];
    btn.textContent = T("排序：{label} {dir}", { label, dir: this.sortDir() === 1 ? "↑" : "↓" });
    btn.title = T("按名称 / 创建时间 / 截止时间排；点同一个换方向");
    btn.dataset.sort = "1";
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const mark = (k: string) => (this.sortKey() === k ? (this.sortDir() === 1 ? " ↑" : " ↓") : "");
      popMenu(btn, [
        { label: T("按名称") + mark("name"), onClick: () => void this.pickSort("name") },
        { label: T("按创建时间") + mark("created"), onClick: () => void this.pickSort("created") },
        { label: T("按截止时间") + mark("due"), onClick: () => void this.pickSort("due") },
        { label: T("反向排列"), onClick: () => void this.pickSort(this.sortKey(), true) },
      ], "right");
    };
    return btn;
  }

  private async pickSort(k: "name" | "created" | "due", flip = false) {
    if (this.sortKey() === k && !flip) this.cfg.sortDir = this.sortDir() === 1 ? -1 : 1;
    else { this.cfg.sortBy = k; if (flip) this.cfg.sortDir = this.sortDir() === 1 ? -1 : 1; else this.cfg.sortDir = 1; }
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
    psort.title = T("项目排序：按名称 / 创建时间 / 截止时间");
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
    const projects = this.sortItems(this.store.projects(),
      (p2) => (this.sortKey() === "name" ? p2 : this.edgeDate(projTasks(p2), "min")),
      (p2) => p2).sort((a, b) => Number(this.store.isPinned(b)) - Number(this.store.isPinned(a)));   // 置顶的永远在最上面
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

    const seg = el("div", "tlt-seg tlt-period");
    (["w", "m", "q"] as Period[]).forEach((p) => {
      const b = el("button", "tlt-seg-b" + (this.period === p ? " on" : ""), periodLabel(p));
      b.dataset.period = p;
      seg.appendChild(b);
    });
    scroll.appendChild(seg);

    const idea = this.store.ideas;
    const box = el("div", "tlt-ideabox");
    box.dataset.tab = "ideas";
    box.append(el("span", "", T("✦ 随手记")), el("b", "", String(idea.length)));
    const stale = idea.filter((i) => i.stage !== "已立项" && (Date.now() - D(i.at).getTime()) / 864e5 > 14).length;
    if (stale) box.append(el("span", "tlt-stale", T("{n} 条待回看", { n: stale })));
    scroll.appendChild(box);
    s.appendChild(scroll);

    const done = all.filter((t) => t.done).length;
    const mine = this.store.staff[0]?.name || "";
    const me = this.store.staff.find((x) => x.name === mine);
    const sat = saturation(this.store.tasks, mine, this.period, { capacity: me?.capacity ?? 100, days: me?.days ?? 5 });
    const foot = el("div", "tlt-sfoot");
    foot.append(el("span", "", T("完成 {a}/{b}", { a: done, b: all.length })), el("span", "", T("{p}我 {n}%", { p: periodLabel(this.period), n: sat.pct })));
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

    const theme = el("button", "tlt-btn", this.plugin.isLight() ? "☾" : "☀");
    theme.dataset.tltTheme = "1";
    theme.title = T("切换明暗");
    theme.onclick = (ev) => { ev.stopPropagation(); this.plugin.toggleTheme(); };
    const add = el("button", "tlt-btn pri lg", T("＋ 新建"));
    add.dataset.newtask = "1";
    top.append(theme, add);
    m.appendChild(top);

    const tabs = el("div", "tlt-tabs");
    [["today", T("日历")], ["month", T("任务")], ["ms", T("里程碑")], ["staff", T("人员")], ["ideas", T("随手记")], ["draw", T("随手画")]].forEach(([k, label]) => {
      const b = el("button", "tlt-tab" + (this.tab === k ? " on" : ""), T(label));
      b.dataset.tab = k;
      tabs.appendChild(b);
    });
    m.appendChild(tabs);

    const work = el("div", "tlt-work");
    if (this.tab === "today") work.appendChild(this.paneToday());
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

    // 日期导航
    const bar = el("div", "tlt-dbar");
    const prev = el("button", "tlt-dnav", "‹"); prev.dataset.dnav = "-1";
    const next = el("button", "tlt-dnav", "›"); next.dataset.dnav = "1";
    const dl = D(sel);
    const lab = el("div", "tlt-dlabel");
    lab.append(T("{m} 月 {d} 日", { m: dl.getMonth() + 1, d: dl.getDate() }));
    lab.createEl("em", { text: T("周{w}", { w: weekday(dl.getDay()) }) + (sel === todayISO() ? T(" · 今天") : "") });
    const todayBtn = el("button", "tlt-btn", T("回到今天")); todayBtn.dataset.today = "1";
    bar.append(prev, lab, next, todayBtn, el("span", "tlt-spacer"),
      el("span", "tlt-dhint", T("{a} 条记录 · {b} 未排", { a: this.logsOn(sel).length, b: this.unscheduled(sel).length })));

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
    // 节奏在上，日期选择紧跟其后（和下面的日历配套）
    p.appendChild(this.rhythm());
    p.appendChild(bar);
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
    // 计划块：任务自己带了时间
    const planned = this.store.tasks.filter((t) => t.due === sel && t.st && !t.done);
    planned.forEach((t) => {
      const a = hhmmToMin(t.st) || DAY_FROM;
      const b = hhmmToMin(t.en) || a + 60;
      const blk = el("div", "tlt-blk plan");
      blk.dataset.task = t.id;
      blk.style.top = `${((a - DAY_FROM) / 60) * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, ((b - a) / 60) * HOUR_PX)}px`;
      const c = el("div", "tlt-blk-c");
      c.append(el("div", "tlt-blk-t", t.title),
        el("div", "tlt-blk-m", `${t.st}–${t.en} · ${T("计划")}${t.wl ? " · " + t.wl + "%" : ""}`));
      blk.appendChild(c);
      this.wireDrag(blk, c, {
        kind: "plan", id: t.id, a, b,
        onMenu: (at) => this.blockMenu("plan", t, at),
      });
      inner.appendChild(blk);
    });
    logs.forEach((l) => {
      const a = hhmmToMin(l.st) || DAY_FROM;
      const b = hhmmToMin(l.en) || a + 30;
      const blk = el("div", "tlt-blk " + (l.extra ? "extra" : "log"));
      blk.dataset.log = l.id;
      blk.style.top = `${((a - DAY_FROM) / 60) * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, ((b - a) / 60) * HOUR_PX)}px`;
      const c = el("div", "tlt-blk-c");
      c.append(el("div", "tlt-blk-t", l.title),
        el("div", "tlt-blk-m", `${l.st}–${l.en} · ${l.extra ? T("临时") : T("记录")}${l.project ? " · " + l.project : ""}`));
      blk.appendChild(c);
      this.wireDrag(blk, c, {
        kind: "log", id: l.id, a, b,
        onMenu: (at) => this.blockMenu("log", l, at),
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

    const plan = logs.filter((l) => !l.extra).length;
    const extra = logs.filter((l) => l.extra).length;
    const b2 = el("div", "tlt-box");
    b2.appendChild(el("div", "tlt-box-h", T("这天 · 计划与实际")));
    [[T("计划"), plan], [T("记录"), logs.length], [T("其中临时"), extra]].forEach(([n, v]) => {
      const r = el("div", "tlt-sum");
      r.append(el("span", "tlt-sum-n", String(n)));
      const bar2 = el("span", "tlt-sum-b");
      const fill = el("i"); fill.style.width = `${Math.min(100, (Number(v) / 6) * 100)}%`;
      bar2.appendChild(fill);
      r.append(bar2, el("span", "tlt-sum-v", T("{n} 条", { n: v })));
      b2.appendChild(r);
    });
    if (logs.length) {
      const pct = Math.round((extra / logs.length) * 100);
      b2.appendChild(el("div", "tlt-hint", T("临时占了这天记录的 {n}%", { n: pct })));
    }
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

  private paneMonth(): HTMLElement {
    const p = el("div", "tlt-pane");
    const m = this.tasksInDim();
    const head = el("div", "tlt-pane-h");
    const label = { d: T("今天"), w: T("本周"), m: T("本月"), q: T("本季度"), all: T("全部") }[this.taskDim];
    head.append(el("span", "", T("{l} · {a} 逾期 / {b} 要做 / {c} 已完成 / {d} 待排期", { l: label, a: m.late.length, b: m.todo.length, c: m.done.length, d: m.pending.length })));
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
    ([["d", T("今天")], ["w", T("本周")], ["m", T("本月")], ["q", T("本季度")], ["all", T("全部")]] as const).forEach(([k, t]) => {
      const b2 = el("button", "tlt-seg-b" + (this.taskDim === k ? " on" : ""), t);
      b2.dataset.dim = k;
      seg.appendChild(b2);
    });
    head.appendChild(seg);
    head.appendChild(this.sortControl());
    p.appendChild(head);
    const selDesc = this.proj ? this.store.projectDesc(this.proj) : "";
    if (selDesc) p.appendChild(el("div", "tlt-pane-sub", selDesc));
    const groups: [string, Task[], string][] = [
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
      this.sortTasks(list).forEach((t) => g.appendChild(this.taskRow(t)));
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
    const inDim = (d?: string) => (dim === "all" ? true : dim === "d" ? d === todayISO() : !!d && inPeriod(d, dim));
    const today = todayISO();
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

  /** 子项进度环：只有带子项的任务才画；点一下就地展开子项 */
  private stepRing(t: Task): HTMLElement {
    const total = t.steps.length;
    const done = t.steps.filter((x) => x.done).length;
    const pct = total ? done / total : 0;
    const R = 5.5, C = 2 * Math.PI * R;
    const ring = el("span", "tlt-stepring" + (t.done ? " all" : done === total ? " ready" : ""));
    ring.dataset.steps = t.id;
    ring.title = T("子项 {a}/{b}，点一下展开", { a: done, b: total });
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const circle = (cls: string) => {
      const c = createSvg("circle");
      c.setAttribute("cx", "7");
      c.setAttribute("cy", "7");
      c.setAttribute("r", String(R));
      c.setAttribute("class", cls);
      return c;
    };
    const fg = circle("tlt-sr-fg");
    fg.setAttribute("stroke-dasharray", C.toFixed(2));
    fg.setAttribute("stroke-dashoffset", (C * (1 - pct)).toFixed(2));
    svg.append(circle("tlt-sr-bg"), fg);
    ring.appendChild(svg);
    return ring;
  }

  /** 就地展开的子项块：勾选 / 点文字改 / 删 / 回车加一条 */
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
  /** 侧栏窄，排序用一个小菜单 */
  private sidebarSortMenu(anchor: HTMLElement) {
    const mark = (k: string) => (this.sortKey() === k ? (this.sortDir() === 1 ? " ↑" : " ↓") : "");
    popMenu(anchor, [
      { label: T("按名称") + mark("name"), onClick: () => void this.pickSort("name") },
      { label: T("按创建时间") + mark("created"), onClick: () => void this.pickSort("created") },
      { label: T("按截止时间") + mark("due"), onClick: () => void this.pickSort("due") },
      { label: T("反向排列"), onClick: () => void this.pickSort(this.sortKey(), true) },
    ], "right");
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
      const pr = el("i", "tlt-pd" + (t.pri >= 3 ? " u" : ""));
      title.appendChild(pr);
    }
    title.appendChild(document.createTextNode(t.title));
    body.appendChild(title);
    const meta = el("div", "tlt-task-m");
    if (t.milestone) meta.appendChild(el("span", "tlt-tag", t.milestone));
    meta.appendChild(el("span", "", t.due ? t.due.slice(5) : T("待排期")));
    if (t.est !== undefined) meta.appendChild(el("span", "tlt-wl", `${t.est} ${T("人天")}`));
    else if (t.wl) meta.appendChild(el("span", "tlt-wl", `${t.wl}%`));
    if (t.scope === "个人") meta.appendChild(el("span", "tlt-tag own", T("个人")));
    (t.tags || []).forEach((tg) => meta.appendChild(el("span", "tlt-tag", tg)));
    if (t.owners.length) meta.appendChild(el("span", "", t.owners.join(T("、"))));
    if (t.files.length) meta.appendChild(el("span", "", `▤ ${t.files.length}`));
    if (t.done && t.doneAt) meta.appendChild(el("span", "tlt-doneat", T("完成 {d}", { d: t.doneAt.slice(5) })));
    if (t.steps.length) meta.appendChild(this.stepRing(t));
    body.appendChild(meta);
    r.appendChild(body);
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
    const rows = this.store.staff.map((s) => ({
      s, sat: saturation(this.store.tasks, s.name, this.period, { capacity: s.capacity, days: s.days }),
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
    p.appendChild(el("div", "tlt-hint", T("档案来自 crew/<姓名>.md 的 frontmatter——岗位、产能、在岗天数都在文件里改；TLT 只读，任务侧只负责分配与统计。")));

    const grid = el("div", "tlt-staffgrid");
    rows.forEach(({ s, sat }) => {
      const card = el("div", "tlt-scard" + (sat.pct >= 100 ? " hot" : ""));
      card.dataset.staff = s.name;
      const h = el("div", "tlt-sh");
      const av = el("span", "tlt-av", s.name.slice(-2));
      av.style.background = s.color;
      const who = el("div", "tlt-who");
      who.append(el("div", "tlt-sname", s.name), el("div", "tlt-srole", `${s.role || "—"}${s.days < 5 ? T(" · 每周 {n} 天", { n: s.days }) : ""}`));
      const pct = el("span", "tlt-spct", String(sat.pct) + "%");
      h.append(av, who, pct);
      card.appendChild(h);
      const bar = el("div", "tlt-sbar");
      const fill = el("i"); fill.style.width = `${Math.min(100, sat.pct)}%`;
      if (sat.pct >= 100) fill.addClass("hot"); else if (sat.pct < 60) fill.addClass("idle");
      bar.appendChild(fill);
      card.appendChild(bar);
      const list = this.store.tasks.filter((t) => !t.done && t.owners.includes(s.name) && (t.pw || "m") === this.period);
      const meta = el("div", "tlt-smeta");
      meta.append(el("span", "", T("{n} 项任务", { n: list.length })),
        el("span", "", T("{a} / {b} 人天", { a: sat.sum, b: sat.avail })));
      card.appendChild(meta);
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
      if (it.body) c.appendChild(el("div", "tlt-ib", it.body));
      const meta = el("div", "tlt-im");
      meta.append(el("span", "", it.at));
      c.appendChild(meta);
      grid.appendChild(c);
    });
    p.appendChild(grid);
    if (!this.store.ideas.length) p.appendChild(el("div", "tlt-empty", T("还没有随手记。一行就能记，正文可以永远不写。")));
    return p;
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
    head.appendChild(this.sortControl());
    p.appendChild(head);
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
      this.sortItems(list,
        (m) => (this.sortKey() === "name" ? m.name : this.edgeDate(m.tasks, "min")),
        (m) => m.name);
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
    if (day && !pick("[data-slotgrid]")) { this.viewDate = day.dataset.day!; await this.render(); return; }

    const dnav = pick("[data-dnav]");
    if (dnav) { this.viewDate = addDays(this.viewDate, Number(dnav.dataset.dnav)); await this.render(); return; }
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

    const dim = pick("[data-dim]");
    if (dim) { this.taskDim = dim.dataset.dim as TaskDim; await this.render(); return; }

    const rv = pick("[data-rhythm]");
    if (rv) { this.rhythmView = rv.dataset.rhythm as "bars" | "star"; await this.render(); return; }

    const period = pick("[data-period]");
    if (period) { this.period = period.dataset.period as Period; await this.render(); return; }

    const pedit = pick("[data-projedit]");
    if (pedit) {
      const name = pedit.dataset.projedit ?? "";
      new ProjectInfoModal(this.app, this.store, name, () => this.render()).open();
      return;
    }
    const proj = pick("[data-proj]");
    if (proj) { const name = proj.dataset.proj ?? ""; this.proj = this.proj === name ? null : name; await this.render(); return; }
    if (pick("[data-projclear]")) { this.proj = null; await this.render(); return; }


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
      new Notice(T("已改到 {a}–{b}", { a: st, b: en }), 2500);
    } else {
      const l = this.store.logs.find((x) => x.id === id);
      if (!l) return;
      await this.store.setLogTime(l, st, en);
      new Notice(T("已改到 {a}–{b}", { a: st, b: en }), 2500);
    }
    await this.refresh();
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
      ...this.store.tasks.filter((x) => x.due === day && x.st && !x.done && x.id !== t.id),
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
    const end = Math.min(23 * 60, start + 60);
    if (t.due !== day) await this.store.setDue(t, day);
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
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  private findTask(id: string): Task | undefined {
    return [...this.store.tasks, ...this.store.logs].find((t) => t.id === id);
  }
}
