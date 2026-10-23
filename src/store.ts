import { App, TAbstractFile, TFile, normalizePath, requestUrl } from "obsidian";
import {
  Task, Staff, Feed, Idea, Msg, Period,
  parseTaskLine, parseStaff, parseMsgLine, parseLogMonth, parseIdeaLine,
  newTaskLine, newMsgLine, newLogLine, toggleTaskLine, setTaskDue, setTaskField, stripFields,
  todayISO, monthBounds, asText,
} from "./data";

/** 消息服务的线上格式（发布端 / 订阅代理），字段都可缺 */
interface WireItem {
  mid?: string; date?: string; title?: string; kind?: string; place?: string;
  who?: string[]; star?: boolean; state?: string; until?: string; body?: string;
}
interface WireFeed {
  url?: string; ok?: boolean; error?: string; id?: string; title?: string; items?: WireItem[];
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
  private loading: Promise<void> | null = null;

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

  /** 只加载一次；并发调用共用同一个 Promise（视图在插件 onload 完成前就恢复时会用到） */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const pending: Promise<void> = this.loading ?? this.load().finally(() => { this.loading = null; });
    this.loading = pending;
    await pending;
  }

  async load() {
    this.tasks = [];
    this.logs = [];
    this.staff = [];
    this.feeds = [];
    this.ideas = [];
    this.tags = [];

    // 任务：一个项目一个文件，H2 = 里程碑，缩进 checklist = 步骤
    for (const file of this.filesIn(this.settings.tasksFolder)) {
      const text = await this.app.vault.cachedRead(file);
      const project = file.basename;
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
      this.feeds.push({
        id: file.basename,
        file: file.path,
        name: asText(fm["title"]) || file.basename,
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
    this.loaded = true;
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
    await this.patchLine(t.file, t.line, toggleTaskLine);
  }

  async setDue(t: Task, due: string) {
    await this.patchLine(t.file, t.line, (l) => setTaskDue(l, due));
  }

  async setField(t: Task, key: string, value: string | number | null) {
    await this.patchLine(t.file, t.line, (l) => setTaskField(l, key, value));
  }

  /** 追加任务到项目文件；若里程碑段落不存在则补 H2 */
  async addTask(project: string, milestone: string | undefined, t: Partial<Task> & { title: string }) {
    await this.ensureFolder(this.settings.tasksFolder);
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
  async renameFeed(feed: Feed, name: string) {
    const n = name.trim();
    if (!n) return false;
    const file = await this.fileByPath(feed.file);
    if (!file) return false;
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
    return true;
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
  async publishSource(from: Feed, opts: { name: string; desc?: string; cadence?: string }) {
    const name = (opts.name || "").trim();
    if (!name) return { ok: false as const, reason: "empty" };

    // id 不让用户填：按名字生成，重名自动加序号；同一个源再次发布沿用上次的 id
    const remembered = (this.settings.feedIds || {})[from.id];
    const banned = new Set('\\/:*?"<>|#[]^'.split(""));
    const clean = (t: string) => Array.from(t).map((c) => (banned.has(c) ? "-" : c)).join("");
    let id = remembered || clean(name).replace(/\s+/g, "-").slice(0, 40) || "feed";
    let target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
    if (!remembered) {
      let base = id, n = 2;
      while (this.app.vault.getAbstractFileByPath(target) && target !== from.file) {
        id = `${base}-${n++}`;
        target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
      }
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

  /** 取消发布：把内容并回个人源，然后把这个源文件删掉（进系统回收站） */
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
        lines[i] = state === "live" ? setTaskField(lines[i], "state", null) : setTaskField(lines[i], "state", "ended");
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
  async publishFeed(feed: Feed, hubUrl: string, publishId?: string) {
    const base = hubUrl.replace(/\/$/, "");
    const pid = publishId || (this.settings.feedIds || {})[feed.id] || feed.id;
    await this.httpJson<PublishResult>(`${base}/register`, {
      method: "POST",
      body: { id: pid, title: feed.name, desc: feed.desc, owner: feed.owner },
    });
    const items = feed.items.map((m, i) => ({
      mid: `${pid}-${m.date}-${i}`,
      date: m.date, title: m.title, kind: m.kind, place: m.place, who: m.who,
      star: m.star, state: m.state, until: m.until, body: m.body,
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
    const mine = this.feeds.filter((f) => f.mine);
    if (mine.some((f) => norm(feedUrl).includes(`id=${f.id}`) || norm(feedUrl).includes(`id=${encodeURIComponent(f.id)}`))) {
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
      const path = normalizePath(`${this.settings.feedsFolder}/远程-${id}.md`);
      let file = this.asFile(this.app.vault.getAbstractFileByPath(path));
      if (!file) {
        await this.ensureFolder(this.settings.feedsFolder);
        await this.createSafe(path,
          `---\ntitle: ${title}\nremote: ${asText(feed.url)}\nown: false\n---\n\n# ${title}\n\n`);
        file = this.asFile(this.app.vault.getAbstractFileByPath(path));
        if (!file) return;
      }
      await this.app.vault.process(file, (text) => {
        const lines = text.split(/\r?\n/);
        for (const it of items) {
          const mid = asText(it.mid) || `${id}-${asText(it.date)}-${asText(it.title)}`;
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
            (it.until ? ` [until:: ${it.until}]` : "") + stateField +
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
