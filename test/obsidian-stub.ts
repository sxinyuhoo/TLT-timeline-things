/** 测试用 obsidian 桩件：只实现被 TLT 用到的部分 */
export class TFile {
  path = ""; basename = ""; name = ""; extension = "md";
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() || path;
    this.basename = this.name.replace(/\.md$/, "");
  }
}
export class TFolder { path = ""; constructor(p = "") { this.path = p; } }

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
}
export function setIcon() {}
export function debounce<T extends Function>(fn: T) { return fn; }

export class ItemView {
  app: any; leaf: any;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(leaf: any) {
    this.leaf = leaf;
    this.app = leaf?.app ?? (globalThis as any).__app;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
    document.body.appendChild(this.containerEl);
  }
  getViewType() { return ""; }
  getDisplayText() { return ""; }
  getIcon() { return ""; }
  async onOpen() {}
  async onClose() {}
}

export class Plugin {
  app: any; manifest: any;
  constructor(app?: any, manifest?: any) { this.app = app; this.manifest = manifest; }
  async loadData() { return {}; }
  async saveData(_d: any) {}
  registerView(_t: string, _f: any) {}
  registerEvent(_e: any) {}
  addRibbonIcon() { return document.createElement("div"); }
  addCommand(_c: any) {}
  addSettingTab(_t: any) {}
}

export class Modal {
  app: any;
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  constructor(app: any) {
    this.app = app;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
    document.body.appendChild(this.containerEl);
  }
  open() { (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); this.containerEl.remove(); }
}

export class Notice { constructor(public message: string) { (globalThis as any).__notices?.push(message); } }

export class PluginSettingTab { app: any; containerEl: HTMLElement; constructor(app: any) { this.app = app; this.containerEl = document.createElement("div"); } }
export class Setting {
  constructor(_c: HTMLElement) {}
  setName() { return this; } setDesc() { return this; }
  addText() { return this; } addDropdown() { return this; }
  addButton() { return this; } addToggle() { return this; }
}
