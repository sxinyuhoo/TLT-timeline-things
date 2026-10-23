import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, TFile, normalizePath } from "obsidian";
import { Store, TLTSettings, DEFAULT_SETTINGS } from "./store";
import { WorkbenchView, VIEW_TYPE_WORKBENCH } from "./views/workbench";
import { MessagesView, VIEW_TYPE_MESSAGES } from "./views/messages";
import { QuickTaskModal } from "./views/modals";
import { todayISO } from "./data";

type ThemeMode = "auto" | "light" | "dark";

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

export default class TLTPlugin extends Plugin {
  settings: Settings;
  store: Store;
  private hub = { publish: "", sync: "", lastSync: "", lastResult: "", lastError: "" };

  async onload() {
    await this.loadSettings();
    this.store = new Store(this.app, this.settings);

    this.registerView(VIEW_TYPE_WORKBENCH, (leaf: WorkspaceLeaf) => new WorkbenchView(leaf, this));
    this.registerView(VIEW_TYPE_MESSAGES, (leaf: WorkspaceLeaf) => new MessagesView(leaf, this));

    this.addRibbonIcon("activity", "时间线工作台", () => this.activateWorkbench());

    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => this.activateWorkbench() });
    this.addCommand({ id: "open-messages", name: "打开消息中心（独立页）", callback: () => this.activateMessages() });
    this.addCommand({ id: "new-task", name: "新建任务", callback: () => new QuickTaskModal(this.app, this.store, () => this.refreshAll()).open() });
    this.addCommand({ id: "seed-demo", name: "生成示例数据", callback: () => this.seedDemo() });
    this.addCommand({ id: "toggle-theme", name: "切换明暗", callback: () => this.toggleTheme() });
    this.addCommand({ id: "hub-publish", name: "推送到发布服务", callback: () => this.publishAll() });
    this.addCommand({ id: "hub-sync", name: "从拉取服务同步", callback: () => this.syncAll() });

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
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
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
    this.saveData(this.settings);
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
    } catch (e: any) {
      this.setHubState({ lastError: "推送失败：" + e.message });
      new Notice("推送失败：" + e.message);
    }
  }

  async syncAll(silent = false) {
    try {
      const r = await this.store.pullFromHub(this.settings.hubSync);
      const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      this.setHubState({ lastSync: stamp, lastResult: `新增 ${r.added} 条`, lastError: "" });
      if (!silent) new Notice(`同步完成：新增 ${r.added} 条`);
      this.refreshAll();
    } catch (e: any) {
      this.setHubState({ lastError: "同步失败：" + e.message });
      new Notice("同步失败：" + e.message);
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
    workspace.revealLeaf(leaf);
  }

  async activateMessages() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MESSAGES)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MESSAGES, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshAll() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKBENCH).forEach((l) => (l.view as WorkbenchView).render());
    this.app.workspace.getLeavesOfType(VIEW_TYPE_MESSAGES).forEach((l) => (l.view as MessagesView).render());
  }

  /* ---------- 示例数据 ---------- */

  async seedDemo() {
    const s = this.store.settings;
    await this.store.ensureVault();
    const w = async (path: string, content: string) => {
      const p = normalizePath(path);
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) return;
      await this.app.vault.create(p, content);
    };

    await w(`${s.teamFolder}/我.md`, `---\ntlt: staff\nrole: 实验室负责人\ncapacity: 100\ndays: 5\nskills: [决策, 算法]\nstatus: active\n---\n`);
    await w(`${s.teamFolder}/许可儿.md`, `---\ntlt: staff\nrole: 算法工程师\ncapacity: 100\ndays: 5\nskills: [评测, 数据集]\nstatus: active\n---\n`);
    await w(`${s.teamFolder}/刘戎阳.md`, `---\ntlt: staff\nrole: 算法工程师\ncapacity: 90\ndays: 5\nskills: [交通仿真, 接口]\nstatus: active\n---\n`);

    const d = todayISO();
    await w(`${s.tasksFolder}/千数万问.md`, `# 千数万问

## V0.7.4 月报

- [ ] 月报定稿 🛫 ${d} 📅 ${d} [est:: 1.5] [pri:: 2] [owner:: [[我]]]
  - [ ] 汇总 10 月场景数据
  - [ ] 与胡昕宇对口径

## 10 月场景推广

- [ ] 湖南 / 江苏 kickoff 📅 ${d} [est:: 0.5] [owner:: [[我]]]
`);
    await w(`${s.tasksFolder}/TRC 论文.md`, `# TRC 论文

## L0 基准与实验

- [ ] L0 基准评测 · 数据集构建 🛫 ${d} 📅 ${d} [est:: 6] [pw:: q] [owner:: [[许可儿]]]
  - [ ] 抽 50 条做人工校验
  - [ ] 冻结 benchmark 脚本
`);
    await w(`${s.feedsFolder}/我的工作动态.md`, `---
title: 我的工作动态
owner: me
mine: true
cadence: 随手发
desc: 我发布给组里看的进展与结论
---

# 我的工作动态

- ${d} 抽检口径 V2 已定稿 [kind:: note] [place:: 会议室] [star:: true]
  > 三处差异写进 V2，周五前按新口径重跑。
`);
    await w(`${s.feedsFolder}/部门消息通知.md`, `---
title: 部门消息通知
owner: 孙晙书
cadence: 每周 2–3 条
desc: 宣贯、团建、制度变更、值班安排
---

# 部门消息通知

- ${d} 部门宣贯：四季度安全与合规要求 [kind:: ask] [place:: 三楼会议室] [state:: live]
  > 领导要求本周内完成，覆盖全员，保留签到记录。
`);
    await w(s.logsFolder + `/${d.slice(0, 7)}.md`, `# 记录 ${d.slice(0, 7)}

## ${d}

- 09:30–11:00 抽检口径核对 [proj:: 千数万问]
  > 和冠宇对了三处口径：表格跨页合并、公式回填、扫描页方向。
- 11:00–11:40 需求对齐会 [proj:: 千数万问] [extra:: true]
  > 被叫去对齐 POC 范围，周五前一页纸。
`);
    await w(s.ideasFile, `# 想法池

- 把抽检脚本做成通用回归工具 [type:: 工具] [stage:: 待验证] [star:: 2] [at:: ${d}] [src:: 抽检时]
  > 现在每次迭代都要人工抽 100 份，脚本散在各处。
- 空间检索的语法即护栏 [type:: 论文] [stage:: 沉淀] [star:: 3] [at:: ${d}] [src:: 写论文时]
`);

    await this.store.load();
    this.refreshAll();
    new Notice("示例数据已生成");
  }
}

