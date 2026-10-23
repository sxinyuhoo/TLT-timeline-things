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
