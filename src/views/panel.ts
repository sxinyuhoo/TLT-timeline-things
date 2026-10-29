import { ItemView, WorkspaceLeaf } from "obsidian";
import type TLTPlugin from "../main";
import { Store, DEFAULT_SETTINGS } from "../store";
import { saturation, inPeriod, todayISO } from "../data";
import { t as T } from "../i18n";
import { el } from "./modals";
import { VIEW_TYPE_WORKBENCH } from "./workbench";

export const VIEW_TYPE_PANEL = "tlt-overview";

/**
 * TLT 概览面板：给 Obsidian 的右侧栏用。
 * 只放「读数」（KPI / 完成度 / 人员饱和度 / 未指派 / 未排期），不放明细——
 * TLT 不是文件视图，右侧栏本来空着，这些数字正好填那个位置。
 * 数字全部来自 TLT 自己的 store，且跟着工作台当前选中的项目过滤。
 */
export class OverviewPanelView extends ItemView {
  plugin: TLTPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TLTPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_PANEL; }
  getDisplayText() { return T("TLT 概览"); }
  getIcon() { return "tlt-gauge"; }
  get store(): Store { return this.plugin.store; }
  private get cfg() { return (this.plugin as { store?: Store } | undefined)?.store?.settings ?? DEFAULT_SETTINGS; }

  async onOpen() {
    this.contentEl.addClass("tlt-root");
    this.contentEl.addClass("tlt-panel-root");
    try { await this.store.ensureLoaded(); } catch (e) { console.error("TLT: 面板载入数据失败", e); }
    await this.render();
  }

  async onClose() { this.contentEl.empty(); }

  async refresh() { await this.render(); }

  async render() {
    const root = this.contentEl;
    const keep = root.querySelector<HTMLElement>(".tlt-pn-body")?.scrollTop ?? 0;
    root.empty();
    const box = el("div", "tlt-pn");
    const proj = this.plugin.activeProject;
    root.appendChild(box);

    // 标题行：面板名 + 当前范围 + 刷新
    const head = el("div", "tlt-pn-head");
    head.appendChild(el("b", "tlt-pn-title", T("TLT 概览")));
    const scope = el("button", "tlt-pn-scope", proj || T("全部工作"));
    scope.title = proj ? T("只看这一个项目，点击回到全部") : T("当前是全库");
    if (proj) {
      scope.dataset.pnclear = "1";
      scope.onclick = () => this.plugin.setActiveProject(null);
    }
    head.appendChild(scope);
    const reload = el("button", "tlt-pn-icon", "⟳");
    reload.title = T("刷新");
    reload.onclick = () => { void (async () => { await this.store.load(); await this.render(); })(); };
    head.appendChild(reload);
    box.appendChild(head);

    const body = el("div", "tlt-pn-body");
    box.appendChild(body);

    const all = this.store.tasks.filter((t) => t.kind === "task").filter((t) => !proj || t.project === proj);
    const today = todayISO();
    const open = all.filter((t) => !t.done);
    const late = open.filter((t) => t.due && t.due < today);
    const dim = this.cfg.defaultPeriod || "m";
    const monthDue = open.filter((t) => t.due && t.due >= today && inPeriod(t.due, dim));
    const noOwner = open.filter((t) => !t.owners.length);
    const noDue = open.filter((t) => !t.due);
    const doneN = all.filter((t) => t.done).length;
    const projects = proj ? [proj] : this.store.projects();

    /* ---- 一、读数 ---- */
    body.appendChild(this.numRow(T("项目"), String(projects.length), null));
    const grid = el("div", "tlt-pn-grid");
    grid.append(
      this.numCard(T("逾期"), String(late.length), late.length ? "late" : "", { goto: { tab: "month", dim: "all" } }),
      this.numCard(T("本月到期"), String(monthDue.length), "", { goto: { tab: "month", dim: "m" } }),
      this.numCard(T("未指派"), String(noOwner.length), noOwner.length ? "warn" : "", { goto: { tab: "month", dim: "all" } }),
      this.numCard(T("未排期"), String(noDue.length), "", { goto: { tab: "month", dim: "all" } }),
    );
    body.appendChild(grid);

    /* ---- 二、完成度 ---- */
    const pct = all.length ? Math.round((doneN / all.length) * 100) : 0;
    const doneCard = el("div", "tlt-pn-block tlt-pn-done");
    doneCard.dataset.pngoto = "done";
    const dr = el("div", "tlt-pn-blockrow");
    dr.append(el("span", "tlt-pn-lab", T("完成")), el("span", "tlt-pn-val", `${pct}%`));
    doneCard.appendChild(dr);
    const bar = el("div", "tlt-pn-bar");
    const fill = el("i");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    doneCard.appendChild(bar);
    doneCard.appendChild(el("div", "tlt-pn-sub", T("已完成 {a} / 共 {b} 条", { a: doneN, b: all.length })));
    body.appendChild(doneCard);

    /* ---- 三、人员饱和度（未完成人天 ÷ 产能）---- */
    const rows = this.staffLoad(proj);
    if (rows.length) {
      const staffBox = el("div", "tlt-pn-block");
      const sh = el("div", "tlt-pn-blockrow");
      sh.append(el("span", "tlt-pn-lab", T("人员（未完成人天 / 产能）")), el("span", "tlt-pn-sub", T("点开人员页")));
      staffBox.dataset.pngoto = "staff";
      staffBox.appendChild(sh);
      rows.slice(0, 6).forEach((r) => {
        const line = el("div", "tlt-pn-staff");
        line.append(el("span", "tlt-pn-name", r.name));
        const b = el("span", "tlt-pn-mini");
        const f = el("i");
        f.style.width = `${Math.min(100, Math.round(r.pct))}%`;
        if (r.pct > 100) f.addClass("over");
        b.appendChild(f);
        line.append(b, el("span", "tlt-pn-pct", `${Math.round(r.pct)}%`));
        staffBox.appendChild(line);
      });
      if (rows.length > 6) {
        const rest = el("div", "tlt-pn-sub", T("还有 {n} 位", { n: rows.length - 6 }));
        rest.dataset.pngoto = "staff";
        staffBox.appendChild(rest);
      }
      body.appendChild(staffBox);
    }

    /* ---- 三、里程碑：开展中 / 已完成 ---- */
    const msList = this.store.milestones(proj || undefined);
    const msDone = msList.filter((m) => m.tasks.length > 0 && m.tasks.every((t) => t.done));
    const msBox = el("div", "tlt-pn-block");
    msBox.dataset.pngoto = "ms";
    const mr = el("div", "tlt-pn-blockrow");
    mr.append(el("span", "tlt-pn-lab", T("里程碑")), el("span", "tlt-pn-val", String(msList.length)));
    msBox.appendChild(mr);
    const mbar = el("div", "tlt-pn-bar");
    const mfill = el("i");
    mfill.style.width = `${msList.length ? Math.round((msDone.length / msList.length) * 100) : 0}%`;
    mbar.appendChild(mfill);
    msBox.appendChild(mbar);
    msBox.appendChild(el("div", "tlt-pn-sub",
      T("开展中 {a} · 已完成 {b}", { a: msList.length - msDone.length, b: msDone.length })));
    body.appendChild(msBox);

    /* ---- 四、子项进度（有子项的任务才计）---- */
    const stepTasks = all.filter((t) => t.steps.length);
    const stepTotal = stepTasks.reduce((n, t) => n + t.steps.length, 0);
    const stepDone = stepTasks.reduce((n, t) => n + t.steps.filter((x) => x.done).length, 0);
    if (stepTotal) {
      const stBox = el("div", "tlt-pn-block");
      const sr = el("div", "tlt-pn-blockrow");
      sr.append(el("span", "tlt-pn-lab", T("子项")), el("span", "tlt-pn-val", `${stepDone}/${stepTotal}`));
      stBox.appendChild(sr);
      const sbar = el("div", "tlt-pn-bar");
      const sfill = el("i");
      sfill.style.width = `${Math.round((stepDone / stepTotal) * 100)}%`;
      sbar.appendChild(sfill);
      stBox.appendChild(sbar);
      stBox.appendChild(el("div", "tlt-pn-sub", T("{n} 条任务拆了子项", { n: stepTasks.length })));
      body.appendChild(stBox);
    }

    /* ---- 五、最近完成（近 7 天）---- */
    const week = new Date();
    week.setDate(week.getDate() - 6);
    const p2d = (n: number) => String(n).padStart(2, "0");
    const from = `${week.getFullYear()}-${p2d(week.getMonth() + 1)}-${p2d(week.getDate())}`;
    const recent = all.filter((t) => t.done && t.doneAt && t.doneAt >= from);
    const rBox = el("div", "tlt-pn-block");
    rBox.dataset.pngoto = "month";
    const rr = el("div", "tlt-pn-blockrow");
    rr.append(el("span", "tlt-pn-lab", T("近期完成（7 天）")), el("span", "tlt-pn-val", String(recent.length)));
    rBox.appendChild(rr);
    rBox.appendChild(el("div", "tlt-pn-sub",
      recent.length ? T("最近一条：{t}", { t: recent[recent.length - 1].title.slice(0, 18) }) : T("这 7 天还没有完成的")));
    body.appendChild(rBox);

    // 点块跳工作台
    body.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const card = t.closest<HTMLElement>("[data-pngoto]");
      const num = t.closest<HTMLElement>("[data-pngoto-tab]");
      if (card) {
        const t2 = card.dataset.pngoto === "staff" ? "staff" : card.dataset.pngoto === "ms" ? "ms" : "month";
        void this.jump({ tab: t2, dim: "all" });
        return;
      }
      if (num) {
        void this.jump({
          tab: num.dataset.pngotoTab || "month",
          dim: num.dataset.pngotoDim || "all",
        });
      }
    });

    const b2 = body.querySelector<HTMLElement>(".tlt-pn-body");
    if (b2) b2.scrollTop = keep;
    body.scrollTop = keep;
  }

  private numRow(label: string, value: string, hint: string | null): HTMLElement {
    const r = el("div", "tlt-pn-block tlt-pn-row");
    r.append(el("span", "tlt-pn-lab", label), el("span", "tlt-pn-val", value));
    if (hint) r.appendChild(el("span", "tlt-pn-sub", hint));
    return r;
  }

  private numCard(label: string, value: string, mod: string, opts: { goto: { tab: string; dim: string } }): HTMLElement {
    const c = el("div", "tlt-pn-card" + (mod ? " " + mod : ""));
    c.dataset.pngotoTab = opts.goto.tab;
    c.dataset.pngotoDim = opts.goto.dim;
    c.append(el("span", "tlt-pn-val", value), el("span", "tlt-pn-lab", label));
    return c;
  }

  /** 未完成任务的 est 之和 ÷ 该人本期可用人天（和工作台的人员页同一套算法） */
  private staffLoad(proj: string | null): { name: string; pct: number; load: number }[] {
    const dim = this.cfg.defaultPeriod || "m";
    const tasks = this.store.tasks.filter((t) => !proj || t.project === proj);
    return this.store.staff
      .filter((s) => s.status !== "left" && s.status !== "leave")
      .map((s) => {
        const sat = saturation(tasks, s.name, dim, { capacity: s.capacity, days: s.days });
        return { name: s.name, pct: sat.pct, load: sat.sum };
      })
      .filter((r) => r.load > 0)
      .sort((a, b) => b.pct - a.pct);
  }

  private async jump(opts: { tab: string; dim?: string }) {
    await this.plugin.activateWorkbench();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKBENCH)[0];
    const v = leaf?.view as unknown as { focusOn?: (o: { tab?: string; dim?: string }) => void | Promise<void> } | undefined;
    try { await v?.focusOn?.(opts); } catch (e) { console.error("TLT: 面板跳转失败", e); }
  }
}
