import { MarkdownPostProcessorContext } from "obsidian";
import type TLTPlugin from "../main";
import { Task, todayISO } from "../data";
import { t as T } from "../i18n";
import { el, TaskModal } from "./modals";

/**
 * 日记里的 TLT 块：把「今天要做什么」直接渲染进日记，勾选写回 TLT 的任务文件。
 *
 *   ```tlt-daily
 *   date: auto        # auto = 用文件名里的日期（补记历史日记也对），也可以写死 2026-10-29
 *   overdue: true     # 把过期未完成的单列一组
 *   tree: true        # 展开任务的子步骤，点子步骤也能勾
 *   who: true         # 显示负责人
 *   scope: all        # all | work | personal
 *   ```
 *
 * 不依赖 Tasks / Dataview 插件：数据来自 TLT 自己的 store，勾选走 store.toggleTask / setStepDone。
 */
export interface DailyOptions {
  /** "auto" = 按文件名里的日期；也可以写死 YYYY-MM-DD */
  date: string;
  overdue: boolean;
  tree: boolean;
  who: boolean;
  scope: "all" | "work" | "personal";
}

export function parseDailyOptions(source: string): DailyOptions {
  const o: DailyOptions = { date: "auto", overdue: true, tree: true, who: true, scope: "all" };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const m = /^([a-zA-Z]+)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (key === "date") o.date = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : "auto";
    else if (key === "overdue") o.overdue = val !== "false" && val !== "no";
    else if (key === "tree") o.tree = val !== "false" && val !== "no";
    else if (key === "who") o.who = val !== "false" && val !== "no";
    else if (key === "scope") o.scope = val === "work" || val === "personal" ? val : "all";
  }
  return o;
}

