import { App, TAbstractFile, TFile, normalizePath, requestUrl } from "obsidian";
import {
  Task, Staff, Feed, Idea, Msg, Period,
  parseTaskLine, parseStaff, parseMsgLine, parseLogMonth, parseIdeaLine,
  newTaskLine, newMsgLine, newLogLine, toggleTaskLine, setTaskDue, setTaskField, stripFields,
  todayISO, monthBounds, asText, readProjectDesc, writeProjectDesc,
} from "./data";

/** 消息服务的线上格式（发布端 / 订阅代理），字段都可缺 */
interface WireItem {
  mid?: string; date?: string; title?: string; kind?: string; place?: string;
  who?: string[]; star?: boolean; state?: string; until?: string; ended?: string; body?: string;
}
interface WireFeed {
  url?: string; ok?: boolean; error?: string; id?: string; title?: string; owner?: string; items?: WireItem[];
}
interface PullResponse { feeds?: WireFeed[]; pulledAt?: string }
interface SubsResponse { subs?: { url?: string }[] }
interface SubscribeResult { ok?: boolean; count?: number; existed?: boolean; reason?: string }
interface PublishResult { ok?: boolean; count?: number; id?: string }

export interface TLTSettings {
  /** TLT 的根目录；下面六个路径默认都在它下面，留空表示直接用库根目录 */
  root: string;
  tasksFolder: string;
  teamFolder: string;
  feedsFolder: string;
  logsFolder: string;
  ideasFile: string;
  tagsFile: string;
  defaultPeriod: Period;
  mineFeed: string;
  feedIds: Record<string, string>;   // 本地源 → 发布 ID
  /** 发布者名：订阅别人时用来区分"这是谁的源"，默认取库名 */
  publisherName?: string;
  /** 工作台两侧栏是否折叠（视图状态，跟着库走） */
  sideCollapsed?: boolean;
  railCollapsed?: boolean;
  /** 排序口径：名称 / 创建时间 / 截止时间（项目、里程碑、任务共用） */
  sortBy?: "name" | "created" | "due";
  /** 1 = 正序，-1 = 反向 */
  sortDir?: 1 | -1;
  /** 每库一个随机盐：让不同人发布的同名源也不会撞 ID */
  publisherSalt?: string;
  feedNames: Record<string, string>; // 本地源 → 上次用的发布名称
}

export const DEFAULT_SETTINGS: TLTSettings = {
  root: "",
  tasksFolder: "TLT/tasks",
  teamFolder: "TLT/crew",
  feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs",
  ideasFile: "TLT/ideas.md",
  tagsFile: "TLT/tags.md",
  defaultPeriod: "m",
  mineFeed: "我的工作动态",
  feedIds: {},
  feedNames: {},
  publisherName: "",
  publisherSalt: "",
  sideCollapsed: false,
  railCollapsed: false,
  sortBy: "name",
  sortDir: 1,
};

/**
 * 根目录 → 六个默认路径。
 * 根目录是「放 TLT 目录的地方」，所以真正的数据目录是 <根目录>/TLT；
 * 留空表示放在库根目录（即 TLT/）；如果根目录本身就叫 TLT，就不再套一层。
 */
export function pathsFromRoot(root: string) {
  const base = root.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  const dir = !base ? "TLT" : /(^|\/)TLT$/i.test(base) ? base : `${base}/TLT`;
  const join = (sub: string) => `${dir}/${sub}`;
  return {
    tasksFolder: join("tasks"),
    teamFolder: join("crew"),
    feedsFolder: join("feeds"),
    logsFolder: join("logs"),
    ideasFile: join("ideas.md"),
    tagsFile: join("tags.md"),
  };
}

/** 受根目录管辖的六个路径 */
export const PATH_KEYS = ["tasksFolder", "teamFolder", "feedsFolder", "logsFolder", "ideasFile", "tagsFile"] as const;
export type PathSettingKey = (typeof PATH_KEYS)[number];

export const PEOPLE_COLORS = ["#F0C24B", "#6C8CFF", "#27C1A3", "#B57BFF", "#F2994A", "#FF7A9C", "#5FD6B4", "#7C8BA1"];

export class Store {
  app: App;
  settings: TLTSettings;
  tasks: Task[] = [];
  logs: Task[] = [];
  staff: Staff[] = [];
  feeds: Feed[] = [];
  ideas: Idea[] = [];
  loaded = false;

  constructor(app: App, settings: TLTSettings) {
    this.app = app;
    this.settings = settings;
  }

  /* ---------------- 读 ---------------- */

  private inFolder(path: string, folder: string) {
    const f = folder.replace(/\/+$/, "");
    return path === f || path.startsWith(f + "/");
  }

