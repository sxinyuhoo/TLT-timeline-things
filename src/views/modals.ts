import { App, Modal, Notice, TFile } from "obsidian";
import type TLTPlugin from "../main";
import { Store } from "../store";
import { t as T } from "../i18n";
import { Task, Staff, Idea, Msg, Feed, Period, Pri, todayISO, minToHHMM, saturation, ideaFilterTags, errMsg } from "../data";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string
): HTMLElementTagNameMap[K] {
  const e = createEl(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(parent: HTMLElement, label: string): HTMLElement {
  const r = el("div", "tlt-row");
  r.appendChild(el("span", "tlt-row-l", label));
  const v = el("div", "tlt-row-v");
  r.appendChild(v);
  parent.appendChild(r);
  return v;
}

function seg<T extends string | number>(parent: HTMLElement, opts: { v: T; t: string }[], cur: T, onPick: (v: T) => void) {
  const wrap = el("div", "tlt-seg");
  opts.forEach((o) => {
    const b = el("button", "tlt-seg-b" + (o.v === cur ? " on" : ""), o.t);
    b.onclick = () => {
      wrap.querySelectorAll(".tlt-seg-b").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      onPick(o.v);
    };
    wrap.appendChild(b);
  });
  parent.appendChild(wrap);
  return wrap;
}

/* ================= 任务 ================= */


/** 所有 TLT 弹窗的基类：给外层 .modal 打个标记，好让样式接管它的底色与内边距 */
export class TltModal extends Modal {
  constructor(app: App) {
    super(app);
    this.modalEl?.addClass("tlt-host");
  }
}

/** 只有两个出口的确认框：确认 / 取消 */
export class ConfirmModal extends TltModal {
  titleText: string;
  body: string;
  okText: string;
  danger: boolean;
  onDone: (ok: boolean) => void | Promise<void>;

  constructor(app: App, opts: { title: string; body: string; ok?: string; danger?: boolean }, onDone: (ok: boolean) => void | Promise<void>) {
    super(app);
    this.titleText = opts.title;
    this.body = opts.body;
    this.okText = opts.ok || T("确认");
    this.danger = opts.danger !== false;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.titleText));
    const b = el("div", "tlt-confirm-body");
    this.body.split("\n").forEach((ln) => b.appendChild(el("div", "", ln)));
    contentEl.appendChild(b);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.finish(false);
    const ok = el("button", "tlt-btn " + (this.danger ? "danger" : "pri"), this.okText);
    ok.onclick = () => this.finish(true);
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => ok.focus(), 40);
  }

  private finish(ok: boolean) {
    this.close();
    void this.onDone(ok);
  }

  onClose() { this.contentEl.empty(); }
}

/**
 * 改了目录、旧目录里还有文件时问一句。
 * 动用户的文件必须先问：可以搬，也可以只改路径（文件留在原地）。
 */
export class MoveDataModal extends TltModal {
  private info: { fromDir: string; toDir: string; moves: { from: string; to: string }[]; blocked: number };
  private onConfirm: () => void | Promise<void>;
  private onCancel?: () => void | Promise<void>;

  constructor(
    app: App,
    info: { fromDir: string; toDir: string; moves: { from: string; to: string }[]; blocked: number },
    onConfirm: () => void | Promise<void>,
    onCancel?: () => void | Promise<void>,
  ) {
    super(app);
    this.info = info;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;
    const { fromDir, toDir, moves, blocked } = this.info;
    contentEl.appendChild(el("div", "tlt-m-title", T("迁移 {n} 个文件", { n: moves.length })));
    contentEl.appendChild(el("div", "tlt-hint",
      T("从 {a} 搬到 {b}。搬运用 Obsidian 自己的改名，双链不会断；旧目录里的空文件夹会保留，可以自己删。", { a: fromDir || T("（库根目录）"), b: toDir || T("（库根目录）") })));
    if (blocked) {
      contentEl.appendChild(el("div", "tlt-hint warn",
        T("目标位置已有 {n} 个同名文件：这些不会被覆盖，会留在旧目录，其余照常搬。", { n: blocked })));
    }
    const list = el("div", "tlt-moves");
    moves.slice(0, 6).forEach((m) => {
      list.appendChild(el("div", "tlt-hint", `${m.from} → ${m.to}`));
    });
    if (moves.length > 6) list.appendChild(el("div", "tlt-hint", T("…还有 {n} 个", { n: moves.length - 6 })));
    contentEl.appendChild(list);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消更新"));
    cancel.onclick = () => { void (async () => { this.close(); await this.onCancel?.(); })(); };
    const ok = el("button", "tlt-btn pri", T("确认搬运"));
    ok.onclick = () => { void (async () => { this.close(); await this.onConfirm(); })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
  }

  onClose() { this.contentEl.empty(); }
}

/**
 * 项目 / 里程碑选择器（新建任务与任务详情共用同一份，避免两处字段不一致）
 * 返回读取当前选择的函数。
 */
function projectPicker(app: App, store: Store, parent: HTMLElement, init: { project?: string; milestone?: string }, draft: { project?: string; milestone?: string }) {
  const projRow = row(parent, T("项目"));
  const projWrap = el("div", "tlt-pick");
  const proj = el("select", "tlt-input");
  proj.setAttribute("data-qproject", "1");
  const fillProjects = (keep?: string) => {
    proj.empty();
    [...store.projects(), "未归属"].forEach((p) => {
      const o = createEl("option");
      o.value = p; o.textContent = p === "未归属" ? T("未归属") : p;
      if (p === (keep || draft.project)) o.selected = true;
      proj.appendChild(o);
    });
    const n = createEl("option");
    n.value = "__new__"; n.textContent = T("＋ 新建项目…");
    proj.appendChild(n);
  };
  draft.project = init.project || "";
  fillProjects();
  const projNew = el("input", "tlt-input");
  projNew.placeholder = T("新项目名（= 文件名）");
  projNew.addClass("tlt-hidden");

  const msRow = row(parent, T("里程碑"));
  const msWrap = el("div", "tlt-pick");
  const msSel = el("select", "tlt-input");
  msSel.setAttribute("data-qmilestone", "1");
  const msNew = el("input", "tlt-input");
  msNew.placeholder = T("新里程碑名");
  msNew.addClass("tlt-hidden");
  const fillMs = () => {
    msSel.empty();
    const list = draft.project ? store.milestones(draft.project).map((m) => m.name) : [];
    const o0 = createEl("option");
    o0.value = ""; o0.textContent = T("（不归里程碑）");
    msSel.appendChild(o0);
    list.forEach((name) => {
      const o = createEl("option");
      o.value = name; o.textContent = name;
      msSel.appendChild(o);
    });
    const n = createEl("option");
    n.value = "__new__"; n.textContent = T("＋ 新建里程碑…");
    msSel.appendChild(n);
    msSel.value = draft.milestone && list.includes(draft.milestone) ? draft.milestone : "";
    msNew.value = "";
    msNew.addClass("tlt-hidden");
  };
  draft.milestone = init.milestone || "";
  fillMs();

  proj.onchange = () => {
    if (proj.value === "__new__") {
      projNew.removeClass("tlt-hidden");
      projNew.focus();
      draft.project = "";
    } else {
      projNew.addClass("tlt-hidden");
      draft.project = proj.value;
      draft.milestone = "";      // 项目换了，里程碑要重选
      fillMs();
    }
  };
  projNew.oninput = () => { draft.project = projNew.value.trim(); };
  msSel.onchange = () => {
    if (msSel.value === "__new__") {
      msNew.removeClass("tlt-hidden"); msNew.focus(); draft.milestone = "";
    } else {
      msNew.addClass("tlt-hidden"); draft.milestone = msSel.value;
    }
  };
  msNew.oninput = () => { draft.milestone = msNew.value.trim(); };
  projWrap.append(proj, projNew);
  projRow.appendChild(projWrap);
  msWrap.append(msSel, msNew);
  msRow.appendChild(msWrap);
}

/** 标签行（新建与详情共用） */
function tagPicker(store: Store, parent: HTMLElement, draft: { tags: string[] }) {
  const tagRow = row(parent, T("标签"));
  const tagWrap = el("div", "tlt-quick");
  const known = Array.from(new Set(store.tasks.flatMap((x) => x.tags || [])));
  const all = Array.from(new Set(["工作", "个人", ...store.tags, ...known, ...draft.tags]));
  const paint = () => {
    tagWrap.empty();
    all.forEach((tg) => {
      const label = tg === "工作" ? T("工作") : tg === "个人" ? T("个人") : tg;
      const b = el("button", "tlt-chip" + (draft.tags.includes(tg) ? " on" : ""), label);
      b.onclick = () => {
        draft.tags = draft.tags.includes(tg) ? draft.tags.filter((x) => x !== tg) : [...draft.tags, tg];
        paint();
      };
      tagWrap.appendChild(b);
    });
    const add = el("input", "tlt-input small");
    add.placeholder = T("新标签");
    add.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const v = add.value.trim();
      if (!v) return;
      if (!all.includes(v)) all.push(v);
      if (!draft.tags.includes(v)) draft.tags.push(v);
      paint();
    };
    tagWrap.appendChild(add);
  };
  paint();
  tagRow.appendChild(tagWrap);
}