class TLTSettingTab extends PluginSettingTab {
  plugin: TLTPlugin;
  constructor(app: App, plugin: TLTPlugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("目录与口径").setHeading();
    containerEl.createEl("p", {
      text: "插件不复用现有目录：任务、人员、消息源、记录都放在下面四个目录里（不存在会自动创建）。",
      cls: "setting-item-description",
    });

    const folder = (name: keyof TLTSettings, label: string, desc: string) =>
      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(typeof this.plugin.settings[name] === "string" ? (this.plugin.settings[name] as string) : "").onChange(async (v) => {
            (this.plugin.settings as any)[name] = v.trim();
            await this.plugin.saveSettings();
          })
        );

    folder("tasksFolder", "任务目录", "一个项目一个 md，里程碑用 ## 分节，任务一行一条");
    folder("teamFolder", "人员目录", "一人一个 md，frontmatter 写 role / capacity / days / skills");
    folder("feedsFolder", "消息源目录", "一源一个 md，正文列表里一行一条消息");
    folder("logsFolder", "记录目录", "按月一个文件，正文用 ## 日期 分节");
    folder("ideasFile", "想法文件", "单文件，一行一个想法");

    new Setting(containerEl)
      .setName("默认占比周期")
      .setDesc("任务占比与饱和度的默认口径")
      .addDropdown((d) =>
        d
          .addOptions({ w: "本周", m: "本月", q: "本季度" })
          .setValue(this.plugin.settings.defaultPeriod)
          .onChange(async (v) => {
            this.plugin.settings.defaultPeriod = v as any;
            await this.plugin.saveSettings();
          })
      );

    folder("hubPublish" as any, "发布服务地址", "把「我发布的源」推到这里（测试：http://127.0.0.1:8787）");
    folder("hubSync" as any, "拉取服务地址", "从订阅代理同步别人的源（测试：http://127.0.0.1:8788）");

    new Setting(containerEl)
      .setName("自动同步间隔")
      .setDesc("从拉取服务同步别人的源")
      .addDropdown((d) =>
        d.addOptions({ "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "1 小时" })
          .setValue(String(this.plugin.settings.autoSyncMin))
          .onChange(async (v) => { this.plugin.settings.autoSyncMin = Number(v); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("自动推送间隔")
      .setDesc("把我发布的源推到发布服务")
      .addDropdown((d) =>
        d.addOptions({ "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "1 小时" })
          .setValue(String(this.plugin.settings.autoPushMin))
          .onChange(async (v) => { this.plugin.settings.autoPushMin = Number(v); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("主题")
      .setDesc("跟随 Obsidian，或强制深/浅色")
      .addDropdown((d) =>
        d
          .addOptions({ auto: "跟随 Obsidian", dark: "深色", light: "浅色" })
          .setValue(this.plugin.settings.theme)
          .onChange(async (v) => {
            this.plugin.settings.theme = v as ThemeMode;
            this.plugin.applyTheme();
            await this.plugin.saveSettings();
          })
      );

    const s = this.plugin.store;
    new Setting(containerEl).setName("当前读取").setHeading();
    containerEl.createEl("p", {
      text: `${s.tasks.length} 条任务 · ${s.logs.length} 条记录 · ${s.staff.length} 位成员 · ${s.feeds.length} 个源（${s.feeds.reduce((n, f) => n + f.items.length, 0)} 条消息）· ${s.ideas.length} 条想法`,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("生成示例数据")
      .setDesc("在四个目录里写一份最小可用的样例，方便先看效果")
      .addButton((b) => b.setButtonText("生成").onClick(async () => { await this.plugin.seedDemo(); this.display(); }));
  }
}
