import { t as T } from "../i18n";
/** 把一段 SVG 片段装进现有 <svg>，避免用 innerHTML 直接赋值 */
export function setSvgMarkup(svg: SVGSVGElement, markup: string): void {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  const nodes = Array.from(doc.documentElement.childNodes)
    .map((node) => svg.ownerDocument.importNode(node, true));
  svg.replaceChildren(...nodes);
}

/**
 * 极简 Markdown：只认三样——标题（`#` / `##` / `###`）、列表（`-` `*` `+`）、待办（`- [ ]` / `- [x]`）。
 * 行内格式（粗体、链接）**故意不处理**：随手记是速记，半截渲染反而更乱。
 * 一律走 Obsidian 的 createEl + textContent，不用 innerHTML（内容来自用户文件，不能当 HTML 信）。
 */
export function miniMarkdown(
  text: string,
  into: HTMLElement,
  opts?: { onCheck?: (idx: number) => void },
): HTMLElement {
  const box = into;
  box.classList.add("tlt-md");
  const mk = (tag: "div" | "span", cls: string, body?: string) => {
    const e = createEl(tag);
    e.className = cls;
    if (body !== undefined) e.textContent = body;
    return e;
  };
  let list: HTMLElement | null = null;
  let cbIdx = -1;
  const endList = () => { list = null; };

  const row = (cls: string, marker: string | null, body: string) => {
    const r = mk("div", cls);
    if (marker !== null) r.appendChild(mk("span", "tlt-md-mk", marker));
    r.appendChild(mk("span", "tlt-md-t", body));
    return r;
  };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { endList(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      endList();
      box.appendChild(mk("div", `tlt-md-h tlt-md-h${h[1].length}`, h[2]));
      continue;
    }

    const todo = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      if (!list) { list = mk("div", "tlt-md-list"); box.appendChild(list); }
      const done = todo[1] !== " ";
      const r = row("tlt-md-li tlt-md-todo" + (done ? " done" : ""), null, todo[2]);
      const cb = mk("span", "tlt-md-cb" + (done ? " on" : ""));
      if (opts?.onCheck) {
        cbIdx += 1;
        const mine = cbIdx;                                   // 定住这一格的下标（闭包别共享 cbIdx）
        cb.addClass("tlt-md-cb-live");
        cb.dataset.mdck = String(mine);
        cb.title = done ? T("取消勾选") : T("勾上");
        cb.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
        cb.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation();          // 别让它冒泡成"打开详情"
          opts.onCheck?.(mine);
        });
      }
      r.insertBefore(cb, r.firstChild);
      list.appendChild(r);
      continue;
    }

    const b = /^[-*+]\s+(.*)$/.exec(line);
    if (b) {
      if (!list) { list = mk("div", "tlt-md-list"); box.appendChild(list); }
      list.appendChild(row("tlt-md-li", "·", b[1]));
      continue;
    }

    endList();
    box.appendChild(mk("div", "tlt-md-p", line));
  }
  return box;
}
