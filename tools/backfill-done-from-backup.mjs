#!/usr/bin/env node
/**
 * 把旧备份里的完成时间补进 TLT 的任务行。
 *
 * 背景：TLT 从 0.9.0 才开始记 `[done:: 日期]`，更早完成的任务没有完成时间。
 * 旧库（Tasks 插件语法）里每条已完成任务都带 `✅ YYYY-MM-DD`，可以按标题对上，补回去。
 *
 * 用法：
 *   node tools/backfill-done-from-backup.mjs "<备份目录>" "<TLT tasks 目录>" [--write]
 *
 * - 不加 --write 只做一次 dry-run：打印能补多少条、对不上的有哪些
 * - 备份目录只读；只往 TLT 任务行追加 `[done:: 日期]`，不动别的字符
 * - 只处理「已勾选、且还没有 [done::] 」的行
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [backupDir, tltDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WRITE = process.argv.includes("--write");
if (!backupDir || !tltDir) {
  console.error('用法：node tools/backfill-done-from-backup.mjs "<备份目录>" "<TLT tasks 目录>" [--write]');
  process.exit(1);
}

/** 把一行任务归一成"光标题"：去掉勾选框、标签、emoji 日期、行内字段、括注人名、链接、标点与空白 */
function normTitle(line) {
  let s = line.replace(/^\s*[-*+]\s*\[[ xX]\]\s*/, "");
  // [wl:: 30] / [owner:: [[张三]]] —— 值里可能有 [[双链]]，不能遇到第一个 ] 就停
  s = s.replace(/\[[a-zA-Z\u4e00-\u9fa5]+::\s*(?:\[\[[^\]]*\]\]|[^\]])*\]/g, " ");
  s = s.replace(/[🛫📅➕✅⏫🔼🔽⏬🔁🏁⏳🆔⛔]\s*\d{4}-\d{2}-\d{2}/g, " "); // 带日期的标记
  s = s.replace(/[🛫📅➕✅⏫🔼🔽⏬🔁🏁⏳🆔⛔]/gu, " ");
  s = s.replace(/#[\w\u4e00-\u9fa5/-]+/g, " ");                     // #task #工作
  s = s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1");             // [[人名]]
  s = s.replace(/（[^）]*）/g, " ").replace(/\([^)]*\)/g, " ");       // （人名）/ (说明)
  s = s.replace(/[\s·・、,，。.：:；;!！?？\-—–~～"'“”‘’]+/g, "");
  return s.trim();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

// ① 备份里：光标题 → 完成日期（同名的取第一个，别覆盖）
const byTitle = new Map();
let backupDone = 0;
for (const f of walk(backupDir)) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!/^\s*[-*+]\s*\[[xX]\]/.test(line)) continue;
    const m = /✅\s*(\d{4}-\d{2}-\d{2})/.exec(line);
    if (!m) continue;
    backupDone++;
    const key = normTitle(line);
    if (key && !byTitle.has(key)) byTitle.set(key, m[1]);
  }
}
console.log(`备份：已完成 ${backupDone} 条，其中 ${backupDone - byTitle.size} 条连备份里也没有 ✅；抽出可对标题 ${byTitle.size} 个`);

// ② TLT 里：已勾选、没有 [done::] 的行
let filled = 0, already = 0, missing = [];
const misses = [];
for (const f of walk(tltDir)) {
  const text = readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*[-*+]\s*\[[xX]\]/.test(line)) continue;
    if (/\[done::/.test(line)) { already++; continue; }
    const key = normTitle(line);
    const date = byTitle.get(key);
    if (!date) { misses.push(`${f.split("/").pop()}: ${line.trim().slice(0, 46)}`); continue; }
    lines[i] = `${line.replace(/\s+$/, "")} [done:: ${date}]`;
    filled++; touched = true;
  }
  if (touched && WRITE) writeFileSync(f, lines.join("\n"));
}

console.log(`TLT：补上 ${filled} 条${WRITE ? "（已写入）" : "（dry-run，未写入）"}；本来就有完成时间的 ${already} 条`);
if (misses.length) {
  console.log(`\n对不上标题的已完成任务 ${misses.length} 条（备份里没有同名行，或标题被改过）：`);
  misses.slice(0, 15).forEach((m) => console.log("  " + m));
  if (misses.length > 15) console.log(`  …还有 ${misses.length - 15} 条`);
}
if (!WRITE) console.log("\n加 --write 才会真的写回去。");
