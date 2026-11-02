#!/usr/bin/env node
/**
 * 推送前自检：manifest 的版本号必须**高于仓库现有的所有 tag**。
 *
 * 为什么要这道闸：这个仓库常有另一路会话在并行推进，凭记忆里的版本号去发版，
 * 很容易把已经到 0.9.x 的仓库改回一个更小的号（实测差点用 0.9.7 覆盖 0.9.43）。
 *
 * 规则：
 *   - HEAD 正好被打了那个 tag（= 正在发这个版本）→ 通过
 *   - 否则 manifest.version 必须严格大于现有最大 tag → 通过
 *   - 小于或等于 → 报错退出（提示正确的下一个号）
 *
 * 用法：npm run check:version
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const version = read("manifest.json").version ?? "";
const pkgVersion = read("package.json").version ?? "";

const semver = (v) => v.split(".").map((x) => parseInt(x, 10) || 0);
const cmp = (a, b) => {
  const A = semver(a), B = semver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const tags = sh("git tag --list").split("\n").map((t) => t.trim()).filter((t) => /^\d+\.\d+\.\d+$/.test(t));
const maxTag = tags.sort(cmp).at(-1) ?? "0.0.0";
const taggedHere = sh("git tag --points-at HEAD").split("\n").map((t) => t.trim());

const fail = [];
if (!/^\d+\.\d+\.\d+$/.test(version)) fail.push(`manifest.json 的 version 不合法：${JSON.stringify(version)}`);
if (version !== pkgVersion) fail.push(`manifest.json (${version}) 与 package.json (${pkgVersion}) 不一致`);

if (!fail.length) {
  if (taggedHere.includes(version)) {
    console.log(`版本检查 ✓  HEAD 已打 tag ${version}（正在发这个版本）`);
  } else if (cmp(version, maxTag) > 0) {
    console.log(`版本检查 ✓  ${version} > 现有最大 tag ${maxTag}`);
  } else {
    fail.push(`版本号 ${version} 不大于现有最大 tag ${maxTag} —— 先 git fetch，再按仓库当前值往上加一（下一个应是 ${maxTag.split(".").map((x, i) => (i === 2 ? Number(x) + 1 : x)).join(".")}）`);
  }
}

if (fail.length) {
  console.error("版本检查 ✗");
  fail.forEach((f) => console.error("  ·", f));
  process.exit(1);
}