  private filesIn(folder: string): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.inFolder(f.path, folder));
  }

  /**
   * 建文件。冷启动时 Obsidian 的库索引可能还不认识已存在的文件，
   * getAbstractFileByPath 返回 null 于是走到 create，而 create 抛
   * 「File already exists.」——只要文件确实在，就不算失败。
   */
  async createSafe(path: string, content: string): Promise<void> {
    try {
      await this.app.vault.create(path, content);
    } catch (e) {
      const exists = await this.app.vault.adapter.exists(path).catch(() => false);
      if (exists) return;
      throw e;
    }
  }

  async ensureFolder(folder: string) {
    const parts = normalizePath(folder).split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch { /* 并发创建忽略 */ }
      }
    }
  }

  /** 个人源：私用草稿，可从这里发布 */
  async ensurePersonalFeed() {
    const path = normalizePath(`${this.settings.feedsFolder}/个人.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    // 个人源被发布出去了（文件已改名/改标志，映射还记着）：别再补一个空的，
    // 否则取消发布会变成"并进这个空壳"，用户看到的是"消息被合并到别的源里去了"
    const pubId = (this.settings.feedIds || {})["个人"];
    if (pubId && this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.feedsFolder}/${pubId}.md`))) return;
    await this.ensureFolder(this.settings.feedsFolder);
    await this.createSafe(path,
      `---\ntitle: 个人\npersonal: true\nowner: me\n---\n\n# 个人\n\n（只有自己看的草稿；从这里可以发布到「我发布的源」）\n`);
  }

  async ensureVault() {
    await this.ensureFolder(this.settings.tasksFolder);
    await this.ensureFolder(this.settings.teamFolder);
    await this.ensureFolder(this.settings.feedsFolder);
    await this.ensureFolder(this.settings.logsFolder);
    await this.ensureFolder(this.settings.ideasFile.split("/").slice(0, -1).join("/") || ".");
    await this.ensurePersonalFeed();
  }

  /** 只加载一次（视图可能早于 onload 就恢复，那时数据还没读） */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  /**
   * 读盘。**必须排队串行**：两个 load 交错跑（一个已经清空、另一个还在 await 读文件）
   * 会把同一份文件塞两遍 —— 界面上就是"每个源出现两次"。
   */
  private queue: Promise<void> = Promise.resolve();
  async load(): Promise<void> {
    const run = this.queue.then(() => this.doLoad());
    this.queue = run.then(() => { /* 上一轮出错也不卡住后面的 */ }, () => { /* 同上 */ });
    return run;
  }

  private async doLoad() {
    this.tasks = [];
    this.logs = [];
    this.staff = [];
    this.feeds = [];
    this.ideas = [];
    this.tags = [];

    // 任务：一个项目一个文件，H2 = 里程碑，缩进 checklist = 步骤
    this.projectDescs = {};
    for (const file of this.filesIn(this.settings.tasksFolder)) {
      const text = await this.app.vault.cachedRead(file);
      const project = file.basename;
      const pfm = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
      // 描述：优先标题下那段 > 引用（人直接看得见），老的 frontmatter desc 还认
      this.projectDescs[project] = readProjectDesc(text) || asText(pfm["desc"]) || asText(pfm["description"]);
      let milestone: string | undefined;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const h = /^##\s+(.+?)\s*$/.exec(line);
        if (h) { milestone = h[1].trim(); continue; }
        if (/^#\s/.test(line)) { milestone = undefined; continue; }
        const t = parseTaskLine(line, { file: file.path, line: i, project, milestone });
        if (!t) continue;
        // 步骤：紧随其后的缩进 checklist
        const steps: { done: boolean; text: string }[] = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}[-*+]\s+\[.\]/.test(lines[j])) {
          const s = /^\s{2,}[-*+]\s+\[(.)\]\s+(.*)$/.exec(lines[j]);
          if (s) steps.push({ done: s[1].toLowerCase() === "x", text: s[2].replace(/\[[a-zA-Z\u4e00-\u9fa5]+::[^\]]*\]/g, "").trim() });
          j++;
        }
        if (steps.length) t.steps = steps;
        this.tasks.push(t);
        i = j - 1;
      }
    }

    // 人员：team/*.md 的 frontmatter
    const staff = this.filesIn(this.settings.teamFolder);
    staff.forEach((file, idx) => {
      const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
      const s = parseStaff(file.basename, file.path, fm);
      if (!s.color) s.color = PEOPLE_COLORS[idx % PEOPLE_COLORS.length];
      this.staff.push(s);
    });

    // 消息源：feeds/*.md
    for (const file of this.filesIn(this.settings.feedsFolder)) {
      const text = await this.app.vault.cachedRead(file);
      const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
      const lines = text.split(/\r?\n/);
      const items: Msg[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^#/.test(lines[i])) continue;
        if (!/^\s*[-*+]\s+/.test(lines[i])) continue;
        const body: string[] = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}>/.test(lines[j])) { body.push(lines[j]); j++; }
        const m = parseMsgLine(lines[i], file.basename, body);
        if (m) items.push(m);
        i = j - 1;
      }
      const title = asText(fm["title"]) || file.basename;
      const alias = asText(fm["alias"]);
      this.feeds.push({
        id: file.basename,
        file: file.path,
        name: alias || title,
        alias: alias || undefined,
        remoteTitle: alias ? title : undefined,
        desc: asText(fm["desc"]) || asText(fm["description"]),
        cadence: asText(fm["cadence"]),
        owner: asText(fm["owner"]),
        mine: fm["mine"] === true || fm["owner"] === "me",
        remote: asText(fm["remote"]),
        personal: fm["personal"] === true,
        items,
      });
    }

    // 记录：logs 月文件
    for (const file of this.filesIn(this.settings.logsFolder)) {
      const text = await this.app.vault.cachedRead(file);
      this.logs.push(...parseLogMonth(text, file.path));
    }

    // 想法：单文件，一行一个
    const ideasPath = normalizePath(this.settings.ideasFile);
    const ideaFile = this.asFile(this.app.vault.getAbstractFileByPath(ideasPath));
    if (ideaFile) {
      const text = await this.app.vault.cachedRead(ideaFile);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const body: string[] = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}>/.test(lines[j])) { body.push(lines[j].replace(/^\s*>\s?/, "")); j++; }
        const it = parseIdeaLine(lines[i], ideaFile.path, i, body.join("\n"));
        if (it) this.ideas.push(it);
        i = Math.max(i, j - 1);
      }
    }

    await this.loadTags();

    // 兜底去重：同一行/同一文件只留一条（保留先出现的）
    const uniqBy = <T>(list: T[], key: (x: T) => string): T[] => {
      const seen = new Set<string>();
      return list.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
    };
    this.tasks = uniqBy(this.tasks, (t) => `${t.file}#${t.line}`);
    this.logs = uniqBy(this.logs, (t) => `${t.file}#${t.line}`);
    this.feeds = uniqBy(this.feeds, (f) => f.file);       // 一个源一个文件
    this.staff = uniqBy(this.staff, (s) => s.file);

    await this.detectMilestoneEvents();
    this.loaded = true;
  }

  /** 里程碑完成状态快照（key: 项目::里程碑）——只在"这一轮刚变成完成"时记事件 */
  private msDone: Record<string, boolean> = {};
  private async detectMilestoneEvents() {
    const seen: Record<string, boolean> = {};
    for (const m of this.milestones()) {
      const key = `${m.project}::${m.name}`;
      const done = m.tasks.length > 0 && m.tasks.every((t) => t.done);
      seen[key] = done;
      if (done && this.msDone[key] === false) {
        await this.appendEvent({ kind: "ms.done", project: m.project, milestone: m.name });
      }
    }
    this.msDone = seen;
  }

  /* ---------------- 快捷命令用的读写 ---------------- */

  /** 事件流目录：<TLT>/events/YYYY-MM.md，一行一条，只追加（时间属性的底账） */
  eventsDir(): string {
    const dataDir = this.settings.tasksFolder.replace(/\/tasks\/?$/, "");
    return normalizePath(`${dataDir}/events`);
  }

  /**
   * 追加一条事件。同一分钟内的同一条事件不会重复写（重复触发只在第一次落一行）。
   * 这是"时间属性"的底账：项目/里程碑/任务的产生与结束都记在这里，供将来的时间线图谱用。
   */
  async appendEvent(ev: { kind: string; project?: string; milestone?: string; task?: string; note?: string }): Promise<void> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const stamp = `${day} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const parts = [stamp, ev.kind];
    if (ev.project) parts.push(`project=${ev.project.replace(/\s+/g, "_")}`);
    if (ev.milestone) parts.push(`milestone=${ev.milestone.replace(/\s+/g, "_")}`);
    if (ev.task) parts.push(`task=${ev.task.replace(/\s+/g, "_")}`);
    if (ev.note) parts.push(`note=${ev.note.replace(/\s+/g, "_")}`);
    const line = `- ${parts.join(" ")}`;

    await this.ensureFolder(this.eventsDir());
    const path = normalizePath(`${this.eventsDir()}/${day.slice(0, 7)}.md`);
    let file = this.asFile(this.app.vault.getAbstractFileByPath(path));
    if (!file) {
      await this.createSafe(path, `# 事件 ${day.slice(0, 7)}\n\n`);
      file = this.asFile(this.app.vault.getAbstractFileByPath(path));
      if (!file) return;
    }
    await this.app.vault.process(file, (data) => {
      // 同一分钟里的同一条事件只留一行（重复触发不会写两遍）
      if (data.split("\n").some((l) => l.trim() === line.trim())) return data;
      return data.replace(/\s*$/, "") + `\n${line}\n`;
    });
  }

  /** 归档目录：和 tasks 同一个 TLT 目录下的 archive/（跟着任务目录走，不额外加设置项） */
  archiveDir(): string {
    const dataDir = this.settings.tasksFolder.replace(/\/tasks\/?$/, "");
    return normalizePath(`${dataDir}/archive`);
  }

  /** 任务目录下的项目文件（不看有没有任务，空项目也列出来） */
  projectFiles(): TFile[] {
    return this.filesIn(this.settings.tasksFolder).slice().sort((a, b) => a.basename.localeCompare(b.basename));
  }

  /** 读一个项目文件里的任务行（行号 + 所属里程碑 + 勾选状态 + 原文） */
  async projectTaskLines(file: TFile): Promise<{ line: number; raw: string; title: string; done: boolean; milestone: string }[]> {
    const text = await this.app.vault.cachedRead(file);
    const lines = text.split(/\r?\n/);
    const out: { line: number; raw: string; title: string; done: boolean; milestone: string }[] = [];
    let milestone = "";
    lines.forEach((ln, i) => {
      const h = /^##\s+(.+?)\s*$/.exec(ln);
      if (h) { milestone = h[1].trim(); return; }
      if (/^#\s/.test(ln)) { milestone = ""; return; }
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(ln);
      if (!m) return;
      const title = m[2].replace(/\[[a-zA-Z\u4e00-\u9fa5]+::[^\]]*\]/g, "")
        .replace(/\s*[🛫📅➕✅⏫🔼🔽⏬🔁🏁](\s*\d{4}-\d{2}-\d{2})?/gu, " ")   // 行内标记与日期标记都不进标题
        .replace(/\s{2,}/g, " ").trim();
      out.push({ line: i, raw: ln, title, done: m[1].toLowerCase() === "x", milestone });
    });
    return out;
  }

  /** 把项目文件移进归档目录（文件还在库里，只是不再出现在工作台） */
  async archiveProject(file: TFile): Promise<boolean> {
    await this.ensureFolder(this.archiveDir());
    const dir = this.archiveDir();
    let target = normalizePath(`${dir}/${file.name}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${dir}/${file.basename}-${n}.md`);
      n++;
    }
    await this.app.fileManager.renameFile(file, target);
    return true;
  }

  /** 归档区里的项目文件（已归档项目） */
  archivedProjects(): TFile[] {
    return this.filesIn(this.archiveDir()).slice().sort((a, b) => a.basename.localeCompare(b.basename));
  }

  /** 把归档的项目搬回任务目录（同名已存在时加序号，不覆盖） */
  async restoreProject(file: TFile): Promise<string | null> {
    await this.ensureFolder(this.settings.tasksFolder);
    const dir = this.settings.tasksFolder;
    let target = normalizePath(`${dir}/${file.name}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${dir}/${file.basename}-${n}.md`);
      n++;
    }
    await this.app.fileManager.renameFile(file, target);
    await this.appendEvent({ kind: "project.restored", project: file.basename });
    return target;
  }

  /** 项目描述（存在项目文件 frontmatter 的 desc 里） */
  projectDesc(name: string): string {
    return this.projectDescs[name] || "";
  }
  private projectDescs: Record<string, string> = {};

  /**
   * 项目信息：改名称（= 改文件名）与描述。
   * 改名会顺带把日志里的 [proj:: 旧名] 一起改掉，否则原来记的"做了什么"会对不上项目。
   */
  async setProjectInfo(from: string, to: string, desc: string): Promise<{ ok: boolean; renamed: boolean; logs: number }> {
    const clean = to.trim().replace(/[\\/:*?"<>|]/g, "");
    if (!clean) return { ok: false, renamed: false, logs: 0 };
    let file = await this.fileByPath(`${this.settings.tasksFolder}/${from}.md`);
    if (!file) return { ok: false, renamed: false, logs: 0 };

    // 先写描述（写在标题下面那段 > 引用里，人打开文件就能看见；老的 frontmatter desc 顺手清掉）
    const wantDesc = desc.trim();
    await this.app.vault.process(file, (data) => writeProjectDesc(data, wantDesc));
    this.projectDescs[clean] = wantDesc;
    if (clean === from) return { ok: true, renamed: false, logs: 0 };

    // 改名：项目文件改名 + 日志里的 [proj::] 跟过来
    let target = normalizePath(`${this.settings.tasksFolder}/${clean}.md`);
    if (this.asFile(this.app.vault.getAbstractFileByPath(target))) {
      let i = 2;
      while (this.asFile(this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.tasksFolder}/${clean} ${i}.md`)))) i++;
      target = normalizePath(`${this.settings.tasksFolder}/${clean} ${i}.md`);
    }
    // 标题行也跟着改名（# 项目名 就是项目的显示名）
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const i = lines.findIndex((l) => /^#\s+/.test(l));
      if (i < 0) return `# ${clean}\n\n${data}`;
      lines[i] = `# ${clean}`;
      return lines.join("\n");
    });
    await this.app.fileManager.renameFile(file, target);
    let logs = 0;
    for (const lf of this.filesIn(this.settings.logsFolder)) {
      let touched = false;
      await this.app.vault.process(lf, (data) => {
        const next = data.replace(new RegExp(`\\[proj::\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "g"), `[proj:: ${clean}]`);
        if (next !== data) { touched = true; return next; }
        return data;
      });
      if (touched) logs++;
    }
    await this.appendEvent({ kind: "project.renamed", project: clean, note: from });
    return { ok: true, renamed: true, logs };
  }

  /** 新建项目文件 */
  async createProject(name: string): Promise<boolean> {
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, "");
    if (!clean) return false;
    const path = normalizePath(`${this.settings.tasksFolder}/${clean}.md`);
    await this.ensureFolder(this.settings.tasksFolder);
    if (this.app.vault.getAbstractFileByPath(path)) return false;
    await this.createSafe(path, `# ${clean}\n\n## 第一个里程碑\n\n- [ ] 示例任务，改成你自己的 🛫 ${todayISO()} 📅 ${todayISO()} [pri:: 1]\n`);
    await this.appendEvent({ kind: "project.created", project: clean });
    return true;
  }

  /** 重命名里程碑：改项目文件里的 `## 标题`（同名已存在则拒绝） */
  async renameMilestone(project: string, from: string, to: string): Promise<boolean> {
    const clean = to.trim();
    if (!clean || clean === from) return false;
    const file = await this.fileByPath(`${this.settings.tasksFolder}/${project}.md`);
    if (!file) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const head = (l: string) => (/^##\s+/.test(l) ? l.replace(/^##\s+/, "").trim() : null);
      const i = lines.findIndex((l) => head(l) === from);
      if (i < 0) return data;
      if (lines.some((l, j) => j !== i && head(l) === clean)) return data;   // 重名，别撞
      lines[i] = `## ${clean}`;
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  /** 给项目加一个里程碑（## 小节） */
  async addMilestone(project: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean) return false;
    const file = await this.fileByPath(`${this.settings.tasksFolder}/${project}.md`);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const esc = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (lines.some((l) => new RegExp(`^##\\s+${esc}\\s*$`).test(l))) return data;
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", `## ${clean}`, "");
      return lines.join("\n");
    });
    await this.appendEvent({ kind: "ms.created", project, milestone: clean });
    return true;
  }

  /* ---------------- 写 ---------------- */

  private asFile(f: TAbstractFile | null | undefined): TFile | null {
    return f instanceof TFile ? f : null;
  }

  private async fileByPath(path: string): Promise<TFile | null> {
    return this.asFile(this.app.vault.getAbstractFileByPath(normalizePath(path)));
  }

  /** 只改目标那一行，不重写整个文件 */
  async patchLine(path: string, lineNo: number, fn: (line: string) => string) {
    const file = await this.fileByPath(path);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      if (lineNo < 0 || lineNo >= lines.length) return data;
      lines[lineNo] = fn(lines[lineNo]);
      return lines.join("\n");
    });
    return true;
  }

  /** 删除一条任务（连同它下面缩进的步骤） */
  /** 按文件 + 行号删掉一条任务（含紧跟的缩进步骤）。行号对不上时按标题兜底找一次。 */
  async removeTaskAt(file: TFile, line: number, title?: string): Promise<boolean> {
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = line;
      if (!/^\s*[-*+]\s+\[[ xX]\]/.test(lines[start] || "")) {
        start = title ? lines.findIndex((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l) && l.includes(title)) : -1;
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}[-*+]\s+\[[ xX]\]/.test(lines[end])) end++;
      lines.splice(start, end - start);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  /* ---------------- 子项（两格缩进的 checklist，只有内容与完成态） ---------------- */

  /** 在项目文件里定位某个任务行（行号可能过期，按标题兜底一次） */
  private findTaskLine(lines: string[], t: Task): number {
    if (t.line >= 0 && t.line < lines.length && lines[t.line]?.includes(t.title)) return t.line;
    return lines.findIndex((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l) && l.includes(t.title));
  }

  /** 任务行下面那串缩进 checklist 的范围 [start, end) */
  private stepRange(lines: string[], taskLine: number): { start: number; end: number } {
    let end = taskLine + 1;
    while (end < lines.length && /^\s{2,}[-*+]\s+\[[ xX]\]/.test(lines[end])) end++;
    return { start: taskLine + 1, end };
  }

  /** 加一条子项（插在这条任务已有子项之后；没有就直接跟在任务行后） */
  async addStep(t: Task, text: string): Promise<boolean> {
    const clean = text.trim();
    if (!clean) return false;
    const file = await this.fileByPath(t.file);
    if (!file) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const at = this.findTaskLine(lines, t);
      if (at < 0) return data;
      const { end } = this.stepRange(lines, at);
      lines.splice(end, 0, `  - [ ] ${clean}`);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  /** 勾 / 取消勾某一条子项 */
  async setStepDone(t: Task, index: number, done: boolean): Promise<boolean> {
    return this.patchStep(t, index, (ln) => ln.replace(/^(\s*[-*+]\s+\[).(\])/, `$1${done ? "x" : " "}$2`));
  }

  /** 改子项文字 */
  async setStepText(t: Task, index: number, text: string): Promise<boolean> {
    const clean = text.trim();
    if (!clean) return false;
    return this.patchStep(t, index, (ln) => ln.replace(/^(\s*[-*+]\s+\[[ xX]\]\s+).*$/, `$1${clean}`));
  }

  /** 删掉某一条子项 */
  async deleteStep(t: Task, index: number): Promise<boolean> {
    const file = await this.fileByPath(t.file);
    if (!file) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const at = this.findTaskLine(lines, t);
      if (at < 0) return data;
      const { start, end } = this.stepRange(lines, at);
      const target = start + index;
      if (target < start || target >= end) return data;
      lines.splice(target, 1);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  private async patchStep(t: Task, index: number, fn: (line: string) => string): Promise<boolean> {
    const file = await this.fileByPath(t.file);
    if (!file) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const at = this.findTaskLine(lines, t);
      if (at < 0) return data;
      const { start, end } = this.stepRange(lines, at);
      const target = start + index;
      if (target < start || target >= end) return data;
      lines[target] = fn(lines[target]);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  async deleteTask(t: Task) {
    const file = await this.fileByPath(t.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = t.line;
      if (!/^\s*[-*+]\s+\[[ xX]\]/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l) && l.includes(t.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}[-*+]\s+\[[ xX]\]/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }

  async toggleTask(t: Task) {
    const today = todayISO();
    const willBeDone = !t.done;
    // 勾上：补 [done:: 日期]；取消勾选：把 [done::] 去掉（重开就重开，别留旧完成时间）
    await this.patchLine(t.file, t.line, (raw) => {
      const next = toggleTaskLine(raw);
      return setTaskField(next, "done", willBeDone ? today : null);
    });
    await this.appendEvent({
      kind: willBeDone ? "task.done" : "task.reopen",
      project: t.project, task: t.title,
    });
  }

  async setDue(t: Task, due: string) {
    await this.patchLine(t.file, t.line, (l) => setTaskDue(l, due));
  }

  /** 改任务的开始日（🛫）；传空串表示删掉 */
  async setStart(t: Task, start: string) {
    await this.patchLine(t.file, t.line, (l) => {
      if (!start) return l.replace(/\s*🛫\s*\d{4}-\d{2}-\d{2}/g, "");
      if (/🛫\s*\d{4}-\d{2}-\d{2}/.test(l)) return l.replace(/🛫\s*\d{4}-\d{2}-\d{2}/, `🛫 ${start}`);
      return l.replace(/(\[[^\]]*\]\s*)?$/, (tail) => ` 🛫 ${start}${tail}`);
    });
  }

  async setField(t: Task, key: string, value: string | number | null) {
    await this.patchLine(t.file, t.line, (l) => setTaskField(l, key, value));
  }

  /** 改任务标题：只换标题，🛫/📅 与 [field::] 段原样留在后面 */
  async setTitle(t: Task, title: string) {
    const body = title.trim();
    if (!body) return;
    await this.patchLine(t.file, t.line, (l) => {
      const m = /^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$/.exec(l);
      if (!m) return l;
      const rest = m[2];
      const dates = (rest.match(/(?:🛫|📅|✅)\s*\d{4}-\d{2}-\d{2}/g) || []).join(" ");
      const fields = (rest.match(/\[[^[\]]+::\s*(?:\[\[[^\]]*\]\]|[^\]])*\]/g) || []).join(" ");
      const tail = [dates, fields].filter(Boolean).join(" ");
      return `${m[1]}${body}${tail ? " " + tail : ""}`;
    });
  }

  /** 把一条任务（连同缩进步骤）搬到另一个项目/里程碑下 */
  async moveTask(t: Task, project: string, milestone?: string) {
    const src = await this.fileByPath(t.file);
    if (!src) return false;
    let raw = "";
    await this.app.vault.process(src, (data) => {
      const lines = data.split(/\r?\n/);
      const start = t.line;
      if (!/^\s*[-*+]\s+\[[ xX]\]/.test(lines[start] || "")) return data;   // 行号漂了就别动
      let end = start + 1;
      while (end < lines.length && /^\s{2,}[-*+]\s+\[[ xX]\]/.test(lines[end])) end++;
      raw = lines.slice(start, end).join("\n");
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    if (!raw) return false;
    await this.insertBlock(project, milestone, raw);
    return true;
  }

  /** 把一段原始行插到项目文件的里程碑下（没有就补 H2） */
  private async insertBlock(project: string, milestone: string | undefined, block: string) {
    await this.ensureFolder(this.settings.tasksFolder);
    const path = normalizePath(`${this.settings.tasksFolder}/${project}.md`);
    const file = await this.fileByPath(path);
    if (!file) {
      const head = `# ${project}\n\n${milestone ? `## ${milestone}\n\n` : ""}${block}\n`;
      await this.createSafe(path, head);
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      if (milestone) {
        const h = lines.findIndex((l) => new RegExp(`^##\\s+${milestone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(l));
        if (h >= 0) {
          let anchor = h + 1;
          for (let i = h + 1; i < lines.length; i++) {
            if (/^#{1,2}\s/.test(lines[i])) break;
            if (/^\s*[-*+]\s+\[.\]/.test(lines[i])) anchor = i + 1;
          }
          lines.splice(anchor, 0, ...block.split("\n"));
          return lines.join("\n");
        }
        lines.push("", `## ${milestone}`, "", ...block.split("\n"));
        return lines.join("\n");
      }
      lines.push(...block.split("\n"));
      return lines.join("\n");
    });
  }

  /** 追加任务到项目文件；若里程碑段落不存在则补 H2 */
  async addTask(project: string, milestone: string | undefined, t: Partial<Task> & { title: string }) {
    await this.ensureFolder(this.settings.tasksFolder);
    if (!t.created) t = { ...t, created: todayISO() };      // 生命周期时间：创建
    await this.appendEvent({ kind: "task.created", project, task: t.title, milestone });
    const path = normalizePath(`${this.settings.tasksFolder}/${project}.md`);
    let file = await this.fileByPath(path);
    const line = newTaskLine(t);
    if (!file) {
      const head = `# ${project}\n\n${milestone ? `## ${milestone}\n\n` : ""}${line}\n`;
      await this.createSafe(path, head);
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      if (milestone) {
        const h = lines.findIndex((l) => new RegExp(`^##\\s+${milestone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(l));
        if (h >= 0) {
          let anchor = h + 1;
          for (let i = h + 1; i < lines.length; i++) {
            if (/^#{1,2}\s/.test(lines[i])) break;
            if (/^\s*[-*+]\s+\[.\]/.test(lines[i])) anchor = i + 1;
          }
          lines.splice(anchor, 0, line);
          return lines.join("\n");
        }
        lines.push("", `## ${milestone}`, "", line);
        return lines.join("\n");
      }
      lines.push(line);
      return lines.join("\n");
    });
  }

  /** 追加记录到月文件（按 ## 日期分节） */
  async addLog(dateISO: string, rec: { st?: string; en?: string; title: string; project?: string; extra?: boolean; body?: string }) {
    await this.ensureFolder(this.settings.logsFolder);
    const month = dateISO.slice(0, 7);
    const path = normalizePath(`${this.settings.logsFolder}/${month}.md`);
    let file = await this.fileByPath(path);
    const body = newLogLine(rec);
    if (!file) {
      await this.createSafe(path, `# 记录 ${month}\n\n## ${dateISO}\n\n${body}\n`);
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const h = lines.findIndex((l) => new RegExp(`^##\\s+${dateISO}\\s*$`).test(l));
      if (h < 0) {
        lines.push("", `## ${dateISO}`, "", body);
        return lines.join("\n");
      }
      let anchor = h + 1;
      for (let i = h + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        if (/^\s*[-*+]\s+/.test(lines[i])) {
          anchor = i + 1;
          while (anchor < lines.length && /^\s{2,}>/.test(lines[anchor])) anchor++;
        }
      }
      lines.splice(anchor, 0, body);
      return lines.join("\n");
    });
  }

  /** 新建一个「我发布的源」文件 */
  async createFeed(id: string, name: string) {
    const safe = id.replace(/[\\/:*?"<>|]/g, "-");
    const path = normalizePath(`${this.settings.feedsFolder}/${safe}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return { ok: false, path };
    await this.ensureFolder(this.settings.feedsFolder);
    await this.createSafe(path, `---\ntitle: ${name}\nowner: me\nmine: true\n---\n\n# ${name}\n\n`);
    return { ok: true, path };
  }

  /** 改源名称：只改 frontmatter 的 title，文件名与 id 不动 */
  /**
   * 改源名称。
   * - 自己的源（个人 / 我发布的）：改的就是 title，发布出去的也叫这个名
   * - 订阅别人的源：**只写本地别名 `alias`**，对方的名称不动；界面显示别名，详情里能看到原名
   */
  async renameFeed(feed: Feed, name: string): Promise<{ ok: boolean; alias: boolean }> {
    const n = name.trim();
    if (!n) return { ok: false, alias: false };
    const file = await this.fileByPath(feed.file);
    if (!file) return { ok: false, alias: false };
    if (feed.remote) {
      await this.app.vault.process(file, (data) => {
        const stripped = data.replace(/^alias:.*\r?\n/m, "");
        if (/^---\r?\n/.test(stripped)) {
          const end = stripped.indexOf("\n---", 3);
          const head = end > 0 ? stripped.slice(0, end) : stripped;
          const rest = end > 0 ? stripped.slice(end) : "";
          return `${head}\nalias: ${n}${rest}`;
        }
        return `---\nalias: ${n}\n---\n\n${stripped}`;
      });
      feed.alias = n;
      feed.remoteTitle = feed.remoteTitle || feed.name;
      feed.name = n;
      return { ok: true, alias: true };
    }
    await this.app.vault.process(file, (data) => {
      if (/^---\r?\n/.test(data)) {
        const end = data.indexOf("\n---", 3);
        const head = end > 0 ? data.slice(0, end) : data;
        const rest = end > 0 ? data.slice(end) : "";
        const next = /^title:.*$/m.test(head)
          ? head.replace(/^title:.*$/m, `title: ${n}`)
          : `${head}\ntitle: ${n}`;
        return next + rest;
      }
      return `---\ntitle: ${n}\n---\n\n${data}`;
    });
    feed.name = n;   // 缓存可能滞后，界面先按新名字走
    return { ok: true, alias: false };
  }

  /** 从一个源里搬走若干条消息（连同正文续行） */
  private async takeMessages(from: Feed, msgs: Msg[]) {
    const file = await this.fileByPath(from.file);
    if (!file) return;
    const keys = msgs.map((m) => `${m.date}\u0000${m.title}`);
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const m = /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l);
        if (m && keys.includes(`${m[1] || ""}\u0000${stripFields(m[2]).trim()}`)) {
          while (i + 1 < lines.length && /^\s{2,}>/.test(lines[i + 1])) i++;
          continue;
        }
        out.push(l);
      }
      return out.join("\n");
    });
  }

  /**
   * 发布一个源：
   * - 个人 → 我发布的：新建 `feeds/<id>.md`，把选中的草稿搬过去
   * - 已是发布源：只改 id/名称/说明
   */
  /**
   * 改写源文件的 frontmatter 状态（个人 ↔ 已发布）。
   * 个人源发布后应当**从「个人」挪到「我发布的」**，而不是另存一份——所以这里是就地改标志位。
   */
  private async setFeedFlags(feed: Feed, flags: { personal: boolean; mine: boolean; title?: string; desc?: string }) {
    const file = await this.fileByPath(feed.file);
    if (!file) console.warn("TLT: setFeedFlags 找不到文件", feed.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(data);
      const keep: string[] = [];
      const body = m ? data.slice(m[0].length) : data;
      if (m) {
        for (const ln of m[1].split(/\r?\n/)) {
          const k = ln.split(":")[0].trim();
          if (["personal", "mine", "title", "desc"].includes(k)) continue;
          if (ln.trim()) keep.push(ln);
        }
      }
      if (flags.title !== undefined) keep.unshift(`title: ${flags.title}`);
      if (flags.desc !== undefined && flags.desc) keep.push(`desc: ${flags.desc}`);
      if (flags.personal) keep.push("personal: true");
      if (flags.mine) keep.push("mine: true");
      if (!keep.some((l) => l.startsWith("owner:"))) keep.push("owner: me");
      return `---\n${keep.join("\n")}\n---\n${body}`;
    });
    return true;
  }

  /** 把个人源就地变成「我发布的」：文件改名成发布 id，标志位翻转，消息留在原地 */
  private async promoteToPublished(from: Feed, id: string, name: string, desc?: string, cadence?: string) {
    const target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
    const file = await this.fileByPath(from.file);
    if (!file) return null;
    if (target !== from.file) {
      await this.ensureFolder(this.settings.feedsFolder);
      if (this.app.vault.getAbstractFileByPath(target)) return null;   // 目标已被占用，交给调用方换 id
      await this.app.fileManager.renameFile(file, target);
    }
    await this.setFeedFlags({ ...from, file: target }, { personal: false, mine: true, title: name, desc });
    if (cadence) {
      const f2 = await this.fileByPath(target);
      if (f2) {
        await this.app.vault.process(f2, (data) => (/^cadence:/m.test(data) ? data : data.replace(/^---\n([\s\S]*?)\n---/, (_a, b) => `---\n${b}\ncadence: ${cadence}\n---`)));
      }
    }
    return target;
  }

  async publishSource(from: Feed, opts: { name: string; desc?: string; cadence?: string }) {
    const name = (opts.name || "").trim();
    if (!name) return { ok: false as const, reason: "empty" };

    // id 不让用户填：按名字生成，重名自动加序号；同一个源再次发布沿用上次的 id
    // 只有"同一个源、同一个名字"才沿用上次的 id；改了名字就按新名字重新派生
    const rememberedId = (this.settings.feedIds || {})[from.id];
    const rememberedName = (this.settings.feedNames || {})[from.id];
    const remembered = rememberedId && rememberedName === name ? rememberedId : undefined;
    const clean = (t: string) => Array.from(t).map((c) => ('\\/:*?"<>|#[]^'.includes(c) ? "-" : c)).join("");
    // 新 ID 一律 slug+短哈希（纯 ASCII）：中文名不再变成 %E4%B8%AA… 这种乱码，
    // 而且不同人发布同名源时哈希不同，不会互相覆盖
    let id = remembered || this.publishIdFor(name);
    if (!remembered) id = clean(id);
    let target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
    if (!remembered) {
      let base = id, n = 2;
      while (this.app.vault.getAbstractFileByPath(target) && target !== from.file) {
        id = `${base}-${n++}`;
        target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
      }
    }

    if (from.personal || !from.remote) {
      // 本地源（个人源、以及自己建的草稿源）：就地转成已发布——
      // 文件改名成它的发布 ID，不另存一份、也不把消息搬来搬去
      let pid = id;
      let target2 = normalizePath(`${this.settings.feedsFolder}/${pid}.md`);
      if (target2 !== from.file && this.app.vault.getAbstractFileByPath(target2)) {
        let base = id, n = 2;
        while (this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.feedsFolder}/${base}-${n}.md`))) n++;
        pid = `${base}-${n}`;
        target2 = normalizePath(`${this.settings.feedsFolder}/${pid}.md`);
      }
      const made = await this.promoteToPublished(from, pid, name, opts.desc, opts.cadence);
      if (!made) return { ok: false as const, reason: "rename" };
      this.settings.feedIds = { ...(this.settings.feedIds || {}), [from.id]: pid };
      this.settings.feedNames = { ...(this.settings.feedNames || {}), [from.id]: name };
      return { ok: true as const, path: made, moved: 0, id: pid };
    }

    const head = [
      "---",
      `title: ${name}`,
      "owner: me",
      "mine: true",
      opts.desc ? `desc: ${opts.desc}` : "",
      opts.cadence ? `cadence: ${opts.cadence}` : "",
      "---",
      "",
      `# ${name}`,
      "",
    ].filter((x, i) => x !== "" || i === 3).join("\n") + "\n";

    const lineOf = (m: Msg) =>
      newMsgLine(m) + (m.body ? `\n  > ${m.body.replace(/\r?\n/g, "\n  > ")}` : "");
    const msgs = from.items.slice();
    const keyOf = (date: string, title: string) => `${date}\u0000${title}`;

    const file = this.asFile(this.app.vault.getAbstractFileByPath(target));
    let moved = 0;
    if (!file) {
      await this.ensureFolder(this.settings.feedsFolder);
      await this.createSafe(target, head + msgs.map(lineOf).join("\n") + "\n");
      moved = msgs.length;
    } else {
      // 已存在：按「日期+标题」去重后追加，重复发布会覆盖标题/说明
      const old = await this.app.vault.cachedRead(file);
      const have = new Set(
        old.split(/\r?\n/)
          .map((l) => /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l))
          .filter(Boolean)
          .map((m) => keyOf(m[1] || "", stripFields(m[2]).trim())),
      );
      const fresh = msgs.filter((m) => !have.has(keyOf(m.date, m.title)));
      await this.app.vault.process(file, (data) => {
        const updated = /^---\r?\n[\s\S]*?\r?\n---/.test(data)
          ? data.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_all, body: string) => {
              const b = /^title:.*$/m.test(body) ? body.replace(/^title:.*$/m, `title: ${name}`) : `${body}\ntitle: ${name}`;
              return `---\n${b}\n---`;
            })
          : `${head}${data}`;
        const tail = fresh.length ? `\n${fresh.map(lineOf).join("\n")}` : "";
        return `${updated.replace(/\s*$/, "")}\n${tail}\n`.replace(/\n{3,}/g, "\n\n");
      });
      moved = fresh.length;
    }

    // 从来源里把这几条搬走（搬失败也不该让整个发布回滚）
    if (from.file !== target && msgs.length) {
      try { await this.takeMessages(from, msgs); } catch { /* 留在原处最多是重复，不丢 */ }
    }
    this.settings.feedIds = { ...(this.settings.feedIds || {}), [from.id]: id };
    return { ok: true as const, path: target, moved, id };
  }

  /** 6 位短哈希（FNV-1a，够用且无依赖） */
  private shortHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36).padStart(6, "0").slice(0, 6);
  }

  /** 文件名/URL 友好的 slug：保留 ASCII 字母数字，其余折叠成 - */
  private slug(text: string): string {
    const ascii = text.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
    return ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  }

  /**
   * 发布 ID：给订阅地址用，必须是纯 ASCII、短、且"我和别人同名也不会撞"。
   * = slug(名字) + 短哈希(发布者名 + 名字 + 每库随机盐)。
   * 同一个人同一个名字永远得到同一个 ID（重复发布会沿用）。
   */
  publishIdFor(name: string): string {
    if (!this.settings.publisherSalt) {
      this.settings.publisherSalt = Math.random().toString(36).slice(2, 10);
    }
    const who = this.settings.publisherName || "tlt";
    const slug = this.slug(name) || "feed";
    return `${slug}-${this.shortHash(`${who}|${name}|${this.settings.publisherSalt}`)}`;
  }

  /** 订阅地址里能不能安全使用的 ID（纯 ASCII、无空格/斜杠） */
  static isCleanId(id: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(id);
  }

  /** 取消发布：把内容并回个人源，然后把这个源文件删掉（进系统回收站） */
  /**
   * 取消发布：把「我发布的」源就地变回个人源（改名回 个人.md 并翻转标志）。
   * 如果已经有另一个个人源，就把消息并进去、删掉这个文件（老数据兼容）。
   */
  async demoteToPersonal(feed: Feed, personalId: string) {
    const home = normalizePath(`${this.settings.feedsFolder}/${personalId}.md`);
    if (feed.file === home) {
      await this.setFeedFlags(feed, { personal: true, mine: false, title: feed.name || personalId });
      return 0;
    }
    const file = await this.fileByPath(feed.file);
    if (!file) return -1;
    const homeFile = this.asFile(this.app.vault.getAbstractFileByPath(home));

    if (!homeFile) {
      // 个人源不在（发布时改名走了）：就地改名回个人，消息原样带回来。
      // 名字保持用户改过的那个（不强行改回「个人」）
      await this.app.fileManager.renameFile(file, home);
      await this.setFeedFlags({ ...feed, file: home }, { personal: true, mine: false, title: feed.name || personalId });
      return 0;
    }

    // 个人源在，但里面没有任何消息（多半是插件自动补的空壳）→ 用它换掉，不合并
    const homeText = await this.app.vault.cachedRead(homeFile);
    const homeMsgs = (homeText.match(/^\s*[-*+]\s+/gm) || []).length;
    if (homeMsgs === 0) {
      await this.app.fileManager.trashFile(homeFile);
      await this.app.fileManager.renameFile(file, home);
      await this.setFeedFlags({ ...feed, file: home }, { personal: true, mine: false, title: feed.name || personalId });
      return 0;
    }

    // 个人源里确实有内容：只能并回去（老的兜底路径），调用方会提示"已合并 N 条"
    return this.foldBackToPersonal(feed, personalId);
  }

  async foldBackToPersonal(feed: Feed, personalId: string) {
    const personal = this.feeds.find((f) => f.id === personalId);
    const home = personal ? personal.file : normalizePath(`${this.settings.feedsFolder}/${personalId}.md`);

    // 直接读盘，不用内存里的 items：刚发布完那一瞬缓存可能是空的
    const src = await this.fileByPath(feed.file);
    let body = "";
    if (src) {
      const raw = await this.app.vault.read(src);
      body = String(raw)
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")     // 去掉 frontmatter
        .replace(/^\s*#.*$/gm, "")                          // 去掉标题行
        .trim();
    }
    const count = (body.match(/^\s*[-*+]\s+/gm) || []).length;

    let pf = await this.fileByPath(home);
    if (!pf) {
      const t = personal ? personal.name : "个人";
      await this.ensureFolder(this.settings.feedsFolder);
      await this.createSafe(home, `---\ntitle: ${t}\npersonal: true\nowner: me\n---\n\n# ${t}\n\n`);
      pf = await this.fileByPath(home);
    }
    if (!pf) return -1;                     // 落不了地就别删源文件，宁可留着重试
    if (body) {
      // 按「日期+标题」去重，避免并回去出现两份
      await this.app.vault.process(pf, (data) => {
        const have = new Set(
          data.split(/\r?\n/)
            .map((l) => /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l))
            .filter(Boolean)
            .map((m) => `${m[1] || ""}\u0000${stripFields(m[2]).trim()}`),
        );
        const add = body.split(/\r?\n/).filter((l) => {
          const m = /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l);
          if (!m) return false;
          return !have.has(`${m[1] || ""}\u0000${stripFields(m[2]).trim()}`);
        });
        return `${data.replace(/\s*$/, "")}\n${add.join("\n")}\n`;
      });
    }
    await this.trashFeedFile(feed);
    return count;
  }

  /** 删掉一个源文件（默认进回收站，可直接恢复） */
  async trashFeedFile(feed: Feed) {
    const file = await this.fileByPath(feed.file);
    if (!file) return false;
    try {
      // 优先走 FileManager：尊重用户在 Obsidian 里的删除偏好（回收站 / 永久删）
      const fm = this.app.fileManager;
      if (fm && typeof fm.trashFile === "function") { await fm.trashFile(file); return true; }
    } catch { /* 落空 */ }
    return false;
  }

  /** 在某个源里发布一条消息 */
  async addMessage(feedName: string, m: Partial<Msg> & { title: string }) {
    const feed = this.feeds.find((f) => f.id === feedName);
    const path = feed ? feed.file : normalizePath(`${this.settings.feedsFolder}/${feedName}.md`);
    let file = await this.fileByPath(path);
    const line = newMsgLine(m) + (m.body ? `\n  > ${m.body.replace(/\n/g, "\n  > ")}` : "");
    if (!file) {
      const head = `---\ntitle: ${feedName}\nmine: true\nowner: me\n---\n\n# ${feedName}\n\n${line}\n`;
      await this.createSafe(path, head);
      return;
    }
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}\n${line}\n`);
  }

  /** 改一条消息：整行 + 续行一起重写（5W 都在行内字段里） */
  async updateMessage(feedId: string, msg: Msg, patch: Partial<Msg>) {
    const feed = this.feeds.find((f) => f.id === feedId);
    const path = feed ? feed.file : normalizePath(`${this.settings.feedsFolder}/${feedId}.md`);
    const file = await this.fileByPath(path);
    if (!file) return false;
    const next: Msg = { ...msg, ...patch, feed: feedId, id: msg.id, title: patch.title ?? msg.title };
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(msg.title) &&
        (l.includes(`[mid:: ${msg.id}]`) || !msg.id.includes("#")));
      if (start < 0) start = lines.findIndex((l) => l.includes(msg.title));
      if (start < 0) return data;
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      const head = newMsgLine(next) + (next.body ? `\n  > ${next.body.replace(/\r?\n/g, "\n  > ")}` : "");
      lines.splice(start, end - start, ...head.split("\n"));
      return lines.join("\n");
    });
    return true;
  }

  /** 改写记录正文：替换该行后面的引用块 */
  /** 改一条记录的时间段（日程拖拽用）：只动行首的 09:30–11:00 那一截 */
  async setLogTime(log: Task, st: string, en: string): Promise<boolean> {
    const file = await this.fileByPath(log.file);
    if (!file) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const hit = (l: string) => /^\s*[-*+]\s+\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s+/.test(l) && l.includes(log.title);
      let i = log.line >= 0 && lines[log.line] && hit(lines[log.line]) ? log.line : lines.findIndex(hit);
      if (i < 0) return data;
      lines[i] = lines[i].replace(/^(\s*[-*+]\s+)\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}(\s+)/, `$1${st}–${en}$2`);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  async updateLogBody(log: Task, body: string) {
    const file = await this.fileByPath(log.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = log.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => l.includes(log.title) && /^\s*[-*+]\s+/.test(l));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      const quoted = body.trim() ? body.trim().split(/\r?\n/).map((l) => `  > ${l}`) : [];
      lines.splice(start + 1, end - start - 1, ...quoted);
      return lines.join("\n");
    });
    return true;
  }

  /** 删除一条记录（含它的引用块） */
  async deleteLog(log: Task) {
    const file = await this.fileByPath(log.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = log.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => l.includes(log.title) && /^\s*[-*+]\s+/.test(l));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }

  async setMsgState(feedName: string, msg: Msg, state: "live" | "ended") {
    const feed = this.feeds.find((f) => f.id === feedName);
    if (!feed) return;
    const file = await this.fileByPath(feed.file);
    if (!file) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!/^\s*[-*+]\s+/.test(lines[i])) continue;
        if (!lines[i].includes(msg.title)) continue;
        if (msg.date && !lines[i].includes(msg.date)) continue;
        if (state === "ended") {
          lines[i] = setTaskField(lines[i], "state", "ended");
          lines[i] = setTaskField(lines[i], "ended", todayISO());     // 结束发布时间自动补
        } else {
          lines[i] = setTaskField(lines[i], "state", null);
          lines[i] = setTaskField(lines[i], "ended", null);           // 恢复：结束时间去掉
        }
        break;
      }
      return lines.join("\n");
    });
  }

  /* ---------- 标签库（TLT/tags.md，一行一个） ---------- */

  tags: string[] = [];

  async loadTags() {
    const path = normalizePath(this.settings.tagsFile || "TLT/tags.md");
    const file = await this.fileByPath(path);
    if (!file) { this.tags = []; return; }
    const text = await this.app.vault.cachedRead(file);
    this.tags = text.split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*+]\s*/, "").trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  private async tagsFileOrCreate() {
    const path = normalizePath(this.settings.tagsFile || "TLT/tags.md");
    let file = await this.fileByPath(path);
    if (!file) {
      await this.ensureFolder(path.split("/").slice(0, -1).join("/") || ".");
      await this.createSafe(path, `# 标签\n\n`);
      file = await this.fileByPath(path);
    }
    return file;
  }

  async addTag(name: string) {
    const n = name.trim().replace(/^#/, "");
    if (!n || this.tags.includes(n)) return false;
    const file = await this.tagsFileOrCreate();
    if (!file) return false;
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}\n- ${n}\n`);
    this.tags.push(n);
    return true;
  }

  /** 改名：标签库 + 所有用到它的随手记一起改 */
  async renameTag(from: string, to: string) {
    const n = to.trim().replace(/^#/, "");
    if (!n || n === from) return false;
    const file = await this.tagsFileOrCreate();
    if (file) {
      await this.app.vault.process(file, (data) => data.split(/\r?\n/)
        .map((l) => (/^\s*[-*+]\s+/.test(l) && l.replace(/^\s*[-*+]\s*/, "").trim() === from ? `- ${n}` : l))
        .join("\n"));
    }
    for (const it of this.ideas) {
      if (!(it.tags || []).includes(from)) continue;
      it.tags = (it.tags || []).map((t) => (t === from ? n : t));
      await this.updateIdea(it);
    }
    this.tags = this.tags.map((t) => (t === from ? n : t));
    return true;
  }

  async deleteTag(name: string) {
    const file = await this.tagsFileOrCreate();
    if (file) {
      await this.app.vault.process(file, (data) => `${data.split(/\r?\n/)
        .filter((l) => !(/^\s*[-*+]\s+/.test(l) && l.replace(/^\s*[-*+]\s*/, "").trim() === name))
        .join("\n")}\n`);
    }
    for (const it of this.ideas) {
      if (!(it.tags || []).includes(name)) continue;
      it.tags = (it.tags || []).filter((t) => t !== name);
      await this.updateIdea(it);
    }
    this.tags = this.tags.filter((t) => t !== name);
    return true;
  }

  async addIdea(it: { title: string; tags?: string[]; body?: string }) {
    const path = normalizePath(this.settings.ideasFile);
    let file = await this.fileByPath(path);
    const line = `- ${it.title} [at:: ${todayISO()}]` +
      (it.tags && it.tags.length ? ` [tags:: ${it.tags.join(", ")}]` : "") +
      (it.body ? `\n  > ${it.body}` : "");
    if (!file) {
      await this.createSafe(path, `# 想法池\n\n${line}\n`);
      return;
    }
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}\n${line}\n`);
  }

  async deleteIdea(it: Idea) {
    const file = await this.fileByPath(it.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = it.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(it.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }

  async updateIdea(it: Idea) {
    const file = await this.fileByPath(it.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = it.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(it.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      let head = `- ${it.title} [at:: ${it.at}]`;
      if (it.tags && it.tags.length) head += ` [tags:: ${it.tags.join(", ")}]`;
      const body = it.body && it.body.trim()
        ? it.body.trim().split(/\r?\n/).map((l) => `  > ${l}`)
        : [];
      lines.splice(start, end - start, head, ...body);
      return lines.join("\n");
    });
    return true;
  }

  /* ---------------- 人员 ---------------- */

  async addStaff(name: string) {
    const path = normalizePath(`${this.settings.teamFolder}/${name}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return false;
    await this.ensureFolder(this.settings.teamFolder);
    await this.createSafe(path, `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: []\nstatus: active\n---\n\n# ${name}\n`);
    return true;
  }

  async removeStaff(staff: Staff) {
    const f = this.asFile(this.app.vault.getAbstractFileByPath(staff.file));
    if (!f) return false;
    await this.app.fileManager.trashFile(f);
    return true;
  }

  /* ---------------- Hub：发布 / 拉取 ---------------- */

  /** 统一走 requestUrl：不受 CORS 限制，也不触发审核的 fetch 警告 */
  private async httpJson<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await requestUrl({
      url,
      method: init.method || "GET",
      contentType: "application/json",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return res.json as T;
  }

  /** 把一个本地源的全部消息推给发布服务 */
  /**
   * 已发布但 ID 不干净（老版本用中文名当 ID）→ 换成 slug+哈希的新 ID。
   * 返回最终使用的 ID；换过就顺手把文件改名，订阅地址也就跟着变干净。
   */
  async ensureCleanPublishId(feed: Feed): Promise<{ id: string; changed: boolean }> {
    const current = (this.settings.feedIds || {})[feed.id] || feed.id;
    if (Store.isCleanId(current)) return { id: current, changed: false };
    const next = this.publishIdFor(feed.name);
    const file = await this.fileByPath(feed.file);
    if (file) {
      const target = normalizePath(`${this.settings.feedsFolder}/${next}.md`);
      if (!this.app.vault.getAbstractFileByPath(target)) {
        try { await this.app.fileManager.renameFile(file, target); } catch { /* 改不动就沿用旧 ID */ }
      }
    }
    const ids = { ...(this.settings.feedIds || {}) };
    delete ids[feed.id];
    ids[next] = next;                       // 已发布的源：文件名就是 ID
    this.settings.feedIds = ids;
    return { id: next, changed: true };
  }

  async publishFeed(feed: Feed, hubUrl: string, publishId?: string) {
    const base = hubUrl.replace(/\/$/, "");
    const pid = publishId || (this.settings.feedIds || {})[feed.id] || feed.id;
    const owner = this.settings.publisherName || "tlt";
    await this.httpJson<PublishResult>(`${base}/register`, {
      method: "POST",
      body: { id: pid, title: feed.name, desc: feed.desc, owner },
    });
    const items = feed.items.map((m, i) => ({
      mid: `${pid}-${m.date}-${i}`,
      date: m.date, title: m.title, kind: m.kind, place: m.place, who: m.who,
      star: m.star, state: m.state, until: m.until, ended: m.ended, body: m.body,
    }));
    return await this.httpJson<PublishResult>(`${base}/publish`, {
      method: "POST",
      body: { id: pid, title: feed.name, items },
    });
  }

  /** 取消发布：从发布服务上摘掉这个源 */
  async unpublishFeed(publishId: string, hubUrl: string) {
    const base = hubUrl.replace(/\/$/, "");
    try { await this.httpJson<unknown>(`${base}/feed?id=${encodeURIComponent(publishId)}`, { method: "DELETE" }); return true; }
    catch { return false; }
  }

  /** 给拉取服务加一个订阅地址 */
  /** 订阅（按规范化 URL 去重，返回 { ok, count, existed }） */
  async subscribeRemote(syncUrl: string, feedUrl: string, name?: string) {
    const base = syncUrl.replace(/\/$/, "");
    const norm = (u: string) => {
      try { const x = new URL(u); return `${x.origin}${x.pathname}?${decodeURIComponent(x.search.replace(/^\?/, ""))}`; }
      catch { return u; }
    };
    // 「这是不是我自己发布的」要比发布用的 ID，不能比本地文件名：
    // 别人发布的源也可能起同样的名字，ID 不同但文件名可能一样
    const myIds = new Set(Object.values(this.settings.feedIds || {}));
    this.feeds.filter((f) => f.mine).forEach((f) => myIds.add(f.id));
    const inUrl = /[?&]id=([^&]+)/.exec(decodeURIComponent(norm(feedUrl)))?.[1] ?? "";
    if (inUrl && myIds.has(inUrl)) {
      return { ok: false, count: 0, existed: true, reason: "self" as const };
    }
    const cur = await this.httpJson<SubsResponse>(`${base}/subscriptions`).catch((): SubsResponse => ({ subs: [] }));
    const subs = cur.subs ?? [];
    if (subs.some((sub) => norm(sub.url ?? "") === norm(feedUrl))) {
      return { ok: true, count: subs.length, existed: true };
    }
    const res = await this.httpJson<SubscribeResult>(`${base}/subscribe`, { method: "POST", body: { url: feedUrl, name } });
    return { ...res, existed: false };
  }

  async unsubscribeRemote(syncUrl: string, feedUrl: string) {
    const base = syncUrl.replace(/\/$/, "");
    try { await this.httpJson<unknown>(`${base}/subscribe?url=${encodeURIComponent(feedUrl)}`, { method: "DELETE" }); return true; }
    catch { return false; }
  }

  /** 从拉取服务同步：把远端消息写进 TLT/feeds/<id>.md（按 mid 去重） */
  async pullFromHub(syncUrl: string) {
    const base = syncUrl.replace(/\/$/, "");
    const data = await this.httpJson<PullResponse>(`${base}/pull`);
    let added = 0, updated = 0;

    for (const feed of data.feeds ?? []) {
      const items = feed.items ?? [];
      if (!feed.ok || !items.length) continue;
      const title = asText(feed.title) || asText(feed.id) || "远程源";
      const rawId = title;
      const id = rawId.replace(/[\\/:*?"<>|]/g, "-");
      // 远端源单独前缀，避免和本地同名源混在一起
      const owner = asText(feed.owner) || "";
      const url = asText(feed.url);
      // 先按订阅地址找（发布者改了名字也不会多出一个源），找不到再用「远程-<名字>.md」
      const known = this.feeds.find((x) => x.remote && url && x.remote === url);
      const localId = known ? known.id : `远程-${id}`;
      const path = known ? known.file : normalizePath(`${this.settings.feedsFolder}/远程-${id}.md`);
      let file = this.asFile(this.app.vault.getAbstractFileByPath(path));
      if (!file && known) {                 // 文件被挪走了：按标题那套兜底
        file = this.asFile(this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.feedsFolder}/远程-${id}.md`)));
      }
      if (!file) {
        await this.ensureFolder(this.settings.feedsFolder);
        await this.createSafe(path,
          `---\ntitle: ${title}\nremote: ${asText(feed.url)}${owner ? `\nowner: ${owner}` : ""}\nown: false\n---\n\n# ${title}\n\n`);
        file = this.asFile(this.app.vault.getAbstractFileByPath(path));
        if (!file) return;
      }
      const cur = file ? await this.app.vault.cachedRead(file) : "";
      const alias = /^alias:\s*(.+)$/m.exec(cur)?.[1]?.trim() || "";
      const header = file
        ? `---\ntitle: ${title}\nremote: ${url}${owner ? `\nowner: ${owner}` : ""}${alias ? `\nalias: ${alias}` : ""}\nown: false\n---`
        : "";
      if (header) {
        await this.app.vault.process(file, (text) => {
          const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
          return `${header}\n\n${body.replace(/^\s+/, "")}`;
        });
      }
      await this.app.vault.process(file, (text) => {
        const lines = text.split(/\r?\n/);
        for (const it of items) {
          const mid = asText(it.mid) || `${localId}-${asText(it.date)}-${asText(it.title)}`;
          const idx = lines.findIndex((l) => l.includes(`[mid:: ${mid}]`));
          const stateField = it.state === "ended" ? " [state:: ended]" : "";
          if (idx >= 0) {
            if (it.state === "ended" && !lines[idx].includes("[state:: ended]")) {
              lines[idx] = lines[idx] + stateField; updated++;
            }
            continue;
          }
          const head = `- ${asText(it.date)} ${asText(it.title)}` +
            (it.kind && it.kind !== "note" ? ` [kind:: ${it.kind}]` : "") +
            (it.place ? ` [place:: ${it.place}]` : "") +
            (it.who?.length ? ` [who:: ${it.who.join(", ")}]` : "") +
            (it.star ? ` [star:: true]` : "") +
            (it.until ? ` [until:: ${it.until}]` : "") +
            (it.ended ? ` [ended:: ${it.ended}]` : "") + stateField +
            ` [mid:: ${mid}]`;
          const body = it.body ? [`  > ${String(it.body).replace(/\n/g, "\n  > ")}`] : [];
          lines.push(head, ...body);
          added++;
        }
        return lines.join("\n");
      });
    }
    return { added, updated, at: data.pulledAt };
  }

  /* ---------------- 派生 ---------------- */

  allTasks() { return [...this.tasks, ...this.logs]; }
  projects(): string[] { return Array.from(new Set(this.tasks.map((t) => t.project))).sort(); }
  milestones(project?: string): { name: string; project: string; tasks: Task[] }[] {
    const map = new Map<string, Task[]>();
    for (const t of this.tasks) {
      if (project && t.project !== project) continue;
      if (!t.milestone) continue;
      const k = `${t.project}::${t.milestone}`;
      map.set(k, [...(map.get(k) || []), t]);
    }
    return Array.from(map.entries()).map(([k, tasks]) => {
      const [p, n] = k.split("::");
      return { name: n, project: p, tasks };
    });
  }
  monthTasks(ref = new Date()) {
    const { start, end } = monthBounds(ref);
    const live = this.tasks.filter((t) => t.kind === "task");
    const inM = (d?: string) => !!d && d >= start && d <= end;
    return {
      late: live.filter((t) => !t.done && inM(t.due) && t.due < todayISO()),
      todo: live.filter((t) => !t.done && inM(t.due) && t.due >= todayISO()),
      done: live.filter((t) => t.done && inM(t.due)),
      pending: live.filter((t) => !t.done && !t.due),
    };
  }
}
