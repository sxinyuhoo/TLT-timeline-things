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

export function getLanguage(): string { return "zh"; }

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
}
/** 桩件版的 setIcon：真的往元素里塞一个 <svg>，测试才能断言"图标在不在" */
export function setIcon(el: { empty?: () => void; appendChild?: (n: unknown) => void; createSvg?: (t: string) => unknown; ownerDocument?: Document }, id: string) {
  const doc = (el && el.ownerDocument) || (typeof document !== "undefined" ? document : undefined);
  if (!doc || !el || typeof el.appendChild !== "function") return;
  if (typeof el.empty === "function") el.empty();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-icon", id);
  el.appendChild(svg);
}
export function debounce<T extends Function>(fn: T) { return fn; }

export const registeredIcons: string[] = [];
export function addIcon(id: string, _svg: string) { registeredIcons.push(id); }

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
  /** Obsidian 的 Component.registerDomEvent：真挂监听，卸载时摘掉（视图里用它绑按键） */
  private _cleanups: (() => void)[] = [];
  registerDomEvent(target: any, type: string, cb: (ev: any) => void, opts?: any) {
    target.addEventListener(type, cb, opts);
    this._cleanups.push(() => target.removeEventListener(type, cb, opts));
  }
  register(cb: () => void) { this._cleanups.push(cb); }
  unload() { this._cleanups.forEach((f) => f()); this._cleanups = []; }
}

export class Plugin {
  app: any; manifest: any;
  constructor(app?: any, manifest?: any) { this.app = app; this.manifest = manifest; }
  async loadData() { return {}; }
  async saveData(_d: any) {}
  registerView(_t: string, _f: any) {}
  /** 记录代码块处理器，供冒烟测试直接调用 */
  codeBlocks: { lang: string; fn: any }[] = [];
  registerMarkdownCodeBlockProcessor(lang: string, fn: any) { this.codeBlocks.push({ lang, fn }); }
  registerEvent(_e: any) {}
  addRibbonIcon() { return document.createElement("div"); }
  commands: any[] = [];
  addCommand(c: any) { this.commands.push(c); }
  addSettingTab(_t: any) {}
  registerInterval(id: number) { return id; }
  registerDomEvent(_el: any, _type: string, _cb: any) {}
  register(_cb: any) {}
}

export class Modal {
  app: any;
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  constructor(app: any) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal";
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.modalEl);
    document.body.appendChild(this.containerEl);
  }
  open() { (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); this.containerEl.remove(); }
}

export class Notice { constructor(public message: string) { (globalThis as any).__notices?.push(message); } }

export class PluginSettingTab { app: any; containerEl: HTMLElement; constructor(app: any) { this.app = app; this.containerEl = document.createElement("div"); } }
/* ---- 组件：够测试断言结构用 ---- */
class TextComponent {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    parent.appendChild(this.inputEl);
  }
  setValue(v: string) { this.inputEl.value = v; return this; }
  setPlaceholder(v: string) { this.inputEl.placeholder = v; return this; }
  onChange(cb: (v: string) => unknown) {
    this.inputEl.addEventListener("change", () => cb(this.inputEl.value));
    return this;
  }
  setDisabled() { return this; }
}

class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.selectEl = document.createElement("select");
    parent.appendChild(this.selectEl);
  }
  addOption(value: string, label: string) {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    this.selectEl.appendChild(o);
    return this;
  }
  addOptions(map: Record<string, string>) {
    Object.entries(map).forEach(([v, l]) => this.addOption(v, l));
    return this;
  }
  setValue(v: string) { this.selectEl.value = v; return this; }
  onChange(cb: (v: string) => unknown) {
    this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
    return this;
  }
}

class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) {
    this.buttonEl = document.createElement("button");
    parent.appendChild(this.buttonEl);
  }
  setButtonText(t: string) { this.buttonEl.textContent = t; return this; }
  setCta() { return this; }
  setTooltip() { return this; }
  setDisabled() { return this; }
  onClick(cb: () => unknown) {
    this.buttonEl.addEventListener("click", () => { void cb(); });
    return this;
  }
}

