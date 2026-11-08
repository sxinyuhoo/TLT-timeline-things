import { App, Component, MarkdownRenderer } from "obsidian";
import { t as T } from "../i18n";
import { toggleMdCheckbox } from "../data";

/**
 * 统一的 Markdown 字段：**默认预览，可切到编辑（源代码）**——和 GitLab 的编辑体验一致。
 *
 * - 预览用 Obsidian 自己的渲染器（`MarkdownRenderer.render`），所以加粗、斜体、行内代码、
 *   引用、列表、任务清单、表格、`[[双链]]`、`![[嵌入]]` 全部和笔记里一模一样；
 * - `sourcePath` 传这个字段所属文件的路径，相对链接 / 图片才能解析；
 * - 预览里的任务清单可以**直接点**：翻转后写回文本框（保存时一起落盘）；
 * - 只读场景（预览浮层等）传 `readOnly: true`，就只有一个渲染出来的预览。
 */
export type MdFieldOpts = {
  value: string;
  /** 字段所属文件的路径（渲染时的 sourcePath） */
  sourcePath: string;
  label?: string;
  placeholder?: string;
  /** 值变化（含在预览里勾选待办）时回调 */
  onChange?: (v: string) => void;
  readOnly?: boolean;
  /** 编辑框最小高度（px） */
  minHeight?: number;
};

export class MarkdownField {
  readonly el: HTMLElement;
  private app: App;
  private opts: MdFieldOpts;
  private head: HTMLElement;
  private preview: HTMLElement;
  private ta: HTMLTextAreaElement;
  private modeBtn: HTMLButtonElement | null = null;
  private comp = new Component();
  private editing = false;

  constructor(app: App, opts: MdFieldOpts) {
    this.app = app;
    this.opts = opts;

    this.el = createDiv({ cls: "tlt-mdf" });

    this.head = this.el.createDiv({ cls: "tlt-mdf-h" });
    if (opts.label) this.head.createSpan({ cls: "tlt-mdf-l", text: opts.label });
    const tail = this.head.createSpan({ cls: "tlt-mdf-tail" });
    if (!opts.readOnly) {
      const btn = tail.createEl("button", { cls: "tlt-btn tiny", text: T("编辑") });
      btn.type = "button";
      btn.onclick = () => this.setMode(!this.editing);
      this.modeBtn = btn;
    }

    this.preview = this.el.createDiv({ cls: "tlt-mdf-prev markdown-rendered" });

    this.ta = this.el.createEl("textarea", { cls: "tlt-mdf-ta" });
    this.ta.value = opts.value;
    this.ta.placeholder = opts.placeholder ?? "";
    if (opts.minHeight) this.ta.style.minHeight = `${opts.minHeight}px`;
    this.ta.addEventListener("input", () => this.emit());
    this.el.appendChild(this.ta);

    this.comp.load();
    // 有内容就先给预览；空的（新建）直接进编辑，省一次点击
    this.setMode(!opts.value.trim() && !opts.readOnly);
  }

  get value(): string {
    return this.ta.value;
  }

  set value(v: string) {
    this.ta.value = v ?? "";
    if (!this.editing) void this.paint();
  }

  /** 失焦前把编辑框里的内容同步回值（保存方一般直接读 value） */
  focus() { this.ta.focus(); }

  destroy() {
    try { this.comp.unload(); } catch { /* 组件已卸载也不影响关闭 */ }
  }

  private emit() {
    this.opts.onChange?.(this.ta.value);
  }

  private setMode(edit: boolean) {
    this.editing = edit;
    if (this.modeBtn) this.modeBtn.textContent = edit ? T("预览") : T("编辑");
    if (edit) {
      this.preview.addClass("tlt-hidden");
      this.ta.removeClass("tlt-hidden");
      this.ta.focus();
    } else {
      this.ta.addClass("tlt-hidden");
      this.preview.removeClass("tlt-hidden");
      void this.paint();
    }
  }

  private async paint() {
    this.preview.empty();
    const md = this.ta.value;
    if (!md.trim()) {
      this.preview.createDiv({
        cls: "tlt-hint",
        text: this.opts.readOnly ? T("（空）") : T("还没写内容，点「编辑」写点什么"),
      });
      return;
    }
    await MarkdownRenderer.render(this.app, md, this.preview, this.opts.sourcePath, this.comp);
    // 预览里的任务清单可以直接点：翻转后写回编辑框
    if (this.opts.readOnly) return;
    this.preview.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb, i) => {
      cb.removeAttribute("disabled");
      cb.onclick = (ev) => {
        ev.preventDefault();
        const next = toggleMdCheckbox(this.ta.value, i);
        if (next === this.ta.value) return;
        this.ta.value = next;
        this.emit();
        void this.paint();
      };
    });
  }
}
