import { App, Notice, TFile } from "obsidian";
import { Store } from "./store";
import { ConfirmModal, PickerModal, type PickItem } from "./views/picker";
import { IdeaModal, PromptModal, QuickTaskModal } from "./views/modals";
import { ComposeModal } from "./views/messages";
import { t as T } from "./i18n";

type Refresh = () => void | Promise<void>;

/**
 * TLT 的原生快捷命令（对应 QuickAdd 里那几个宏，但不依赖任何第三方插件）。
 * 都在命令面板里，可以绑快捷键。
 */

/** 项目选择：列出任务目录下所有项目文件，可过滤；带未完成/完成计数 */
async function pickProject(app: App, store: Store, title: string): Promise<TFile | null> {
  const files = store.projectFiles();
  if (!files.length) {
    new Notice(T("任务目录里还没有项目，先用「新建项目」建一个"));
    return null;
  }
  const items: PickItem<TFile>[] = [];
  for (const f of files) {
    const rows = await store.projectTaskLines(f);
    const undone = rows.filter((r) => !r.done).length;
    items.push({
      label: f.basename,
      hint: rows.length ? `${T("未完成")} ${undone} / ${T("共")} ${rows.length}` : T("还没有任务"),
      value: f,
    });
  }
  return new Promise((resolve) => {
    new PickerModal<TFile>(app, title, items, T("输入项目名过滤"), (v) => { resolve(v); }).open();
  });
}

/* ---------------- ① 登记任务 ---------------- */

export function taskRegisterFlow(app: App, store: Store, refresh: Refresh) {
  new QuickTaskModal(app, store, refresh).open();
}

/* ---------------- ①b 随手记（想法池） ---------------- */

export function quickIdeaFlow(app: App, store: Store, refresh: Refresh) {
  new IdeaModal(app, store, undefined, refresh).open();
}

/* ---------------- ①c 新建消息（消息中心） ---------------- */

export function newMessageFlow(app: App, store: Store, refresh: Refresh) {
  const writable = [
    ...store.feeds.filter((f) => f.personal),
    ...store.feeds.filter((f) => f.mine && !f.personal),
  ];
  if (!writable.length) { new Notice(T("没有可写的消息源（个人源或我发布的）")); return; }
  new ComposeModal(app, store, refresh).open();
}

/* ---------------- ② 新建项目 ---------------- */

export function newProjectFlow(app: App, store: Store, refresh: Refresh) {
  new PromptModal(app, T("新建项目"), T("项目名（会建成一个 md，## 是里程碑）"), async (name) => {
    const ok = await store.createProject(name);
    if (!ok) { new Notice(T("没建成：名字空了，或者同名项目已存在")); return; }
    await store.load();
    await refresh();
    new Notice(T("已新建项目：{n}", { n: name }));
  }).open();
}

/* ---------------- ③ 新建里程碑 ---------------- */

export async function newMilestoneFlow(app: App, store: Store, refresh: Refresh) {
  const file = await pickProject(app, store, T("给哪个项目加里程碑"));
  if (!file) return;
  new PromptModal(app, T("新建里程碑"), T("里程碑名（项目文件里的 ## 小节）"), async (name) => {
    const ok = await store.addMilestone(file.basename, name);
    if (!ok) { new Notice(T("没加成：名字空了，或者这个里程碑已经在了")); return; }
    await store.load();
    await refresh();
    new Notice(T("已在 {p} 加了里程碑：{n}", { p: file.basename, n: name }));
  }).open();
}

/* ---------------- ④ 删除任务 ---------------- */

