#!/usr/bin/env node
/**
 * 给老数据补上里程碑的显式完成标记。
 *
 * 背景：里程碑的"完成"以前是**派生**出来的——"有任务 且 任务全勾完"就算完成。
 * 现在改成**只看显式标记**（文件里那行 `[ms:: 🌕] [ms-done:: 日期]`）。
 * 老文件里那些"任务都勾完了、但文件里没有 [ms::] 行"的里程碑，
 * 切换规则之后会全部掉回"开展中"——这个脚本负责把这些补上，别让完成记录丢了。
 *
 * 用法：
 *   node tools/backfill-ms-done.mjs "<TLT tasks 目录>" [--write]
 *
 * - 不加 --write 只做 dry-run：列出会补哪些里程碑、补什么内容、用了哪个日期
 * - 只处理：小节里**至少有一条任务**、且**全部任务都已勾选**、且**还没有 [ms::] 行**的里程碑
 * - 完成日取该小节任务里 `[done::]` 的**最晚一天**（都是文件里已有的真实日期）；
 *   一条都没有就只写 `[ms:: 🌕]`，不编日期
 * - 只往 `## 小节` 标题下面插一行，不动别的字符
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WRITE = process.argv.includes("--write");
const tasksDir = args[0];
if (!tasksDir) {
  console.error('用法：node tools/backfill-ms-done.mjs "<TLT tasks 目录>" [--write]');
  process.exit(1);
}

const isTask = (l) => /^- \[[ xX]\]\s+/.test(l); // 只看顶格任务行；两格缩进的是子项，不算任务
const isDone = (l) => /^- \[[xX]\]/.test(l);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

let filesTouched = 0, msMarked = 0, withDate = 0, withoutDate = 0;
const report = [];

for (const file of walk(tasksDir)) {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const inserts = []; // { at, line, name, tasks, date }
  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (!h) continue;
    const name = h[1].trim();
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^##\s/.test(lines[j])) { end = j; break; }
    const slice = lines.slice(i + 1, end);
    if (slice.some((l) => /\[ms::|\[ms-done::/.test(l))) continue;   // 已经有显式行：跳过
    const tasks = slice.filter(isTask);
    if (!tasks.length || !tasks.every(isDone)) continue;             // 没任务 / 有没勾完的：跳过
    const dates = tasks
      .map((l) => (/\[done::\s*(\d{4}-\d{2}-\d{2})\]/.exec(l) || [])[1])
      .filter(Boolean)
      .sort();
    const date = dates.length ? dates[dates.length - 1] : "";
    inserts.push({ at: i + 1, line: date ? `[ms:: 🌕] [ms-done:: ${date}]` : `[ms:: 🌕]`, name, n: tasks.length, date });
  }
  if (!inserts.length) continue;
  filesTouched++;
  report.push({ file, list: inserts.map((x) => `${x.name}（${x.n} 条任务${x.date ? "，完成日 " + x.date : "，无完成日"}）`) });
  for (const x of inserts) { msMarked++; x.date ? withDate++ : withoutDate++; }
  if (WRITE) {
    for (const x of inserts.sort((a, b) => b.at - a.at)) lines.splice(x.at, 0, x.line);
    writeFileSync(file, lines.join("\n"), "utf8");
  }
}

for (const r of report) {
  console.log("\n" + r.file);
  for (const l of r.list) console.log("  + " + l);
}
console.log(`\n${WRITE ? "已写入" : "（dry-run，未写入）"}：${filesTouched} 个文件 / ${msMarked} 个里程碑`
  + `（带完成日 ${withDate}、只标完成 ${withoutDate}）`);
if (!WRITE && msMarked) console.log("确认无误后加 --write 真正写入。");
