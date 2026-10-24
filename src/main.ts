import {
  App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, normalizePath, requestUrl,
  type SettingDefinition, type SettingDefinitionItem,
} from "obsidian";
import { Store, TLTSettings, DEFAULT_SETTINGS, pathsFromRoot, PATH_KEYS } from "./store";
import { WorkbenchView, VIEW_TYPE_WORKBENCH } from "./views/workbench";
import { MessagesView, VIEW_TYPE_MESSAGES } from "./views/messages";
import { MoveDataModal } from "./views/modals";
import {
  taskRegisterFlow, newProjectFlow, newMilestoneFlow, deleteTaskFlow,
  archiveTaskFlow, archiveProjectFlow, quickMenuFlow,
} from "./actions";
import { todayISO, asText, type Period } from "./data";
import { t, setLanguage, LANGUAGE_LABELS, type Language } from "./i18n";
import { attachFolderSuggest } from "./views/folder-suggest";

type ThemeMode = "auto" | "light" | "dark";

/** catch 里拿到的值一律按 unknown 处理，取一条能显示的文案 */
const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "未知错误";

/** 设置里所有字符串型字段的键（给目录输入框用） */
type PathKey =
  | "root" | "tasksFolder" | "teamFolder" | "feedsFolder" | "logsFolder"
  | "ideasFile" | "tagsFile" | "mineFeed" | "hubPublish" | "hubSync";

interface Settings extends TLTSettings {
  theme: ThemeMode;
  language: Language;
  /** 人员目录 team → crew 的一次性迁移标记 */
  crewMigrated?: boolean;
  /** 上一次「更新」时实际生效的根目录（用户改了但没点更新时，用它算派生差异） */
  appliedRoot?: string;
  hubPublish: string;
  hubSync: string;
  autoSyncMin: number;
  autoPushMin: number;
}

const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  theme: "auto",
  language: "auto",
  hubPublish: "http://127.0.0.1:8787",
  hubSync: "http://127.0.0.1:8788",
  autoSyncMin: 15,
  autoPushMin: 0,
};

export class TLTPlugin extends Plugin {
  settings: Settings;
  store: Store;
  private hub = { publish: "", sync: "", lastSync: "", lastResult: "", lastError: "" };

  async onload() {
    // 重启时 Obsidian 会先恢复上次打开的标签页，视图可能在本函数跑完前就开始渲染，
    // 所以 settings / store 这两个字段必须**立刻**有值，不能等 loadSettings()。
    this.settings = { ...DEFAULTS };
    this.store = new Store(this.app, this.settings);
    try {
      await this.boot();
    } catch (e) {
      // 兜底：任何一处出错都别让 Obsidian 报「插件加载失败」——给出可读原因，插件保持可用
      console.error("TLT: 加载失败", e);
      const detail = e instanceof Error ? (e.stack || e.message) : String(e);
      new Notice(t("TLT 加载出错：{msg}", { msg: errMsg(e) }));
      void this.dumpLoadError(detail);
    }
  }

  /**
   * 默认目录改名的一次性迁移：人员目录 team → crew。
   * 只认「还等于旧默认值」的情况，用户自己改过的不动；旧目录里的文件会问要不要搬。
   */
  async migrateFolderDefaults() {
    const s = this.settings;
    if (s.crewMigrated || s.teamFolder !== "TLT/team") return;
    const before = { ...s };
    s.teamFolder = "TLT/crew";
    s.crewMigrated = true;
    await this.saveSettings();
    await this.relocate(before);          // 先把旧 team 目录里的档案搬进 crew/
    await this.store.ensureVault();
    new Notice(t("人员目录已由 TLT/team 改为 TLT/crew"));
  }

