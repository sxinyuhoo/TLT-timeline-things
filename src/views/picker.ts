import { App } from "obsidian";
import { TltModal, el } from "./modals";
import { t as T } from "../i18n";

/**
 * 一个可搜索、可上下键选择、回车确认的列表弹窗。
 * 这是 QuickAdd 那种 suggester 的原生替代品：命令面板触发 → 打字过滤 → 回车选中。
 */
export interface PickItem<T> {
  label: string;
  hint?: string;
  value: T;
}

export class PickerModal<T> extends TltModal {
  title: string;
  items: PickItem<T>[];
  placeholder: string;
  onPick: (v: T | null) => void | Promise<void>;
  private cursor = 0;
  private shown: PickItem<T>[] = [];
  private listEl!: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(app: App, title: string, items: PickItem<T>[], placeholder: string, onPick: (v: T | null) => void | Promise<void>) {
    super(app);
    this.title = title;
    this.items = items;
    this.placeholder = placeholder;
    this.onPick = onPick;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.title));

    const input = el("input", "tlt-input wide tlt-picksearch");
    input.placeholder = this.placeholder || T("输入关键字过滤");
    this.inputEl = input;
    contentEl.appendChild(input);

    const list = el("div", "tlt-picklist big");
    this.listEl = list;
    contentEl.appendChild(list);

    const hint = el("div", "tlt-hint", T("↑↓ 选择 · 回车确认 · Esc 取消"));
    contentEl.appendChild(hint);

    input.oninput = () => { this.cursor = 0; this.draw(); };
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); this.commit(); }
      else if (e.key === "Escape") { e.preventDefault(); this.finish(null); }
    });
    this.draw();
    window.setTimeout(() => input.focus(), 40);
  }

  private move(d: number) {
    if (!this.shown.length) return;
    this.cursor = (this.cursor + d + this.shown.length) % this.shown.length;
    this.draw();
  }

  private commit() {
    const it = this.shown[this.cursor];
    if (!it) return;
    this.finish(it.value);
  }

  private finish(v: T | null) {
    this.close();
    void this.onPick(v);
  }

  private draw() {
    const q = this.inputEl.value.trim().toLowerCase();
    this.shown = !q
      ? this.items
      : this.items.filter((i) => `${i.label} ${i.hint || ""}`.toLowerCase().includes(q));
    if (this.cursor >= this.shown.length) this.cursor = Math.max(0, this.shown.length - 1);
    this.listEl.empty();
    if (!this.shown.length) {
      this.listEl.appendChild(el("div", "tlt-hint", T("没有匹配项")));
      return;
    }
    this.shown.forEach((it, idx) => {
      const r = el("div", "tlt-pickrow" + (idx === this.cursor ? " on" : ""));
      r.appendChild(el("span", "tlt-pickname", it.label));
      if (it.hint) r.appendChild(el("span", "tlt-pickrole", it.hint));
      r.onclick = () => this.finish(it.value);
      r.onmouseenter = () => { this.cursor = idx; this.mark(); };
      this.listEl.appendChild(r);
    });
  }

  private mark() {
    Array.from(this.listEl.children).forEach((c, i) => c.classList.toggle("on", i === this.cursor));
  }

  onClose() { this.contentEl.empty(); }
}

/** 只有两个出口的确认框：确认 / 取消 */
export class ConfirmModal extends TltModal {
  titleText: string;
  body: string;
  okText: string;
  danger: boolean;
  onDone: (ok: boolean) => void | Promise<void>;

  constructor(app: App, opts: { title: string; body: string; ok?: string; danger?: boolean }, onDone: (ok: boolean) => void | Promise<void>) {
    super(app);
    this.titleText = opts.title;
    this.body = opts.body;
    this.okText = opts.ok || T("确认");
    this.danger = opts.danger !== false;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.titleText));
    const b = el("div", "tlt-confirm-body");
    this.body.split("\n").forEach((ln) => b.appendChild(el("div", "", ln)));
    contentEl.appendChild(b);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", T("取消"));
    cancel.onclick = () => this.finish(false);
    const ok = el("button", "tlt-btn " + (this.danger ? "danger" : "pri"), this.okText);
    ok.onclick = () => this.finish(true);
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => ok.focus(), 40);
  }

  private finish(ok: boolean) {
    this.close();
    void this.onDone(ok);
  }

  onClose() { this.contentEl.empty(); }
}