/**
 * 负责人选择：一个「已选 chip + 选择…」的紧凑控件，点开是带搜索的勾选面板。
 * 不再把全体人员平铺在表单里（人多时会撑满整个弹窗）。
 */
function ownerSelect(store: Store, parent: HTMLElement, draft: { owners: string[] }) {
  const wrap = el("div", "tlt-ownerbox");
  const line = el("div", "tlt-quick");
  // 就地展开的候选面板：不做浮动定位（真机上浮动面板会被弹窗裁掉/盖住，看着像点了没反应）
  const pop = el("div", "tlt-pickpop inline tlt-hidden");

  const draw = () => {
    pop.empty();
    const search = el("input", "tlt-input tlt-picksearch");
    search.placeholder = T("搜名字或岗位");
    const list = el("div", "tlt-picklist");
    const fill = () => {
      list.empty();
      const q = search.value.trim();
      const rows = store.staff.filter((x) => !q || x.name.includes(q) || (x.role || "").includes(q));
      if (!rows.length) list.appendChild(el("div", "tlt-hint", T("没有匹配的人")));
      rows.forEach((st) => {
        const on = draft.owners.includes(st.name);
        const r = el("div", "tlt-pickrow" + (on ? " on" : ""));
        r.append(el("span", "tlt-pickck" + (on ? " on" : "")), el("span", "tlt-pickname", st.name),
          el("span", "tlt-pickrole", st.role || ""));
        r.onclick = () => {
          draft.owners = on ? draft.owners.filter((y) => y !== st.name) : [...draft.owners, st.name];
          paint();
          fill();
        };
        list.appendChild(r);
      });
    };
    search.oninput = fill;
    fill();
    pop.append(search, list);
  };

  const paint = () => {
    line.empty();
    if (!draft.owners.length) line.appendChild(el("span", "tlt-owner-none", T("未指派")));
    draft.owners.forEach((n) => {
      const st = store.staff.find((x) => x.name === n);
      const chip = el("span", "tlt-chip on tlt-owner-chip");
      chip.append(el("span", "", n));
      if (st) chip.title = `${st.role} · ${T("产能")} ${st.capacity}%`;
      const x = el("i", "", "×");
      x.onclick = (ev) => { ev.stopPropagation(); draft.owners = draft.owners.filter((y) => y !== n); paint(); };
      chip.appendChild(x);
      line.appendChild(chip);
    });
    const open = !pop.classList.contains("tlt-hidden");
    const btn = el("button", "tlt-btn tiny", !draft.owners.length ? T("选择负责人…") : open ? T("收起") : T("选择…"));
    btn.dataset.ownerpick = "1";
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const isOpen = !pop.classList.contains("tlt-hidden");
      if (isOpen) pop.addClass("tlt-hidden");
      else { draw(); pop.removeClass("tlt-hidden"); }
      paint();
      if (!isOpen) {
        const box = pop.querySelector<HTMLInputElement>(".tlt-picksearch");
        window.setTimeout(() => box?.focus(), 20);
      }
    };
    line.appendChild(btn);
  };

  paint();
  wrap.append(line, pop);
  parent.appendChild(wrap);
}



/**
 * 项目信息：看/改项目名称（= 文件名）与一段描述。
 * 改名会同步日志里的 [proj:: 旧名]，描述写进项目文件的 frontmatter。
 */
/** 新建项目：名称 + 一段描述（描述可选，写进项目文件 frontmatter 的 desc） */
export class NewProjectModal extends TltModal {
  store: Store;
  onDone: () => void | Promise<void>;

  constructor(app: App, store: Store, onDone: () => void | Promise<void>) {
    super(app); this.store = store; this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("新建项目")));

    const nameRow = row(contentEl, T("名称"));
    const name = el("input", "tlt-input wide");
    name.placeholder = T("项目名（会建成一个 md，## 是里程碑）");
    name.setAttribute("data-newname", "1");
    nameRow.appendChild(name);

    const descRow = row(contentEl, T("描述"));
    const desc = el("textarea", "tlt-input tlt-textarea");
    desc.placeholder = T("这个项目是做什么的、交付什么…（可留空，之后也能改）");
    desc.setAttribute("data-newdesc", "1");
    descRow.appendChild(desc);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("创建"));
    ok.setAttribute("data-newok", "1");
    ok.onclick = () => { void (async () => {
      const n = name.value.trim();
      const okMade = await this.store.createProject(n);
      if (!okMade) { new Notice(T("没建成：名字空了，或者同名项目已存在")); return; }
      if (desc.value.trim()) await this.store.setProjectInfo(n, n, desc.value);
      await this.store.load();
      this.close();
      void this.onDone();
      new Notice(T("已新建项目：{n}", { n }));
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => name.focus(), 40);
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ok.click(); });
  }
}

export class ProjectInfoModal extends TltModal {
  store: Store;
  from: string;
  onDone: (info?: { from: string; to: string; renamed: boolean }) => void | Promise<void>;

  constructor(app: App, store: Store, from: string, onDone: (info?: { from: string; to: string; renamed: boolean }) => void | Promise<void>) {
    super(app); this.store = store; this.from = from; this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("项目信息")));

    // 一句话概况：几个里程碑、多少条任务、完成 percentage
    const list = this.store.tasks.filter((t) => t.project === this.from);
    const msCount = this.store.milestones(this.from).length;
    const doneCount = list.filter((t) => t.done).length;
    const pct = list.length ? Math.round((doneCount / list.length) * 100) : 0;
    contentEl.appendChild(el("div", "tlt-hint", T("{m} 个里程碑 · {n} 条任务 · 完成 {p}%", { m: msCount, n: list.length, p: pct })));

    const nameRow = row(contentEl, T("名称"));
    const name = el("input", "tlt-input wide");
    name.value = this.from;
    name.setAttribute("data-projname", "1");
    nameRow.appendChild(name);

    const descRow = row(contentEl, T("描述"));
    const desc = el("textarea", "tlt-input tlt-textarea");
    desc.value = this.store.projectDesc(this.from);
    desc.placeholder = T("这个项目是做什么的、交付什么、有谁在参与…（存进项目文件的 frontmatter：desc）");
    desc.setAttribute("data-projdesc", "1");
    descRow.appendChild(desc);

    const hint = el("div", "tlt-hint", T("改名称会连文件一起改名，日志里记的「[proj:: 旧名]」也会跟着改。"));
    contentEl.appendChild(hint);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const save = el("button", "tlt-btn pri", T("保存"));
    save.onclick = () => { void (async () => {
      const to = name.value.trim();
      const r = await this.store.setProjectInfo(this.from, to || this.from, desc.value);
      if (!r.ok) { new Notice(T("没保存：名字不能为空")); return; }
      await this.store.load();
      this.close();
      void this.onDone({ from: this.from, to: to || this.from, renamed: r.renamed });
      new Notice(r.renamed
        ? T("已改名为「{n}」{logs}", { n: to, logs: r.logs ? T("，{n} 条日志里的项目名也改了", { n: r.logs }) : "" })
        : T("已保存项目信息"));
    })(); };
    foot.append(cancel, save);
    contentEl.appendChild(foot);
  }
}