/** 文件名里的 8 位日期 → 那天；否则今天（和用户原来的日记约定一致：补记历史日记按文件名算） */
export function dateFromPath(path: string): string {
  const base = (path.split("/").pop() ?? "").replace(/\.md$/, "");
  const digits = base.replace(/\D/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return todayISO();
}

const isPersonal = (t: Task) => t.scope === "个人" || (t.tags || []).includes("个人");

function pick(tasks: Task[], o: DailyOptions, date: string) {
  const scopeOk = (t: Task) =>
    o.scope === "all" || (o.scope === "personal" ? isPersonal(t) : !isPersonal(t));
  const pool = tasks.filter((t) => t.kind !== "log" && scopeOk(t));
  const overdue = pool.filter((t) => !t.done && t.due && t.due < date);
  const planned = pool.filter((t) => !t.done && !t.due && t.start === date);
  const todo = pool.filter((t) => !t.done && t.due === date);
  // 「已完成」只看**真实的完成时间**（`[done:: 日期]`），不做任何"按截止日"的近似。
  // 那天到期、后来才勾掉的任务，会出现在**它真正被勾掉的那天**的日记里。
  const done = pool.filter((t) => t.done && t.doneAt === date);
  const rank = (a: Task, b: Task) =>
    (a.due || "9999").localeCompare(b.due || "9999") || b.pri - a.pri || (b.est || 0) - (a.est || 0);
  return {
    overdue: overdue.sort(rank),
    planned: planned.sort(rank),
    todo: todo.sort(rank),
    done: done.sort((a, b) => (a.doneAt || "").localeCompare(b.doneAt || "")),
  };
}

/** 渲染一个 tlt-daily 块（导出出来是为了能在测试里直接调） */
export function renderDaily(plugin: TLTPlugin, host: HTMLElement, source: string, path: string) {
  host.empty();
  const box = el("div", "tlt-daily");
  host.appendChild(box);
  const store = plugin.store;
  if (!store || !store.loaded) {
    // 数据还没读完（冷启动常见）：先给一句提示，store 读完那一刻 refreshDailyBlocks() 会重画
    box.appendChild(el("div", "tlt-daily-warn", T("TLT 数据还没就绪，稍等或重开这篇笔记")));
    return;
  }
  const o = parseDailyOptions(source);
  const date = o.date === "auto" ? dateFromPath(path) : o.date;
  const g = pick(store.tasks, o, date);

  const row = (t: Task, kind: "late" | "todo" | "done") => {
    const r = el("div", "tlt-daily-row" + (kind === "done" ? " done" : ""));
    const cb = el("i", "tlt-daily-cb" + (t.done ? " on" : ""));
    // 在阅读视图里点代码块，Obsidian 会顺手切到源码——把事件按住，只做勾选
    const hold = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    cb.addEventListener("mousedown", hold);
    cb.addEventListener("click", (ev) => {
      hold(ev);
      void (async () => { await store.toggleTask(t); plugin.refreshDailyBlocks(); })();
    });
    r.appendChild(cb);
    const body = el("div", "tlt-daily-b");
    const titleLine = el("div", "tlt-daily-trow");
    titleLine.appendChild(el("div", "tlt-daily-t", t.title));
    // 任务名后面一个笔：点它编辑（标题本身不响应点击，免得误触）
    const edit = el("button", "tlt-daily-edit", "📝");
    edit.title = T("编辑这条任务");
    edit.addEventListener("mousedown", hold);
    edit.addEventListener("click", (ev) => {
      hold(ev);
      new TaskModal(plugin.app, store, t, () => plugin.refreshDailyBlocks()).open();
    });
    titleLine.appendChild(edit);
    body.appendChild(titleLine);
    const bits: string[] = [`${t.project}${t.milestone ? " · " + t.milestone : ""}`];
    if (t.due && kind !== "done") bits.push(t.due === date ? T("今天到期") : T("截止 {d}", { d: t.due }));
    if (t.due && kind === "done") bits.push(T("截止 {d}", { d: t.due }));
    if (t.est !== undefined) bits.push(`${t.est} ${T("人天")}`);
    if (t.pri >= 2) bits.push(t.pri >= 3 ? T("紧急") : T("高"));
    if (o.who && t.owners.length) bits.push(t.owners.join(T("、")));

    body.appendChild(el("div", "tlt-daily-m", bits.join(" · ")));
    if (o.tree && t.steps.length) {
      const steps = el("div", "tlt-daily-steps");
      t.steps.forEach((st, i) => {
        const sr = el("div", "tlt-daily-step" + (st.done ? " done" : ""));
        const sc = el("i", "tlt-daily-cb small" + (st.done ? " on" : ""));
        sc.addEventListener("mousedown", hold);
        sc.addEventListener("click", (ev) => {
          hold(ev);
          void (async () => { await store.setStepDone(t, i, !st.done); plugin.refreshDailyBlocks(); })();
        });
        sr.append(sc, el("span", "", st.text));
        steps.appendChild(sr);
      });
      body.appendChild(steps);
    }
    r.appendChild(body);
    return r;
  };

  const section = (label: string, list: Task[], kind: "late" | "todo" | "done") => {
    if (!list.length) return;
    const h = el("div", "tlt-daily-h" + (kind === "late" ? " late" : ""));
    h.append(el("span", "", label), el("b", "", String(list.length)));
    box.appendChild(h);
    list.forEach((t) => box.appendChild(row(t, kind)));
  };

  if (o.overdue) section(T("逾期"), g.overdue, "late");
  section(T("今日待做"), g.todo, "todo");
  section(T("今天计划做"), g.planned, "todo");
  section(T("今日已完成"), g.done, "done");

  if ((!o.overdue || !g.overdue.length) && !g.todo.length && !g.planned.length && !g.done.length) {
    box.appendChild(el("div", "tlt-daily-empty", T("这天没有待办，也没有完成的记录")));
  }
}

/**
 * 注册 `tlt-daily` 代码块。
 *
 * 注意两件事：
 *  ① 首次渲染**不能**因为 `host.isConnected === false` 就跳过——Obsidian 有时先在离屏片段里渲染、
 *     再挂到文档上；按 isConnected 提前返回会得到一个空块（实测就是这样"看不见事项"的）。
 *     所以只记「画过没有」，清理留到数据刷新那一轮。
 *  ② 渲染函数与宿主元素一起记，数据一变全部重画；宿主已经离线的（笔记关了）顺手摘掉，别攒内存。
 */
export function registerDailyBlocks(plugin: TLTPlugin) {
  plugin.registerMarkdownCodeBlockProcessor("tlt-daily", (source: string, host: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const entry = {
      host,
      draw: () => renderDaily(plugin, host, source, ctx.sourcePath),
    };
    plugin.dailyBlocks.add(entry);
    entry.draw();
  });
}
