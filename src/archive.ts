import { App, Notice, TFile } from "obsidian";
import { Store } from "./store";
import { ConfirmModal } from "./views/picker";
import { t as T } from "./i18n";

/**
 * 归档 / 删除的确认动作：命令面板与工作台右键菜单共用同一套。
 * 规则：动文件先问，只有「确认 / 取消」两个出口；提示里写清去哪、还剩什么。
 */

export interface TaskRef {
  file: TFile;
  line: number;
  title: string;
  milestone?: string;
  done?: boolean;
}

type Refresh = () => void | Promise<void>;

export function confirmArchiveTask(
  app: App, store: Store, t: TaskRef, refresh: Refresh, openUndone = 0,
) {
  const body = `${t.title}\n\n${T("归档到")}：${store.archiveDir()}/${t.file.basename}.md\n\n` +
    (t.done
      ? T("这条任务已完成，会从项目里摘掉、在归档文件里留一条。")
      : T("这条任务还没完成（这个项目里还有 {n} 条未完成）。仍然要归档吗？", { n: openUndone }));
  new ConfirmModal(app, { title: T("归档任务"), body, ok: T("归档") }, async (ok) => {
    if (!ok) return;
    const done = await store.archiveTask(t.file, t.line, t.milestone || "");
    await store.load();
    await refresh();
    new Notice(done ? T("已归档：{n}", { n: t.title }) : T("任务行内容已变化，归档中止（请重试）"), 4000);
  }).open();
}

export function confirmDeleteTask(app: App, store: Store, t: TaskRef, refresh: Refresh) {
  const body = `${t.title}\n\n${T("来源")}：${t.file.path}${t.milestone ? " · " + t.milestone : ""}\n\n` +
    T("这一行会从文档里移除，不可撤销（可从回收站/文件历史恢复）。");
  new ConfirmModal(app, { title: T("删除任务"), body, ok: T("删除") }, async (ok) => {
    if (!ok) return;
    const done = await store.removeTaskAt(t.file, t.line, t.title);
    await store.load();
    await refresh();
    new Notice(done ? T("已删除：{n}", { n: t.title }) : T("任务行内容已变化，删除中止（请重试）"), 4000);
  }).open();
}

export function confirmArchiveProject(app: App, store: Store, file: TFile, refresh: Refresh) {
  void (async () => {
    const rows = await store.projectTaskLines(file);
    const open = rows.filter((r) => !r.done).length;
    const body = open
      ? T("{p} 还有 {n} 条未完成（共 {m} 条）。归档后它会移出工作台，任务不会丢（在 {d} 里）。", { p: file.basename, n: open, m: rows.length, d: store.archiveDir() })
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
      new Notice(done ? T("已归档项目：{n}", { n: file.basename }) : T("归档失败，文件可能已被移动"), 4000);
    }).open();
  })();
}
