import { App, Modal, Notice, TFile } from "obsidian";
import { Store } from "../store";
import { Task, Staff, Idea, Msg, Feed, Period, addDays, todayISO, minToHHMM, saturation, ideaFilterTags } from "../data";

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

export class TaskModal extends TltModal {
  store: Store;
  task: Task;
  onChange: () => void;
  draft: Partial<Task>;

  constructor(app: App, store: Store, task: Task, onChange: () => void) {
    super(app); this.store = store; this.task = task; this.onChange = onChange;
    this.draft = { due: task.due, wl: task.wl, pw: task.pw, pri: task.pri, owners: [...task.owners], start: task.start };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const t = this.task;

    contentEl.appendChild(el("div", "tlt-m-title", t.title));
    const meta = el("div", "tlt-m-meta",
      `${t.project}${t.milestone ? " · " + t.milestone : ""} · ${t.done ? "已完成" : "进行中"}`);
    contentEl.appendChild(meta);

    const due = row(contentEl, "截止");
    const dIn = el("input", "tlt-input") as HTMLInputElement;
    dIn.type = "date";
    dIn.value = this.draft.due || "";
    dIn.onchange = () => { this.draft.due = dIn.value || undefined; };
    due.appendChild(dIn);
    const quick = el("div", "tlt-quick");
    [["今天", 0], ["明天", 1], ["三天后", 3], ["一周后", 7]].forEach(([lbl, n]) => {
      const b = el("button", "tlt-chip", String(lbl));
      b.onclick = () => { this.draft.due = addDays(todayISO(), Number(n)); dIn.value = this.draft.due; };
      quick.appendChild(b);
    });
    due.appendChild(quick);

    const wl = row(contentEl, "占比");
    seg<number>(wl, [10, 20, 30, 50, 100].map((v) => ({ v, t: v + "%" })), this.draft.wl || 10, (v) => (this.draft.wl = v));
    const per = el("div", "tlt-quick");
    (["w", "m", "q"] as Period[]).forEach((p) => {
      const b = el("button", "tlt-chip" + (this.draft.pw === p ? " on" : ""), { w: "本周", m: "本月", q: "本季度" }[p]);
      b.onclick = () => { this.draft.pw = p; per.querySelectorAll(".tlt-chip").forEach((x) => x.classList.remove("on")); b.classList.add("on"); };
      per.appendChild(b);
    });
    wl.appendChild(per);

    const pri = row(contentEl, "优先级");
    seg<number>(pri, [{ v: 0, t: "低" }, { v: 1, t: "普通" }, { v: 2, t: "高" }, { v: 3, t: "紧急" }], this.draft.pri || 1, (v) => (this.draft.pri = v as any));

    // 负责人：默认只显示当前负责人，要改再展开
    const owners = row(contentEl, "负责人");
    const whoBox = el("div", "tlt-ownerbox");
    const cur = el("div", "tlt-quick");
    const pool = el("div", "tlt-quick tlt-ownerpick");
    pool.addClass("tlt-hidden");
    let picking = false;
    const paintOwners = () => {
      cur.empty();
      const names = this.draft.owners || [];
      if (!names.length) cur.appendChild(el("span", "tlt-owner-none", "未指派"));
      names.forEach((n) => {
        const st = this.store.staff.find((x) => x.name === n);
        const chip = el("span", "tlt-chip on tlt-owner-chip");
        chip.append(el("span", "", n));
        if (st) chip.title = `${st.role} · 产能 ${st.capacity}%`;
        if (picking) {
          const x = el("i", "", "×");
          x.onclick = () => {
            this.draft.owners = (this.draft.owners || []).filter((y) => y !== n);
            paintOwners();
          };
          chip.appendChild(x);
        }
        cur.appendChild(chip);
      });
      const toggle = el("button", "tlt-btn tiny", picking ? "完成" : names.length ? "调整…" : "指派…");
      toggle.onclick = () => { picking = !picking; paintOwners(); };
      cur.appendChild(toggle);

      pool.empty();
      if (picking) pool.removeClass("tlt-hidden"); else pool.addClass("tlt-hidden");
      if (!picking) return;
      const rest = this.store.staff.filter((x) => !(this.draft.owners || []).includes(x.name));
      if (!rest.length) pool.appendChild(el("span", "tlt-owner-none", "都指派过了"));
      rest.forEach((st2) => {
        const b = el("button", "tlt-chip", st2.name);
        b.title = `${st2.role} · 产能 ${st2.capacity}%`;
        b.onclick = () => {
          this.draft.owners = [...(this.draft.owners || []), st2.name];
          paintOwners();
        };
        pool.appendChild(b);
      });
    };
    paintOwners();
    whoBox.append(cur, pool);
    owners.appendChild(whoBox);

    const foot = el("div", "tlt-m-foot");
    const save = el("button", "tlt-btn pri", "保存");
    save.onclick = async () => {
      const d = this.draft;
      if (d.due !== t.due) await this.store.setDue(t, d.due || "");
      if (d.wl !== t.wl) await this.store.setField(t, "wl", d.wl ?? 0);
      if (d.pw !== t.pw) await this.store.setField(t, "pw", d.pw ?? "m");
      if (d.pri !== t.pri) await this.store.setField(t, "pri", d.pri ?? 1);
      if ((d.owners || []).join(",") !== t.owners.join(",")) {
        await this.store.setField(t, "owner", (d.owners || []).map((o) => `[[${o}]]`).join(", "));
      }
      this.close(); this.onChange(); new Notice("已写回任务行");
    };
    const done = el("button", "tlt-btn", t.done ? "标为未完成" : "标记完成");
    done.onclick = async () => { await this.store.toggleTask(t); this.close(); this.onChange(); };
    const del = el("button", "tlt-btn danger", "删除任务");
    del.onclick = async () => {
      await this.store.deleteTask(t);
      this.close(); this.onChange(); new Notice("已删除任务");
    };
    const open = el("button", "tlt-btn", "打开所在笔记");
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(t.file);
      if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
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
  onChange: () => void;

  constructor(app: App, store: Store, log: Task, onChange: () => void) {
    super(app); this.store = store; this.log = log; this.onChange = onChange;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.log.title));
    contentEl.appendChild(el("div", "tlt-m-meta",
      `${this.log.due} · ${this.log.st || ""}${this.log.en ? "–" + this.log.en : ""}${this.log.extra ? " · 计划外" : ""}${this.log.project ? " · " + this.log.project : ""}`));