export async function deleteTaskFlow(app: App, store: Store, refresh: Refresh) {
  const files = store.projectFiles();
  if (!files.length) { new Notice(T("任务目录里还没有项目")); return; }

  // ① 选来源：某个项目，或跨项目搜全部
  const first: PickItem<string>[] = [];
  for (const f of files) {
    const rows = await store.projectTaskLines(f);
    if (!rows.length) continue;
    first.push({ label: f.basename, hint: `${T("未完成")} ${rows.filter((r) => !r.done).length} / ${T("共")} ${rows.length}`, value: f.path });
  }
  if (!first.length) { new Notice(T("没有找到任务")); return; }
  first.push({ label: T("全库所有任务（跨项目搜索）"), hint: T("一次列出全部项目里的任务"), value: "__all__" });

  const scope = await new Promise<string | null>((resolve) => {
    new PickerModal<string>(app, T("删除任务 · ① 选来源"), first, T("输入项目名过滤"), (v) => { resolve(v); }).open();
  });
  if (!scope) return;

  // ② 选任务
  const items: PickItem<{ file: TFile; line: number; title: string; milestone: string; done: boolean }>[] = [];
  for (const f of files) {
    if (scope !== "__all__" && f.path !== scope) continue;
    const rows = await store.projectTaskLines(f);
    for (const r of rows) {
      items.push({
        label: (r.done ? "✔ " : "○ ") + r.title,
        hint: scope === "__all__" ? `${f.basename}${r.milestone ? " · " + r.milestone : ""}` : r.milestone || T("未分区"),
        value: { file: f, line: r.line, title: r.title, milestone: r.milestone, done: r.done },
      });
    }
  }
  if (!items.length) { new Notice(T("这个来源里没有任务")); return; }
  const pick = await new Promise<typeof items[number]["value"] | null>((resolve) => {
    new PickerModal(app, T("删除任务 · ② 选任务"), items, T("输入关键字搜索任务"), (v) => { resolve(v); }).open();
  });
  if (!pick) return;

  // ③ 确认
  new ConfirmModal(app, {
    title: T("删除任务"),
    body: `${pick.title}\n\n${T("来源")}：${pick.file.path}${pick.milestone ? " · " + pick.milestone : ""}\n\n${T("这一行会从文档里移除，不可撤销（可从回收站/文件历史恢复）。")}`,
    ok: T("删除"),
  }, async (ok) => {
    if (!ok) return;
    const done = await store.removeTaskAt(pick.file, pick.line, pick.title);
    await store.load();
    await refresh();
    new Notice(done ? T("已删除：{n}", { n: pick.title }) : T("任务行内容已变化，删除中止（请重试）"));
  }).open();
}

/* ---------------- ⑤ 归档任务（从项目里摘出来，留档） ---------------- */

export async function archiveTaskFlow(app: App, store: Store, refresh: Refresh) {
  const file = await pickProject(app, store, T("归档任务 · ① 选项目"));
  if (!file) return;
  const rows = await store.projectTaskLines(file);
  const undone = rows.filter((r) => !r.done).length;
  if (!rows.length) { new Notice(T("这个项目里没有任务")); return; }

  const items: PickItem<{ line: number; title: string; milestone: string; done: boolean }>[] = rows.map((r) => ({
    label: (r.done ? "✔ " : "○ ") + r.title,
    hint: r.milestone || T("未分区"),
    value: { line: r.line, title: r.title, milestone: r.milestone, done: r.done },
  }));
  const pick = await new Promise<typeof items[number]["value"] | null>((resolve) => {
    new PickerModal(app, `${T("归档任务 · ② 选任务")}（${file.basename}）`, items, T("输入关键字搜索任务"), (v) => { resolve(v); }).open();
  });
  if (!pick) return;

  const body = `${pick.title}\n\n${T("归档")}：${file.basename}${pick.milestone ? " · " + pick.milestone : ""}\n→ ${store.archiveDir()}/${file.basename}.md\n\n` +
    (pick.done ? T("这条任务已完成，会从项目里摘掉、在归档文件里留一条。") : T("这条任务还没完成（这个项目里还有 {n} 条未完成）。仍然要归档吗？", { n: undone }));
  new ConfirmModal(app, { title: T("归档任务"), body, ok: T("归档") }, async (ok) => {
    if (!ok) return;
    const done = await store.archiveTask(file, pick.line, pick.milestone);
    await store.load();
    await refresh();
    new Notice(done ? T("已归档：{n}", { n: pick.title }) : T("任务行内容已变化，归档中止（请重试）"));
  }).open();
}

