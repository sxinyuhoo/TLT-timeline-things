#!/usr/bin/env node
/**
 * styles.css 的静态检查（官方上架检查会做 CSS lint，解析失败会报 "Unexpected }"）。
 *
 * tsc / eslint / 单测都碰不到 CSS——曾经因为注释后面多了一个 `}` 被官网打回，所以在
 * 发版门禁里加一道：剥掉注释后，① 大括号严格配平、不允许负深度；
 * ② 规则外面不允许出现声明（多写的 `}` 会让后面的声明掉到规则外）；
 * ③ 规则外面不允许出现裸的 `}`（也就是"没有选择器的块"）。
 */
import fs from "node:fs";

const file = process.argv[2] || "styles.css";
const raw = fs.readFileSync(file, "utf8");
const lineAt = (idx) => raw.slice(0, idx).split("\n").length;
const problems = [];

// ---------- 剥注释（用空格顶掉，保住行号） ----------
let s = "";
for (let i = 0; i < raw.length;) {
  if (raw[i] === "/" && raw[i + 1] === "*") {
    const end = raw.indexOf("*/", i + 2);
    if (end === -1) { problems.push(`第 ${lineAt(i)} 行：注释没闭合（缺 "*/"）`); break; }
    s += raw.slice(i, end + 2).replace(/[^\n]/g, " ");
    i = end + 2;
    continue;
  }
  s += raw[i];
  i += 1;
}

// ---------- 配平 + 规则外不许有内容 ----------
let depth = 0;
let pendingSelector = "";        // 当前块的选择器（跨行拼起来）
let lastAtRuleSemi = -1;         // @charset/@import 这类"带分号的 @ 规则"结束的位置
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === "{") {
    if (depth === 0 && !pendingSelector.trim())
      problems.push(`第 ${lineAt(i)} 行：出现了一个没有选择器的规则块（多余的 "{"？）`);
    depth += 1;
    pendingSelector = "";
  } else if (ch === "}") {
    depth -= 1;
    if (depth < 0) {
      problems.push(`第 ${lineAt(i)} 行：多出来的 "}"（前面没有与之配对的 "{"）`);
      depth = 0;
    }
    pendingSelector = "";
  } else if (ch === ";" && depth === 0) {
    // 规则外面只允许 @charset / @import / @namespace 这类以分号结尾的 @ 规则
    const head = s.slice(Math.max(lastAtRuleSemi + 1, 0), i).trim();
    if (!/^@(charset|import|namespace)\b/i.test(head) && head) {
      problems.push(`第 ${lineAt(i)} 行：规则外面出现了声明「${head.replace(/\s+/g, " ").slice(0, 70)}」——多半是上面多写了一个 "}"`);
    }
    lastAtRuleSemi = i;
  } else if (depth === 0) {
    pendingSelector += ch;
  }
}
if (depth !== 0) problems.push(`文件末尾还有 ${depth} 个没闭合的 "{"`);

const lineCount = raw.split("\n").length;
if (problems.length) {
  console.error("styles.css 检查未通过：");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`styles.css 检查通过（${lineCount} 行：括号配平、规则外干净）`);