  /** 自检：把版本、数据量、目录、上次加载错误写进插件目录，出问题时一看就知道 */
  async selfCheck() {
    const s = this.settings;
    const file = (this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`) + "/tlt-check.log";
    let lastError = "（无）";
    try { if (await this.app.vault.adapter.exists(file)) lastError = (await this.app.vault.adapter.read(file)).trim(); } catch { /* 读不到就算了 */ }
    const msg = Number(this.store.feeds.reduce((n, f) => n + f.items.length, 0));
    const report = [
      `TLT v${this.manifest.version} · Obsidian ${(this.app as unknown as { appVersion?: string }).appVersion ?? "?"}`,
      `时间 ${new Date().toISOString()}`,
      `根目录 ${s.root || "（库根目录）"}`,
      `任务目录 ${s.tasksFolder} · 人员目录 ${s.teamFolder} · 消息源目录 ${s.feedsFolder} · 记录目录 ${s.logsFolder}`,
      `数据：任务 ${this.store.tasks.length} · 人员 ${this.store.staff.length} · 源 ${this.store.feeds.length} · 消息 ${msg} · 记录 ${this.store.logs.length} · 随手记 ${this.store.ideas.length} · 标签 ${this.store.tags.length}`,
      `主题 ${s.theme} · 语言 ${s.language} · 自动同步 ${s.autoSyncMin} 分 / 自动推送 ${s.autoPushMin} 分`,
      `上次加载错误：${lastError}`,
    ].join("\n");
    try {
      const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
      if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
      await this.app.vault.adapter.write(file, report + "\n");
    } catch (e) { console.error("TLT: 自检写入失败", e); }
    new Notice(`TLT v${this.manifest.version} 自检：任务 ${this.store.tasks.length} · 人员 ${this.store.staff.length} · 源 ${this.store.feeds.length} · 消息 ${msg}（报告见插件目录 tlt-check.log）`, 8000);
  }

  /** 加载出错时把原因写进插件目录，方便事后排查（用户只看到一句「加载失败」时尤其有用） */
  private async dumpLoadError(detail: string) {
    try {
      const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
      await this.app.vault.adapter.write(
        `${dir}/load-error.log`,
        `v${this.manifest.version}  ${new Date().toISOString()}\n${detail}\n`,
      );
    } catch {
      /* 诊断文件写不出来就算了，不能因此再抛一次 */
    }
  }

  private async boot() {
    await this.loadSettings();
    if (this.settings.appliedRoot === undefined) {
      this.settings.appliedRoot = this.settings.root;   // 老数据没有这个字段：以当前根目录为准
      await this.saveSettings();
    }
    await this.migrateFolderDefaults();
    this.store.settings = this.settings;
    setLanguage(this.settings.language);
    this.store = new Store(this.app, this.settings);

    this.registerView(VIEW_TYPE_WORKBENCH, (leaf: WorkspaceLeaf) => new WorkbenchView(leaf, this));
    this.registerView(VIEW_TYPE_MESSAGES, (leaf: WorkspaceLeaf) => new MessagesView(leaf, this));

    this.addRibbonIcon("activity", "时间线工作台", () => { void this.activateWorkbench(); });

    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => { void this.activateWorkbench(); } });
    this.addCommand({ id: "open-messages", name: "打开消息中心（独立页）", callback: () => { void this.activateMessages(); } });
    const refresh = () => this.refreshAll();
    // —— 快捷命令（原生，不依赖 QuickAdd）——
    this.addCommand({ id: "quick-menu", name: t("快捷命令…"), callback: () => quickMenuFlow(this.app, this.store, refresh, { workbench: () => this.activateWorkbench(), messages: () => this.activateMessages() }) });
    this.addCommand({ id: "new-task", name: t("登记任务"), callback: () => taskRegisterFlow(this.app, this.store, refresh) });
    this.addCommand({ id: "new-project", name: t("新建项目"), callback: () => newProjectFlow(this.app, this.store, refresh) });
    this.addCommand({ id: "new-milestone", name: t("新建里程碑"), callback: () => { void newMilestoneFlow(this.app, this.store, refresh); } });
    this.addCommand({ id: "archive-task", name: t("归档任务"), callback: () => { void archiveTaskFlow(this.app, this.store, refresh); } });
    this.addCommand({ id: "archive-project", name: t("归档项目"), callback: () => { void archiveProjectFlow(this.app, this.store, refresh); } });
    this.addCommand({ id: "delete-task", name: t("删除任务"), callback: () => { void deleteTaskFlow(this.app, this.store, refresh); } });
    this.addCommand({ id: "seed-demo", name: "生成示例数据", callback: () => { void this.seedDemo(); } });
    this.addCommand({ id: "toggle-theme", name: "切换明暗", callback: () => this.toggleTheme() });
    this.addCommand({ id: "self-check", name: "自检（写一份诊断报告）", callback: () => { void this.selfCheck(); } });
    this.addCommand({ id: "hub-publish", name: "推送到发布服务", callback: () => { void this.publishAll(); } });
    this.addCommand({ id: "hub-sync", name: "从拉取服务同步", callback: () => { void this.syncAll(); } });

    this.addSettingTab(new TLTSettingTab(this.app, this));

    this.applyTheme();
    await this.store.ensureVault();
    await this.store.load();

    let timer: number | null = null;
    const reload = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await this.store.load();
        this.refreshAll();
      }, 400);
    };
    this.registerEvent(this.app.vault.on("modify", reload));
    this.registerEvent(this.app.vault.on("create", reload));
    this.registerEvent(this.app.vault.on("delete", reload));
    this.registerEvent(this.app.vault.on("rename", reload));
    // 换主题（或跟随系统日夜切换）时重新落一次令牌类
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyTheme()));

    // 重启后 Obsidian 会恢复上次打开的视图，那时 store 还是空的；数据读完必须补一次重画。
    // 这一步绝不能把 onload 带崩：视图自己出问题不该让插件「加载失败」。
    try { this.refreshAll(); } catch (e) { console.error("TLT: 首次刷新失败", e); }
    this.setupTimers();
  }

  /** 自动同步 / 自动推送 */
  setupTimers() {
    const sync = Number(this.settings.autoSyncMin) || 0;
    const push = Number(this.settings.autoPushMin) || 0;
    if (sync > 0) {
      this.registerInterval(window.setInterval(() => this.syncAll(true), sync * 60_000));
    }
    if (push > 0) {
      this.registerInterval(window.setInterval(() => this.publishAll(true), push * 60_000));
    }
  }

  onunload() { document.body.removeClass("tlt-light"); document.body.removeClass("tlt-dark"); }

  /* ---------- 配置 ---------- */

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULTS, ...saved };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.store.settings = this.settings;
    await this.store.load();
    this.refreshAll();
  }

  /* ---------- 主题 ---------- */

  /** Obsidian 现在是深是浅（类可能挂在 body 或 html 上，都问一遍，最后按背景亮度兜底） */
  private obsidianIsDark(): boolean {
    const cls = `${document.body.className} ${document.documentElement.className}`;
    if (/\btheme-dark\b/.test(cls)) return true;
    if (/\btheme-light\b/.test(cls)) return false;
    const c = getComputedStyle(document.body);
    const raw = (c.getPropertyValue("--background-primary") || c.backgroundColor || "").trim();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
    if (m) return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 128;
    return false;
  }
  isLight(): boolean {
    if (this.settings.theme === "light") return true;
    if (this.settings.theme === "dark") return false;
    return !this.obsidianIsDark();                            // auto：跟随 Obsidian
  }
  /** auto 也要落到一个明确类上：否则深浅切换时只有 CSS 猜得到，界面自己不知道 */
  applyTheme() {
    const light = this.isLight();
    document.body.toggleClass("tlt-light", light);
    document.body.toggleClass("tlt-dark", !light);
  }
  toggleTheme() {
    // 三态循环：浅 → 深 → 跟随系统
    const cur = this.settings.theme;
    this.settings.theme = cur === "light" ? "dark" : cur === "dark" ? "auto" : "light";
    this.applyTheme();
    void this.saveData(this.settings);
    this.refreshAll();
    new Notice({ light: "浅色", dark: "深色", auto: "跟随系统" }[this.settings.theme]);
  }

  /* ---------- Hub ---------- */

  hubState() {
    return {
      publish: this.settings.hubPublish,
      sync: this.settings.hubSync,
      lastSync: this.hub.lastSync,
      lastResult: this.hub.lastResult,
      lastError: this.hub.lastError,
      syncMin: this.settings.autoSyncMin,
      pushMin: this.settings.autoPushMin,
    };
  }
  setHubState(patch: Partial<typeof this.hub>) { this.hub = { ...this.hub, ...patch }; }

  async publishAll(silent = false) {
    const mine = this.store.feeds.filter((f) => f.mine);
    if (!mine.length) { new Notice("没有我发布的源"); return; }
    try {
      let total = 0;
      for (const f of mine) { const r = await this.store.publishFeed(f, this.settings.hubPublish); total += r.count || 0; }
      this.setHubState({ lastResult: `推送 ${mine.length} 个源 / ${total} 条`, lastError: "" });
      if (!silent) new Notice(`已推送 ${mine.length} 个源（${total} 条）`);
      this.refreshAll();
    } catch (e) {
      const msg = errMsg(e);
      this.setHubState({ lastError: "推送失败：" + msg });
      new Notice("推送失败：" + msg);
    }
  }

  async syncAll(silent = false) {
    try {
      const r = await this.store.pullFromHub(this.settings.hubSync);
      const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      this.setHubState({ lastSync: stamp, lastResult: `新增 ${r.added} 条`, lastError: "" });
      if (!silent) new Notice(`同步完成：新增 ${r.added} 条`);
      this.refreshAll();
    } catch (e) {
      const msg = errMsg(e);
      this.setHubState({ lastError: "同步失败：" + msg });
      new Notice("同步失败：" + msg);
    }
  }

  /* ---------- 视图 ---------- */

  async activateWorkbench() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_WORKBENCH)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_WORKBENCH, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateMessages() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MESSAGES)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MESSAGES, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  refreshAll() {
    const draw = (type: string) => {
      for (const l of this.app.workspace.getLeavesOfType(type)) {
        try {
          const v = l.view as WorkbenchView | MessagesView;
          if (v && typeof v.render === "function") void v.render();
        } catch (e) {
          console.error("TLT: 刷新视图失败", e);   // 一个视图画不出来，不能连累别的
        }
      }
    };
    draw(VIEW_TYPE_WORKBENCH);
    draw(VIEW_TYPE_MESSAGES);
  }

  /* ---------- 示例数据 ---------- */

  /** 测一下消息服务能不能通（发布端看 /feeds，订阅端看 /subscriptions） */
  async pingHub(kind: "publish" | "sync", silent = false) {
    const base = (kind === "publish" ? this.settings.hubPublish : this.settings.hubSync).replace(/\/$/, "");
    const label = kind === "publish" ? "发布服务" : "拉取服务";
    if (!base) { if (!silent) new Notice(`还没填${label}地址`); return false; }
    try {
      const res = await requestUrl({
        url: `${base}${kind === "publish" ? "/feeds" : "/subscriptions"}`,
        method: "GET", throw: false,
      });
      if (res.status >= 400) { if (!silent) new Notice(`${label}返回 HTTP ${res.status}`); return false; }
      const body = res.json as { feeds?: unknown[]; subs?: unknown[] };
      const n = kind === "publish" ? (body.feeds?.length ?? 0) : (body.subs?.length ?? 0);
      if (!silent) {
        new Notice(kind === "publish" ? `发布服务通，已注册 ${n} 个源` : `拉取服务通，已订阅 ${n} 个源`);
      }
      return true;
    } catch (e) {
      if (!silent) new Notice(`${label}连不上：${errMsg(e)}`);
      return false;
    }
  }

  /**
   * 写入一份**虚构**的示例数据，方便先看界面。
   * 这里的所有人名、项目、消息都是编的占位内容，不含任何真实信息。
   * 已存在的文件一律不覆盖。
   */
  async seedDemo() {
    const s = this.store.settings;
    await this.store.ensureVault();
    const w = async (path: string, content: string) => {
      const p = normalizePath(path);
      if (this.app.vault.getAbstractFileByPath(p)) return;
      await this.store.createSafe(p, content);
    };
    const d = todayISO();

    await w(`${s.teamFolder}/示例成员.md`, `---\ntlt: staff\nrole: 负责人\ncapacity: 100\ndays: 5\nskills: [决策, 评审]\nstatus: active\n---\n`);
    await w(`${s.teamFolder}/张三.md`, `---\ntlt: staff\nrole: 工程师\ncapacity: 100\ndays: 5\nskills: [实现, 文档]\nstatus: active\n---\n`);
    await w(`${s.teamFolder}/李四.md`, `---\ntlt: staff\nrole: 工程师\ncapacity: 90\ndays: 5\nskills: [测试, 数据]\nstatus: active\n---\n`);

    await w(`${s.tasksFolder}/示例项目.md`, `# 示例项目

## 第一阶段

- [ ] 这是示例任务，换成你自己的 🛫 ${d} 📅 ${d} [est:: 1] [pri:: 2] [owner:: [[示例成员]]]
  - [ ] 这是子步骤，用两格缩进
  - [ ] 勾选会写回这一行
- [ ] 示例任务：没有里程碑的也可以 📅 ${d} [est:: 0.5] [owner:: [[张三]]]
`);

    await w(`${s.feedsFolder}/我的消息源.md`, `---
title: 我的消息源
owner: me
mine: true
cadence: 随手发
desc: 我发布出去的动态
---

# 我的消息源

- ${d} 示例消息：这条会出现在消息中心 [star:: true]
  > 正文写在缩进的引用里，可以留空。
`);

    await w(`${s.logsFolder}/${d.slice(0, 7)}.md`, `# 记录 ${d.slice(0, 7)}

## ${d}

- 09:30–11:00 示例记录：做了什么 [proj:: 示例项目]
  > 记录是"实际发生"的时间块，和任务的"计划"分开。
- 11:00–11:40 示例记录：临时的会议 [extra:: true]
  > 标 [extra:: true] 表示计划外插入。
`);

    await w(s.ideasFile, `# 随手记

- 示例随手记：一行一条，用 #标签 归类 [at:: ${d}]
  > 正文可选，写"为什么记下来"最有用。
- 示例随手记：看到就记，不用想放哪个项目 [tags:: 示例] [at:: ${d}]
`);

    await this.store.load();
    this.refreshAll();
    new Notice("已写入示例数据（内容都是编的，可直接删）");
  }

  /**
   * 根目录变了：只把"还等于旧默认值"的那几项挪过去，用户单独改过的不动。
   * 声明式设置与命令式设置都走这里，避免两条路径行为不一致。
   */
  /**
   * 「更新」按钮唯一会做的事：按当前设置重建派生路径，并把旧位置的数据搬过来。
   * 打字阶段只写设置值、别的什么都不动（用户要求：只有点「更新」才真正更新）。
   */
  async applyNow(): Promise<{ movedFiles: number; blocked: number; pending: boolean; kept: number; moved: number }> {
    const s = this.settings;
    const snapshot = { ...s };
    const after = pathsFromRoot(s.root);
    // 判断某一项现在是不是「从某个根目录派生出来的」：只要它等于派生尾巴
    // （`TLT/tasks` 或 `<任意>/TLT/tasks`）就认为可以跟着根目录走；
    // 完全自定的路径（如 `乱写的/任务`）才保留。
    const isDerived = (value: string, tail: string) => value === tail || value.endsWith(`/${tail}`);
    const tails = pathsFromRoot("");            // TLT/tasks、TLT/crew…（不含根目录前缀的尾巴）
    let moved = 0, kept = 0;
    PATH_KEYS.forEach((k) => {
      if (isDerived(s[k], tails[k])) { s[k] = after[k]; moved++; }
      else kept++;
    });
    s.appliedRoot = s.root;
    await this.saveSettings();
    const res = await this.relocate(snapshot, async () => {   // 取消更新：整次操作回滚
      Object.assign(this.settings, snapshot);
      await this.saveSettings();
      new Notice(t("已取消更新，设置与目录都保持原样"));
    });
    if (!res.pending) await this.store.ensureVault();    // 没有迁移就直接补建
    return { ...res, kept, moved };
  }

  /**
   * 把旧位置的数据搬到新位置。
   * 只有在"目标已有同名文件"时才弹窗，且弹窗只有两个出口：确认搬运 / 取消更新。
   */
  /**
   * 把旧位置的数据搬到新位置。
   * 只要这次更新涉及迁移，就先弹窗把「从哪搬到哪、搬几个」摆出来，由用户确认；
   * 弹窗只有两个出口：确认搬运 / 取消更新（取消会把整次操作回滚）。
   */
  private async relocate(old: Settings, onCancel?: () => void | Promise<void>): Promise<{ movedFiles: number; blocked: number; pending: boolean }> {
    const moves = this.planMove(old);
    if (!moves.length) return { movedFiles: 0, blocked: 0, pending: false };
    const blocked = moves.filter((m) => this.app.vault.getAbstractFileByPath(m.to));
    const info = {
      fromDir: this.oldDataDir(old),
      toDir: this.oldDataDir(this.settings),
      moves,
      blocked: blocked.length,
    };
    new MoveDataModal(this.app, info, async () => {
      const st = await this.doMove(moves);
      await this.store.ensureVault();
      await this.notifyMove(old, st.moved);
      this.refreshAll();
    }, onCancel).open();
    return { movedFiles: 0, blocked: blocked.length, pending: true };
  }

  /** 旧数据目录的路径（去掉 /tasks 尾巴） */
  private oldDataDir(old: TLTSettings): string {
    return old.tasksFolder.replace(/\/tasks$/, "").replace(/\/+$/, "");
  }

  /** 旧数据目录里还剩几个 md（搬完之后调用） */
  private countIn(dir: string): number {
    if (!dir) return 0;
    return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${dir}/`)).length;
  }

  /** 搬运结果提示：搬了几个 + 旧目录是保留还是已清空，都写在通知里 */
  async notifyMove(old: TLTSettings, moved: number) {
    const dir = this.oldDataDir(old);
    const left = this.countIn(dir);
    const bits: string[] = [];
    if (moved) bits.push(t("已搬 {n} 个文件到新目录", { n: moved }));
    if (!bits.length) return;
    bits.push(left === 0
      ? t("旧目录 {dir} 已清空，空文件夹保留（需要的话自行删除）", { dir })
      : t("旧目录 {dir} 仍有 {n} 个文件（同名未覆盖）", { dir, n: left }));
    new Notice(bits.join(" · "), 8000);
  }


  private async doMove(moves: { from: string; to: string }[]): Promise<{ moved: number; skipped: number }> {
    let moved = 0, skipped = 0;
    for (const m of moves) {
      const f = this.app.vault.getAbstractFileByPath(m.from);
      if (!f) continue;
      if (this.app.vault.getAbstractFileByPath(m.to)) { skipped++; continue; }   // 同名不覆盖
      await this.ensureParent(m.to);
      await this.app.fileManager.renameFile(f, m.to);
      moved++;
    }
    await this.store.load();
    this.refreshAll();
    return { moved, skipped };
  }

  /**
   * 路径改了、旧目录里还有数据：问要不要一起搬过去。
   * 不auto搬 —— 动用户的文件必须有明确同意。
   */
  /** 旧路径 → 新路径的文件级搬运计划（只算真实存在、且新旧不同的） */
  planMove(old: TLTSettings): { from: string; to: string }[] {
    const s = this.settings;
    const out: { from: string; to: string }[] = [];
    const folders: ("tasksFolder" | "teamFolder" | "feedsFolder" | "logsFolder")[] =
      ["tasksFolder", "teamFolder", "feedsFolder", "logsFolder"];
    for (const k of folders) {
      const from = old[k] || "";
      const to = s[k] || "";
      if (!from || from === to) continue;
      for (const f of this.app.vault.getMarkdownFiles()) {
        if (f.path.startsWith(from.replace(/\/+$/, "") + "/")) {
          out.push({ from: f.path, to: `${to}/${f.path.slice(from.length + 1)}` });
        }
      }
    }
    for (const k of ["ideasFile", "tagsFile"] as const) {
      const from = old[k] || "";
      const to = s[k] || "";
      if (from && from !== to && this.app.vault.getAbstractFileByPath(from)) out.push({ from, to });
    }
    return out;
  }

  private async ensureParent(filePath: string) {
    const dir = filePath.split("/").slice(0, -1).join("/");
    if (dir) await this.store.ensureFolder(dir);
  }

}