    const body = el("textarea", "tlt-textarea") as HTMLTextAreaElement;
    body.placeholder = "谈了什么 / 决定了什么 / 下一步（会写成文件里的引用块）";
    body.value = (this.log as any).note || "";
    contentEl.appendChild(body);

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "删除这条记录");
    del.onclick = async () => {
      await this.store.deleteLog(this.log);
      this.close(); this.onChange(); new Notice("已删除记录");
    };
    const open = el("button", "tlt-btn", "打开月文件");
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(this.log.file);
      if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
      this.close();
    };
    const ok = el("button", "tlt-btn pri", "保存");
    ok.onclick = async () => {
      await this.store.updateLogBody(this.log, body.value);
      this.close(); this.onChange(); new Notice("已写回记录");
    };
    foot.append(del, open, ok);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 快速添加 ================= */

export class QuickTaskModal extends TltModal {
  store: Store;
  onChange: () => void;
  private draft: any;
  private preset: { title?: string; due?: string } = {};

  constructor(app: App, store: Store, onChange: () => void, preset?: { title?: string; due?: string }) {
    super(app); this.store = store; this.onChange = onChange;
    this.preset = preset || {};
    const proj = store.projects()[0] || "未归属";
    const ms = store.milestones(proj)[0]?.name || "";
    this.draft = {
      start: todayISO(), due: preset?.due || todayISO(),
      est: 1, pri: 1, owners: [],
      project: proj, milestone: ms, tags: [] as string[], scope: "工作" as "工作" | "个人",
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "新建任务"));

    // 只有任务名
    const title = el("input", "tlt-input wide") as HTMLInputElement;
    title.placeholder = "任务名";
    title.value = this.preset.title || "";
    contentEl.appendChild(title);

