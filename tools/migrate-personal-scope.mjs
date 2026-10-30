#!/usr/bin/env node
/**
 * 把老数据的「个人任务」统一成 `[scope:: 个人]`。
 *
 * 背景：早期把个人任务写成 `[tags:: 个人]`，后来改成正规字段 `[scope:: 个人]`。
 * 解析已经只认 `[scope:: 个人]`，所以库里的老行必须一次性迁过来，否则会当成工作任务。
 *
 * 做法（逐行处理任务行）：
 *   - `[tags:: 个人]`            → 删掉 tags 字段，补 `[scope:: 个人]`
 *   - `[tags:: 个人, 抽检]`      → `[tags:: 抽检] [scope:: 个人]`
 *   - 已经有 `[scope:: 个人]`    → 只把 tags 里的「个人」去掉（去重）
 *   - 其它行（不是任务行）不动
 *
 * 默认 dry-run（只统计、不写），加 `--write` 才落盘。写之前请自行备份。
 *
 *   node tools/migrate-personal-scope.mjs "<vault 的 TLT/tasks 目录>"
 *   node tools/migrate-personal-scope.mjs "<...>" --write
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const write = process.argv.includes("--write");
if (!dir) {
  console.error("用法：node tools/migrate-personal-scope.mjs <TLT/tasks 目录> [--write]");
  process.exit(1);
}

const FIELD = /\[([\w\u4e00-\u9fa5]+)::\s*((?:\[\[[^\]]*\]\]|[^\]])*)\]/g;

/** 找出这一行里某个字段的原文与值 */
function fieldOf(line, key) {
  const re = new RegExp(`\\[${key}::\\s*((?:\\[\\[[^\\]]*\\]\\]|[^\\]])*)\\]`);
  const m = re.exec(line);
  return m ? { raw: m[0], value: m[1] } : null;
}

/** 重写一条任务行；返回 null 表示不用动 */
export function migrateLine(line) {
  if (!/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) return null;      // 只处理任务行
  const tags = fieldOf(line, "tags");
  const scope = fieldOf(line, "scope");
  const tagList = tags ? tags.value.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const hadPersonalTag = tagList.includes("个人");
  const alreadyScoped = scope?.value.trim() === "个人";
  if (!hadPersonalTag && !alreadyScoped) return null;
  if (hadPersonalTag === false && alreadyScoped === true) return null;

  let out = line;
  if (tags) {
    const rest = tagList.filter((t) => t !== "个人");
    if (rest.length) {
      out = out.replace(tags.raw, `[tags:: ${rest.join(", ")}]`);
    } else {
      // 整个 tags 字段只剩「个人」：连字段带前面的空格一起删掉
      out = out.replace(new RegExp(`\\s*${tags.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
    }
  }
  if (hadPersonalTag && !alreadyScoped) {
    if (scope) out = out.replace(scope.raw, "[scope:: 个人]");
    else out = `${out} [scope:: 个人]`;
  }
  return out === line ? null : out.trimEnd();
}

const files = readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(join(dir, f)).isFile());
let touchedFiles = 0, touchedLines = 0;
for (const f of files) {
  const path = join(dir, f);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  let n = 0;
  const next = lines.map((l) => {
    const m = migrateLine(l);
    if (!m) return l;
    n += 1;
    return m;
  });
  if (!n) continue;
  touchedFiles += 1;
  touchedLines += n;
  console.log(`${write ? "改" : "将改"} ${f}：${n} 行`);
  if (write) writeFileSync(path, next.join("\n"), "utf8");
}
console.log(`\n合计：${touchedFiles} 个文件 / ${touchedLines} 行${write ? "（已写入）" : "（dry-run，未写入；加 --write 才落盘）"}`);