export default TLTPlugin;

/**
 * 设置页。
 * 组织方式与 pickme 一致：不加顶级标题、通用项放最上面、分节用 setSetting 标题、
 * 每项都写清「改了会怎样」，动作类集中在各自小节里。
 * 声明式（1.13+ 的设置搜索）与命令式（老客户端 / 需要按钮的地方）两套字段保持一致。
 */
export class TLTSettingTab extends PluginSettingTab {
  plugin: TLTPlugin;
  constructor(app: App, plugin: TLTPlugin) { super(app, plugin); this.plugin = plugin; }

  /** 1.13+ 的设置搜索读这里 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const text = (key: PathKey, name: string, desc: string, dflt: string): SettingDefinition => ({
      name: t(name), desc: t(desc), control: { type: "text", key, placeholder: dflt, defaultValue: dflt },
    });
    /** 目录类字段用官方目录控件：自带补全，Tab / 点击即可选中已有目录 */
    const folder = (key: PathKey, name: string, desc: string, dflt: string): SettingDefinition => ({
      name: t(name), desc: t(desc),
      control: {
        type: "folder", key, placeholder: dflt, defaultValue: dflt, includeRoot: key === "root",
        filter: (f) => !f.path.startsWith(".") && !f.path.includes("/."),
      },
    });
    const pick = (
      key: "defaultPeriod" | "autoSyncMin" | "autoPushMin" | "theme" | "language",
      name: string, desc: string, options: Record<string, string>,
    ): SettingDefinition => ({ name: t(name), desc: t(desc), control: { type: "dropdown", key, options } });
    const every = { "0": t("关闭"), "5": t("5 分钟"), "15": t("15 分钟"), "30": t("30 分钟"), "60": t("1 小时") };
    const d = DEFAULTS;

