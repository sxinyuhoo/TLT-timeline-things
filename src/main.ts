import {
  App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, normalizePath, requestUrl,
  type SettingDefinition, type SettingDefinitionItem,
} from "obsidian";
import { Store, TLTSettings, DEFAULT_SETTINGS, pathsFromRoot, PATH_KEYS } from "./store";
import { WorkbenchView, VIEW_TYPE_WORKBENCH } from "./views/workbench";
import { MessagesView, VIEW_TYPE_MESSAGES } from "./views/messages";
import { QuickTaskModal } from "./views/modals";
import { todayISO, asText, type Period } from "./data";

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
  hubPublish: string;
  hubSync: string;
  autoSyncMin: number;
  autoPushMin: number;
}

const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  theme: "auto",
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
    await this.loadSettings();
    this.store = new Store(this.app, this.settings);

    this.registerView(VIEW_TYPE_WORKBENCH, (leaf: WorkspaceLeaf) => new WorkbenchView(leaf, this));
    this.registerView(VIEW_TYPE_MESSAGES, (leaf: WorkspaceLeaf) => new MessagesView(leaf, this));

    this.addRibbonIcon("activity", "时间线工作台", () => { void this.activateWorkbench(); });

    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => { void this.activateWorkbench(); } });
    this.addCommand({ id: "open-messages", name: "打开消息中心（独立页）", callback: () => { void this.activateMessages(); } });
    this.addCommand({ id: "new-task", name: "新建任务", callback: () => { new QuickTaskModal(this.app, this.store, () => this.refreshAll()).open(); } });
    this.addCommand({ id: "seed-demo", name: "生成示例数据", callback: () => { void this.seedDemo(); } });
    this.addCommand({ id: "toggle-theme", name: "切换明暗", callback: () => this.toggleTheme() });
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

  isLight(): boolean {
    if (this.settings.theme === "light") return true;
    if (this.settings.theme === "dark") return false;
    return document.body.classList.contains("theme-light");   // auto：跟随系统/Obsidian
  }
  applyTheme() {
    document.body.toggleClass("tlt-light", this.settings.theme === "light");
    document.body.toggleClass("tlt-dark", this.settings.theme === "dark");
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
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKBENCH).forEach((l) => { void (l.view as WorkbenchView).render(); });
    this.app.workspace.getLeavesOfType(VIEW_TYPE_MESSAGES).forEach((l) => { void (l.view as MessagesView).render(); });
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
      await this.app.vault.create(p, content);
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
  async applyRootChange(nextRoot: string) {
    const s = this.settings;
    const next = nextRoot.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
    if (next === s.root) return { moved: 0, kept: 0 };
    const before = pathsFromRoot(s.root);
    const after = pathsFromRoot(next);
    let moved = 0, kept = 0;
    s.root = next;
    PATH_KEYS.forEach((k) => {
      if (s[k] === before[k]) { s[k] = after[k]; moved++; } else kept++;
    });
    await this.saveSettings();
    await this.store.ensureVault();      // 立刻把新目录建出来，不用等重启
    return { moved, kept };
  }

  /** 把六项强制对齐到根目录（用户把路径改乱之后的修复入口） */
  async alignPathsToRoot() {
    const s = this.settings;
    Object.assign(s, pathsFromRoot(s.root));
    await this.saveSettings();
    await this.store.ensureVault();
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
      name, desc, control: { type: "text", key, placeholder: dflt, defaultValue: dflt },
    });
    const pick = (
      key: "defaultPeriod" | "autoSyncMin" | "autoPushMin" | "theme",
      name: string, desc: string, options: Record<string, string>,
    ): SettingDefinition => ({ name, desc, control: { type: "dropdown", key, options } });
    const every = { "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "1 小时" };
    const d = DEFAULTS;

    return [
      pick("theme", "主题", "跟随 Obsidian，或强制深色/浅色。主界面右上角也能切。",
        { auto: "跟随 Obsidian", dark: "深色", light: "浅色" }),
      {
        type: "group", heading: "目录",
        items: [
          text("root", "根目录", "下面六项默认都放在这个目录下；留空表示直接用库的根目录。改这里会一起更新它们，单独改过的那项不会被覆盖。", d.root),
          text("tasksFolder", "任务目录", "一个项目一个文件，## 小节是里程碑，任务一行一条。", d.tasksFolder),
          text("teamFolder", "人员目录", "一人一个文件，frontmatter 写 role / capacity / days / skills。", d.teamFolder),
          text("feedsFolder", "消息源目录", "一个源一个文件，正文列表一行一条消息。", d.feedsFolder),
          text("logsFolder", "记录目录", "按月一个文件，正文用 ## 日期 分节。", d.logsFolder),
          text("ideasFile", "随手记文件", "单文件，一行一条。", d.ideasFile),
          text("tagsFile", "标签库文件", "单文件，一行一个标签。", d.tagsFile),
        ],
      },
      {
        type: "group", heading: "口径",
        items: [
          pick("defaultPeriod", "默认占比周期", "占比与饱和度的默认口径，界面上随时可切。",
            { w: "本周", m: "本月", q: "本季度" }),
        ],
      },
      {
        type: "group", heading: "消息服务",
        items: [
          text("hubPublish", "发布服务地址", "把「我发布的源」推到这里。发布端与订阅端可以是同一个地址。", d.hubPublish),
          text("hubSync", "拉取服务地址", "从这里同步订阅的源。留空则完全离线，只用库内 Markdown。", d.hubSync),
          pick("autoSyncMin", "自动同步间隔", "按这个间隔自动拉取订阅的源。", every),
          pick("autoPushMin", "自动推送间隔", "按这个间隔把我发布的源推上去。", every),
        ],
      },
      {
        type: "group", heading: "维护",
        items: [
          { name: "推送到发布服务", desc: "立刻把所有「我发布的源」推一遍。", action: () => { void this.plugin.publishAll(); } },
          { name: "从拉取服务同步", desc: "立刻拉取一次订阅的源。", action: () => { void this.plugin.syncAll(); } },
          { name: "生成示例数据", desc: "在目录里写一份最小可用的样例，已存在的不覆盖。", action: () => { void this.plugin.seedDemo(); } },
        ],
      },
    ];
  }

  /** 声明式界面改完值之后的副作用（主题要立刻应用） */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "root") {
      const r = await this.plugin.applyRootChange(asText(value));
      new Notice(r.kept
        ? `根目录已更新，${r.kept} 项自定义路径保持不变`
        : "根目录已更新");
      this.renderSettings();
      return;
    }
    const bag = this.plugin.settings as unknown as Record<string, unknown>;
    bag[key] = value;
    await this.plugin.saveSettings();
    if (key === "theme") this.plugin.applyTheme();
    // 改了目录就顺手把新目录建出来
    if ((PATH_KEYS as readonly string[]).includes(key)) await this.plugin.store.ensureVault();
  }

  /** 老版本客户端（< 1.13）只认 display()，转发到 renderSettings 以便内部重建这一页 */
  display() { this.renderSettings(); }

  renderSettings() {
    const { containerEl } = this;
    containerEl.empty();
    const p = this.plugin;

    // 通用项：不加标题，放最上面
    new Setting(containerEl)
      .setName("主题")
      .setDesc("跟随 Obsidian，或强制深色/浅色。主界面右上角的按钮也能切。")
      .addDropdown((d) =>
        d.addOptions({ auto: "跟随 Obsidian", dark: "深色", light: "浅色" })
          .setValue(p.settings.theme)
          .onChange((v) => {
            p.settings.theme = v as ThemeMode;
            p.applyTheme();
            void p.saveSettings();
          })
      );

    /* ---------- 目录 ---------- */
    new Setting(containerEl).setName("目录").setHeading();
    const d = DEFAULTS;
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "插件只读这几个目录，不扫全库，也不和别的任务插件共用文件。目录不存在会自动创建；路径改完会重新扫描一次，原来的文件不会搬也不会删。",
    });
    new Setting(containerEl)
      .setName("根目录")
      .setDesc("下面六项默认都放在这个目录下；留空表示直接用库的根目录。改这里会一起更新它们，单独改过的那项不会被覆盖。")
      .addText((t) => {
        t.setPlaceholder(d.root).setValue(p.settings.root ?? d.root);
        const commit = () => {
          const next = t.inputEl.value.trim();
          if (next === p.settings.root) return;
          void (async () => {
            const r = await p.applyRootChange(next);
            new Notice(r.kept
              ? `根目录已更新，${r.kept} 项自定义路径保持不变`
              : `根目录已改为 ${next || "（库根目录）"}，目录已就位`);
            this.renderSettings();
          })();
        };
        t.inputEl.addEventListener("blur", commit);
        t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") t.inputEl.blur(); });
      });

    const folder = (name: PathKey, label: string, desc: string, dflt: string) =>
      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addText((t) => {
          t.setPlaceholder(dflt).setValue(p.settings[name]);
          // 路径不逐字保存（每敲一个字就重扫一遍库），失焦或回车才落盘
          const commit = () => {
            const v = t.inputEl.value.trim();
            if (v === p.settings[name]) return;
            p.settings[name] = v;
            void p.saveSettings().then(() => p.store.ensureVault());
            new Notice("目录已更新");
          };
          t.inputEl.addEventListener("blur", commit);
          t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") t.inputEl.blur(); });
        });
    folder("tasksFolder", "任务目录", "一个项目一个文件，## 小节是里程碑，任务一行一条。", d.tasksFolder);
    folder("teamFolder", "人员目录", "一人一个文件，frontmatter 写 role / capacity / days / skills。", d.teamFolder);
    folder("feedsFolder", "消息源目录", "一个源一个文件，正文列表一行一条消息。", d.feedsFolder);
    folder("logsFolder", "记录目录", "按月一个文件，正文用 ## 日期 分节。", d.logsFolder);
    folder("ideasFile", "随手记文件", "单文件，一行一条。", d.ideasFile);
    folder("tagsFile", "标签库文件", "单文件，一行一个标签。", d.tagsFile);

    /* ---------- 口径 ---------- */
    new Setting(containerEl).setName("口径").setHeading();
    new Setting(containerEl)
      .setName("默认占比周期")
      .setDesc("占比与饱和度的默认口径，界面上随时可切。")
      .addDropdown((dd) =>
        dd.addOptions({ w: "本周", m: "本月", q: "本季度" })
          .setValue(p.settings.defaultPeriod)
          .onChange((v) => {
            p.settings.defaultPeriod = v as Period;
            void p.saveSettings();
          })
      );

    /* ---------- 消息服务 ---------- */
    new Setting(containerEl).setName("消息服务").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "服务是可选的：不填就完全离线，只用库内的 Markdown。发布端与订阅端可以是同一个地址（仓库里的 services-py 就是同进程同端口）。",
    });
    const intervals = { "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "1 小时" };
    folder("hubPublish", "发布服务地址", "把「我发布的源」推到这里。", d.hubPublish);
    folder("hubSync", "拉取服务地址", "从这里同步订阅的源。", d.hubSync);
    new Setting(containerEl)
      .setName("自动同步间隔")
      .setDesc("按这个间隔自动拉取订阅的源。")
      .addDropdown((dd) =>
        dd.addOptions(intervals).setValue(String(p.settings.autoSyncMin))
          .onChange((v) => { p.settings.autoSyncMin = Number(v); void p.saveSettings(); })
      );
    new Setting(containerEl)
      .setName("自动推送间隔")
      .setDesc("按这个间隔把我发布的源推上去。")
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
    new Setting(containerEl).setName("维护").setHeading();
    new Setting(containerEl)
      .setName("按根目录重排六个路径")
      .setDesc("把下面六项重新对齐到当前根目录。路径被改乱、或改了根目录后没跟上时用这个；会覆盖你单独设过的路径。")
      .addButton((b) => b.setButtonText("重排").onClick(() => {
        void (async () => {
          await p.alignPathsToRoot();
          new Notice("六个路径已按根目录重排，目录已就位");
          this.renderSettings();
        })();
      }));
    new Setting(containerEl)
      .setName("生成示例数据")
      .setDesc("写一份**虚构**的样例（人名和项目都是编的），方便先看界面。已存在的文件不覆盖。")
      .addButton((b) => b.setButtonText("生成").onClick(() => { void p.seedDemo(); }));
    const store = p.store;
    new Setting(containerEl)
      .setName("当前读取")
      .setDesc(`${store.tasks.length} 条任务 · ${store.logs.length} 条记录 · ${store.staff.length} 位成员 · ${store.feeds.length} 个源（${store.feeds.reduce((n, f) => n + f.items.length, 0)} 条消息）· ${store.ideas.length} 条随手记`);
  }

  /** 一次性把两个地址都测一遍，结果合并成一条提示 */
  private async testBoth(): Promise<void> {
    const okPublish = await this.plugin.pingHub("publish", true);
    const okSync = await this.plugin.pingHub("sync", true);
    new Notice(`发布服务${okPublish ? "正常" : "连不上"} · 拉取服务${okSync ? "正常" : "连不上"}`);
  }
}
