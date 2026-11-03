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

/* ================= 自带 SVG 图标 =================
 * 为什么不用 Obsidian 的 addIcon + setIcon：
 *   图标注册是全局的，一旦没注册上（或别的插件覆盖、或极端字体/主题下回退），
 *   界面上就会冒出"问号/方块"。这些是**局部小图标**，直接内联画出来最稳，
 *   不依赖任何注册表；页签那种必须交给 Obsidian 的大图标仍走 getIcon()。
 * 结构化成「元素 + 属性」而不是 innerHTML：目录审核不允许动态 innerHTML。
 */
type IconNode = [tag: string, attrs: Record<string, string | number>];
const ICON_SHAPES: Record<string, IconNode[]> = {
  "chev-l": [["path", { d: "m15 18-6-6 6-6" }]],
  "chev-r": [["path", { d: "m9 18 6-6-6-6" }]],
  "chev-d": [["path", { d: "m6 9 6 6 6-6" }]],
  "pen": [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" }]],
  "plus": [["path", { d: "M12 5v14" }], ["path", { d: "M5 12h14" }]],
  "close": [["path", { d: "M18 6 6 18" }], ["path", { d: "M6 6l12 12" }]],
  "dots": [["circle", { cx: 5, cy: 12, r: 1 }], ["circle", { cx: 12, cy: 12, r: 1 }], ["circle", { cx: 19, cy: 12, r: 1 }]],
  "updown": [["path", { d: "M8 3v18" }], ["path", { d: "M8 3 4 7m4-4 4 4" }], ["path", { d: "M16 21V3" }], ["path", { d: "m16 21 4-4m-4 4-4-4" }]],
  "list": [["path", { d: "M8 6h13M8 12h13M8 18h13" }], ["path", { d: "M3 6h.01M3 12h.01M3 18h.01" }]],
  "refresh": [["path", { d: "M21 12a9 9 0 1 1-2.6-6.4" }], ["path", { d: "M21 3v6h-6" }]],
  "expand": [["path", { d: "M15 3h6v6M9 21H3v-6" }], ["path", { d: "M21 3l-7 7M3 21l7-7" }]],
  "star": [["path", { d: "m12 3 2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.5 9.9 9.1 9Z" }]],
  "warn": [["path", { d: "M12 9v4M12 17h.01" }], ["path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" }]],
  "check": [["path", { d: "M20 6 9 17l-5-5" }]],
  "undo": [["path", { d: "M3 7v6h6" }], ["path", { d: "M3.5 13a9 9 0 1 0 2.6-6.4L3 9" }]],
  "spark": [["path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" }]],
};

/** 往元素里画一个小图标（内联 SVG，不依赖 Obsidian 的图标注册表） */
export function svgIcon(parent: HTMLElement, name: string, size = 14): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of ICON_SHAPES[name] || []) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    svg.appendChild(node);
  }
  svg.addClass("tlt-svg");
  parent.appendChild(svg);
  return svg;
}