    // 项目（可选可新建）
    const projRow = row(contentEl, "项目");
    const projWrap = el("div", "tlt-pick");
    const proj = el("select", "tlt-input") as HTMLSelectElement;
    const fillProjects = (keep?: string) => {
      proj.empty();
      [...this.store.projects(), "未归属"].forEach((p) => {
        const o = createEl("option");
        o.value = p; o.textContent = p;
        if (p === (keep || this.draft.project)) o.selected = true;
        proj.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__"; n.textContent = "＋ 新建项目…";
      proj.appendChild(n);
    };
    fillProjects();
    const projNew = el("input", "tlt-input") as HTMLInputElement;
    projNew.placeholder = "新项目名（= 文件名）";
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
    const msRow = row(contentEl, "里程碑");
    const msWrap = el("div", "tlt-pick");
    const msSel = el("select", "tlt-input") as HTMLSelectElement;
    const msNew = el("input", "tlt-input") as HTMLInputElement;
    msNew.placeholder = "新里程碑名";
    msNew.addClass("tlt-hidden");
    const fillMs = () => {
      msSel.empty();
      const list = this.draft.project ? this.store.milestones(this.draft.project).map((m) => m.name) : [];
      const o0 = createEl("option");
      o0.value = ""; o0.textContent = "（不归里程碑）";
      msSel.appendChild(o0);
      list.forEach((name) => {
        const o = createEl("option");
        o.value = name; o.textContent = name;
        msSel.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__"; n.textContent = "＋ 新建里程碑…";
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
    const tagRow = row(contentEl, "标签");
    const tagWrap = el("div", "tlt-quick");
    const knownTags = Array.from(new Set(this.store.tasks.flatMap((t) => t.tags || [])));
    const allTags = Array.from(new Set(["工作", "个人", ...knownTags]));
    const paintTags = () => {
      tagWrap.empty();
      allTags.forEach((tg) => {
        const b = el("button", "tlt-chip" + (this.draft.tags.includes(tg) ? " on" : ""), tg);
        b.onclick = () => {
          const a = this.draft.tags as string[];
          this.draft.tags = a.includes(tg) ? a.filter((x) => x !== tg) : [...a, tg];
          paintTags();
        };
        tagWrap.appendChild(b);
      });
      const add = el("input", "tlt-input small") as HTMLInputElement;
      add.placeholder = "新标签";
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

    // 开始 / 截止
    const startRow = row(contentEl, "开始");
    const start = el("input", "tlt-input") as HTMLInputElement;
    start.type = "date"; start.value = this.draft.start;
    start.onchange = () => (this.draft.start = start.value);
    startRow.appendChild(start);

    const dueRow = row(contentEl, "截止");
    const due = el("input", "tlt-input") as HTMLInputElement;
    due.type = "date"; due.value = this.draft.due;
    due.onchange = () => (this.draft.due = due.value);
    dueRow.appendChild(due);
    const quick = el("div", "tlt-quick");
    [["今天", 0], ["明天", 1], ["三天后", 3], ["一周后", 7]].forEach(([lbl, n]) => {
      const b = el("button", "tlt-chip", String(lbl));
      b.onclick = () => { this.draft.due = addDays(todayISO(), Number(n)); due.value = this.draft.due; };
      quick.appendChild(b);
    });
    dueRow.appendChild(quick);

    // 人天
    const estRow = row(contentEl, "工作量");
    seg<number>(estRow, [0.5, 1, 2, 3, 5].map((v) => ({ v, t: v + " 天" })), this.draft.est, (v) => {
      this.draft.est = v; estInput.value = String(v);
    });
    const estInput = el("input", "tlt-input small") as HTMLInputElement;
    estInput.type = "number"; estInput.step = "0.5"; estInput.min = "0"; estInput.value = String(this.draft.est);
    estInput.oninput = () => { this.draft.est = Number(estInput.value) || 0; };
    estRow.appendChild(estInput);

    // 优先级
    const priRow = row(contentEl, "优先级");
    seg<number>(priRow, [{ v: 0, t: "低" }, { v: 1, t: "普通" }, { v: 2, t: "高" }, { v: 3, t: "紧急" }], this.draft.pri, (v) => (this.draft.pri = v));

    // 负责人
    const whoRow = row(contentEl, "负责人");
    const whoWrap = el("div", "tlt-people");
    if (!this.store.staff.length) whoWrap.appendChild(el("div", "tlt-hint", "还没有人员档案（人员页可以新建）"));
    this.store.staff.forEach((st) => {
      const sat = saturation(this.store.tasks, st.name, "m", { capacity: st.capacity, days: st.days });
      const b = el("button", "tlt-chip" + (this.draft.owners.includes(st.name) ? " on" : ""), `${st.name} · ${sat.pct}%`);
      b.title = `${st.role || ""} · 本月已排 ${sat.sum} / ${sat.avail} 人天`;
      b.onclick = () => {
        const a = this.draft.owners;
        this.draft.owners = a.includes(st.name) ? a.filter((x: string) => x !== st.name) : [...a, st.name];
        b.classList.toggle("on");
      };
      whoWrap.appendChild(b);
    });
    whoRow.appendChild(whoWrap);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "创建");
    ok.onclick = async () => {
      const name = title.value.trim();
      if (!name) { new Notice("先写任务名"); return; }
      await this.store.addTask(this.draft.project, this.draft.milestone || undefined, {
        title: name,
        start: this.draft.start,
        due: this.draft.due,
        est: this.draft.est,
        pri: this.draft.pri as any,
        owners: this.draft.owners,
        tags: this.draft.tags,
      });
      this.close(); this.onChange(); new Notice("已创建任务");
    };
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
  onChange: () => void;
  startAt: string;
  constructor(app: App, store: Store, date: string, onChange: () => void, startAt = "09:00") {
    super(app); this.store = store; this.date = date; this.onChange = onChange; this.startAt = startAt;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", `记一条 · ${this.date}`));
    contentEl.appendChild(el("div", "tlt-m-meta", "记录是「实际发生」的事；计划外的事也记在这里"));

    const st = el("input", "tlt-input") as HTMLInputElement;
    st.type = "time"; st.value = this.startAt;
    const en = el("input", "tlt-input") as HTMLInputElement;
    en.type = "time";
    const [hh, mm] = this.startAt.split(":").map(Number);
    en.value = minToHHMM(hh * 60 + (mm || 0) + 30);
    const times = el("div", "tlt-times");
    times.append(st, el("span", "tlt-dash", "–"), en);
    contentEl.appendChild(times);

    const title = el("input", "tlt-input wide") as HTMLInputElement;
    title.placeholder = "做了什么";
    contentEl.appendChild(title);
    const body = el("textarea", "tlt-textarea") as HTMLTextAreaElement;
    body.placeholder = "正文（可留空）";
    contentEl.appendChild(body);

    const extra = el("label", "tlt-check");
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox";
    extra.append(cb, el("span", "", "计划外（临时插入）"));
    contentEl.appendChild(extra);

    const foot = el("div", "tlt-m-foot");
    const ok = el("button", "tlt-btn pri", "记录");
    ok.onclick = async () => {
      if (!title.value.trim()) return;
      await this.store.addLog(this.date, {
        st: st.value, en: en.value, title: title.value.trim(), body: body.value.trim() || undefined, extra: cb.checked,
      });
      this.close(); this.onChange(); new Notice("已写入记录");
    };
    const cancel = el("button", "tlt-btn", "取消");
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
  onChange?: () => void;
  constructor(app: App, store: Store, staff: Staff, onChange?: () => void) {
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
    who.append(el("div", "tlt-staff-name", s.name), el("div", "tlt-staff-role", s.role || "未填岗位"));
    head.append(av, who);
    contentEl.appendChild(head);

    const sat = saturation(this.store.tasks, s.name, this.store.settings.defaultPeriod, { capacity: s.capacity, days: s.days });
    const grid = el("div", "tlt-staff-grid");
    const cell = (label: string, value: string) => {
      const c = el("div", "tlt-staff-cell");
      c.append(el("span", "tlt-staff-l", label), el("b", "", value));
      grid.appendChild(c);
    };
    cell("产能", `${s.capacity}%`);
    cell("在岗", `每周 ${s.days} 天`);
    cell("可用", `${sat.avail} 人天/月`);
    cell("已排", `${sat.sum} 人天（${sat.pct}%）`);
    contentEl.appendChild(grid);

    const skillRow = el("div", "tlt-staff-line");
    skillRow.appendChild(el("span", "tlt-staff-l", "技能"));
    const chips = el("div", "tlt-quick");
    (s.skills || []).length
      ? s.skills.forEach((k) => chips.appendChild(el("span", "tlt-chip on", k)))
      : chips.appendChild(el("span", "tlt-hint", "还没填"));
    skillRow.appendChild(chips);
    contentEl.appendChild(skillRow);

    if (s.note) {
      const noteRow = el("div", "tlt-staff-line");
      noteRow.appendChild(el("span", "tlt-staff-l", "备注"));
      noteRow.appendChild(el("div", "tlt-staff-note", s.note));
      contentEl.appendChild(noteRow);
    }

    const tasks = this.store.tasks.filter((t) => !t.done && t.owners.includes(s.name));
    const listRow = el("div", "tlt-staff-line");
    listRow.appendChild(el("span", "tlt-staff-l", "手上"));
    const ul = el("div", "tlt-staff-tasks");
    tasks.length
      ? tasks.slice(0, 6).forEach((t) => {
          const r = el("div", "tlt-staff-task");
          r.append(el("span", "", t.title), el("span", "tlt-hint", t.est !== undefined ? `${t.est} 人天` : t.due || ""));
          ul.appendChild(r);
        })
      : ul.appendChild(el("div", "tlt-hint", "这个周期没有任务"));
    listRow.appendChild(ul);
    contentEl.appendChild(listRow);

    contentEl.appendChild(el("div", "tlt-hint", `档案文件：${s.file}`));

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "删除档案");
    del.onclick = async () => {
      await this.store.removeStaff(s);
      this.close(); this.onChange?.(); new Notice(`已删除 ${s.name} 的档案`);
    };
    const open = el("button", "tlt-btn pri", "打开档案文件");
    open.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(s.file);
      if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
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
  onJump: () => void;
  constructor(app: App, store: Store, task: Task, onJump: () => void) {
    super(app); this.store = store; this.task = task; this.onJump = onJump;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.addClass("tlt-peek");
    const t = this.task;
    contentEl.appendChild(el("div", "tlt-peek-title", t.title));
    const rows: [string, string][] = [
      ["项目", `${t.project}${t.milestone ? " · " + t.milestone : ""}`],
      ["时间", `${t.start ? t.start + " → " : ""}${t.due || "未排期"}`],
      ["工作量", t.est !== undefined ? `${t.est} 人天` : t.wl ? `${t.wl}%` : "未估"],
      ["负责人", t.owners.length ? t.owners.join("、") : "未分配"],
      ["状态", t.done ? "已完成" : "进行中"],
    ];
    rows.forEach(([k, v]) => {
      const r = el("div", "tlt-peek-row");
      r.append(el("span", "tlt-peek-k", k), el("span", "tlt-peek-v", v));
      contentEl.appendChild(r);
    });
    const foot = el("div", "tlt-m-foot");
    const open = el("button", "tlt-btn pri", "打开任务 →");
    open.onclick = () => { this.close(); this.onJump(); };
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
      ["项目", m.project],
      ["进度", `${done}/${m.tasks.length}（${Math.round((done / m.tasks.length) * 100)}%）`],
      ["人天", `${m.tasks.reduce((n, t) => n + (t.est || 0), 0)} 天`],
      ["负责人", Array.from(new Set(m.tasks.flatMap((t) => t.owners))).join("、") || "未分配"],
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
    const open = el("button", "tlt-btn pri", "打开里程碑 →");
    open.onclick = () => { this.close(); this.onOpenMs(); };
    foot.appendChild(open);
    contentEl.appendChild(foot);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 添加人员 ================= */

export class AddStaffModal extends TltModal {
  store: Store;
  onChange: () => void;
  constructor(app: App, store: Store, onChange: () => void) {
    super(app); this.store = store; this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "添加成员"));
    contentEl.appendChild(el("div", "tlt-m-meta",
      `会在 ${this.store.settings.teamFolder}/ 新建一个档案文件，frontmatter 里填岗位与产能。`));
    const name = el("input", "tlt-input wide") as HTMLInputElement;
    name.placeholder = "姓名（= 文件名）";
    contentEl.appendChild(name);
    const role = el("input", "tlt-input wide") as HTMLInputElement;
    role.placeholder = "岗位，默认「算法工程师」";
    contentEl.appendChild(role);

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "创建");
    ok.onclick = async () => {
      const n = name.value.trim();
      if (!n) return;
      const created = await this.store.addStaff(n);
      if (!created) { new Notice("同名档案已存在"); return; }
      this.close();
      this.onChange();
      new Notice(`已创建 ${n} 的档案，点卡片可查看/编辑`);
    };
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
  onChange: () => void;
  constructor(app: App, store: Store, idea: Idea | undefined, onChange: () => void) {
    super(app); this.store = store; this.idea = idea; this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const isNew = !this.idea;

    contentEl.appendChild(el("div", "tlt-idea-kicker", isNew ? "新建随手记" : "随手记"));

    const title = el("input", "tlt-idea-title") as HTMLInputElement;
    title.placeholder = "一句话记下来";
    title.value = this.idea?.title || "";
    contentEl.appendChild(title);

    // 已选标签（可点 × 去掉）
    let tags: string[] = this.idea ? ideaFilterTags(this.idea) : [];
    contentEl.appendChild(el("div", "tlt-field-label", "标签"));
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
      const add = el("input", "tlt-tagin") as HTMLInputElement;
      add.placeholder = tags.length ? "再加…" : "加标签，回车";
      add.onkeydown = async (e) => {
        if (e.key !== "Enter") return;
        const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, "");
        if (!v) return;
        if (!tags.includes(v)) tags.push(v);
        if (!this.store.tags.includes(v)) await this.store.addTag(v);
        (e.target as HTMLInputElement).value = "";
        paint();
        (tagWrap.querySelector(".tlt-tagin") as HTMLInputElement | null)?.focus();
      };
      tagWrap.appendChild(add);
    };
    paint();
    contentEl.appendChild(tagWrap);

    // 标签库：点一下加进上面，✎ 改/删，末尾 + 新建
    contentEl.appendChild(el("div", "tlt-field-label", "标签库（点一下加入，✎ 修改）"));
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
        new PromptModal(this.app, "新建标签", "标签名", async (v) => {
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

    contentEl.appendChild(el("div", "tlt-field-label", "为什么做 / 怎么验证"));
    const body = el("textarea", "tlt-textarea tall") as HTMLTextAreaElement;
    body.placeholder = "值得做的理由、可能的验证方式（可以留空）";
    body.value = this.idea?.body || "";
    contentEl.appendChild(body);

    const foot = el("div", "tlt-m-foot");
    if (!isNew) {
      const del = el("button", "tlt-btn danger", "删除");
      del.onclick = async () => {
        await this.store.deleteIdea(this.idea!);
        this.close(); this.onChange(); new Notice("已删除想法");
      };
      foot.appendChild(del);
      foot.appendChild(el("span", "tlt-spacer"));
    }
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", isNew ? "收录" : "保存");
    ok.onclick = async () => {
      const t = title.value.trim();
      if (!t) { new Notice("先写一句话"); return; }
      const bd = body.value.trim();
      if (this.idea) {
        this.idea.title = t; this.idea.tags = tags; this.idea.body = bd;
        await this.store.updateIdea(this.idea);
      } else {
        await this.store.addIdea({ title: t, tags, body: bd || undefined });
      }
      this.close(); this.onChange(); new Notice(isNew ? "已收进想法池" : "已保存");
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}

/* ================= 消息 ================= */


/** 轻量弹出菜单（锚在按钮上方，点外面关掉） */
export function popMenu(anchor: HTMLElement, items: { label: string; onClick: () => void }[], align: "left" | "right" = "left") {
  document.querySelectorAll(".tlt-menu").forEach((n) => n.remove());
  const m = el("div", "tlt-menu");
  items.forEach((it) => {
    const b = el("button", "tlt-menu-i", it.label);
    b.onclick = () => { m.remove(); it.onClick(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth || 150;
  const left = align === "right" ? Math.min(r.right - w, window.innerWidth - w - 8) : Math.max(8, r.left);
  m.style.left = `${Math.round(left)}px`;
  m.style.top = `${Math.round(Math.min(r.top - m.offsetHeight - 6, window.innerHeight - m.offsetHeight - 8))}px`;
  const off = (e: MouseEvent) => {
    if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener("mousedown", off); }
  };
  window.setTimeout(() => document.addEventListener("mousedown", off), 0);
}

/** 消息的 5W 表单（新建与编辑共用）：时间/地点/人物/缘由/内容/标签 */
export interface MsgDraft {
  title: string; date: string; place: string; who: string; why: string;
  body: string; tags: string; kind: Msg["kind"];
}

export function buildMsgFields(parent: HTMLElement, init: Partial<MsgDraft>, store: Store) {
  const d: MsgDraft = {
    title: init.title || "", date: init.date || todayISO(), place: init.place || "",
    who: init.who || "", why: init.why || "", body: init.body || "",
    tags: init.tags || "", kind: "note",
  };

  // 标题：最亮的一个框，先填它
  const title = el("input", "tlt-input wide tlt-input-title") as HTMLInputElement;
  title.placeholder = "标题：一句话说清这条消息";
  title.value = d.title;
  title.oninput = () => (d.title = title.value);
  parent.appendChild(title);

  // 内容紧跟标题
  const body = el("textarea", "tlt-textarea tlt-input-body") as HTMLTextAreaElement;
  body.placeholder = "内容：具体要说什么（可留空）";
  body.value = d.body;
  body.oninput = () => (d.body = body.value);
  parent.appendChild(body);

  const rowOf = (label: string) => {
    const r = el("div", "tlt-row");
    r.appendChild(el("span", "tlt-row-l", label));
    parent.appendChild(r);
    return r;
  };

  const whenRow = rowOf("时间");
  const when = el("input", "tlt-input") as HTMLInputElement;
  when.type = "date";
  when.value = d.date;
  when.oninput = () => (d.date = when.value);
  whenRow.appendChild(when);

  const whereRow = rowOf("地点");
  const where = el("input", "tlt-input") as HTMLInputElement;
  where.placeholder = "会议室 / 线上 / 可留空";
  where.value = d.place;
  where.oninput = () => (d.place = where.value);
  whereRow.appendChild(where);

  const whoRow = rowOf("人物");
  const who = el("input", "tlt-input") as HTMLInputElement;
  who.placeholder = "谁在场 / 谁交办，逗号分开";
  who.value = d.who;
  who.oninput = () => (d.who = who.value);
  whoRow.appendChild(who);

  const whyRow = rowOf("缘由");
  const why = el("input", "tlt-input") as HTMLInputElement;
  why.placeholder = "为什么发这条（可留空）";
  why.value = d.why;
  why.oninput = () => (d.why = why.value);
  whyRow.appendChild(why);

  const tagRow = rowOf("标签");
  const tags = el("input", "tlt-input") as HTMLInputElement;
  tags.placeholder = "逗号分开，可留空";
  tags.value = d.tags;
  tags.oninput = () => (d.tags = tags.value);
  tagRow.appendChild(tags);

  return {
    titleEl: title,
    value: (): Partial<Msg> => ({
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
  onChange: () => void;
  private editing = false;
  constructor(app: App, store: Store, msg: Msg, onChange: () => void) {
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
    cell("时间", m.date);
    cell("地点", m.place);
    cell("人物", m.who.join("、"));
    cell("缘由", m.why);
    if (w.children.length) contentEl.appendChild(w);

    if (m.tags.length) {
      const tg = el("div", "tlt-quick tlt-msg-tags");
      m.tags.forEach((t) => tg.appendChild(el("span", "tlt-tag", t)));
      contentEl.appendChild(tg);
    }

    const foot = el("div", "tlt-m-foot");
    const left = el("div", "tlt-foot-left");
    if (feed) left.appendChild(el("span", "tlt-srcbadge", feed.personal ? "个人" : feed.name));
    if (m.star) left.appendChild(el("span", "tlt-srcbadge star", "★ 重要"));
    if (m.state === "ended") left.appendChild(el("span", "tlt-srcbadge off", "已结束"));
    foot.appendChild(left);

    const more = el("button", "tlt-btn tlt-more", "⋯");
    more.title = "更多";
    const moreItems: { label: string; onClick: () => void }[] = [];
    if (writable) {
      moreItems.push({
        label: m.state === "ended" ? "恢复发布" : "结束这条",
        onClick: async () => {
          await this.store.setMsgState(m.feed, m, m.state === "ended" ? "live" : "ended");
          this.close(); this.onChange(); new Notice("状态已更新");
        },
      });
    }
    if (feed?.personal) {
      moreItems.push({
        label: "发布为消息源…",
        onClick: () => {
          this.close();
          new PublishPersonalModal(this.app, this.store, feed!, m, () => this.onChange()).open();
        },
      });
    }

    if (writable) {
      const edit = el("button", "tlt-btn", "编辑");
      edit.onclick = () => { this.editing = true; this.onOpen(); };
      foot.appendChild(edit);
    }
    if (moreItems.length) {
      more.onclick = () => popMenu(more, moreItems, "right");
      foot.appendChild(more);
    }
    const toTask = el("button", "tlt-btn pri", "转为任务…");
    toTask.onclick = () => {
      this.close();
      new QuickTaskModal(this.app, this.store, this.onChange, { title: m.title, due: m.date }).open();
    };
    const close = el("button", "tlt-btn", "关闭");
    close.onclick = () => this.close();
    foot.append(toTask, close);
    contentEl.appendChild(foot);
  }

  private openEdit(contentEl: HTMLElement, m: Msg, feed?: Feed) {
    contentEl.appendChild(el("div", "tlt-m-title", "编辑消息"));
    const f = buildMsgFields(contentEl, {
      title: m.title, date: m.date, place: m.place,
      who: m.who.join("、"), why: m.why, body: m.body, tags: m.tags.join(", "), kind: m.kind,
    }, this.store);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => { this.editing = false; this.onOpen(); };
    const save = el("button", "tlt-btn pri", "保存");
    save.onclick = async () => {
      const v = f.value();
      if (!v.title) { new Notice("标题不能空"); return; }
      await this.store.updateMessage(m.feed, m, v);
      this.close(); this.onChange(); new Notice("已保存");
    };
    foot.append(cancel, save);
    contentEl.appendChild(foot);
    window.setTimeout(() => f.titleEl.focus(), 50);
  }

  onClose() { this.contentEl.empty(); }
}

export class PublishPersonalModal extends TltModal {
  store: Store;
  from: Feed;
  msg: Msg;
  onDone: () => void;
  constructor(app: App, store: Store, from: Feed, msg: Msg, onDone: () => void) {
    super(app); this.store = store; this.from = from; this.msg = msg; this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "发布为消息源"));
    contentEl.appendChild(el("div", "tlt-m-meta", `把「${this.msg.title}」放进一个新源，别人订阅这个源就能收到。`));

    const idIn = el("input", "tlt-input wide") as HTMLInputElement;
    idIn.placeholder = "源 ID（英文/数字最稳，作为 ?ID=）";
    idIn.value = "my-feed";
    contentEl.appendChild(idIn);

    const nameIn = el("input", "tlt-input wide") as HTMLInputElement;
    nameIn.placeholder = "源名称（显示用）";
    nameIn.value = "我的新源";
    contentEl.appendChild(nameIn);
    contentEl.appendChild(el("div", "tlt-hint", "ID 就是订阅地址里的 ?id=，建好后别改。"));

    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "创建并放入");
    ok.onclick = async () => {
      const id = idIn.value.trim();
      const name = nameIn.value.trim() || id;
      if (!id) { new Notice("先写源 ID"); return; }
      const r = await this.store.createFeed(id, name);
      if (!r.ok) { new Notice("同名源已存在，换个 ID"); return; }
      await this.store.addMessage(id, {
        title: this.msg.title, date: this.msg.date, kind: this.msg.kind, place: this.msg.place, body: this.msg.body,
      });
      await this.store.setMsgState(this.from.id, this.msg, "ended");
      this.close(); this.onDone();
      new Notice(`已发布到「${name}」· 去消息中心右栏推送它`);
    };
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
  onDone: () => void;
  constructor(app: App, store: Store, name: string, onDone: () => void) {
    super(app); this.store = store; this.name = name; this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "编辑标签"));
    contentEl.appendChild(el("div", "tlt-m-meta", `改名会同时更新 ${this.store.ideas.filter((i) => (i.tags || []).includes(this.name)).length} 条随手记。`));

    const input = el("input", "tlt-input wide") as HTMLInputElement;
    input.value = this.name;
    contentEl.appendChild(input);

    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "删除标签");
    del.onclick = async () => {
      await this.store.deleteTag(this.name);
      this.close(); this.onDone(); new Notice(`已删除「${this.name}」`);
    };
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "保存");
    ok.onclick = async () => {
      const v = input.value.trim().replace(/^#/, "");
      if (!v) { new Notice("名称不能为空"); return; }
      if (v !== this.name) await this.store.renameTag(this.name, v);
      this.close(); this.onDone(); new Notice("已改好");
    };
    foot.append(del, cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => input.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}

/** 小输入框（替代 window.prompt，Obsidian 审核不允许用原生 prompt） */
export class PromptModal extends TltModal {
  title: string;
  label: string;
  onSubmit: (v: string) => void | Promise<void>;
  constructor(app: App, title: string, label: string, onSubmit: (v: string) => void | Promise<void>) {
    super(app); this.title = title; this.label = label; this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.title));
    const input = el("input", "tlt-input wide tlt-input-title") as HTMLInputElement;
    input.placeholder = this.label;
    contentEl.appendChild(input);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "取消");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "确定");
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
    window.setTimeout(() => input.focus(), 50);
  }
  onClose() { this.contentEl.empty(); }
}
