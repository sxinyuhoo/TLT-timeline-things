import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type TLTPlugin from "../main";
import { Store } from "../store";
import {
  Task, Msg, Period, todayISO, addDays,
  hhmmToMin, minToHHMM, inPeriod, saturation, D, parseIdeaText, ideaTags, ideaFilterTags,
} from "../data";
import { TaskModal, LogModal, QuickLogModal, QuickTaskModal, StaffModal, AddStaffModal, IdeaModal, MsgModal, TaskPeekModal, MilestonePeekModal, el } from "./modals";
import { setSvgMarkup } from "./dom";

export const VIEW_TYPE_WORKBENCH = "tlt-workbench";
const DAY_FROM = 7 * 60, DAY_TO = 23 * 60, HOUR_PX = 62;
type TaskDim = "w" | "m" | "q" | "all";
const PERIOD_LABEL: Record<Period, string> = { w: "本周", m: "本月", q: "本季度" };
const KIND_LABEL: Record<string, string> = { ask: "要求", event: "活动", risk: "风险", note: "通知" };
const KIND_COLOR: Record<string, string> = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export class WorkbenchView extends ItemView {
  plugin: TLTPlugin;
  get store(): Store { return this.plugin.store; }
  private tab = "today";
  private viewDate = todayISO();
  private period: Period;
  private proj: string | null = null;
  private q = "";
  private expanded = new Set<string>();
  private rhythmView: "bars" | "star" = "star";
  private taskDim: TaskDim = "m";
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
  getDisplayText() { return "时间线工作台"; }
  getIcon() { return "activity"; }

  async onOpen() {
    this.contentEl.addEventListener("click", (ev) => { void this.onClick(ev); });
    await this.render();
  }
  async onClose() { this.contentEl.empty(); }

  async refresh() {
    await this.store.load();
    await this.render();
  }

  /* ================= 渲染 ================= */

  async render() {
    const root = this.contentEl;
    const prevScroll = root.querySelector<HTMLElement>(".tlt-work")?.scrollTop || 0;
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

  private sidebar(): HTMLElement {
    const s = el("aside", "tlt-side");
    const top = el("div", "tlt-brand");
    const dot = el("span", "tlt-mark");
    top.append(dot, el("b", "", "TLT"));
    const folder = el("span", "tlt-fold", "TLT/");
    folder.title = `${this.store.settings.tasksFolder} · ${this.store.settings.teamFolder}`;
    top.appendChild(folder);
    s.appendChild(top);

    const scroll = el("div", "tlt-side-scroll");
    scroll.appendChild(el("div", "tlt-shead", "项目 · 进度"));
    const projects = this.store.projects();
    const all = this.store.tasks;
    projects.forEach((p) => {
      const list = all.filter((t) => t.project === p);
      const pct = list.length ? Math.round((list.filter((t) => t.done).length / list.length) * 100) : 0;
      const card = el("div", "tlt-proj" + (this.proj === p ? " on" : ""));
      card.dataset.proj = p;
      const row = el("div", "tlt-prow");
      row.append(el("span", "tlt-sw"), el("span", "tlt-pname", p), el("span", "tlt-ppct", pct + "%"));
      const bar = el("div", "tlt-pbar");
      const fill = el("i"); fill.style.width = pct + "%"; bar.appendChild(fill);
      const meta = el("div", "tlt-pmeta", `${list.filter((t) => !t.done).length} 项未完成 · ${list.filter((t) => t.milestone).length} 个里程碑任务`);
      card.append(row, bar, meta);
      scroll.appendChild(card);
    });
    if (!projects.length) scroll.appendChild(el("div", "tlt-empty", "TLT/tasks 里还没有任务文件"));

    const seg = el("div", "tlt-seg tlt-period");
    (["w", "m", "q"] as Period[]).forEach((p) => {
      const b = el("button", "tlt-seg-b" + (this.period === p ? " on" : ""), PERIOD_LABEL[p]);
      b.dataset.period = p;
      seg.appendChild(b);
    });
    scroll.appendChild(seg);

    const idea = this.store.ideas;
    const box = el("div", "tlt-ideabox");
    box.dataset.tab = "ideas";
    box.append(el("span", "", "✦ 随手记"), el("b", "", String(idea.length)));
    const stale = idea.filter((i) => i.stage !== "已立项" && (Date.now() - D(i.at).getTime()) / 864e5 > 14).length;
    if (stale) box.append(el("span", "tlt-stale", `${stale} 条待回看`));
    scroll.appendChild(box);
    s.appendChild(scroll);

    const done = all.filter((t) => t.done).length;
    const mine = this.store.staff[0]?.name || "";
    const me = this.store.staff.find((x) => x.name === mine);
    const sat = saturation(this.store.tasks, mine, this.period, { capacity: me?.capacity ?? 100, days: me?.days ?? 5 });
    const foot = el("div", "tlt-sfoot");
    foot.append(el("span", "", `完成 ${done}/${all.length}`), el("span", "", `${PERIOD_LABEL[this.period]}我 ${sat.pct}%`));
    s.appendChild(foot);
    return s;
  }

  /* ---------- 主区 ---------- */

  private main(): HTMLElement {
    const m = el("main", "tlt-main");
    const top = el("div", "tlt-top");
    const crumbs = el("div", "tlt-crumbs");
    crumbs.append(el("b", "", this.proj || "全部工作"), el("span", "tlt-sep", "/"), el("span", "", this.tabName()));
    top.appendChild(crumbs);
    top.appendChild(el("div", "tlt-spacer"));

    const search = el("div", "tlt-search");
    const input = el("input");
    input.placeholder = { today: "搜索任务 / 记录", month: "搜索任务", ms: "搜索里程碑", staff: "搜索人员", ideas: "搜索随手记", draw: "" }[this.tab] || "搜索";
    input.value = this.q;
    input.dataset.search = "1";
    input.dataset.focuskey = "search";
    search.appendChild(input);
    top.appendChild(search);

    const theme = el("button", "tlt-btn", this.plugin.isLight() ? "☾" : "☀");
    theme.dataset.theme = "1";
    theme.title = "切换明暗";
    const add = el("button", "tlt-btn pri lg", "＋ 新建");
    add.dataset.newtask = "1";
    top.append(theme, add);
    m.appendChild(top);

    const tabs = el("div", "tlt-tabs");
    [["today", "日历"], ["month", "任务"], ["ms", "里程碑"], ["staff", "人员"], ["ideas", "随手记"], ["draw", "随手画"]].forEach(([k, t]) => {
      const b = el("button", "tlt-tab" + (this.tab === k ? " on" : ""), t);
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
    return { today: "日历", month: "任务", ms: "里程碑", staff: "人员", ideas: "随手记", draw: "随手画" }[this.tab] || "";
  }

  /* ---------- 日历 ---------- */

  private tasksForDay(k: string) {
    return this.store.tasks.filter((t) => t.due === k || (t.start && t.due && t.start <= k && t.due >= k));
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
    lab.append(`${dl.getMonth() + 1} 月 ${dl.getDate()} 日`);
    lab.createEl("em", { text: `周${WEEK[dl.getDay()]}${sel === todayISO() ? " · 今天" : ""}` });
    const todayBtn = el("button", "tlt-btn", "回到今天"); todayBtn.dataset.today = "1";
    bar.append(prev, lab, next, todayBtn, el("span", "tlt-spacer"),
      el("span", "tlt-dhint", `${this.logsOn(sel).length} 条记录 · ${this.unscheduled(sel).length} 未排`));

    // 7 天条
    const strip = el("div", "tlt-strip");
    for (let i = -3; i <= 3; i++) {
      const k = addDays(sel, i);
      const cell = el("div", "tlt-ds" + (k === sel ? " sel" : "") + (k === todayISO() ? " today" : ""));
      cell.dataset.day = k;
      cell.append(el("span", "tlt-dw", WEEK[D(k).getDay()]), el("span", "tlt-dn", String(D(k).getDate())));
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
        el("div", "tlt-blk-m", `${t.st}–${t.en} · 计划${t.wl ? " · " + t.wl + "%" : ""}`));
      blk.appendChild(c);
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
        el("div", "tlt-blk-m", `${l.st}–${l.en} · ${l.extra ? "临时" : "记录"}${l.project ? " · " + l.project : ""}`));
      blk.appendChild(c);
      inner.appendChild(blk);
    });
    if (sel === todayISO()) {
      const now = new Date();
      const nm = now.getHours() * 60 + now.getMinutes();
      if (nm > DAY_FROM && nm < DAY_TO) {
        const line = el("div", "tlt-now");
        line.style.top = `${((nm - DAY_FROM) / 60) * HOUR_PX}px`;
        line.appendChild(el("b", "", `现在 ${minToHHMM(nm)}`));
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
    h1.append(el("span", "", "这天要做的"), el("span", "tlt-hint2", "点一下排进时间表"));
    b1.appendChild(h1);
    if (uns.length) {
      const chips = el("div", "tlt-chips");
      uns.forEach((t) => {
        const c = el("span", "tlt-chipq");
        c.dataset.sched = t.id;
        c.title = "点一下排进这天的时间表";
        c.textContent = `${t.title}${t.wl ? " · " + t.wl + "%" : ""}`;
        chips.appendChild(c);
      });
      b1.appendChild(chips);
    } else b1.appendChild(el("div", "tlt-empty", "都排上了"));
    side.appendChild(b1);

    const plan = logs.filter((l) => !l.extra).length;
    const extra = logs.filter((l) => l.extra).length;
    const b2 = el("div", "tlt-box");
    b2.appendChild(el("div", "tlt-box-h", "这天 · 计划与实际"));
    [["计划", plan], ["记录", logs.length], ["其中临时", extra]].forEach(([n, v]) => {
      const r = el("div", "tlt-sum");
      r.append(el("span", "tlt-sum-n", String(n)));
      const bar2 = el("span", "tlt-sum-b");
      const fill = el("i"); fill.style.width = `${Math.min(100, (Number(v) / 6) * 100)}%`;
      bar2.appendChild(fill);
      r.append(bar2, el("span", "tlt-sum-v", `${v} 条`));
      b2.appendChild(r);
    });
    if (logs.length) {
      const pct = Math.round((extra / logs.length) * 100);
      b2.appendChild(el("div", "tlt-hint", `临时占了这天记录的 ${pct}%`));
    }
    side.appendChild(b2);
    wrap.appendChild(side);
    p.appendChild(wrap);

    // 时间轴定位：刚排期的任务 → 它的开始时间；否则当天滚到此刻前半小时，别的日子滚到 9:00
    const jump = this.scrollToMin;
    this.scrollToMin = null;
    const d0 = new Date();
    const nowMin = d0.getHours() * 60 + d0.getMinutes();
    const focus = jump !== null ? jump : sel === todayISO() ? Math.max(DAY_FROM, nowMin) : 9 * 60;
    grid.dataset.scrollTop = String(Math.max(0, ((focus - DAY_FROM) / 60) * HOUR_PX - 90));
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
    head.append(el("span", "tlt-rhythm-t", "节奏 · 21 天"));
    head.appendChild(el("span", "tlt-rhythm-s", `${dueN} 个到期 · ${msN} 个里程碑 · 最挤 ${D(busy).getMonth() + 1}/${D(busy).getDate()}（${bn} 件）`));
    head.appendChild(el("span", "tlt-spacer"));
    const seg = el("div", "tlt-seg tlt-rhythm-seg");
    ([["bars", "条带"], ["star", "星图"]] as const).forEach(([k, t]) => {
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
      c.title = `${k} · ${n} 件`;
      mini.appendChild(c);
    });
    wrap.appendChild(mini);
    return wrap;
  }

  /** 极坐标时间线：半径=时间，扇区=项目，连线=同一个人 */
  private starMap(): HTMLElement {
    const box = el("div", "tlt-star-box");
    const svg = createSvg("svg");
    svg.setAttribute("class", "tlt-star");
    svg.setAttribute("viewBox", "0 0 560 210");
    const redraw = () => { setSvgMarkup(svg, this.starBody(560, 210)); };
    redraw();
    box.appendChild(svg);
    box.appendChild(el("div", "tlt-star-legend",
      "半径=时间（内圈今天，每圈 7 天） · 扇区=项目 · 圆点=任务 · 菱形=里程碑 · 细线=同一个人 · 滚轮缩放，拖动平移"));

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
    const projects = Array.from(new Set(tasks.map((t) => t.project))).slice(0, 8);
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
    [0, 7, 14, 21].forEach((d) => {
      const r = r0 + (d / 21) * (R - r0);
      body += `<circle class="tlt-ring" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/>`;
      body += `<text class="tlt-rlab" x="${(cx + 3).toFixed(1)}" y="${(cy - r + 9).toFixed(1)}">${d === 0 ? "今天" : "+" + d + "天"}</text>`;
    });
    projects.forEach((p, i) => {
      const a = ((-90 + i * span) * Math.PI) / 180;
      body += `<line class="tlt-spoke" x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * (R + 8)).toFixed(1)}" y2="${(cy + Math.sin(a) * (R + 8)).toFixed(1)}"/>`;
      const lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 18);
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      body += `<text class="tlt-plab" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${escapeXml(p.slice(0, 8))}</text>`;
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
    const label = { w: "本周", m: "本月", q: "本季度", all: "全部" }[this.taskDim];
    head.append(el("span", "", `${label} · ${m.late.length} 逾期 / ${m.todo.length} 要做 / ${m.done.length} 已完成 / ${m.pending.length} 待排期`));
    head.appendChild(el("span", "tlt-spacer"));
    const tags = Array.from(new Set(["工作", "个人", ...this.store.tasks.flatMap((t) => t.tags || [])]));
    const tf = el("div", "tlt-seg tlt-tag-seg");
    [{ v: null, t: "全部" }, ...tags.map((t) => ({ v: t, t }))].forEach(({ v: tv, t }) => {
      const b = el("button", "tlt-seg-b" + (this.taskTag === tv ? " on" : ""), t);
      b.dataset.tag = tv ?? "";
      tf.appendChild(b);
    });
    head.appendChild(tf);
    const seg = el("div", "tlt-seg tlt-dim-seg");
    ([["w", "本周"], ["m", "本月"], ["q", "本季度"], ["all", "全部"]] as const).forEach(([k, t]) => {
      const b2 = el("button", "tlt-seg-b" + (this.taskDim === k ? " on" : ""), t);
      b2.dataset.dim = k;
      seg.appendChild(b2);
    });
    head.appendChild(seg);
    p.appendChild(head);
    const groups: [string, Task[], string][] = [
      [`${label}逾期`, m.late, "#D98B5F"],
      [`${label}要做`, m.todo, "#5B6CFF"],
      [`${label}已完成`, m.done, "#4FB59A"],
      ["待排期（未分配时间）", m.pending, "#8B7CF6"],
    ];
    groups.forEach(([name, list, color]) => {
      const g = el("div", "tlt-mgrp");
      const h = el("div", "tlt-mgh");
      const dot = el("span", "tlt-dot"); dot.style.background = color;
      h.append(dot, el("span", "", name), el("span", "tlt-mgc", String(list.length)));
      g.appendChild(h);
      if (!list.length) g.appendChild(el("div", "tlt-empty", "没有"));
      list.forEach((t) => g.appendChild(this.taskRow(t)));
      p.appendChild(g);
    });
    return p;
  }

  /** 任务视图的维度：本周 / 本月 / 本季度 / 全部 */
  private tasksInDim() {
    const all = this.store.tasks.filter((t) => t.kind === "task")
      .filter((t) => !this.q || t.title.includes(this.q) || (t.project || "").includes(this.q) || (t.milestone || "").includes(this.q))
      .filter((t) => !this.taskTag ||
        (this.taskTag === "工作" || this.taskTag === "个人" ? t.scope === this.taskTag : (t.tags || []).includes(this.taskTag)));
    const dim = this.taskDim;
    const inDim = (d?: string) => (dim === "all" ? true : !!d && inPeriod(d, dim));
    const today = todayISO();
    return {
      late: all.filter((t) => !t.done && t.due && t.due < today && inDim(t.due)),
      todo: all.filter((t) => !t.done && t.due && t.due >= today && inDim(t.due)),
      done: all.filter((t) => t.done && inDim(t.due)),
      pending: all.filter((t) => !t.done && !t.due),
    };
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
    meta.appendChild(el("span", "", t.due ? t.due.slice(5) : "待排期"));
    if (t.est !== undefined) meta.appendChild(el("span", "tlt-wl", `${t.est} 人天`));
    else if (t.wl) meta.appendChild(el("span", "tlt-wl", `${t.wl}%`));
    if (t.scope === "个人") meta.appendChild(el("span", "tlt-tag own", "个人"));
    (t.tags || []).forEach((tg) => meta.appendChild(el("span", "tlt-tag", tg)));
    if (t.owners.length) meta.appendChild(el("span", "", t.owners.join("、")));
    if (t.files.length) meta.appendChild(el("span", "", `▤ ${t.files.length}`));
    body.appendChild(meta);
    r.appendChild(body);
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
    head.append(el("span", "", `${rows.length} 人 · 平均 ${avg}% · ${over} 人超载 · ${idle} 人偏闲`));
    head.appendChild(el("span", "tlt-src", this.store.settings.teamFolder));
    head.appendChild(el("span", "tlt-spacer"));
    const add = el("button", "tlt-btn", "＋ 添加成员");
    add.dataset.addstaff = "1";
    head.appendChild(add);
    p.appendChild(head);
    p.appendChild(el("div", "tlt-hint", "档案来自 team/<姓名>.md 的 frontmatter——岗位、产能、在岗天数都在文件里改；TLT 只读，任务侧只负责分配与统计。"));

    const grid = el("div", "tlt-staffgrid");
    rows.forEach(({ s, sat }) => {
      const card = el("div", "tlt-scard" + (sat.pct >= 100 ? " hot" : ""));
      card.dataset.staff = s.name;
      const h = el("div", "tlt-sh");
      const av = el("span", "tlt-av", s.name.slice(-2));
      av.style.background = s.color;
      const who = el("div", "tlt-who");
      who.append(el("div", "tlt-sname", s.name), el("div", "tlt-srole", `${s.role || "—"}${s.days < 5 ? ` · 每周 ${s.days} 天` : ""}`));
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
      meta.append(el("span", "", `${list.length} 项任务`),
        el("span", "", `${sat.sum} / ${sat.avail} 人天`));
      card.appendChild(meta);
      grid.appendChild(card);
    });
    p.appendChild(grid);
    if (!rows.length) p.appendChild(el("div", "tlt-empty", "TLT/team 里还没有人员档案"));
    return p;
  }

  /* ---------- 想法 ---------- */

  private paneIdeas(): HTMLElement {
    const p = el("div", "tlt-pane");
    const cap = el("div", "tlt-cap");
    const i = el("input");
    i.placeholder = "随手记一句，前面可以加 #标签，例：#论文 #灵感 把常用脚本整理成工具";
    i.dataset.ideanew = "1";
    const plus = el("button", "tlt-btn lg", "＋ 随手记");
    plus.dataset.ideanewmodal = "1";
    cap.append(el("span", "tlt-plus", "✦"), i, plus);
    p.appendChild(cap);
    p.appendChild(el("div", "tlt-hint", "用 # 打标签，想打几个打几个。回车收录；也可以点「＋ 随手记」用表单。"));
    const prev = el("div", "tlt-idea-prev");
    prev.dataset.ideaprev = "1";
    p.appendChild(prev);

    const allTags = Array.from(new Set([...this.store.tags, ...this.store.ideas.flatMap((i) => ideaFilterTags(i))]));
    const shown = this.store.ideas
      .filter((i) => !this.q || i.title.includes(this.q) || (i.body || "").includes(this.q))
      .filter((i) => !this.ideaTags.size || ideaFilterTags(i).some((t) => this.ideaTags.has(t)));
    const stale = this.store.ideas.filter((x) => (Date.now() - D(x.at).getTime()) / 864e5 > 14).length;
    const meta = el("div", "tlt-ideas-meta");
    meta.append(el("span", "", `${shown.length} 条随手记`),
      el("span", "tlt-sep-dot", "·"),
      el("span", "", stale ? `${stale} 条超过两周没动` : "没有搁太久的"));
    p.appendChild(meta);

    if (allTags.length) {
      const tf = el("div", "tlt-tagpick");
      const all = el("button", "tlt-tagp" + (this.ideaTags.size ? "" : " on"), "全部");
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
      if (!ideaTags(it).length) h.append(el("span", "tlt-itype", "未打标签"));
      c.append(h, el("div", "tlt-it", it.title));
      if (it.body) c.appendChild(el("div", "tlt-ib", it.body));
      const meta = el("div", "tlt-im");
      meta.append(el("span", "", it.at));
      c.appendChild(meta);
      grid.appendChild(c);
    });
    p.appendChild(grid);
    if (!this.store.ideas.length) p.appendChild(el("div", "tlt-empty", "还没有随手记。一行就能记，正文可以永远不写。"));
    return p;
  }

  /* ---------- 里程碑 ---------- */

  /** 随手画：功能预留 */
  private paneDraw(): HTMLElement {
    const p = el("div", "tlt-pane");
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", "随手画 · 功能预留"));
    p.appendChild(head);
    const box = el("div", "tlt-emptybox");
    box.append(
      el("div", "tlt-empty-k", "随手画"),
      el("div", "tlt-empty-d", "先占个位置：随手记里的草图、白板、截图批注会在这里。还没有实现，标记为预留。"),
    );
    const chips = el("div", "tlt-quick");
    ["手绘草图", "思维导图", "截图批注", "与随手记互转"].forEach((t) => chips.appendChild(el("span", "tlt-chip off", t)));
    box.appendChild(chips);
    p.appendChild(box);
    return p;
  }

  private paneMilestones(): HTMLElement {
    const p = el("div", "tlt-pane");
    const ms = this.store.milestones(this.proj || undefined)
      .filter((m) => !this.q || m.name.includes(this.q) || (m.project || "").includes(this.q) || m.tasks.some((t) => t.title.includes(this.q)));
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", `${ms.length} 个里程碑 · ${ms.filter((m) => m.tasks.every((t) => t.done)).length} 已完成`));
    p.appendChild(head);
    if (!ms.length) p.appendChild(el("div", "tlt-empty", "任务文件里用「## 里程碑名」分节，这里就会出现里程碑。"));

    ms.forEach((m) => {
      const done = m.tasks.filter((t) => t.done).length;
      const pct = Math.round((done / m.tasks.length) * 100);
      const card = el("div", "tlt-ms" + (this.expanded.has(m.name) ? " open" : ""));
      card.dataset.ms = m.name;
      const h = el("div", "tlt-ms-h");
      const dot = el("span", "tlt-dot"); dot.addClass("k-ms");
      h.append(dot, el("span", "tlt-ms-n", m.name), el("span", "tlt-ms-p", m.project));
      const bar = el("span", "tlt-pbar small");
      const fill = el("i"); fill.style.width = pct + "%";
      bar.appendChild(fill);
      h.append(el("span", "tlt-spacer"), bar, el("span", "tlt-ms-c", `${done}/${m.tasks.length}`));
      card.appendChild(h);
      if (this.expanded.has(m.name)) {
        const body = el("div", "tlt-ms-b");
        m.tasks.forEach((t) => body.appendChild(this.taskRow(t)));
        card.appendChild(body);
      }
      p.appendChild(card);
    });
    return p;
  }

  /* ---------- 右栏：消息 ---------- */

  private rail(): HTMLElement {
    const r = el("aside", "tlt-msgs");
    const head = el("div", "tlt-msgs-h");
    const unread = this.allMsgs().filter((m) => !m.read_ && m.state !== "ended").length;
    head.append(el("b", "", "消息"));
    const badge = el("span", "tlt-badge", String(unread));
    head.appendChild(badge);
    const expand = el("button", "tlt-expand-btn");
    expand.dataset.expand = "1";
    expand.title = "在独立页打开消息中心";
    expand.append(el("span", "tlt-expand-i", "⤢"), el("span", "", "消息中心"));
    head.appendChild(expand);
    r.appendChild(head);

    const list = el("div", "tlt-mtl");
    // 搜索只作用在工作区（任务/里程碑/随手记），右栏消息永远看全部
    const items = this.allMsgs().sort((a, b) => a.date.localeCompare(b.date));
    let last = "";
    items.forEach((m) => {
      if (m.date !== last) {
        const d = D(m.date);
        list.appendChild(el("div", "tlt-mday" + (m.date === todayISO() ? " today" : ""), `${d.getMonth() + 1}/${d.getDate()} · 周${WEEK[d.getDay()]}`));
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
        `${KIND_LABEL[m.kind]}${m.place ? " · " + m.place : ""}${m.state === "ended" ? " · 已结束" : ""}`));
      list.appendChild(n);
    });
    if (!items.length) list.appendChild(el("div", "tlt-empty", "还没有消息。在 feeds/ 里建一个源，或点 ＋ 发布一条。"));
    r.appendChild(list);

    const foot = el("div", "tlt-mfoot", `源 ${this.store.feeds.length} · 消息 ${items.length}`);
    r.appendChild(foot);
    return r;
  }

  private allMsgs(): (Msg & { read_?: boolean })[] {
    return this.store.feeds.flatMap((f) => f.items);
  }

  /* ---------- 交互 ---------- */

  private bindInputs(root: HTMLElement) {
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
        ideaPrev.createSpan({ cls: "tlt-pv-l", text: "识别到" });
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
        new Notice("已收进想法池");
      })(); });
    }
  }

  /** 空白处点击 → 按坐标算时间 */
  private async onClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const pick = (sel: string) => t.closest<HTMLElement>(sel);

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

    const proj = pick("[data-proj]");
    if (proj) { const name = proj.dataset.proj ?? ""; this.proj = this.proj === name ? null : name; await this.render(); return; }

    if (pick("[data-theme]")) { this.plugin.toggleTheme(); return; }

    if (pick("[data-newtask]")) { new QuickTaskModal(this.app, this.store, () => this.refresh()).open(); return; }

    if (pick("[data-ideanewmodal]")) { new IdeaModal(this.app, this.store, undefined, () => this.refresh()).open(); return; }

    if (pick("[data-expand]")) { await this.plugin.activateMessages(); return; }

    const ck = pick("[data-ck]");
    if (ck) {
      ev.stopPropagation();
      const task = this.findTask(ck.dataset.ck ?? "");
      if (task) { await this.store.toggleTask(task); await this.refresh(); }
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

  /** 把一条任务排进当前日期的第一个空档（排完写回 [st::] [en::]） */
  private async scheduleTask(t: Task) {
    const day = this.viewDate;
    const busy = [
      ...this.store.logs.filter((l) => l.due === day),
      ...this.store.tasks.filter((x) => x.due === day && x.st && !x.done),
    ];
    let start = 9 * 60;
    if (busy.length) {
      start = Math.max(...busy.map((b) => hhmmToMin(b.en) || (hhmmToMin(b.st) || 540) + 30));
    }
    if (start >= 22 * 60) { new Notice("这天排满了，换一天试试"); return; }
    const end = Math.min(23 * 60, start + 60);
    if (t.due !== day) await this.store.setDue(t, day);
    await this.store.setField(t, "st", minToHHMM(start));
    await this.store.setField(t, "en", minToHHMM(end));
    this.scrollToMin = start;
    await this.refresh();
    new Notice(`已排入 ${minToHHMM(start)}–${minToHHMM(end)}`);
  }

  private findTask(id: string): Task | undefined {
    return [...this.store.tasks, ...this.store.logs].find((t) => t.id === id);
  }
}
