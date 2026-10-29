import { App } from "obsidian";
import { TltModal, el, ConfirmModal } from "./modals";

export { ConfirmModal };
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
      else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); this.commit(); }
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
