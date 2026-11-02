#!/usr/bin/env node
/**
 * 给老任务补上显式的归属字段 `[scope:: 工作]` / `[scope:: 个人]`。
 *
 * 背景：归属以前是"没标个人的都算工作"——可实际库里 96% 的任务都没写 scope，
 * 于是「工作」这个筛选等于没筛。现在改成**只看显式字段**：
 *   有 [scope:: 工作] 才是工作，有 [scope:: 个人] 才是个人，没写＝未标注。
 * 这个脚本负责把老数据一次性补齐（补齐之后「未标注」那一档自然消失）。
 *
 * 用法：
 *   node tools/backfill-scope.mjs "<TLT tasks 目录>" [--write]
 *
 * 规则：
 *   - 已经有 [scope::] 的行不动
 *   - `[tags:: … 个人 …]`（老写法）→ 写 [scope:: 个人]，并把 tags 里的「个人」去掉
 *   - 其余没有 scope 的 → 写 [scope:: 工作]（不动 tags：很多人本来就把「工作」当普通标签在用）
 * 默认 dry-run，只打印数量；加 --write 才真的写。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WRITE = process.argv.includes("--write");
const tasksDir = args[0];
if (!tasksDir) {
  console.error('用法：node tools/backfill-scope.mjs "<TLT tasks 目录>" [--write]');
  process.exit(1);
}

const isTask = (l) => /^- \[[ xX]\]\s+/.test(l);
const scopeRe = /\[scope::\s*([^\]]*)\]/;
const tagsRe = /\[tags::\s*([^\]]*)\]/;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

let asPersonal = 0, asWork = 0, skipped = 0, filesTouched = 0;
const touchedFiles = [];

for (const file of walk(tasksDir)) {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  let changed = false;
  const out = lines.map((l) => {
    if (!isTask(l)) return l;
    if (scopeRe.test(l)) { skipped++; return l; }
    const tm = tagsRe.exec(l);
    const tags = tm ? tm[1].split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) : [];
    const personal = tags.includes("个人");
    let next = l;
    if (personal) {
      const kept = tags.filter((x) => x !== "个人");
      next = kept.length ? next.replace(tagsRe, `[tags:: ${kept.join(", ")}]`) : next.replace(/\s*\[tags::[^\]]*\]/, "");
      asPersonal++;
    } else {
      asWork++;
    }
    changed = true;
    return `${next.replace(/\s+$/, "")} [scope:: ${personal ? "个人" : "工作"}]`;
  });
  if (changed) { filesTouched++; touchedFiles.push(file); if (WRITE) writeFileSync(file, out.join("\n"), "utf8"); }
}

console.log(`\n${WRITE ? "已写入" : "（dry-run，未写入）"}：${filesTouched} 个文件`);
console.log(`  补成 [scope:: 个人]：${asPersonal} 条`);
console.log(`  补成 [scope:: 工作]：${asWork} 条`);
console.log(`  已有 scope、跳过：${skipped} 条`);
for (const f of touchedFiles) console.log("  · " + f);
if (!WRITE && (asPersonal + asWork)) console.log("\n确认无误后加 --write 真正写入。");