class ToggleComponent {
  toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.toggleEl = document.createElement("input");
    this.toggleEl.type = "checkbox";
    parent.appendChild(this.toggleEl);
  }
  setValue(v: boolean) { this.toggleEl.checked = v; return this; }
  onChange(cb: (v: boolean) => unknown) {
    this.toggleEl.addEventListener("change", () => cb(this.toggleEl.checked));
    return this;
  }
}

/** 真实渲染的 Setting：测试要能读结构（名称 / 说明 / 分节 / 控件） */
export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.settingEl.className = "setting-item";
    this.infoEl = document.createElement("div");
    this.infoEl.className = "setting-item-info";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "setting-item-name";
    this.descEl = document.createElement("div");
    this.descEl.className = "setting-item-description";
    this.infoEl.append(this.nameEl, this.descEl);
    this.controlEl = document.createElement("div");
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(this.infoEl, this.controlEl);
    container.appendChild(this.settingEl);
  }

  setName(t: string) { this.nameEl.textContent = t; return this; }
  setDesc(t: string) { this.descEl.textContent = t; return this; }
  setHeading() {
    this.settingEl.classList.add("setting-item-heading");
    this.descEl.remove();
    this.controlEl.remove();
    return this;
  }
  setClass(c: string) { this.settingEl.classList.add(c); return this; }
  setDisabled(_v: boolean) { return this; }
  addText(cb: (c: TextComponent) => unknown) {
    const c = new TextComponent(this.controlEl);
    cb(c);
    return this;
  }
  addDropdown(cb: (c: DropdownComponent) => unknown) {
    const c = new DropdownComponent(this.controlEl);
    cb(c);
    return this;
  }
  addButton(cb: (c: ButtonComponent) => unknown) {
    const c = new ButtonComponent(this.controlEl);
    cb(c);
    return this;
  }
  addToggle(cb: (c: ToggleComponent) => unknown) {
    const c = new ToggleComponent(this.controlEl);
    cb(c);
    return this;
  }
}

/** 测试里用 Node 的 fetch 代打 requestUrl */
export async function requestUrl(req: any): Promise<any> {
  const res = await fetch(req.url, {
    method: req.method || "GET",
    headers: req.contentType ? { "content-type": req.contentType } : undefined,
    body: req.body,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: text ? JSON.parse(text) : null,
  };
}


/** 测试用的 Markdown 渲染桩：够用的极简渲染（加粗/斜体/行内代码/引用/清单/勾选/双链） */
export const MarkdownRenderer = {
  render: (_app: unknown, md: string, el: HTMLElement, _path?: string, _comp?: unknown) => {
    el.empty();
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (x: string) => esc(x)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[\[([^\]]+)\]\]/g, '<a class="internal-link">$1</a>');
    let list: HTMLElement | null = null;
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      const task = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line);
      if (task) {
        if (!list) { list = document.createElement("ul"); el.appendChild(list); }
        const li = document.createElement("li");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        if (task[1].toLowerCase() === "x") cb.checked = true;
        cb.disabled = true;
        li.innerHTML = inline(task[2]);
        li.insertBefore(cb, li.firstChild);
        list.appendChild(li);
        continue;
      }
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) { list = document.createElement("ul"); el.appendChild(list); }
        const li = document.createElement("li");
        li.innerHTML = inline(bullet[1]);
        list.appendChild(li);
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) {
        const bq = document.createElement("blockquote");
        bq.innerHTML = inline(quote[1]);
        el.appendChild(bq);
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const hd = document.createElement(`h${h[1].length}`);
        hd.innerHTML = inline(h[2]);
        el.appendChild(hd);
        continue;
      }
      const p = document.createElement("p");
      p.innerHTML = inline(line);
      el.appendChild(p);
    }
    return Promise.resolve();
  },
};

/** 最小 Component 桩：MarkdownField 会 load/unload 它，渲染桩本身不用它 */
export class Component {
  onload() { /* noop */ }
  onunload() { /* noop */ }
  load() { this.onload(); return this; }
  unload() { this.onunload(); }
  registerEvent() { /* noop */ }
  registerInterval() { /* noop */ }
  addChild() { /* noop */ }
}