/* ---------------- ⑥ 归档项目（整个文件移进归档目录） ---------------- */

export async function archiveProjectFlow(app: App, store: Store, refresh: Refresh) {
  const file = await pickProject(app, store, T("归档项目"));
  if (!file) return;
  const rows = await store.projectTaskLines(file);
  const undone = rows.filter((r) => !r.done).length;
  const body = undone
    ? T("{p} 还有 {n} 条未完成（共 {m} 条）。归档后它会移出工作台，任务不会丢（在 {d} 里）。", { p: file.basename, n: undone, m: rows.length, d: store.archiveDir() })
    : T("{p} 的任务都已完成（共 {m} 条）。归档后移出工作台，文件仍在 {d} 里，随时能翻回来。", { p: file.basename, m: rows.length, d: store.archiveDir() });
  new ConfirmModal(app, {
    title: T("归档项目"),
    body: `${body}\n\n${file.path} → ${store.archiveDir()}/${file.name}`,
    ok: T("归档"),
  }, async (ok) => {
    if (!ok) return;
    const done = await store.archiveProject(file);
    await store.load();
    await refresh();
    new Notice(done ? T("已归档项目：{n}", { n: file.basename }) : T("归档失败，文件可能已被移动"));
  }).open();
}

/* ---------------- ⑦ 一个总入口：快捷命令面板 ---------------- */

export function quickMenuFlow(
  app: App, store: Store, refresh: Refresh,
  open: { workbench: () => void | Promise<void>; messages: () => void | Promise<void> },
) {
  const items: PickItem<string>[] = [
    { label: T("登记任务"), hint: T("一句话记下来，顺手挑项目和里程碑"), value: "task" },
    { label: T("新建项目"), hint: T("建一个项目文件（## 是里程碑）"), value: "project" },
    { label: T("新建里程碑"), hint: T("给已有项目加一个 ## 小节"), value: "milestone" },
    { label: T("随手记"), hint: T("一句想法进想法池，可带 #标签"), value: "idea" },
    { label: T("新建消息"), hint: T("记一条消息到消息源（个人 / 我发布的）"), value: "message" },
    { label: T("归档任务"), hint: T("一条任务收起来：从项目里摘掉，记到 archive/项目.md"), value: "archive-task" },
    { label: T("归档项目"), hint: T("项目结束了：整个文件搬进 archive/，工作台不再显示"), value: "archive-project" },
    { label: T("删除任务"), hint: T("选项目 → 选任务 → 确认"), value: "delete" },
    { label: T("打开工作台"), hint: T("日历 / 任务 / 里程碑 / 人员"), value: "workbench" },
    { label: T("打开消息中心"), hint: T("时间线消息"), value: "messages" },
  ];
  new PickerModal<string>(app, T("TLT 快捷命令"), items, T("输入关键字过滤命令"), (v) => {
    if (!v) return;
    if (v === "task") taskRegisterFlow(app, store, refresh);
    else if (v === "idea") quickIdeaFlow(app, store, refresh);
    else if (v === "message") newMessageFlow(app, store, refresh);
    else if (v === "project") newProjectFlow(app, store, refresh);
    else if (v === "milestone") void newMilestoneFlow(app, store, refresh);
    else if (v === "archive-task") void archiveTaskFlow(app, store, refresh);
    else if (v === "archive-project") void archiveProjectFlow(app, store, refresh);
    else if (v === "delete") void deleteTaskFlow(app, store, refresh);
    else if (v === "workbench") void open.workbench();
    else if (v === "messages") void open.messages();
  }).open();
}