export class TaskModal extends TltModal {
  store: Store;
  task: Task;
  onChange: () => void | Promise<void>;
  showTimeline = false;
  draft: {
    title: string; project?: string; milestone?: string; tags: string[];
    start?: string; due?: string; est?: number; wl: number; pw: Period; pri: Pri; owners: string[];
  };

  constructor(app: App, store: Store, task: Task, onChange: () => void | Promise<void>) {
    super(app); this.store = store; this.task = task; this.onChange = onChange;
    this.draft = {
      title: task.title,
      project: task.project,
      milestone: task.milestone,
      tags: [...(task.tags || [])],
      start: task.start,
      due: task.due,
      est: task.est,
      wl: task.wl,
      pw: task.pw,
      pri: task.pri,
      owners: [...task.owners],
    };
  }

  /** 子项动过之后：重新读盘拿最新的 steps，再重画这一层（不重读会看不到刚加的那条） */
  private async refreshSteps() {
    await this.store.load();
    const fresh = this.store.tasks.find((x) => x.file === this.task.file && x.title === this.task.title);
    if (fresh) this.task = fresh;
    this.contentEl.empty();
    void this.onOpen();
  }

  /** 就地改子项文字（回车保存，Esc 取消） */
  private editStep(span: HTMLElement, index: number) {
    const input = el("input", "tlt-step-edit");
    input.value = span.textContent ?? "";
    span.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = (save: boolean) => { void (async () => {
      if (done) return;
      done = true;
      if (save) await this.store.setStepText(this.task, index, input.value);
      await this.refreshSteps();
    })(); };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const t = this.task;

    const title = el("input", "tlt-input wide");
    title.placeholder = T("任务名");
    title.value = this.draft.title;
    title.oninput = () => { this.draft.title = title.value; };
    contentEl.appendChild(title);

    projectPicker(this.app, this.store, contentEl, { project: t.project, milestone: t.milestone }, this.draft);
    tagPicker(this.store, contentEl, this.draft);

    // 开始 / 截止 并成一行：两个日期输入 + 截止的快捷按钮
    const dates = row(contentEl, T("时间"));
    const dline = el("div", "tlt-dline");
    const start = el("input", "tlt-input date");
    start.type = "date";
    start.value = this.draft.start || "";
    start.title = T("开始");
    start.onchange = () => { this.draft.start = start.value || undefined; };
    const arrow = el("span", "tlt-darrow", "→");
    const dIn = el("input", "tlt-input date");
    dIn.type = "date";
    dIn.value = this.draft.due || "";
    dIn.title = T("截止");
    dIn.onchange = () => { this.draft.due = dIn.value || undefined; };
    dline.append(start, arrow, dIn);
    dates.appendChild(dline);


    // 工作量（人天）：与新建一致
    const estRow = row(contentEl, T("工作量"));
    // 工作量（人天）：与截止时间互不影响
    seg<number>(estRow, [0.5, 1, 2, 3, 5].map((v) => ({ v, t: v + T(" 天") })), this.draft.est || 1, (v) => {
      this.draft.est = v;
    });
    // 常用档之外的值：一个小的「自定义」入口，平时不占地方
    const estInput = el("input", "tlt-input small tlt-est-custom");
    estInput.type = "number"; estInput.step = "0.5"; estInput.min = "0";
    estInput.value = this.draft.est !== undefined && ![0.5, 1, 2, 3, 5].includes(this.draft.est) ? String(this.draft.est) : "";
    estInput.placeholder = T("自定义");
    estInput.onchange = () => {
      const v = Number(estInput.value);
      this.draft.est = Number.isFinite(v) && v > 0 ? v : undefined;
      estRow.querySelectorAll(".tlt-seg-b").forEach((x) => x.classList.remove("on"));
    };
    estRow.appendChild(estInput);

    const pri = row(contentEl, T("优先级"));
    seg<number>(pri, [{ v: 0, t: T("低") }, { v: 1, t: T("普通") }, { v: 2, t: T("高") }, { v: 3, t: T("紧急") }], this.draft.pri || 1, (v) => (this.draft.pri = v as Pri));

    const whoRowD = row(contentEl, T("负责人"));
    ownerSelect(this.store, whoRowD, this.draft);

    // 子项：只有内容与完成态；改动即时写回，不参与"保存"
    const stepRow = row(contentEl, T("子项"));
    const stepBox = el("div", "tlt-steps in-modal");
    if (!this.task.steps.length) {
      stepBox.appendChild(el("div", "tlt-hint", T("还没有子项。加一条就有关键步骤，任务行上会出现进度环。")));
    }
    this.task.steps.forEach((st, i) => {
      const line = el("div", "tlt-step" + (st.done ? " done" : ""));
      const cb = el("i", "tlt-scb" + (st.done ? " on" : ""));
      cb.onclick = () => { void (async () => { await this.store.setStepDone(this.task, i, !st.done); await this.refreshSteps(); })(); };
      const txt = el("span", "tlt-step-t", st.text);
      txt.onclick = () => this.editStep(txt, i);
      const del = el("button", "tlt-step-del", "×");
      del.title = T("删掉这条子项");
      del.onclick = () => { new ConfirmModal(this.app, {
        title: T("删掉这条子项"),
        body: `${st.text}\n\n${T("只删子项，任务本身不动。")}`,
        ok: T("删除"),
      }, async (ok) => { if (ok) { await this.store.deleteStep(this.task, i); await this.refreshSteps(); } }).open(); };
      line.append(cb, txt, del);
      stepBox.appendChild(line);
    });
    const stepAdd = el("input", "tlt-step-add");
    stepAdd.placeholder = T("加一条子项，回车");
    stepAdd.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const v = stepAdd.value.trim();
      if (!v) return;
      void (async () => { await this.store.addStep(this.task, v); await this.refreshSteps(); })();
    });
    stepBox.appendChild(stepAdd);
    stepRow.appendChild(stepBox);

    // 时间线：创建 / 完成 / 子项进度。默认收着，想看再点开
    const tlRow = row(contentEl, T("时间线"));
    const tl = el("div", "tlt-tl");
    const tlItems: [string, string][] = [
      [T("创建"), this.task.created || T("未记录")],
      [T("完成"), this.task.doneAt || T("未完成")],
      [T("进度"), this.task.steps.length ? T("{a}/{b}", { a: this.task.steps.filter((x) => x.done).length, b: this.task.steps.length }) : T("无子项")],
    ];
    tlItems.forEach(([k, v]) => {
      const r = el("div", "tlt-tl-r");
      r.append(el("span", "tlt-tl-k", k), el("span", "tlt-tl-v", v));
      tl.appendChild(r);
    });
    const tlToggle = el("button", "tlt-btn tiny", this.showTimeline ? T("收起") : T("展开"));
    tlToggle.onclick = () => { this.showTimeline = !this.showTimeline; this.contentEl.empty(); void this.onOpen(); };
    if (!this.showTimeline) tl.addClass("tlt-hidden");
    tlRow.querySelector(".tlt-row-l")?.appendChild(tlToggle);
    tlRow.appendChild(tl);

    const foot = el("div", "tlt-m-foot");
    const save = el("button", "tlt-btn pri", T("保存"));
    save.onclick = () => { void (async () => {
      const d = this.draft;
      // 先就地改字段（行号不变），最后再改标题/搬文件——搬完行号就失效了
      if (d.due !== t.due) await this.store.setDue(t, d.due || "");
      if ((d.start || "") !== (t.start || "")) await this.store.setStart(t, d.start || "");
      if (d.wl !== t.wl) await this.store.setField(t, "wl", d.wl ?? 0);
      if (d.pw !== t.pw) await this.store.setField(t, "pw", d.pw ?? "m");
      if (d.pri !== t.pri) await this.store.setField(t, "pri", d.pri ?? 1);
      if ((d.est ?? null) !== (t.est ?? null)) await this.store.setField(t, "est", d.est ?? null);
      if ((d.tags || []).join(",") !== (t.tags || []).join(",")) {
        await this.store.setField(t, "tags", (d.tags || []).join(", "));
      }
      if ((d.owners || []).join(",") !== t.owners.join(",")) {
        await this.store.setField(t, "owner", (d.owners || []).map((o) => `[[${o}]]`).join(", "));
      }
      if (d.title.trim() && d.title.trim() !== t.title) await this.store.setTitle(t, d.title.trim());
      const moved = (d.project || "") !== (t.project || "") || (d.milestone || "") !== (t.milestone || "");
      if (moved && d.project) await this.store.moveTask(t, d.project, d.milestone || undefined);
      this.close();
      void this.onChange();
      new Notice(moved ? T("已保存，任务已移动") : T("已写回任务行"));
    })(); };
    const done = el("button", "tlt-btn", t.done ? T("标为未完成") : T("标记完成"));
    done.onclick = () => { void (async () => {
      const open = t.steps.filter((x) => !x.done).length;
      if (!t.done && open) new Notice(T("还有 {n} 个子项没勾（这次先记完成）", { n: open }), 4000);
      await this.store.toggleTask(t);
      this.close(); void this.onChange();
    })(); };
    const del = el("button", "tlt-btn danger", T("删除任务"));
    del.onclick = () => { void (async () => {
      await this.store.deleteTask(t);
      this.close(); void this.onChange(); new Notice(T("已删除任务"));
    })(); };
    const open = el("button", "tlt-btn", T("打开所在笔记"));
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(t.file);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
      this.close();
    };
    foot.append(del, done, open, save);
    contentEl.appendChild(foot);
  }

  onClose() { this.contentEl.empty(); }
}