    return [
      pick("language", "界面语言", "设置面板与插件界面用什么语言。",
        { auto: t("自动（跟随 Obsidian）"), zh: LANGUAGE_LABELS.zh, en: LANGUAGE_LABELS.en }),
      pick("theme", "主题", "跟随 Obsidian，或强制深色/浅色。主界面右上角也能切。",
        { auto: t("跟随 Obsidian"), dark: t("深色"), light: t("浅色") }),
      {
        type: "group", heading: t("目录"),
        items: [
          folder("root", "根目录", "TLT 目录放在这里：下面六项都在它的 TLT 子目录下；留空表示放在库根目录（即 TLT/）。输入只做记录，点右边的「更新」才真正生效（重建六项路径 + 把数据搬过去）。", d.root),
          { name: t("更新"), desc: t("按当前设置重建六个路径，并把旧位置的数据搬过来；目标已有同名文件时才会问你。"), action: () => { void this.alignAndNotify(); } },
          folder("tasksFolder", "任务目录", "一个项目一个文件，## 小节是里程碑，任务一行一条。", d.tasksFolder),
          folder("teamFolder", "人员目录", "一人一个文件，frontmatter 写 role / capacity / days / skills。", d.teamFolder),
          folder("feedsFolder", "消息源目录", "一个源一个文件，正文列表一行一条消息。", d.feedsFolder),
          folder("logsFolder", "记录目录", "按月一个文件，正文用 ## 日期 分节。", d.logsFolder),
          text("ideasFile", "随手记文件", "单文件，一行一条。", d.ideasFile),
          text("tagsFile", "标签库文件", "单文件，一行一个标签。", d.tagsFile),
        ],
      },
      {
        type: "group", heading: t("口径"),
        items: [
          pick("defaultPeriod", "默认占比周期", "占比与饱和度的默认口径，界面上随时可切。",
            { w: t("本周"), m: t("本月"), q: t("本季度") }),
        ],
      },
      {
        type: "group", heading: t("消息服务"),
        items: [
          text("hubPublish", "发布服务地址", "把「我发布的源」推到这里。发布端与订阅端可以是同一个地址。", d.hubPublish),
          text("hubSync", "拉取服务地址", "从这里同步订阅的源。留空则完全离线，只用库内 Markdown。", d.hubSync),
          pick("autoSyncMin", "自动同步间隔", "按这个间隔自动拉取订阅的源。", every),
          pick("autoPushMin", "自动推送间隔", "按这个间隔把我发布的源推上去。", every),
        ],
      },
      {
        type: "group", heading: t("维护"),
        items: [
          { name: t("推送到发布服务"), desc: t("立刻把所有「我发布的源」推一遍。"), action: () => { void this.plugin.publishAll(); } },
          { name: t("从拉取服务同步"), desc: t("立刻拉取一次订阅的源。"), action: () => { void this.plugin.syncAll(); } },
          { name: t("生成示例数据"), desc: t("写一份虚构的样例（人名和项目都是编的），方便先看界面。已存在的文件不覆盖。"), action: () => { void this.plugin.seedDemo(); } },
          { name: t("版本"), desc: this.versionLine() },
        ],
      },
    ];
  }

  /**
   * 重画这一页。1.13+ 的声明式页由框架渲染（update()），
   * 不能拿命令式的 renderSettings() 去 empty + 重建——那会把官方控件一起换掉。
   */
  rerender(): void {
    const up = (this as unknown as { update?: () => void }).update;
    if (typeof up === "function") {
      try { up.call(this); return; } catch { /* 框架不给面子就退回命令式 */ }
    }
    this.renderSettings();
  }

  /** 版本行：确认「实际加载的是哪个版本」时最有用 */
  versionLine(): string {
    const ver = (this.app as unknown as { appVersion?: string }).appVersion ?? "?";
    return `TLT v${this.plugin.manifest.version} · Obsidian ${ver}`;
  }

  /** 重排路径 + 提示（两套界面共用） */
  async alignAndNotify() {
    const r = await this.plugin.applyNow();
    if (r.pending) return;                       // 迁移交给弹窗确认，提示也由它给
    const dataDir = this.plugin.settings.tasksFolder.replace(/\/tasks$/, "");
    const bits: string[] = [];
    bits.push(t("{n} 项路径已同步", { n: r.moved }));
    if (r.kept) bits.push(t("{n} 项手工设置保持不变", { n: r.kept }));
    if (r.movedFiles) bits.push(t("已搬 {n} 个文件到 {dir}", { n: r.movedFiles, dir: dataDir }));
    bits.push(t("目录已就位"));
    new Notice(bits.join(" · "));   // 旧目录的状态由 notifyMove 单独提示
    await this.plugin.store.load();
    this.plugin.refreshAll();
    this.rerender();
  }

  /**
   * 声明式设置是**每次按键**都调这里：逐字只把值记下来，
   * 派生路径 / 建目录 / 搬数据一律留给「更新」按钮。
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    const bag = this.plugin.settings as unknown as Record<string, unknown>;
    bag[key] = value;
    await this.plugin.saveSettings();
    if (key === "theme") this.plugin.applyTheme();
    if (key === "language") { setLanguage(asText(value)); this.rerender(); }
  }

  /** 老版本客户端（< 1.13）只认 display()，转发到 renderSettings 以便内部重建这一页 */
  display() { this.renderSettings(); }

  renderSettings() {
    const { containerEl } = this;
    containerEl.empty();
    const p = this.plugin;

    // 通用项：不加标题，放最上面
    new Setting(containerEl)
      .setName(t("界面语言"))
      .setDesc(t("设置面板与插件界面用什么语言。"))
      .addDropdown((dd) => {
        dd.addOption("auto", t("自动（跟随 Obsidian）"))
          .addOption("zh", LANGUAGE_LABELS.zh)
          .addOption("en", LANGUAGE_LABELS.en)
          .setValue(p.settings.language ?? "auto")
          .onChange((v) => {
            p.settings.language = v as Language;
            setLanguage(v);
            void p.saveSettings();
            p.refreshAll();
            this.renderSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("主题"))
      .setDesc("跟随 Obsidian，或强制深色/浅色。主界面右上角的按钮也能切。")
      .addDropdown((d) =>
        d.addOptions({ auto: t("跟随 Obsidian"), dark: t("深色"), light: t("浅色") })
          .setValue(p.settings.theme)
          .onChange((v) => {
            p.settings.theme = v as ThemeMode;
            p.applyTheme();
            void p.saveSettings();
          })
      );

    /* ---------- 目录 ---------- */
    new Setting(containerEl).setName(t("目录")).setHeading();
    const d = DEFAULTS;
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "插件只读这几个目录，不扫全库，也不和别的任务插件共用文件。目录不存在会自动创建；路径改完会重新扫描一次，原来的文件不会搬也不会删。",
    });
    new Setting(containerEl)
      .setName(t("根目录"))
      .setDesc(t("TLT 目录放在这里：下面六项都在它的 TLT 子目录下；留空表示放在库根目录（即 TLT/）。输入只做记录（有候选可 Tab/点击选中），点「更新」才真正生效：重建六项路径，并把旧位置的数据搬过去。"))
      .addButton((b) => b.setButtonText(t("更新")).setTooltip(t("按当前设置重建六个路径，并把数据搬过去")).onClick(() => { void this.alignAndNotify(); }))
      .addText((tc) => {
        tc.setPlaceholder(d.root).setValue(p.settings.root ?? d.root);
        const commit = () => {
          const next = tc.inputEl.value.trim();
          if (next === p.settings.root) return;
          void (async () => {
            p.settings.root = next;
            await p.saveSettings();
            new Notice(t("已记录新的根目录，点「更新」生效"));
          })();
        };
        attachFolderSuggest(p.app, tc.inputEl);
        tc.inputEl.addEventListener("blur", commit);
        tc.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") tc.inputEl.blur(); });
      });

    const folder = (name: PathKey, label: string, desc: string, dflt: string) =>
      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addText((tc) => {
          tc.setPlaceholder(dflt).setValue(p.settings[name]);
          // 逐字不保存（每敲一个字就重扫一遍库）；失焦或回车只把值记下来，
          // 真正的生效（建目录 / 搬数据）交给该行上面的「更新」按钮。
          const commit = () => {
            const v = tc.inputEl.value.trim();
            if (v === p.settings[name]) return;
            p.settings[name] = v;
            void p.saveSettings();
            new Notice(t("已记录，点「更新」生效"));
          };
          attachFolderSuggest(p.app, tc.inputEl);          // 边打边给候选：Tab / 点击选中
          tc.inputEl.addEventListener("blur", commit);
          tc.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") tc.inputEl.blur(); });
        });
    folder("tasksFolder", t("任务目录"), t("一个项目一个文件，## 小节是里程碑，任务一行一条。"), d.tasksFolder);
    folder("teamFolder", t("人员目录"), t("一人一个文件，frontmatter 写 role / capacity / days / skills。"), d.teamFolder);
    folder("feedsFolder", t("消息源目录"), t("一个源一个文件，正文列表一行一条消息。"), d.feedsFolder);
    folder("logsFolder", t("记录目录"), t("按月一个文件，正文用 ## 日期 分节。"), d.logsFolder);
    folder("ideasFile", t("随手记文件"), t("单文件，一行一条。"), d.ideasFile);
    folder("tagsFile", t("标签库文件"), t("单文件，一行一个标签。"), d.tagsFile);

    /* ---------- 口径 ---------- */
    new Setting(containerEl).setName(t("口径")).setHeading();
    new Setting(containerEl)
      .setName(t("默认占比周期"))
      .setDesc(t("占比与饱和度的默认口径，界面上随时可切。"))
      .addDropdown((dd) =>
        dd.addOptions({ w: "本周", m: "本月", q: "本季度" })
          .setValue(p.settings.defaultPeriod)
          .onChange((v) => {
            p.settings.defaultPeriod = v as Period;
            void p.saveSettings();
          })
      );

    /* ---------- 消息服务 ---------- */
    new Setting(containerEl).setName(t("消息服务")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "服务是可选的：不填就完全离线，只用库内的 Markdown。发布端与订阅端可以是同一个地址（仓库里的 services-py 就是同进程同端口）。",
    });
    const intervals = { "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "1 小时" };
    folder("hubPublish", t("发布服务地址"), t("把「我发布的源」推到这里。"), d.hubPublish);
    folder("hubSync", t("拉取服务地址"), t("从这里同步订阅的源。"), d.hubSync);
    new Setting(containerEl)
      .setName(t("自动同步间隔"))
      .setDesc(t("按这个间隔自动拉取订阅的源。"))
      .addDropdown((dd) =>
        dd.addOptions(intervals).setValue(String(p.settings.autoSyncMin))
          .onChange((v) => { p.settings.autoSyncMin = Number(v); void p.saveSettings(); })
      );
    new Setting(containerEl)
      .setName(t("自动推送间隔"))
      .setDesc(t("按这个间隔把我发布的源推上去。"))
      .addDropdown((dd) =>
        dd.addOptions(intervals).setValue(String(p.settings.autoPushMin))
          .onChange((v) => { p.settings.autoPushMin = Number(v); void p.saveSettings(); })
      );
    const hub = p.hubState();
    new Setting(containerEl)
      .setName("推送与同步")
      .setDesc(hub.lastSync
        ? `上次同步 ${hub.lastSync} · ${hub.lastResult || "无变化"}${hub.lastError ? ` · ${hub.lastError}` : ""}`
        : "还没同步过。也可以点下面的按钮手动来一次。")
      .addButton((b) => b.setButtonText("推送我的源").onClick(() => { void p.publishAll(); }))
      .addButton((b) => b.setButtonText("同步订阅").onClick(() => { void p.syncAll(); }))
      .addButton((b) => b.setButtonText("测试连接").onClick(() => { void this.testBoth(); }));
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "「测试连接」会分别请求发布服务的 /feeds 与拉取服务的 /subscriptions，只读、不改数据。",
    });

    /* ---------- 维护 ---------- */
    new Setting(containerEl).setName(t("维护")).setHeading();
    new Setting(containerEl)
      .setName(t("生成示例数据"))
      .setDesc("写一份**虚构**的样例（人名和项目都是编的），方便先看界面。已存在的文件不覆盖。")
      .addButton((b) => b.setButtonText("生成").onClick(() => { void p.seedDemo(); }));
    const store = p.store;
    new Setting(containerEl)
      .setName("当前读取")
      .setDesc(`${store.tasks.length} 条任务 · ${store.logs.length} 条记录 · ${store.staff.length} 位成员 · ${store.feeds.length} 个源（${store.feeds.reduce((n, f) => n + f.items.length, 0)} 条消息）· ${store.ideas.length} 条随手记`);
    this.footerVersion();
  }

  /** 命令式页脚：版本 */
  private footerVersion(): void {
    new Setting(this.containerEl).setName(t("版本")).setDesc(`TLT v${this.plugin.manifest.version} · Obsidian ${(this.app as unknown as { appVersion?: string }).appVersion ?? "?"}`);
  }

  /** 一次性把两个地址都测一遍，结果合并成一条提示 */
  private async testBoth(): Promise<void> {
    const okPublish = await this.plugin.pingHub("publish", true);
    const okSync = await this.plugin.pingHub("sync", true);
    new Notice(`发布服务${okPublish ? "正常" : "连不上"} · 拉取服务${okSync ? "正常" : "连不上"}`);
  }
}
