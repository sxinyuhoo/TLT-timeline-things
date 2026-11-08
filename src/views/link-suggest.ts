import { App, TFile } from "obsidian";

/**
 * 文本域里的 `[[` / `![[` 文件补全。
 *
 * Obsidian 原生的 `[[` 补全只在自己的编辑器里（CodeMirror），普通 textarea 没有；
 * 这里复用同一套"数据源 + 候选浮层"的做法（和设置页的目录补全一致）：
 *   · 打 `[[` 或 `![[` 弹候选，继续打字按"文件名 + 路径"模糊过滤；
 *   · ↑↓ 选择、回车 / Tab 确认、Esc 关闭，鼠标点选（mousedown 防失焦）；
 *   · 选中后插入 `[[文件名]]`（`![[` 则插入 `![[文件名]]`），光标落在 `]]` 之后；
 *   · 已经打了 `|别名` 就不再弹（别名里不补全）；找不到匹配就不插入。
 */
export function attachLinkSuggest(app: App, ta: HTMLTextAreaElement): () => void {
  const doc = ta.ownerDocument;
  const adopt = <T extends Element>(el: T): T => (doc === document ? el : doc.adoptNode(el));
  const pop = adopt(createDiv({ cls: "tlt-suggest tlt-hidden" }));
  doc.body.appendChild(pop);

  type Hit = { file: TFile; score: number };
  let hits: Hit[] = [];
  let active = 0;
  let trigger = -1;            // `[[` 的起始位置
  let bang = false;            // 是不是 ![[
  let lastQ = "";              // 上一次的查询词（光标在同一段补全里动时不要重置高亮）
  let lastStart = -1;

  const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

  const files = (): TFile[] => {
    const v = app.vault as unknown as { getFiles?: () => TFile[]; getMarkdownFiles?: () => TFile[] };
    const all = v.getFiles?.() ?? v.getMarkdownFiles?.() ?? [];
    return all;
  };

  /** 简单打分：前缀 > 包含 > 子序列；同分按路径短→长 */
  const score = (name: string, path: string, q: string): number => {
    const n = name.toLowerCase();
    const p = path.toLowerCase();
    const s = q.toLowerCase();
    if (!s) return 1;
    if (n.startsWith(s)) return 100 - name.length;
    const i = n.indexOf(s);
    if (i >= 0) return 60 - i;
    if (p.includes(s)) return 30;
    // 子序列（cc → 常见缩写打法）
    let j = 0;
    for (const ch of n) { if (ch === s[j]) j++; if (j === s.length) break; }
    return j === s.length ? 10 : -1;
  };

  const close = () => {
    pop.addClass("tlt-hidden");
    pop.empty();
    hits = [];
    trigger = -1;
    lastQ = "";
    lastStart = -1;
  };

  /** 光标前是不是 `[[`（或 `![[`）触发的补全环境 */
  const probe = (): { start: number; q: string; bang: boolean } | null => {
    const pos = ta.selectionStart ?? 0;
    if (pos !== (ta.selectionEnd ?? 0)) return null;              // 选中一段时不弹
    const before = ta.value.slice(0, pos);
    const open = before.lastIndexOf("[[");
    if (open < 0) return null;
    const q = before.slice(open + 2);
    if (q.includes("]") || q.includes("\n") || q.includes("|")) return null;   // 已闭合 / 换行 / 在写别名
    const b = open > 0 && before[open - 1] === "!";
    return { start: b ? open - 1 : open, q, bang: b };
  };

  const paint = () => {
    pop.empty();
    const keepScroll = () => {
      const on = pop.querySelector<HTMLElement>(".tlt-suggest-i.on");
      // jsdom / 老环境没有 scrollIntoView：有就滚一下，没有就算了
      on?.scrollIntoView?.({ block: "nearest" });
    };
    hits.forEach((h, i) => {
      const row = adopt(createDiv({ cls: "tlt-suggest-i" + (i === active ? " on" : "") }));
      row.appendChild(adopt(createSpan({ text: h.file.basename })));
      row.appendChild(adopt(createSpan({ cls: "tlt-suggest-p", text: h.file.path })));
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      pop.appendChild(row);
    });
    if (!hits.length) { close(); return; }
    // 定位到输入框下方（textarea 内部光标位置拿不到，贴框下沿最稳）
    const r = ta.getBoundingClientRect();
    pop.style.left = `${Math.round(r.left)}px`;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    pop.style.minWidth = `${Math.max(200, Math.min(420, Math.round(r.width)))}px`;
    pop.removeClass("tlt-hidden");
    keepScroll();
  };

  const refresh = () => {
    const p = probe();
    if (!p) { close(); return; }
    // 同一段补全（`[[` 位置与查询词都没变）→ 保持当前高亮。
    // 不然方向键的 keyup 会再刷一次，把高亮打回第一条，看起来就是"上下键没用"。
    if (p.start === lastStart && p.q === lastQ && hits.length) { bang = p.bang; return; }
    trigger = p.start;
    bang = p.bang;
    lastStart = p.start;
    lastQ = p.q;
    const scored = files()
      .map((file) => ({ file, score: score(file.basename, file.path, p.q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => {
        if (bang) {                                                    // 嵌入：图片优先
          const ai = IMG.test(a.file.name) ? 1 : 0;
          const bi = IMG.test(b.file.name) ? 1 : 0;
          if (ai !== bi) return bi - ai;
        }
        if (b.score !== a.score) return b.score - a.score;
        return a.file.path.length - b.file.path.length;
      })
      .slice(0, 20);
    hits = scored;
    active = 0;
    paint();
  };

  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit || trigger < 0) { close(); return; }
    const pos = ta.selectionStart ?? 0;
    // 笔记用不带后缀的名字（[[报告模板]]）；图片等附件带上后缀（![[杆件编号.png]]）——和 Obsidian 自己的插入一致
    const name = hit.file.extension === "md" ? hit.file.basename : hit.file.name;
    const link = `${bang ? "!" : ""}[[${name}]]`;
    ta.value = ta.value.slice(0, trigger) + link + ta.value.slice(pos);
    const caret = trigger + link.length;
    ta.setSelectionRange(caret, caret);
    close();
    ta.dispatchEvent(new Event("input", { bubbles: true }));          // 让预览/保存跟着更新
    ta.focus();
  };

  const onInput = () => refresh();
  const onKey = (ev: KeyboardEvent) => {
    if (pop.hasClass("tlt-hidden")) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!hits.length) return;
      active = (active + (ev.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      paint();
      return;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
      ev.preventDefault();
      pick(active);
      return;
    }
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
  };
  const onBlur = () => window.setTimeout(close, 120);                 // 留时间给 mousedown 点选
  const onSel = () => { if (!pop.hasClass("tlt-hidden")) refresh(); };

  ta.addEventListener("input", onInput);
  ta.addEventListener("keydown", onKey);
  ta.addEventListener("blur", onBlur);
  ta.addEventListener("click", onSel);
  ta.addEventListener("keyup", onSel);

  return () => {
    ta.removeEventListener("input", onInput);
    ta.removeEventListener("keydown", onKey);
    ta.removeEventListener("blur", onBlur);
    ta.removeEventListener("click", onSel);
    ta.removeEventListener("keyup", onSel);
    pop.remove();
  };
}
