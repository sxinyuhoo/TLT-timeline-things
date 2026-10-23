import { t as T } from "../i18n";
import { ItemView, WorkspaceLeaf, Notice, App } from "obsidian";
import type TLTPlugin from "../main";
import { Store } from "../store";
import { Msg, Feed, todayISO, addDays, D, cleanFeedUrl, errMsg } from "../data";
import { el, MsgModal, buildMsgFields, popMenu, TltModal } from "./modals";
import { setSvgMarkup } from "./dom";

export const VIEW_TYPE_MESSAGES = "tlt-messages";
const KIND_COLOR: Record<string, string> = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export class MessagesView extends ItemView {
  plugin: TLTPlugin;
  /** 左栏多选：选中哪些源（空 = 全部源） */
  private selected: Set<string> = new Set();
  private zoom: "d" | "w" | "m" = "w";
  private filter: "all" | "star" | "unread" = "all";
  private range: "all" | "today" | "7" | "30" = "all";
  private mode: "card" | "spine" | "compact" | "bands" | "heat" | "net" | "axis" = "card";
  /** 横轴时间线：窗口跨度（天）与中心（相对今天的偏移） */
  private tlSpan = 33;
  private tlCenter = 13.5;
  private heatMonth = todayISO().slice(0, 7);
  private heatDay = "";
  private q = "";

  get store(): Store { return this.plugin.store; }

  constructor(leaf: WorkspaceLeaf, plugin: TLTPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_MESSAGES; }
  getDisplayText() { return "消息中心"; }
  getIcon() { return "rss"; }

  async onOpen() { await this.store.ensureLoaded(); await this.render(); }
  async refresh() { await this.store.load(); await this.render(); }

  private msgs(): Msg[] {
    return this.store.feeds.flatMap((f) => f.items);
  }

  async render() {
    // 源被删掉（取消发布/退订）后，选中集合里留着旧 id 会把时间线筛成空的
    const alive = new Set(this.store.feeds.map((f) => f.id));
    [...this.selected].forEach((id) => { if (!alive.has(id)) this.selected.delete(id); });

    const root = this.contentEl;
    const ae = document.activeElement;
    const keep = ae?.instanceOf(HTMLInputElement) && ae.dataset.focuskey
      ? { key: ae.dataset.focuskey, start: ae.selectionStart ?? 0, end: ae.selectionEnd ?? 0 }
      : null;
    root.empty();
    root.addClass("tlt-root");

    const outer = el("div", "tlt-fm");
    const head = el("div", "tlt-fm-h");
    head.append(el("b", "", "消息中心"), el("span", "tlt-fm-hint", "个人 · 发布 · 订阅"));
    head.appendChild(el("span", "tlt-spacer"));
    const th = el("button", "tlt-btn", this.plugin.isLight() ? "☾" : "☀");
    th.onclick = () => this.plugin.toggleTheme();
    head.appendChild(th);
    outer.appendChild(head);

    const body = el("div", "tlt-fm-body");
    body.append(this.rail(), this.center(), this.side());
    outer.appendChild(body);
    root.appendChild(outer);

    if (keep) {
      const again = root.querySelector<HTMLInputElement>(`[data-focuskey="${keep.key}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(keep.start, keep.end); } catch { /* noop */ } }
    }
  }

  /* ---------------- 左栏：多选筛选 ---------------- */

  private railRow(f: Feed) {
    const on = this.selected.has(f.id);
    const row = el("div", "tlt-fr" + (on ? " on" : "") + (f.mine ? " mine" : "") + (f.personal ? " personal" : ""));
    row.append(el("span", "tlt-ck" + (on ? " on" : "")), el("span", "tlt-fr-n", f.name),
      el("span", "tlt-fr-c", String(f.items.length)));
    row.onclick = (ev: MouseEvent) => {
      // 单击 = 只选它（右栏显示它的管理面板）；⌘/Ctrl 点 = 叠加多选（只用来筛时间线）
      if (ev.metaKey || ev.ctrlKey) {
        if (this.selected.has(f.id)) this.selected.delete(f.id);
        else this.selected.add(f.id);
      } else if (this.selected.size === 1 && this.selected.has(f.id)) {
        this.selected.clear();
      } else {
        this.selected.clear();
        this.selected.add(f.id);
      }
      void this.render();
    };
    return row;
  }

  private rail(): HTMLElement {
    const r = el("aside", "tlt-fm-rail");
    const personal = this.store.feeds.filter((f) => f.personal);
    const mine = this.store.feeds.filter((f) => f.mine && !f.personal);
    const subs = this.store.feeds.filter((f) => !f.mine && !f.personal);

    r.appendChild(el("div", "tlt-fgrp", "个人"));
    personal.forEach((f) => r.appendChild(this.railRow(f)));
    r.appendChild(el("div", "tlt-fgrp", "我发布的"));
    mine.forEach((f) => r.appendChild(this.railRow(f)));
    r.appendChild(el("div", "tlt-fgrp", "我订阅的"));
    subs.forEach((f) => r.appendChild(this.railRow(f)));
    if (!personal.length && !mine.length && !subs.length) r.appendChild(el("div", "tlt-empty", T("feeds/ 里还没有源")));

    const all = el("div", "tlt-fr add");
    all.append(el("span", "tlt-fr-n", this.selected.size ? `已选 ${this.selected.size} 个 · 清除` : "⌘ 点可多选 · 全部源"));
    all.onclick = () => { this.selected.clear(); void this.render(); };
    r.appendChild(all);
    return r;
  }

  /* ---------------- 中栏：新建 + 筛选 + 时间线 ---------------- */

  private center(): HTMLElement {
    const m = el("main", "tlt-fm-main");
    const items = this.visible();

    /* ---- 第一行：搜索 + 新建 ---- */
    const bar = el("div", "tlt-fm-bar");
    const sb = el("div", "tlt-fm-search");
    const si = el("input");
    si.placeholder = "搜索消息";
    si.value = this.q;
    si.dataset.focuskey = "msgsearch";
    let composing = false;
    si.addEventListener("compositionstart", () => { composing = true; });
    si.addEventListener("compositionend", () => {
      composing = false;
      this.q = si.value.trim();
      void this.render();
    });
    si.addEventListener("input", () => {
      if (composing) return;
      this.q = si.value.trim();
      void this.render();
    });
    sb.appendChild(si);
    bar.appendChild(sb);

    const add = el("button", "tlt-btn pri lg", "＋ 新建");
    add.onclick = () => new ComposeModal(this.app, this.store, () => this.refresh()).open();
    bar.appendChild(add);
    m.appendChild(bar);

    /* ---- 第二行：日期（范围 + 颗粒 + 回到今天）---- */
    const t1 = el("div", "tlt-fm-tools");
    const dg = el("div", "tlt-tgrp");
    dg.appendChild(el("span", "tlt-tgrp-l", "时间"));
    const range = el("div", "tlt-seg");
    ([["all", "全部"], ["today", "今天"], ["7", "近 7 天"], ["30", "近 30 天"]] as const).forEach(([v, t]) => {
      const b = el("button", "tlt-seg-b" + (this.range === v ? " on" : ""), t);
      b.onclick = () => { this.range = v; void this.render(); };
      range.appendChild(b);
    });
    dg.appendChild(range);
    t1.appendChild(dg);
    t1.appendChild(el("span", "tlt-spacer"));
    const today = el("button", "tlt-tlink", T("回到今天"));
    today.onclick = () => this.jumpToday();
    t1.appendChild(today);
    m.appendChild(t1);

    /* ---- 第三行：条数 + 形态 ---- */
    const t2 = el("div", "tlt-fm-tools sub");
    t2.appendChild(el("span", "tlt-count", `${items.length} 条`));
    t2.appendChild(el("span", "tlt-spacer"));

    const MODES = [["card", "卡片"], ["spine", "河流"], ["compact", "紧凑"],
      ["bands", "按源分带"], ["axis", "可缩放时间轴"], ["heat", "月度热力"], ["net", "人物脉络"]] as const;
    const cur = MODES.find(([v]) => v === this.mode) ?? MODES[0];
    const viewBtn = el("button", "tlt-btn tlt-viewbtn");
    viewBtn.append(el("span", "tlt-viewbtn-i", "▤"), el("span", "", T(cur[1])), el("span", "tlt-viewbtn-c", "⌄"));
    viewBtn.onclick = () => {
      popMenu(viewBtn, MODES.map(([v, label]) => ({
        label: (v === this.mode ? "✓ " : "   ") + T(label),
        onClick: () => { this.mode = v; void this.render(); },
      })), "right");
    };
    t2.appendChild(viewBtn);
    m.appendChild(t2);

    /* ---- 内容 ---- */
    if (this.mode === "heat") m.appendChild(this.heat());
    else if (this.mode === "axis") m.appendChild(this.axis(items));
    else if (this.mode === "bands") m.appendChild(this.bands(items));
    else if (this.mode === "net") m.appendChild(this.net(items));
    else m.appendChild(this.timeline(items));
    return m;
  }

  /** 时间线（卡片 / 河流 / 紧凑共用） */
  private timeline(items: Msg[]): HTMLElement {
    const list = el("div", "tlt-mtl wide mode-" + this.mode);
    if (!items.length) list.appendChild(el("div", "tlt-empty", T("没有符合条件的消息")));
    let last = "";
    items.forEach((x) => {
      const key = this.zoom === "m" ? x.date.slice(0, 7) : x.date;
      if (key !== last) {
        const d = D(x.date);
        const isToday = x.date === todayISO();
        const mk = el("div", "tlt-mday" + (isToday ? " today" : ""));
        mk.dataset.day = isToday ? "today" : x.date;
        mk.append(el("span", "tlt-mday-n",
          this.zoom === "m" ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` : `${d.getDate()}`));
        if (this.zoom !== "m") mk.append(el("span", "tlt-mday-u", `${d.getMonth() + 1} 月`));
        if (this.zoom !== "m") mk.append(el("span", "tlt-mday-w", `周${WEEK[d.getDay()]}`));
        if (isToday) mk.append(el("span", "tlt-mday-t", "今天"));
        list.appendChild(mk);
        last = key;
      }
      list.appendChild(this.item(x));
    });
    return list;
  }

  /** 可缩放时间轴：横轴是日期，滚轮缩放、拖动平移、双击复位 */
  private axis(items: Msg[]): HTMLElement {
    const box = el("div", "tlt-axis");
    const svg = createSvg("svg");
    svg.setAttribute("class", "tlt-axis-svg");
    svg.setAttribute("viewBox", "0 0 760 260");
    const W = 760;
    const label = el("div", "tlt-axis-hint", "");
    const redraw = () => {
      const lanes = this.axisLanes(items);
      const H = Math.max(120, 54 + lanes.length * 30);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      setSvgMarkup(svg, this.axisBody(W, H, items));
      label.textContent = `窗口 ${Math.round(this.tlSpan)} 天 · 滚轮缩放 · 拖动平移 · 双击回到默认（前 3 天后 30 天）`;
    };
    redraw();
    box.appendChild(svg);
    box.appendChild(label);

    const dayOf = (clientX: number) => {
      const r = svg.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      const to = this.tlCenter + this.tlSpan / 2;
      const from = to - this.tlSpan;
      return from + frac * this.tlSpan;
    };

    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const at = dayOf(e.clientX);
      const next = Math.max(2, Math.min(400, this.tlSpan * (e.deltaY < 0 ? 0.86 : 1.16)));
      const r = svg.getBoundingClientRect();
      const frac = (e.clientX - r.left) / r.width;
      this.tlCenter = at - frac * next + next / 2;
      this.tlSpan = next;
      redraw();
    }, { passive: false });

    let drag = false, sx = 0, c0 = 0;
    svg.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("[data-msg]")) return;
      drag = true; sx = e.clientX; c0 = this.tlCenter;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("grabbing");
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      this.tlCenter = c0 - ((e.clientX - sx) / r.width) * this.tlSpan;
      redraw();
    });
    const stop = () => { drag = false; svg.classList.remove("grabbing"); };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("dblclick", () => {
      this.tlSpan = 33; this.tlCenter = 13.5; redraw();
    });
    svg.addEventListener("click", (e) => {
      const target = e.target;
      const g = target instanceof Element ? target.closest("[data-msg]") : null;
      if (!g) return;
      const m = items.find((x) => x.id === g.getAttribute("data-msg"));
      if (m) this.openMsg(m);
    });
    return box;
  }

  private axisLanes(items: Msg[]) {
    return this.store.feeds
      .map((f) => ({ feed: f, items: items.filter((x) => x.feed === f.id) }))
      .filter((l) => l.items.length);
  }

  /** 横轴时间线的 SVG：日期刻度 + 每个源一条泳道 + 今天竖线 */
  private axisBody(W: number, H: number, items: Msg[]): string {
    const left = 92, right = W - 18;
    const plotW = right - left;
    const to = this.tlCenter + this.tlSpan / 2;
    const from = to - this.tlSpan;
    // 横轴用的是「相对今天的天数偏移」，不是 epoch 天数
    const baseDay = Math.floor(+D(todayISO()) / 864e5);
    const x = (off: number) => left + ((off - from) / this.tlSpan) * plotW;
    const offsetOf = (iso: string) => Math.floor(+D(iso) / 864e5) - baseDay;

    const steps = [1, 2, 3, 7, 14, 30, 90];
    const step = steps.find((s) => this.tlSpan / s <= 12) || 90;
    let g = "";
    // 网格 + 日期
    for (let d = Math.ceil(from / step) * step; d <= to; d += step) {
      const px = x(d);
      if (px < left - 1 || px > right + 1) continue;
      g += `<line class="tlt-axis-grid" x1="${px.toFixed(1)}" y1="34" x2="${px.toFixed(1)}" y2="${H - 10}"/>`;
      const dt = new Date((baseDay + d) * 864e5);
      const label = step >= 30 ? `${dt.getMonth() + 1}月` : `${dt.getMonth() + 1}/${dt.getDate()}`;
      g += `<text class="tlt-axis-tick" x="${px.toFixed(1)}" y="24" text-anchor="middle">${label}</text>`;
    }
    // 今天
    const tx = x(0);
    if (tx >= left && tx <= right) {
      g += `<line class="tlt-axis-today" x1="${tx.toFixed(1)}" y1="30" x2="${tx.toFixed(1)}" y2="${H - 8}"/>`;
      g += `<text class="tlt-axis-today-l" x="${(tx + 3).toFixed(1)}" y="40">今天</text>`;
    }
    // 泳道
    const lanes = this.axisLanes(items);
    lanes.forEach((lane, i) => {
      const y = 52 + i * 30;
      g += `<text class="tlt-axis-lane" x="${left - 10}" y="${y + 4}" text-anchor="end">${escapeXml(lane.feed.name.slice(0, 8))}</text>`;
      g += `<line class="tlt-axis-lane-l" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`;
      lane.items.forEach((m) => {
        const px = x(offsetOf(m.date));
        if (px < left - 6 || px > right + 6) return;
        const r = 3.2;
        g += `<g class="tlt-axis-g" data-msg="${escapeXml(m.id)}">
          <circle class="tlt-axis-hit" cx="${px.toFixed(1)}" cy="${y}" r="9"/>
          <circle class="tlt-axis-d" cx="${px.toFixed(1)}" cy="${y}" r="${r}" fill="${m.star ? "var(--tlt-acc)" : "var(--tlt-ink3)"}"/>
          <title>${escapeXml(`${m.date} ${m.title}`)}</title></g>`;
      });
    });
    if (!lanes.length) g += `<text class="tlt-axis-empty" x="${left}" y="70">这个窗口里没有消息</text>`;
    return g;
  }

  /** 按源分带：每个消息源一条泳道，横轴＝时间 */
  private bands(items: Msg[]): HTMLElement {
    const { from, to } = this.bounds();
    const a = +D(from), b = +D(to);
    const span = Math.max(864e5, b - a);
    const box = el("div", "tlt-bands");
    const axis = el("div", "tlt-band-axis");
    axis.append(el("span", "", from.slice(5)), el("span", "tlt-spacer"), el("span", "", to.slice(5)));
    box.appendChild(axis);

    const feeds = this.store.feeds.filter((f) => items.some((x) => x.feed === f.id));
    feeds.forEach((f) => {
      const row = el("div", "tlt-band");
      const name = el("div", "tlt-band-n");
      name.append(el("span", "tlt-band-dot"), el("span", "", f.name));
      const lane = el("div", "tlt-band-lane");
      items.filter((x) => x.feed === f.id).forEach((x) => {
        const p = el("i", "tlt-band-i");
        p.style.left = `${Math.max(0, Math.min(100, ((+D(x.date) - a) / span) * 100)).toFixed(2)}%`;
        p.style.background = KIND_COLOR[x.kind];
        p.title = `${x.date} · ${x.title}`;
        p.onclick = () => this.openMsg(x);
        lane.appendChild(p);
      });
      row.append(name, lane);
      box.appendChild(row);
    });
    if (!feeds.length) box.appendChild(el("div", "tlt-empty", T("这个范围里没有消息")));
    return box;
  }

  /** 月度热力：一个月一张格子，颜色深浅＝当天消息数 */
  private heat(): HTMLElement {
    const box = el("div", "tlt-heat");
    const all = this.msgs().filter((x) => !this.selected.size || this.selected.has(x.feed));
    const [y, mo] = this.heatMonth.split("-").map(Number);

    const head = el("div", "tlt-heat-h");
    const prev = el("button", "tlt-tlink", "‹");
    prev.onclick = () => { this.heatMonth = this.shiftMonth(-1); void this.render(); };
    const next = el("button", "tlt-tlink", "›");
    next.onclick = () => { this.heatMonth = this.shiftMonth(1); void this.render(); };
    head.append(prev, el("b", "", `${y} 年 ${mo} 月`), next, el("span", "tlt-spacer"),
      el("span", "tlt-heat-l", "少"), el("span", "tlt-heat-i lv1"), el("span", "tlt-heat-i lv2"),
      el("span", "tlt-heat-i lv3"), el("span", "tlt-heat-i lv4"), el("span", "tlt-heat-l", "多"));
    box.appendChild(head);

    const grid = el("div", "tlt-heat-grid");
    ["日", "一", "二", "三", "四", "五", "六"].forEach((w) => grid.appendChild(el("div", "tlt-heat-w", w)));
    const first = new Date(y, mo - 1, 1);
    const days = new Date(y, mo, 0).getDate();
    for (let i = 0; i < first.getDay(); i++) grid.appendChild(el("div", "tlt-heat-c blank"));
    const count: Record<string, number> = {};
    all.forEach((x) => { count[x.date] = (count[x.date] || 0) + 1; });
    const max = Math.max(1, ...Object.values(count));
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const n = count[key] || 0;
      const lv = n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3));
      const c = el("div", "tlt-heat-c" + (lv ? ` lv${lv}` : "") + (key === todayISO() ? " today" : "") + (this.heatDay === key ? " on" : ""));
      c.title = `${key} · ${n} 条`;
      c.append(el("span", "tlt-heat-d", String(d)));
      if (n) c.append(el("span", "tlt-heat-n", String(n)));
      c.onclick = () => { this.heatDay = key; void this.render(); };
      grid.appendChild(c);
    }
    box.appendChild(grid);

    if (this.heatDay) {
      const list = el("div", "tlt-heat-day");
      list.appendChild(el("div", "tlt-count", `${this.heatDay} 的消息`));
      all.filter((x) => x.date === this.heatDay).forEach((x) => {
        const row = el("div", "tlt-crow");
        const dot = el("span", "tlt-nd"); dot.style.background = KIND_COLOR[x.kind];
        row.append(dot, el("span", "tlt-crow-t", x.title));
        row.onclick = () => this.openMsg(x);
        list.appendChild(row);
      });
      if (!all.some((x) => x.date === this.heatDay)) list.appendChild(el("div", "tlt-empty", T("这天没有消息")));
      box.appendChild(list);
    }
    return box;
  }

  /** 人物脉络：谁发的源 → 哪些源 → 多少条 */
  private net(items: Msg[]): HTMLElement {
    const box = el("div", "tlt-net");
    const feeds = this.store.feeds.filter((f) => f.items.length);
    const owners = Array.from(new Set(feeds.map((f) => f.owner || "我")));
    const W = 640, H = Math.max(240, owners.length * 64);
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "tlt-net-svg");

    const oy = (i: number) => 34 + (i * (H - 68)) / Math.max(1, owners.length - 1);
    const fy = (i: number) => 26 + (i * (H - 52)) / Math.max(1, feeds.length - 1);
    let g = "";
    feeds.forEach((f, i) => {
      const oi = owners.indexOf(f.owner || "我");
      g += `<path class="tlt-net-e" d="M150 ${oy(oi).toFixed(1)} C 260 ${oy(oi).toFixed(1)}, 300 ${fy(i).toFixed(1)}, 400 ${fy(i).toFixed(1)}"/>`;
    });
    owners.forEach((o, i) => {
      const n = feeds.filter((f) => (f.owner || "我") === o).reduce((s, f) => s + f.items.length, 0);
      const label = o === "me" ? "我" : o;
      g += `<g class="tlt-net-g"><circle class="tlt-net-o" cx="130" cy="${oy(i).toFixed(1)}" r="${(11 + Math.min(9, n)).toFixed(1)}"/>
        <text class="tlt-net-t" x="130" y="${(oy(i) + 30).toFixed(1)}" text-anchor="middle">${escapeXml(label.slice(0, 6))}</text>
        <text class="tlt-net-n" x="130" y="${(oy(i) + 3).toFixed(1)}" text-anchor="middle">${n}</text></g>`;
    });
    feeds.forEach((f, i) => {
      const y = fy(i);
      g += `<g class="tlt-net-g" data-feed="${escapeXml(f.id)}">
        <rect class="tlt-net-hit" x="392" y="${(y - 12).toFixed(1)}" width="196" height="24"/>
        <rect class="tlt-net-f" x="400" y="${(y - 10).toFixed(1)}" width="${(56 + Math.min(96, f.items.length * 12)).toFixed(0)}" height="20" rx="10"/>
        <text class="tlt-net-t2" x="410" y="${(y + 4).toFixed(1)}">${escapeXml(f.name.slice(0, 12))}</text>
        <text class="tlt-net-n2" x="586" y="${(y + 4).toFixed(1)}">${f.items.length}</text></g>`;
    });
    setSvgMarkup(svg, g);
    svg.addEventListener("click", (ev) => {
      const target = ev.target;
      const t = target instanceof Element ? target.closest("[data-feed]") : null;
      if (!t) return;
      const id = t.getAttribute("data-feed") ?? "";
      if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
      void this.render();
    });
    box.appendChild(svg);
    box.appendChild(el("div", "tlt-hint", "圆＝人（数字是他们发的消息数），胶囊＝消息源，粗细不代表什么。点源可以只看它。"));
    return box;
  }

  private openMsg(x: Msg) {
    x.read_ = true;
    new MsgModal(this.app, this.store, x, () => this.refresh()).open();
  }

  private shiftMonth(d: number) {
    const [y, mo] = this.heatMonth.split("-").map(Number);
    const dt = new Date(y, mo - 1 + d, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }

  /** 一条消息：三种形态共用一套数据，只换外壳 */
  private item(x: Msg): HTMLElement {
    const feed = this.store.feeds.find((f) => f.id === x.feed);
    const dot = () => {
      const d = el("span", "tlt-nd");
      d.style.background = KIND_COLOR[x.kind];
      return d;
    };
    const open = () => this.openMsg(x);

    if (this.mode === "compact") {
      const row = el("div", "tlt-crow" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
      row.append(dot());
      row.append(el("span", "tlt-crow-t", x.title));
      row.append(el("span", "tlt-crow-s", feed ? feed.name : ""));

      row.onclick = open;
      return row;
    }

    if (this.mode === "spine") {
      const row = el("div", "tlt-srow" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
      const rail = el("div", "tlt-srail");
      rail.appendChild(dot());
      row.appendChild(rail);
      const body = el("div", "tlt-sbody");
      const nh = el("div", "tlt-nh");
      nh.append(el("span", "tlt-nm", x.title));
      if (x.star) nh.appendChild(el("span", "tlt-sk", "★"));
      body.appendChild(nh);
      body.appendChild(el("div", "tlt-nm2",
        [feed ? feed.name : "", x.place || "", x.who.length ? x.who.join("、") : "", x.state === "ended" ? "已结束" : ""]
          .filter(Boolean).join("  ·  ")));
      if (x.body) body.appendChild(el("div", "tlt-nb", x.body));
      row.appendChild(body);
      row.onclick = open;
      return row;
    }

    const card = el("div", "tlt-card" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
    const top = el("div", "tlt-card-top");
    const kd = el("span", "tlt-carddot");
    kd.style.background = KIND_COLOR[x.kind];
    top.append(kd, el("span", "tlt-nm", x.title));
    if (x.star) top.appendChild(el("span", "tlt-sk", "★"));
    card.appendChild(top);
    const bits = [feed ? feed.name : "", x.place || "", x.who.length ? x.who.join("、") : "", x.state === "ended" ? "已结束" : ""]
      .filter(Boolean);
    if (bits.length) card.appendChild(el("div", "tlt-nm2", bits.join("  ·  ")));
    if (x.body) card.appendChild(el("div", "tlt-nb", x.body));
    card.onclick = open;
    return card;
  }

  private bounds() {
    const back = this.zoom === "m" ? 60 : this.zoom === "d" ? 5 : 14;
    const fwd = this.zoom === "m" ? 120 : this.zoom === "d" ? 10 : 60;
    let from = addDays(todayISO(), -back), to = addDays(todayISO(), fwd);
    if (this.range === "today") { from = todayISO(); to = todayISO(); }
    if (this.range === "7") from = addDays(todayISO(), -7);
    if (this.range === "30") from = addDays(todayISO(), -30);
    return { from, to };
  }

  private visible(): Msg[] {
    const { from, to } = this.bounds();
    return this.msgs()
      .filter((x) => (this.filter === "star" ? x.star : this.filter === "unread" ? !x.read_ : true))
      .filter((x) => !this.selected.size || this.selected.has(x.feed))
      .filter((x) => !this.q || x.title.includes(this.q) || (x.body || "").includes(this.q) || (x.place || "").includes(this.q))
      .filter((x) => x.date >= from && x.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** 回到今天：找得到就滚过去，找不到就把范围放宽再滚 */
  private jumpToday() {
    const go = () => {
      const el2 = document.querySelector<HTMLElement>('.tlt-mtl [data-day="today"]');
      if (el2) el2.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    if (document.querySelector('.tlt-mtl [data-day="today"]')) { go(); return; }
    this.range = "7";
    if (!this.msgs().some((x) => x.date === todayISO())) this.range = "all";
    void this.render().then(() => window.setTimeout(go, 60));
  }

  /* ---------------- 右栏：消息源管理 ---------------- */

  private side(): HTMLElement {
    const s = el("aside", "tlt-fm-side");
    const ids = Array.from(this.selected);

    if (ids.length === 1) {
      const f = this.store.feeds.find((x) => x.id === ids[0]);
      if (f) {
        // 标题可改：源名称存在 frontmatter 里，发布/取消发布都沿用这个名字
        const tw = el("div", "tlt-d-titlewrap");
        const tEl = el("div", "tlt-d-title", f.name);
        const pen = el("button", "tlt-rename", "✎");
        pen.title = "改源名称";
        pen.onclick = () => {
          const inp = el("input", "tlt-input");
          inp.value = f.name;
          tw.empty();
          tw.appendChild(inp);
          inp.focus();
          inp.select();
          let done = false;
          const commit = () => { void (async () => {
            if (done) return;
            done = true;
            const v = inp.value.trim();
            if (v && v !== f.name) {
              await this.store.renameFeed(f, v);
              new Notice(`已改名为「${v}」`);
            }
            await this.refresh();
          })(); };
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") void this.render();
          });
          inp.addEventListener("blur", commit);
        };
        tw.append(tEl, pen);
        s.appendChild(tw);
        s.appendChild(el("div", "tlt-d-meta",
          `${f.personal ? "个人源" : f.mine ? "我发布的源" : "我订阅的源"} · ${f.items.length} 条`));

        const act = el("div", "tlt-d-act");
        if (f.personal) {
          s.appendChild(el("div", "tlt-d-body", "新消息默认进这里，只有自己看。点开某条草稿可以「发布为消息源」。"));
          const n = el("button", "tlt-btn pri", T("新建消息到这个源"));
          n.onclick = () => new ComposeModal(this.app, this.store, () => this.refresh(), f.id).open();
          act.appendChild(n);
          const pub = el("button", "tlt-btn", T("发布消息源…"));
          pub.title = "把这里的草稿变成一个别人能订阅的源";
          pub.onclick = () => new PublishFeedModal(this.app, this.store, f, () => this.refresh()).open();
          act.appendChild(pub);
        } else if (f.mine) {
          const st = this.plugin.hubState();
          const pid = (this.store.settings.feedIds || {})[f.id] || f.id;
          s.appendChild(el("div", "tlt-d-body", `订阅地址：${st.publish}/feed?id=${encodeURIComponent(pid)}`));
          const push = el("button", "tlt-btn pri", T("手动推送"));
          push.onclick = () => { void (async () => {
            try {
              const r = await this.store.publishFeed(f, st.publish, pid);
              new Notice(`已推送 ${r.count} 条`);
            } catch (e) { new Notice("推送失败：" + errMsg(e)); }
          })(); };
          const unpub = el("button", "tlt-btn danger", T("取消发布"));
          unpub.onclick = () => { void (async () => {
            try { await this.store.unpublishFeed(pid, st.publish); } catch { /* 服务没起也不影响本地 */ }
            const back = f.personal ? 0 : await this.store.foldBackToPersonal(f, "个人");
            this.selected.delete(f.id);
            await this.refresh();
            if (back < 0) new Notice("并回个人失败，源文件已保留，稍后再试");
            else new Notice(back ? `已取消发布，${back} 条回到「个人」` : "已取消发布（这个源里没有内容）");
          })(); };
          act.append(push, unpub);
        } else {
          const st = this.plugin.hubState();
          if (f.remote) s.appendChild(el("div", "tlt-d-body", f.remote));
          const un = el("button", "tlt-btn danger", T("取消订阅"));
          un.onclick = () => { void (async () => {
            try { await this.store.unsubscribeRemote(st.sync, f.remote || ""); } catch { /* 服务没起就只清本地 */ }
            this.selected.delete(f.id);
            const gone = await this.store.trashFeedFile(f);
            await this.refresh();
            new Notice(gone ? `已取消订阅「${f.name}」，本地文件已进回收站` : `已取消订阅「${f.name}」`);
          })(); };
          act.appendChild(un);
        }
        s.appendChild(act);
        s.appendChild(el("div", "tlt-hint", "左栏可多选源来过滤时间线；这里只管理当前这一个源。"));
        return s;
      }
    }

    if (ids.length > 1) {
      s.appendChild(el("div", "tlt-d-title", `已选 ${ids.length} 个源`));
      s.appendChild(el("div", "tlt-d-meta", "要管理某个源，只选它一个。"));
      const list = el("div", "tlt-src-list");
      ids.forEach((id) => {
        const f = this.store.feeds.find((x) => x.id === id);
        if (!f) return;
        const row = el("div", "tlt-src-row");
        row.append(el("span", "tlt-src-name", f.name),
          el("span", "tlt-src-kind", f.personal ? "个人" : f.mine ? "我发布" : "订阅"));
        list.appendChild(row);
      });
      s.appendChild(list);
      return s;
    }

    return this.overviewSide(s);
  }

  private overviewSide(s: HTMLElement): HTMLElement {
    const unread = this.msgs().filter((x) => !x.read_).length;
    const star = this.msgs().filter((x) => x.star).length;
    s.appendChild(el("div", "tlt-d-title", "消息源管理"));
    const stats = el("div", "tlt-d-stats");
    [[String(unread), "未读"], [String(star), "重要"], [String(this.store.feeds.length), "源"]].forEach(([v, l]) => {
      const c = el("div", "tlt-d-stat");
      c.append(el("b", "", v), el("span", "", l));
      stats.appendChild(c);
    });
    s.appendChild(stats);
    s.appendChild(this.hubPanel());
    s.appendChild(el("div", "tlt-hint", "点左栏某个源，这里换成它的管理面板（可多选筛选时间线）。"));
    return s;
  }

  private hubPanel(): HTMLElement {
    const box = el("div", "tlt-hub-side");
    const st = this.plugin.hubState();
    box.appendChild(el("div", "tlt-fgrp", "服务"));
    const row = (label: string, value: string) => {
      const d = el("div", "tlt-hub-row");
      d.append(el("span", "tlt-hub-l", label), el("code", "", value));
      return d;
    };
    box.appendChild(row(T("发布"), st.publish));
    box.appendChild(row("拉取", st.sync));
    box.appendChild(el("div", "tlt-hub-note",
      `自动同步：${st.syncMin ? `每 ${st.syncMin} 分钟` : "关闭"} · 自动推送：${st.pushMin ? `每 ${st.pushMin} 分钟` : "关闭"}（在设置里改）`));

    const btns = el("div", "tlt-hub-btns");
    const push = el("button", "tlt-btn", T("推送我的源"));
    push.onclick = () => new PublishModal(this.app, this.store, this.plugin, () => this.render()).open();
    const sync = el("button", "tlt-btn", T("同步订阅"));
    sync.onclick = () => { void (async () => {
      try {
        const r = await this.store.pullFromHub(st.sync);
        const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        this.plugin.setHubState({ lastSync: stamp, lastResult: `新增 ${r.added} 条`, lastError: "" });
        await this.refresh();
        new Notice(`同步完成：新增 ${r.added} 条`);
      } catch (e) { new Notice("同步失败：" + errMsg(e)); }
    })(); };
    btns.append(push, sync);
    box.appendChild(btns);

    const input = el("input", "tlt-input");
    input.placeholder = "订阅地址（可粘贴 @URL:…）";
    box.appendChild(input);
    const sub = el("button", "tlt-btn", T("订阅这个源"));
    sub.onclick = () => { void (async () => {
      const url = cleanFeedUrl(input.value);
      if (!url) { new Notice("先填订阅地址"); return; }
      try {
        const r = await this.store.subscribeRemote(st.sync, url);
        if (r.reason === "self") { new Notice("这是你自己发布的源，不需要订阅"); return; }
        if (r.existed) { new Notice("已经订阅过这个源"); input.value = ""; return; }
        input.value = "";
        const p = await this.store.pullFromHub(st.sync);
        await this.refresh();
        new Notice(`已订阅并同步 ${p.added} 条`);
      } catch (e) { new Notice("订阅失败：" + errMsg(e)); }
    })(); };
    box.appendChild(sub);
    return box;
  }
}

/* ================= 发布一个源 ================= */

class PublishFeedModal extends TltModal {
  store: Store;
  from: Feed;
  onDone: () => void | Promise<void>;
  constructor(app: App, store: Store, from: Feed, onDone: () => void | Promise<void>) {
    super(app); this.store = store; this.from = from; this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "发布消息源"));
    contentEl.appendChild(el("div", "tlt-m-meta",
      `把「${this.from.name}」里的草稿变成一个别人能订阅的源；发布后它会出现在「我发布的」里。`));

    const nameIn = el("input", "tlt-input wide tlt-input-title");
    nameIn.placeholder = "源名称（别人看到的名字）";
    nameIn.value = (this.store.settings.feedNames || {})[this.from.id] || this.from.name;
    nameIn.oninput = () => {
      this.store.settings.feedNames = { ...(this.store.settings.feedNames || {}), [this.from.id]: nameIn.value.trim() };
    };
    contentEl.appendChild(nameIn);

    const descRow = el("div", "tlt-row");
    descRow.appendChild(el("span", "tlt-row-l", "说明"));
    const descIn = el("input", "tlt-input");
    descIn.placeholder = "这个源发什么（可留空）";
    descRow.appendChild(descIn);

    const cadRow = el("div", "tlt-row");
    cadRow.appendChild(el("span", "tlt-row-l", "节奏"));
    const cadIn = el("input", "tlt-input");
    cadIn.placeholder = "比如 每周 2–3 条（可留空）";
    cadRow.appendChild(cadIn);

    contentEl.append(descRow, cadRow);
    contentEl.appendChild(el("div", "tlt-hint",
      "名称会记住，下次发布还是它；建好之后也能在右栏 ✎ 改。订阅地址由插件自动生成，不用自己起 ID。"));

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("发布"));
    ok.onclick = () => { void (async () => {
      const name = nameIn.value.trim();
      if (!name) { new Notice("先写源名称"); return; }
      try {
        const r = await this.store.publishSource(this.from, {
          name, desc: descIn.value.trim(), cadence: cadIn.value.trim(),
        });
        if (!r.ok) { new Notice("发布失败：名称空着"); return; }
        this.close(); void this.onDone();
        new Notice(`已发布「${name}」· 订阅地址在右栏里`);
      } catch (e) {
        new Notice("发布失败：" + errMsg(e));
      }
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => nameIn.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 新建消息 ================= */

class ComposeModal extends TltModal {
  store: Store;
  onDone: () => void | Promise<void>;
  presetFeed?: string;
  constructor(app: App, store: Store, onDone: () => void | Promise<void>, presetFeed?: string) {
    super(app); this.store = store; this.onDone = onDone; this.presetFeed = presetFeed;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "新建消息"));
    contentEl.appendChild(el("div", "tlt-m-meta", "只有标题必填；时间地点人物这些留着更好找，也可以空着。"));

    const f = buildMsgFields(contentEl, { date: todayISO() }, this.store);

    const srcRow = el("div", "tlt-row");
    srcRow.appendChild(el("span", "tlt-row-l", "消息源"));
    const src = el("select", "tlt-input");
    const options: Feed[] = [
      ...this.store.feeds.filter((x) => x.personal),
      ...this.store.feeds.filter((x) => x.mine && !x.personal),
    ];
    options.forEach((x) => {
      const o = createEl("option");
      o.value = x.id;
      o.textContent = `${x.name}（${x.personal ? "个人" : "已发布"}）`;
      src.appendChild(o);
    });
    if (this.presetFeed) src.value = this.presetFeed;
    srcRow.appendChild(src);
    contentEl.appendChild(srcRow);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("创建"));
    ok.onclick = () => { void (async () => {
      const v = f.value();
      if (!v.title) { new Notice("先写标题"); return; }
      if (!src.value) { new Notice("先选一个消息源"); return; }
      await this.store.addMessage(src.value, v);
      this.close(); void this.onDone(); new Notice("已创建消息");
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => f.titleEl.focus(), 50);
    f.titleEl.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) ok.click(); });
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 推送前确认 ID ================= */

class PublishModal extends TltModal {
  store: Store;
  plugin: TLTPlugin;
  onDone: () => void | Promise<void>;
  constructor(app: App, store: Store, plugin: TLTPlugin, onDone: () => void | Promise<void>) {
    super(app); this.store = store; this.plugin = plugin; this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "推送到发布服务"));
    contentEl.appendChild(el("div", "tlt-m-meta", "下面的 ID 就是别人订阅地址里的 ?id=。"));

    const rows: { feed: Feed; input: HTMLInputElement }[] = [];
    this.store.feeds.filter((f) => f.mine && !f.personal).forEach((f) => {
      const r = el("div", "tlt-row");
      r.appendChild(el("span", "tlt-row-l", f.name.slice(0, 6)));
      const box = el("div", "tlt-row-v");
      const input = el("input", "tlt-input");
      input.value = (this.store.settings.feedIds || {})[f.id] || f.id;
      box.append(input, el("div", "tlt-hint", `${f.items.length} 条`));
      r.appendChild(box);
      contentEl.appendChild(r);
      rows.push({ feed: f, input });
    });
    if (!rows.length) contentEl.appendChild(el("div", "tlt-hint", "没有可发布的源"));

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "保存并推送");
    ok.onclick = () => { void (async () => {
      const ids: Record<string, string> = {};
      rows.forEach(({ feed, input }) => { ids[feed.id] = input.value.trim() || feed.id; });
      this.store.settings.feedIds = ids;
      await this.plugin.saveSettings();
      try {
        let total = 0;
        for (const { feed, input } of rows) {
          const r = await this.store.publishFeed(feed, this.plugin.hubState().publish, input.value.trim() || feed.id);
          total += r.count || 0;
        }
        new Notice(`已推送 ${rows.length} 个源（${total} 条）`);
      } catch (e) { new Notice("推送失败：" + errMsg(e)); }
      this.close(); void this.onDone();
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}