/* ================= 记录 / 时间块 ================= */

export class LogModal extends TltModal {
  store: Store;
  log: Task;
  onChange: () => void | Promise<void>;

  constructor(app: App, store: Store, log: Task, onChange: () => void | Promise<void>) {
    super(app); this.store = store; this.log = log; this.onChange = onChange;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.log.title));
    contentEl.appendChild(el("div", "tlt-m-meta",
      `${this.log.due} · ${this.log.st || ""}${this.log.en ? "–" + this.log.en : ""}${this.log.extra ? " · " + T("计划外") : ""}${this.log.project ? " · " + this.log.project : ""}`));

    const body = el("textarea", "tlt-textarea");
    body.placeholder = T("谈了什么 / 决定了什么 / 下一步（会写成文件里的引用块）");
    body.value = this.log.note || "";
    contentEl.appendChild(body);

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", T("删除这条记录"));
    del.onclick = () => { void (async () => {
      await this.store.deleteLog(this.log);
      this.close(); void this.onChange(); new Notice(T("已删除记录"));
    })(); };
    const open = el("button", "tlt-btn", T("打开月文件"));
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(this.log.file);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
      this.close();
    };
    const ok = el("button", "tlt-btn pri", T("保存"));
    ok.onclick = () => { void (async () => {
      await this.store.updateLogBody(this.log, body.value);
      this.close(); void this.onChange(); new Notice(T("已写回记录"));
    })(); };
    foot.append(del, open, ok);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 快速添加 ================= */

/** 新建任务表单的草稿（只有这里用，字段都是必填的默认值） */
interface QuickDraft {
  start: string; due: string; est: number; pri: Pri;
  owners: string[]; project: string; milestone: string; tags: string[];
}

export class QuickTaskModal extends TltModal {
  store: Store;
  onChange: () => void | Promise<void>;
  private draft: QuickDraft;
  private preset: { title?: string; due?: string; project?: string; milestone?: string } = {};

  constructor(app: App, store: Store, onChange: () => void | Promise<void>, preset?: { title?: string; due?: string; project?: string; milestone?: string }) {
    super(app); this.store = store; this.onChange = onChange;
    this.preset = preset || {};
    // 已经点了某个项目 / 里程碑，就直接用它，别再让人手选一遍
    const pinned = preset?.project && store.projects().includes(preset.project) ? preset.project : "";
    const proj = pinned || store.projects()[0] || "未归属";
    const msList = store.milestones(proj).map((m) => m.name);
    const ms = preset?.milestone && msList.includes(preset.milestone) ? preset.milestone : msList[0] || "";
    this.draft = {
      start: todayISO(), due: preset?.due || todayISO(),
      est: 1, pri: 1, owners: [],
      project: proj, milestone: ms, tags: [],
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("新建任务")));

    // 只有任务名
    const title = el("input", "tlt-input wide");
    title.placeholder = T("任务名");
    title.value = this.preset.title || "";
    contentEl.appendChild(title);

