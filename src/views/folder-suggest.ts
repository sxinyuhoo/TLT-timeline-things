import { App, TFolder } from "obsidian";

/**
 * 目录输入框的补全（命令式设置页用；1.13+ 的声明式设置用官方 `type: "folder"` 控件）。
 *
 * 行为对齐常见插件：边打边出候选，Tab / 回车 / 点击选中，Esc 关闭；
 * 候选只列**已存在**的目录——不存在的路径直接手打，点「更新」时再创建。
 */
export function attachFolderSuggest(app: App, input: HTMLInputElement): void {
  // 设置页可能开在独立窗口（popout）里：浮层必须挂到输入框自己那个 document，
  // 否则会被建到主窗口，用户在设置窗口里什么也看不到。
  const doc = input.ownerDocument;
  /** 在输入框所属窗口里建元素：先在主文档建，再 adoptNode 挪过去（设置页常开在独立窗口） */
  const adopt = <T extends Element>(el: T): T => (doc === document ? el : doc.adoptNode(el));
  const mkDiv = (cls: string, text?: string): HTMLElement => adopt(createDiv(text === undefined ? { cls } : { cls, text }));
  const pop = mkDiv("tlt-suggest tlt-hidden");
  doc.body.appendChild(pop);
  let items: string[] = [];
  let active = -1;
  let skipNextOpen = false;

  const close = () => {
    pop.addClass("tlt-hidden");
    pop.empty();          // 隐藏时也把上一批候选清掉，避免留下过期条目
    items = [];
    active = -1;
  };

  const paint = () => {
    pop.empty();
    items.forEach((p, i) => {
      const row = mkDiv("tlt-suggest-i" + (i === active ? " on" : ""), p);
      // mousedown 先于 blur：用 mousedown 才不会因为输入框失焦而点空
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(p);
      });
      pop.appendChild(row);
    });
    if (!items.length) close();
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.width = `${Math.max(r.width, 220)}px`;
  };

  const pick = (path: string) => {
    input.value = path;
    skipNextOpen = true;
    // 用输入框自己文档的 Event 构造器：Node 环境里全局 Event 是另一套，jsdom 会拒收
    const view = doc.defaultView;
    const Ctor = (view && view.Event) || Event;
    input.dispatchEvent(new Ctor("input", { bubbles: true }));     // 让上层的提交逻辑看到新值
    skipNextOpen = false;
    close();
    input.focus();
  };

  const open = () => {
    if (skipNextOpen) return;
    const raw = input.value.trim().replace(/\\/g, "/");
    const cut = raw.lastIndexOf("/");
    const prefix = cut >= 0 ? raw.slice(0, cut + 1) : "";
    const tail = (cut >= 0 ? raw.slice(cut + 1) : raw).toLowerCase();
    // 候选：前缀命中排前面（与常见插件的补全一致），其次是包含命中的
    const ranked: { p: string; rank: number }[] = [];
    const all = typeof app.vault.getAllLoadedFiles === "function" ? app.vault.getAllLoadedFiles() : [];
    for (const f of all) {
      if (!(f instanceof TFolder)) continue;
      const p = f.path;
      if (!p || p.startsWith(".") || p.includes("/.")) continue;
      if (!p.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const seg = p.slice(prefix.length).toLowerCase();
      if (!tail) ranked.push({ p, rank: 0 });
      else if (seg.startsWith(tail)) ranked.push({ p, rank: 0 });
      else if (seg.includes(tail)) ranked.push({ p, rank: 1 });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.p.localeCompare(b.p));
    items = ranked.slice(0, 8).map((x) => x.p);
    active = tail ? 0 : -1;                       // 手打了一段就把第一个当成默认候选
    if (!items.length) { close(); return; }
    paint();
    place();
    pop.removeClass("tlt-hidden");
  };

  input.addEventListener("input", open);
  input.addEventListener("focus", open);
  input.addEventListener("blur", () => { window.setTimeout(close, 120); });
  input.addEventListener("keydown", (e) => {
    if (pop.classList.contains("tlt-hidden")) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Tab" || e.key === "Enter") {
      if (active >= 0 && items[active]) { pick(items[active]); e.preventDefault(); }
      else close();
    } else if (e.key === "Escape") close();
  });
}