    // 项目（可选可新建）
    const projRow = row(contentEl, T("项目"));
    const projWrap = el("div", "tlt-pick");
    const proj = el("select", "tlt-input");
    proj.setAttribute("data-qproject", "1");
    const fillProjects = (keep?: string) => {
      proj.empty();
      [...this.store.projects(), "未归属"].forEach((p) => {
        const o = createEl("option");
        o.value = p; o.textContent = p === "未归属" ? T("未归属") : p;
        if (p === (keep || this.draft.project)) o.selected = true;
        proj.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__"; n.textContent = T("＋ 新建项目…");
      proj.appendChild(n);
    };
    fillProjects();
    const projNew = el("input", "tlt-input");
    projNew.placeholder = T("新项目名（= 文件名）");
    projNew.addClass("tlt-hidden");
    proj.onchange = () => {
      if (proj.value === "__new__") {
        projNew.removeClass("tlt-hidden");
        projNew.focus();
        this.draft.project = "";
      } else {
        projNew.addClass("tlt-hidden");
        this.draft.project = proj.value;
        fillMs();
      }
    };
    projNew.oninput = () => { this.draft.project = projNew.value.trim(); };
    projWrap.append(proj, projNew);
    projRow.appendChild(projWrap);

    // 里程碑（跟着项目变，也能新建）
    const msRow = row(contentEl, T("里程碑"));
    const msWrap = el("div", "tlt-pick");
    const msSel = el("select", "tlt-input");
  msSel.setAttribute("data-qmilestone", "1");
    const msNew = el("input", "tlt-input");
    msNew.placeholder = T("新里程碑名");
    msNew.addClass("tlt-hidden");
    const fillMs = () => {
      msSel.empty();
      const list = this.draft.project ? this.store.milestones(this.draft.project).map((m) => m.name) : [];
      const o0 = createEl("option");
      o0.value = ""; o0.textContent = T("（不归里程碑）");
      msSel.appendChild(o0);
      list.forEach((name) => {
        const o = createEl("option");
        o.value = name; o.textContent = name;
        msSel.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__"; n.textContent = T("＋ 新建里程碑…");
      msSel.appendChild(n);
      msSel.value = list.includes(this.draft.milestone) ? this.draft.milestone : "";
    };
    fillMs();
    msSel.onchange = () => {
      if (msSel.value === "__new__") {
        msNew.removeClass("tlt-hidden"); msNew.focus(); this.draft.milestone = "";
      } else {
        msNew.addClass("tlt-hidden"); this.draft.milestone = msSel.value;
      }
    };
    msNew.oninput = () => { this.draft.milestone = msNew.value.trim(); };
    msWrap.append(msSel, msNew);
    msRow.appendChild(msWrap);

    // 标签（工作 / 个人 也当成普通标签，不再单独设「范围」）
    const tagRow = row(contentEl, T("标签"));
    const tagWrap = el("div", "tlt-quick");
    const knownTags = Array.from(new Set(this.store.tasks.flatMap((t) => t.tags || [])));
    const allTags = Array.from(new Set(["工作", "个人", ...knownTags]));
    const paintTags = () => {
      tagWrap.empty();
      allTags.forEach((tg) => {
        const label = tg === "工作" ? T("工作") : tg === "个人" ? T("个人") : tg;
        const b = el("button", "tlt-chip" + (this.draft.tags.includes(tg) ? " on" : ""), label);
        b.onclick = () => {
          const a = this.draft.tags;
          this.draft.tags = a.includes(tg) ? a.filter((x) => x !== tg) : [...a, tg];
          paintTags();
        };
        tagWrap.appendChild(b);
      });
      const add = el("input", "tlt-input small");
      add.placeholder = T("新标签");
      add.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        const v = add.value.trim();
        if (!v) return;
        if (!allTags.includes(v)) allTags.push(v);
        if (!this.draft.tags.includes(v)) this.draft.tags.push(v);
        paintTags();
      };
      tagWrap.appendChild(add);
    };
    paintTags();
    tagRow.appendChild(tagWrap);

    // 开始 / 截止：同一行（各填各的）
    const dateRow = row(contentEl, T("时间"));
    const dline = el("div", "tlt-dline");
    const start = el("input", "tlt-input date");
    start.type = "date"; start.value = this.draft.start || todayISO(); start.title = T("开始");
    start.onchange = () => { this.draft.start = start.value; };
    const due = el("input", "tlt-input date");
    due.type = "date"; due.value = this.draft.due || ""; due.title = T("截止");
    due.onchange = () => { this.draft.due = due.value; };
    dline.append(start, el("span", "tlt-darrow", "→"), due);
    dateRow.appendChild(dline);

    // 人天：与截止时间互不影响，各填各的
    const estRow = row(contentEl, T("工作量"));
    const estOpts = [0.5, 1, 2, 3, 5].map((v) => ({ v, t: v + T(" 天") }));
    seg<number>(estRow, estOpts, this.draft.est || 1, (v) => {
      this.draft.est = v;
      estInput.value = "";
    });
    const estInput = el("input", "tlt-input small tlt-est-custom");
    estInput.type = "number"; estInput.step = "0.5"; estInput.min = "0";
    estInput.value = estOpts.some((o) => o.v === this.draft.est) ? "" : String(this.draft.est ?? "");
    estInput.placeholder = T("自定义");
    estInput.onchange = () => {
      const v = Number(estInput.value);
      this.draft.est = Number.isFinite(v) && v > 0 ? v : 1;
      estRow.querySelectorAll(".tlt-seg-b").forEach((x) => x.classList.remove("on"));
    };
    estRow.appendChild(estInput);

    // 优先级
    const priRow = row(contentEl, T("优先级"));
    seg<Pri>(priRow, [{ v: 0, t: T("低") }, { v: 1, t: T("普通") }, { v: 2, t: T("高") }, { v: 3, t: T("紧急") }], this.draft.pri, (v) => (this.draft.pri = v));

    // 负责人：一个紧凑的框选控件（点开是带搜索的勾选列表）
    const whoRow = row(contentEl, T("负责人"));
    if (!this.store.staff.length) whoRow.appendChild(el("div", "tlt-hint", T("还没有人员档案（人员页可以新建）")));
    else ownerSelect(this.store, whoRow, this.draft);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("创建"));
    ok.onclick = () => { void (async () => {
      const name = title.value.trim();
      if (!name) { new Notice(T("先写任务名")); return; }
      await this.store.addTask(this.draft.project, this.draft.milestone || undefined, {
        title: name,
        start: this.draft.start,
        due: this.draft.due,
        est: this.draft.est,
        pri: this.draft.pri,
        owners: this.draft.owners,
        tags: this.draft.tags,
      });
      this.close(); void this.onChange(); new Notice(T("已创建任务"));
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
    title.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ok.click(); });
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 记录添加 ================= */

export class QuickLogModal extends TltModal {
  store: Store;
  date: string;
  onChange: () => void | Promise<void>;
  startAt: string;
  constructor(app: App, store: Store, date: string, onChange: () => void | Promise<void>, startAt = "09:00") {
    super(app); this.store = store; this.date = date; this.onChange = onChange; this.startAt = startAt;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("记一条 · {d}", { d: this.date })));
    contentEl.appendChild(el("div", "tlt-m-meta", T("记录是「实际发生」的事；计划外的事也记在这里")));

    const st = el("input", "tlt-input");
    st.type = "time"; st.value = this.startAt;
    const en = el("input", "tlt-input");
    en.type = "time";
    const [hh, mm] = this.startAt.split(":").map(Number);
    en.value = minToHHMM(hh * 60 + (mm || 0) + 30);
    const times = el("div", "tlt-times");
    times.append(st, el("span", "tlt-dash", "–"), en);
    contentEl.appendChild(times);

    const title = el("input", "tlt-input wide");
    title.placeholder = T("做了什么");
    contentEl.appendChild(title);
    const body = el("textarea", "tlt-textarea");
    body.placeholder = T("正文（可留空）");
    contentEl.appendChild(body);

    const extra = el("label", "tlt-check");
    const cb = el("input"); cb.type = "checkbox";
    extra.append(cb, el("span", "", T("计划外（临时插入）")));
    contentEl.appendChild(extra);

    const foot = el("div", "tlt-m-foot");
    const ok = el("button", "tlt-btn pri", T("记录"));
    ok.onclick = () => { void (async () => {
      if (!title.value.trim()) return;
      await this.store.addLog(this.date, {
        st: st.value, en: en.value, title: title.value.trim(), body: body.value.trim() || undefined, extra: cb.checked,
      });
      this.close(); void this.onChange(); new Notice(T("已写入记录"));
    })(); };
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 人员档案（只读） ================= */

export class StaffModal extends TltModal {
  store: Store;
  staff: Staff;
  onChange?: () => void | Promise<void>;
  constructor(app: App, store: Store, staff: Staff, onChange?: () => void | Promise<void>) {
    super(app); this.store = store; this.staff = staff; this.onChange = onChange;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const s = this.staff;

    const head = el("div", "tlt-staff-head");
    const av = el("span", "tlt-av big", s.name.slice(-2));
    if (s.color) av.style.background = s.color;
    const who = el("div", "tlt-who");
    who.append(el("div", "tlt-staff-name", s.name), el("div", "tlt-staff-role", s.role || T("未填岗位")));
    head.append(av, who);
    contentEl.appendChild(head);

    const sat = saturation(this.store.tasks, s.name, this.store.settings.defaultPeriod, { capacity: s.capacity, days: s.days });
    const grid = el("div", "tlt-staff-grid");
    const cell = (label: string, value: string) => {
      const c = el("div", "tlt-staff-cell");
      c.append(el("span", "tlt-staff-l", label), el("b", "", value));
      grid.appendChild(c);
    };
    cell(T("产能"), `${s.capacity}%`);
    cell(T("在岗"), T("每周 {n} 天", { n: s.days }));
    cell(T("可用"), T("每月 {n} 人天", { n: sat.avail }));
    cell(T("已排"), T("{n} 人天（{p}%）", { n: sat.sum, p: sat.pct }));
    contentEl.appendChild(grid);

    const skillRow = el("div", "tlt-staff-line");
    skillRow.appendChild(el("span", "tlt-staff-l", T("技能")));
    const chips = el("div", "tlt-quick");
    (s.skills || []).length
      ? s.skills.forEach((k) => chips.appendChild(el("span", "tlt-chip on", k)))
      : chips.appendChild(el("span", "tlt-hint", T("还没填")));
    skillRow.appendChild(chips);
    contentEl.appendChild(skillRow);

    if (s.note) {
      const noteRow = el("div", "tlt-staff-line");
      noteRow.appendChild(el("span", "tlt-staff-l", T("备注")));
      noteRow.appendChild(el("div", "tlt-staff-note", s.note));
      contentEl.appendChild(noteRow);
    }

    const tasks = this.store.tasks.filter((t) => !t.done && t.owners.includes(s.name));
    const listRow = el("div", "tlt-staff-line");
    listRow.appendChild(el("span", "tlt-staff-l", T("手上")));
    const ul = el("div", "tlt-staff-tasks");
    tasks.length
      ? tasks.slice(0, 6).forEach((t) => {
          const r = el("div", "tlt-staff-task");
          r.append(el("span", "", t.title), el("span", "tlt-hint", t.est !== undefined ? `${t.est} ${T("人天")}` : t.due || ""));
          ul.appendChild(r);
        })
      : ul.appendChild(el("div", "tlt-hint", T("这个周期没有任务")));
    listRow.appendChild(ul);
    contentEl.appendChild(listRow);

    contentEl.appendChild(el("div", "tlt-hint", T("档案文件：{p}", { p: s.file })));

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", T("删除档案"));
    del.onclick = () => { void (async () => {
      await this.store.removeStaff(s);
      this.close(); void this.onChange?.(); new Notice(T("已删除 {n} 的档案", { n: s.name }));
    })(); };
    const open = el("button", "tlt-btn pri", T("打开档案文件"));
    open.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(s.file);
      if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    };
    foot.append(del, open);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 节奏里的任务：只读详情 + 跳转 ================= */

export class TaskPeekModal extends TltModal {
  store: Store;
  task: Task;
  onJump: () => void | Promise<void>;
  constructor(app: App, store: Store, task: Task, onJump: () => void | Promise<void>) {
    super(app); this.store = store; this.task = task; this.onJump = onJump;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.addClass("tlt-peek");
    const t = this.task;
    contentEl.appendChild(el("div", "tlt-peek-title", t.title));
    const rows: [string, string][] = [
      [T("项目"), `${t.project}${t.milestone ? " · " + t.milestone : ""}`],
      [T("时间"), `${t.start ? t.start + " → " : ""}${t.due || T("未排期")}`],
      [T("工作量"), t.est !== undefined ? `${t.est} ${T("人天")}` : t.wl ? `${t.wl}%` : T("未估")],
      [T("负责人"), t.owners.length ? t.owners.join(T("、")) : T("未分配")],
      [T("状态"), t.done ? T("已完成") : T("进行中")],
    ];
    rows.forEach(([k, v]) => {
      const r = el("div", "tlt-peek-row");
      r.append(el("span", "tlt-peek-k", k), el("span", "tlt-peek-v", v));
      contentEl.appendChild(r);
    });
    const foot = el("div", "tlt-m-foot");
    const open = el("button", "tlt-btn pri", T("打开任务 →"));
    open.onclick = () => { this.close(); void this.onJump(); };
    foot.appendChild(open);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 里程碑：只读弹窗 ================= */

export class MilestonePeekModal extends TltModal {
  store: Store;
  milestone: { name: string; project: string; tasks: Task[] };
  onOpenMs: () => void;
  constructor(app: App, store: Store, milestone: { name: string; project: string; tasks: Task[] }, onOpenMs: () => void) {
    super(app); this.store = store; this.milestone = milestone; this.onOpenMs = onOpenMs;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const m = this.milestone;
    const done = m.tasks.filter((t) => t.done).length;
    contentEl.appendChild(el("div", "tlt-peek-title", m.name));
    const rows: [string, string][] = [
      [T("项目"), m.project],
      [T("进度"), T("{a}/{b}（{p}%）", { a: done, b: m.tasks.length, p: Math.round((done / m.tasks.length) * 100) })],
      [T("人天"), T("{n} 天", { n: m.tasks.reduce((n, t) => n + (t.est || 0), 0) })],
      [T("负责人"), Array.from(new Set(m.tasks.flatMap((t) => t.owners))).join(T("、")) || T("未分配")],
    ];
    rows.forEach(([k, v]) => {
      const r = el("div", "tlt-peek-row");
      r.append(el("span", "tlt-peek-k", k), el("span", "tlt-peek-v", v));
      contentEl.appendChild(r);
    });
    const list = el("div", "tlt-peek-tasks");
    m.tasks.slice(0, 8).forEach((t) => {
      const r = el("div", "tlt-peek-task");
      r.append(el("span", "", `${t.done ? "✓" : "○"} ${t.title}`), el("span", "tlt-hint", t.due || ""));
      list.appendChild(r);
    });
    contentEl.appendChild(list);

    const foot = el("div", "tlt-m-foot");
    const rename = el("button", "tlt-btn", T("重命名"));
    rename.title = T("改项目文件里这个 ## 小节的标题");
    rename.onclick = () => {
      this.close();
      new PromptModal(this.app, T("重命名里程碑"), T("里程碑名（项目文件里的 ## 小节）"), async (name) => {
        const ok = await this.store.renameMilestone(m.project, m.name, name);
        new Notice(ok ? T("已重命名为：{n}", { n: name }) : T("没改成：名字空了、同名已存在，或原来的小节已不在"));
        await this.store.load();
        this.onOpenMs();
      }, m.name).open();
    };
    const open = el("button", "tlt-btn pri", T("打开里程碑 →"));
    open.onclick = () => { this.close(); this.onOpenMs(); };
    foot.append(rename, open);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 添加人员 ================= */

export class AddStaffModal extends TltModal {
  store: Store;
  onChange: () => void | Promise<void>;
  constructor(app: App, store: Store, onChange: () => void | Promise<void>) {
    super(app); this.store = store; this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("添加成员")));
    contentEl.appendChild(el("div", "tlt-m-meta",
      T("会在 {d}/ 新建一个档案文件，frontmatter 里填岗位与产能。", { d: this.store.settings.teamFolder })));
    const name = el("input", "tlt-input wide");
    name.placeholder = T("姓名（= 文件名）");
    contentEl.appendChild(name);
    const role = el("input", "tlt-input wide");
    role.placeholder = T("岗位，默认「算法工程师」");
    contentEl.appendChild(role);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("创建"));
    ok.onclick = () => { void (async () => {
      const n = name.value.trim();
      if (!n) return;
      const created = await this.store.addStaff(n);
      if (!created) { new Notice(T("同名档案已存在")); return; }
      this.close();
      void this.onChange();
      new Notice(T("已创建 {n} 的档案，点卡片可查看/编辑", { n }));
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => name.focus(), 50);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); });
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 想法 ================= */

export class IdeaModal extends TltModal {
  store: Store;
  idea?: Idea;
  onChange: () => void | Promise<void>;
  constructor(app: App, store: Store, idea: Idea | undefined, onChange: () => void | Promise<void>) {
    super(app); this.store = store; this.idea = idea; this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const isNew = !this.idea;

    contentEl.appendChild(el("div", "tlt-idea-kicker", isNew ? T("新建随手记") : T("随手记")));

    const title = el("input", "tlt-idea-title");
    title.placeholder = T("一句话记下来");
    title.value = this.idea?.title || "";
    contentEl.appendChild(title);

    // 已选标签（可点 × 去掉）
    let tags: string[] = this.idea ? ideaFilterTags(this.idea) : [];
    contentEl.appendChild(el("div", "tlt-field-label", T("标签")));
    const tagWrap = el("div", "tlt-idea-tagwrap");
    const paint = () => {
      tagWrap.empty();
      tags.forEach((tg) => {
        const chip = el("span", "tlt-tagchip");
        chip.append(el("span", "", tg));
        const x = el("i", "", "×");
        x.onclick = () => { tags = tags.filter((t) => t !== tg); paint(); };
        chip.appendChild(x);
        tagWrap.appendChild(chip);
      });
      const add = el("input", "tlt-tagin");
      add.placeholder = tags.length ? T("再加…") : T("加标签，回车");
      add.onkeydown = (e) => { void (async () => {
        if (e.key !== "Enter") return;
        const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, "");
        if (!v) return;
        if (!tags.includes(v)) tags.push(v);
        if (!this.store.tags.includes(v)) await this.store.addTag(v);
        (e.target as HTMLInputElement).value = "";
        paint();
        tagWrap.querySelector<HTMLInputElement>(".tlt-tagin")?.focus();
      })(); };
      tagWrap.appendChild(add);
    };
    paint();
    contentEl.appendChild(tagWrap);

    // 标签库：点一下加进上面，✎ 改/删，末尾 + 新建
    contentEl.appendChild(el("div", "tlt-field-label", T("标签库（点一下加入，✎ 修改）")));
    const lib = el("div", "tlt-taglib");
    const libTags = () => Array.from(new Set([
      ...this.store.tags,
      ...this.store.ideas.flatMap((i) => ideaFilterTags(i)),
      ...this.store.tasks.flatMap((t) => t.tags || []),
    ])).filter((t) => !tags.includes(t));
    const paintLib = () => {
      lib.empty();
      libTags().forEach((tg) => {
        const one = el("span", "tlt-taglib-i" + (tags.includes(tg) ? " on" : ""));
        one.append(el("span", "tlt-taglib-n", tg));
        const edit = el("i", "", "✎");
        edit.onclick = (ev) => {
          ev.stopPropagation();
          new TagEditModal(this.app, this.store, tg, () => {
            tags = tags.map((t) => (t === tg ? "" : t)).filter(Boolean);
            paint(); paintLib();
          }).open();
        };
        one.appendChild(edit);
        one.onclick = () => {
          if (!tags.includes(tg)) tags.push(tg);
          paint(); paintLib();
        };
        lib.appendChild(one);
      });
      const plus = el("span", "tlt-taglib-i plus", "＋");
      plus.onclick = () => {
        new PromptModal(this.app, T("新建标签"), T("标签名"), async (v) => {
          const name = v.trim().replace(/^#/, "");
          if (!name) return;
          await this.store.addTag(name);
          paintLib();
        }).open();
      };
      lib.appendChild(plus);
    };
    paintLib();
    contentEl.appendChild(lib);

    contentEl.appendChild(el("div", "tlt-field-label", T("为什么做 / 怎么验证")));
    const body = el("textarea", "tlt-textarea tall");
    body.placeholder = T("值得做的理由、可能的验证方式（可以留空）");
    body.value = this.idea?.body || "";
    contentEl.appendChild(body);

    const foot = el("div", "tlt-m-foot");
    if (!isNew) {
      const del = el("button", "tlt-btn danger", T("删除"));
      del.onclick = () => { void (async () => {
        await this.store.deleteIdea(this.idea);
        this.close(); void this.onChange(); new Notice(T("已删除想法"));
      })(); };
      foot.appendChild(del);
      foot.appendChild(el("span", "tlt-spacer"));
    }
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", isNew ? T("收录") : T("保存"));
    ok.onclick = () => { void (async () => {
      const t = title.value.trim();
      if (!t) { new Notice(T("先写一句话")); return; }
      const bd = body.value.trim();
      if (this.idea) {
        this.idea.title = t; this.idea.tags = tags; this.idea.body = bd;
        await this.store.updateIdea(this.idea);
      } else {
        await this.store.addIdea({ title: t, tags, body: bd || undefined });
      }
      this.close(); void this.onChange(); new Notice(isNew ? T("已收进想法池") : T("已保存"));
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 消息 ================= */


/** 轻量弹出菜单（锚在按钮上方，点外面关掉） */
export function popMenu(
  anchor: HTMLElement,
  items: { label: string; onClick: () => void | Promise<void>; danger?: boolean }[],
  align: "left" | "right" = "left",
  at?: { x: number; y: number },
) {
  document.querySelectorAll(".tlt-menu").forEach((n) => n.remove());
  const m = el("div", "tlt-menu");
  items.forEach((it) => {
    const b = el("button", "tlt-menu-i" + (it.danger ? " danger" : ""), it.label);
    b.onclick = () => { m.remove(); void it.onClick(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  // 四边都夹进视口：上面放不下就翻到下面，两边都放不下就贴边——否则菜单会伸出窗口被裁掉
  const PAD = 8;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth || 150;
  const h = m.offsetHeight || 120;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left: number, top: number;
  if (at) {
    left = at.x + w + PAD <= vw ? at.x : vw - w - PAD;      // 右键：贴在指针下方，出界往左收
    top = at.y;
  } else {
    left = align === "right" ? r.right - w : r.left;
    const above = r.top - h - 6;
    const below = r.bottom + 6;
    top = above >= PAD ? above : below + h <= vh - PAD ? below : above;
  }
  m.style.left = `${Math.round(Math.max(PAD, Math.min(left, vw - w - PAD)))}px`;
  m.style.top = `${Math.round(Math.max(PAD, Math.min(top, vh - h - PAD)))}px`;
  const off = (e: MouseEvent) => {
    if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener("mousedown", off); }
  };
  window.setTimeout(() => document.addEventListener("mousedown", off), 0);
}

/** 消息的 5W 表单（新建与编辑共用）：时间/地点/人物/缘由/内容/标签 */
export interface MsgDraft {
  /** date = 创建时间（自动填今天） */
  title: string; date: string; place: string; who: string; why: string;
  body: string; tags: string; kind: Msg["kind"];
  /** 截止时间：留空表示没有固定截止，长期有效 */
  until: string;
}

export function buildMsgFields(parent: HTMLElement, init: Partial<MsgDraft>, store: Store) {
  const d: MsgDraft = {
    title: init.title || "", date: init.date || todayISO(), place: init.place || "",
    who: init.who || "", why: init.why || "", body: init.body || "",
    tags: init.tags || "", kind: "note", until: init.until || "",
  };

  // 标题：最亮的一个框，先填它
  const title = el("input", "tlt-input wide tlt-input-title");
  title.placeholder = T("标题：一句话说清这条消息");
  title.value = d.title;
  title.oninput = () => (d.title = title.value);
  parent.appendChild(title);

  // 内容紧跟标题
  const body = el("textarea", "tlt-textarea tlt-input-body");
  body.placeholder = T("内容：具体要说什么（可留空）");
  body.value = d.body;
  body.oninput = () => (d.body = body.value);
  parent.appendChild(body);

  const rowOf = (label: string) => {
    const r = el("div", "tlt-row");
    r.appendChild(el("span", "tlt-row-l", label));
    parent.appendChild(r);
    return r;
  };

  const whenRow = rowOf(T("创建时间"));
  const when = el("input", "tlt-input");
  when.type = "date";
  when.value = d.date;
  when.oninput = () => (d.date = when.value);
  whenRow.appendChild(when);

  const untilRow = rowOf(T("截止时间"));
  const until = el("input", "tlt-input tlt-input-until");
  until.type = "date";
  until.value = d.until;
  until.oninput = () => (d.until = until.value);
  const clearUntil = el("button", "tlt-btn tiny", T("清除"));
  clearUntil.title = T("留空 = 没有固定截止，长期有效");
  clearUntil.onclick = () => { until.value = ""; d.until = ""; };
  untilRow.append(until, clearUntil, el("span", "tlt-hint", T("留空 = 长期有效")));

  const whereRow = rowOf(T("地点"));
  const where = el("input", "tlt-input");
  where.placeholder = T("会议室 / 线上 / 可留空");
  where.value = d.place;
  where.oninput = () => (d.place = where.value);
  whereRow.appendChild(where);

  const whoRow = rowOf(T("人物"));
  const who = el("input", "tlt-input");
  who.placeholder = T("谁在场 / 谁交办，逗号分开");
  who.value = d.who;
  who.oninput = () => (d.who = who.value);
  whoRow.appendChild(who);

  const whyRow = rowOf(T("缘由"));
  const why = el("input", "tlt-input");
  why.placeholder = T("为什么发这条（可留空）");
  why.value = d.why;
  why.oninput = () => (d.why = why.value);
  whyRow.appendChild(why);

  const tagRow = rowOf(T("标签"));
  const tags = el("input", "tlt-input");
  tags.placeholder = T("逗号分开，可留空");
  tags.value = d.tags;
  tags.oninput = () => (d.tags = tags.value);
  tagRow.appendChild(tags);

  return {
    titleEl: title,
    value: (): Partial<Msg> & { title: string } => ({
      title: d.title.trim(),
      date: d.date || todayISO(),
      place: d.place.trim(),
      who: d.who.split(/[,，、]/).map((x) => x.trim().replace(/^\[\[|\]\]$/g, "")).filter(Boolean),
      why: d.why.trim(),
      body: d.body.trim(),
      tags: d.tags.split(/[,，]/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean),
      kind: "note",
    }),
  };
}

export class MsgModal extends TltModal {
  store: Store;
  msg: Msg;
  onChange: () => void | Promise<void>;
  private editing = false;
  constructor(app: App, store: Store, msg: Msg, onChange: () => void | Promise<void>) {
    super(app); this.store = store; this.msg = msg; this.onChange = onChange;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tlt-modal");
    const m = this.msg;
    const feed = this.store.feeds.find((f) => f.id === m.feed);
    const writable = !!feed?.mine || !!feed?.personal;

    if (this.editing) { this.openEdit(contentEl, m, feed); return; }

    // 先标题，再内容，最后才是时间地点这些标注
    contentEl.appendChild(el("div", "tlt-m-title", m.title));
    if (m.body) contentEl.appendChild(el("div", "tlt-m-body", m.body));

    const w = el("div", "tlt-5w");
    const cell = (k: string, v: string) => {
      if (!v) return;
      const c = el("div", "tlt-5w-c");
      c.append(el("span", "tlt-5w-k", k), el("span", "tlt-5w-v", v));
      w.appendChild(c);
    };
    cell(T("创建时间"), m.date);
    cell(T("截止时间"), m.until || T("长期有效"));
    if (m.ended) cell(T("结束发布时间"), m.ended);
    cell(T("地点"), m.place);
    cell(T("人物"), m.who.join(T("、")));
    cell(T("缘由"), m.why);
    if (w.children.length) contentEl.appendChild(w);

    if (m.tags.length) {
      const tg = el("div", "tlt-quick tlt-msg-tags");
      m.tags.forEach((t) => tg.appendChild(el("span", "tlt-tag", t)));
      contentEl.appendChild(tg);
    }

    const foot = el("div", "tlt-m-foot");
    const left = el("div", "tlt-foot-left");
    if (feed) left.appendChild(el("span", "tlt-srcbadge", feed.personal ? T("个人") : feed.name));
    if (m.star) left.appendChild(el("span", "tlt-srcbadge star", T("★ 重要")));
    if (m.state === "ended") left.appendChild(el("span", "tlt-srcbadge off", T("已结束")));
    foot.appendChild(left);

    // 动作全部平铺，不再藏进「⋯」：编辑 / 结束(恢复) / 发布为消息源 / 转为任务
    if (writable) {
      const edit = el("button", "tlt-btn", T("编辑"));
      edit.onclick = () => { this.editing = true; this.onOpen(); };
      foot.appendChild(edit);

      const stateBtn = el("button", "tlt-btn", m.state === "ended" ? T("恢复发布") : T("结束这条"));
      stateBtn.title = m.state === "ended"
        ? T("恢复后结束发布时间会被去掉")
        : T("结束后会自动补上结束发布时间");
      stateBtn.onclick = () => { void (async () => {
        await this.store.setMsgState(m.feed, m, m.state === "ended" ? "live" : "ended");
        this.close(); void this.onChange();
        new Notice(m.state === "ended" ? T("已恢复发布，结束时间已去掉") : T("已结束，已记下结束发布时间"));
      })(); };
      foot.appendChild(stateBtn);
    }
    if (feed?.personal) {
      const pub = el("button", "tlt-btn", T("发布为消息源…"));
      pub.title = T("把这条消息单独发布成一个别人能订阅的源");
      pub.onclick = () => {
        this.close();
        if (feed) new PublishPersonalModal(this.app, this.store, feed, m, () => { void this.onChange(); }).open();
      };
      foot.appendChild(pub);
    }
    const toTask = el("button", "tlt-btn pri", T("转为任务…"));
    toTask.onclick = () => {
      this.close();
      new QuickTaskModal(this.app, this.store, this.onChange, { title: m.title, due: m.date }).open();
    };
    const close = el("button", "tlt-btn", T("关闭"));
    close.onclick = () => this.close();
    foot.append(toTask, close);
    contentEl.appendChild(foot);
  }

  private openEdit(contentEl: HTMLElement, m: Msg, feed?: Feed) {
    contentEl.appendChild(el("div", "tlt-m-title", T("编辑消息")));
    const f = buildMsgFields(contentEl, {
      title: m.title, date: m.date, until: m.until, place: m.place,
      who: m.who.join("、"), why: m.why, body: m.body, tags: m.tags.join(", "), kind: m.kind,
    }, this.store);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => { this.editing = false; this.onOpen(); };
    const save = el("button", "tlt-btn pri", T("保存"));
    save.onclick = () => { void (async () => {
      const v = f.value();
      if (!v.title) { new Notice(T("标题不能空")); return; }
      await this.store.updateMessage(m.feed, m, v);
      this.close(); void this.onChange(); new Notice(T("已保存"));
    })(); };
    foot.append(cancel, save);
    contentEl.appendChild(foot);
    window.setTimeout(() => f.titleEl.focus(), 50);
  }

  onClose() { this.contentEl.empty(); }
}

export class PublishPersonalModal extends TltModal {
  store: Store;
  plugin?: TLTPlugin;
  from: Feed;
  msg: Msg;
  onDone: () => void | Promise<void>;
  constructor(app: App, store: Store, from: Feed, msg: Msg, onDone: () => void | Promise<void>, plugin?: TLTPlugin) {
    super(app); this.store = store; this.from = from; this.msg = msg; this.onDone = onDone; this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("发布为消息源")));
    contentEl.appendChild(el("div", "tlt-m-meta", T("把「{t}」放进一个新源，别人订阅这个源就能收到。", { t: this.msg.title })));

    const idIn = el("input", "tlt-input wide");
    idIn.placeholder = T("源 ID（英文/数字最稳，作为 ?ID=）");
    idIn.value = "my-feed";
    contentEl.appendChild(idIn);

    const nameIn = el("input", "tlt-input wide");
    nameIn.placeholder = T("源名称（显示用）");
    nameIn.value = T("我的新源");
    contentEl.appendChild(nameIn);
    contentEl.appendChild(el("div", "tlt-hint", T("ID 就是订阅地址里的 ?id=，建好后别改。")));

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("创建并放入"));
    ok.onclick = () => { void (async () => {
      const id = idIn.value.trim();
      const name = nameIn.value.trim() || id;
      if (!id) { new Notice(T("先写源 ID")); return; }
      // 服务不通就不报"已发布"：先确认发布服务在线
      const hub = this.plugin?.hubState().publish || "";
      if (this.plugin) {
        if (!hub) { new Notice(T("还没填发布服务地址（设置 → 消息服务）")); return; }
        if (!(await this.plugin.pingHub("publish"))) return;
      }
      const r = await this.store.createFeed(id, name);
      if (!r.ok) { new Notice(T("同名源已存在，换个 ID")); return; }
      await this.store.addMessage(id, {
        title: this.msg.title, date: this.msg.date, kind: this.msg.kind, place: this.msg.place, body: this.msg.body,
      });
      await this.store.setMsgState(this.from.id, this.msg, "ended");
      let pushed = 0;
      let pushErr = "";
      if (this.plugin && hub) {
        await this.store.load();
        const feed = this.store.feeds.find((f) => f.id === id);
        try {
          if (feed) pushed = (await this.store.publishFeed(feed, hub, id)).count ?? 0;
        } catch (e) { pushErr = errMsg(e); }
      }
      this.close(); void this.onDone();
      new Notice(pushErr
        ? T("源已建好，但推送失败：{msg}（可在右栏「手动推送」重试）", { msg: pushErr })
        : T("已发布并推送「{name}」· {n} 条", { name, n: pushed }), 8000);
    })(); };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => idIn.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}


/** 标签库：改名 / 删除 */
export class TagEditModal extends TltModal {
  store: Store;
  name: string;
  onDone: () => void | Promise<void>;
  constructor(app: App, store: Store, name: string, onDone: () => void | Promise<void>) {
    super(app); this.store = store; this.name = name; this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", T("编辑标签")));
    contentEl.appendChild(el("div", "tlt-m-meta", T("改名会同时更新 {n} 条随手记。", { n: this.store.ideas.filter((i) => (i.tags || []).includes(this.name)).length })));

    const input = el("input", "tlt-input wide");
    input.value = this.name;
    contentEl.appendChild(input);

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", T("删除标签"));
    del.onclick = () => { void (async () => {
      await this.store.deleteTag(this.name);
      this.close(); void this.onDone(); new Notice(T("已删除「{n}」", { n: this.name }));
    })(); };
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("保存"));
    ok.onclick = () => { void (async () => {
      const v = input.value.trim().replace(/^#/, "");
      if (!v) { new Notice(T("名称不能为空")); return; }
      if (v !== this.name) await this.store.renameTag(this.name, v);
      this.close(); void this.onDone(); new Notice(T("已改好"));
    })(); };
    foot.append(del, cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => { input.focus(); input.select(); }, 50);
  }
  onClose() { this.contentEl.empty(); }
}

/** 小输入框（替代 window.prompt，Obsidian 审核不允许用原生 prompt） */
export class PromptModal extends TltModal {
  title: string;
  label: string;
  onSubmit: (v: string) => void | Promise<void>;
  initial: string;
  constructor(app: App, title: string, label: string, onSubmit: (v: string) => void | Promise<void>, initial = "") {
    super(app); this.title = title; this.label = label; this.onSubmit = onSubmit; this.initial = initial;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.title));
    const input = el("input", "tlt-input wide tlt-input-title");
    input.placeholder = this.label;
    input.value = this.initial;
    contentEl.appendChild(input);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", T("确定"));
    ok.onclick = () => {
      const v = input.value.trim();
      this.close();
      if (v) void this.onSubmit(v);
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); ok.click(); }
    });
    window.setTimeout(() => { input.focus(); input.select(); }, 50);
  }
  onClose() { this.contentEl.empty(); }
}
