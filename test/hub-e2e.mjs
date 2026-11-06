/* 发布 → 订阅 → 拉取 全链路测试（需要两个本地服务在跑） */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import esbuild from "esbuild";
import { strict as assert } from "node:assert";

// 发布端与订阅端现在同一个进程、同一个端口（services-py）。
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8899);
const PUB = process.env.PUB || `http://127.0.0.1:${PORT}`;
const SYNC = process.env.SYNC || PUB;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "tlt-hub-"));
const PY = fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3";
const svc = spawn(PY, ["services-py/tlt_service.py", "--port", String(PORT), "--data", DATA], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));

await esbuild.build({
  stdin: { contents: `export { Store } from "./src/store"; export { TFile } from "obsidian";`, resolveDir: process.cwd(), sourcefile: "h.ts", loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: "test/store-bundle.mjs",
  external: ["obsidian"],
  logLevel: "error",
  plugins: [{
    name: "stub", setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: `export class TFile{constructor(p){this.path=p||"";this.basename=String(p||"").split("/").pop().replace(/\.md$/,"");this.name=this.basename+".md";this.extension="md";}};export class TFolder{};
export const normalizePath=p=>p.replace(/^\\/+|\\/+$/g,"");
export async function requestUrl(req){
  const res = await fetch(req.url, { method: req.method || "GET",
    headers: req.contentType ? { "content-type": req.contentType } : undefined, body: req.body });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}`,
        loader: "js",
      }));
    },
  }],
});
const { Store, TFile } = await import("./store-bundle.mjs?" + Date.now());

/** 一个可写的临时 vault */
function makeVault(root) {
  const files = new Map();
  const abs = (p) => path.join(root, p);
  const api = {
    getMarkdownFiles: () => [...files.keys()].map((p) => new TFile(p)),
    cachedRead: async (f) => files.get(f.path) ?? "",
    read: async (f) => files.get(f.path) ?? "",
    getAbstractFileByPath: (p) => (files.has(p) ? new TFile(p) : null),
    create: async (p, content) => {
      files.set(p, content);
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), content, "utf8");
      return { path: p };
    },
    process: async (f, fn) => {
      const next = fn(files.get(f.path) ?? "");
      files.set(f.path, next);
      fs.writeFileSync(abs(f.path), next, "utf8");
      return next;
    },
    createFolder: async () => {},
    delete: async () => {},
    on: () => ({}),
  };
  return { api, files };
}

const settings = {
  tasksFolder: "TLT/tasks", teamFolder: "TLT/crew", feedsFolder: "TLT/feeds",
  logsFolder: "TLT/logs", ideasFile: "TLT/ideas.md", defaultPeriod: "m", mineFeed: "我的动态",
};

let pass = 0;
const t = async (n, fn) => {
  try { await fn(); pass++; console.log("  ✓", n); }
  catch (e) { console.log("  ✗", n, "\n    ", e.message); process.exitCode = 1; }
};

console.log(`publish ${PUB} · sync ${SYNC}\n`);

// 先把拉取服务上残留的订阅清空，保证测试可重复
try {
  const cur = await fetch(`${SYNC}/subscriptions`).then((r) => r.json());
  for (const sub of cur.subs || []) {
    await fetch(`${SYNC}/subscribe?url=${encodeURIComponent(sub.url)}`, { method: "DELETE" });
  }
} catch { /* 服务没起就让下面的用例失败 */ }

/* ---------- 1) 发布端：模拟"我"的库 ---------- */
const A = fs.mkdtempSync(path.join(os.tmpdir(), "tlt-a-"));
const vaultA = makeVault(A);
vaultA.files.set("TLT/feeds/我的动态.md", `---
title: 我的动态
owner: me
mine: true
---

- 2026-10-21 示例进展：方案已定稿 [kind:: note] [place:: 会议室] [star:: true]
  > 三处差异写进 V2。
- 2026-10-22 周会：先把 示例任务：写一页纸 [kind:: note]
`);
const storeA = new Store({ vault: vaultA.api, metadataCache: { getFileCache: () => ({ frontmatter: { title: "我的动态", owner: "me", mine: true } }) } }, settings);
await storeA.load();

await t("发布：把我的源推到发布服务", async () => {
  const feed = storeA.feeds[0];
  assert.ok(feed, "本地源没读到");
  const r = await storeA.publishFeed(feed, PUB);
  assert.equal(r.count, 2);
  console.log("      服务端返回:", JSON.stringify(r));
});

await t("发布服务：GET /feeds 能看到", async () => {
  const r = await fetch(`${PUB}/feeds`).then((x) => x.json());
  const mine = r.feeds.find((f) => f.id === "我的动态");
  assert.ok(mine, "注册表里没有");
  assert.equal(mine.count, 2);
});

/* ---------- 2) 订阅端：模拟"别人"的库 ---------- */
const B = fs.mkdtempSync(path.join(os.tmpdir(), "tlt-b-"));
const vaultB = makeVault(B);
const storeB = new Store({ vault: vaultB.api, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } }, settings);
await storeB.load();

await t("订阅：直接抓这个源地址（不经过任何同步服务）", async () => {
  const r = await storeB.subscribeRemote(`${PUB}/feed?id=我的动态`, "我的动态");
  assert.ok(r.ok);
  assert.equal(r.count, 2, `订阅时就该把 2 条读进来，实际 ${r.count}`);
});

await t("源地址本身就能读到两条消息", async () => {
  const r = await fetch(`${PUB}/feed?id=我的动态`).then((x) => x.json());
  assert.equal(r.items.length, 2, `源里应有 2 条：${JSON.stringify(r).slice(0, 120)}`);
  assert.ok(r.title, "源要有标题");
});

await t("入库：远端消息写成 TLT/feeds/<id>.md", async () => {
  const r = await storeB.syncSubscriptions();      // 订阅时已经写入，这里再同步应是幂等的
  assert.equal(r.added, 0, `已经入库过，不该再加：${r.added}`);
  const file = [...vaultB.files.keys()].find((k) => k.includes("我的动态") && k.startsWith("TLT/feeds/"));
  assert.ok(file, "没有生成远端源文件");
  const text = vaultB.files.get(file);
  assert.ok(text.includes("[mid::"), "缺少 mid，会重复");
  assert.ok(text.includes("示例进展：方案已定稿"));
  console.log(`      写入 ${file}（${text.split("\\n").length} 行）`);
});

await t("幂等：再同步一次不重复", async () => {
  const r = await storeB.syncSubscriptions();
  assert.equal(r.added, 0, `第二次又加了 ${r.added} 条`);
});

await t("重新加载后能读到远端消息", async () => {
  await storeB.load();
  const remote = storeB.feeds.find((f) => !f.mine && f.items.length >= 2);
  assert.ok(remote, "重新加载后远端源丢失");
  console.log("      远端源:", remote.name, remote.items.map((i) => i.title).join(" / "));
});

await t("退订后再同步，不会把它拉回来", async () => {
  await storeB.forgetSub(`${PUB}/feed?id=我的动态`);
  const before = storeB.feeds.find((f) => !f.mine)?.items.length ?? 0;
  const r = await storeB.syncSubscriptions();
  assert.equal(r.added, 0, "退订后不该再拉");
  const after = storeB.feeds.find((f) => !f.mine)?.items.length ?? 0;
  assert.equal(after, before, "本地已有的内容不动（文件由用户决定删）");
});

fs.rmSync(A, { recursive: true, force: true });
fs.rmSync(B, { recursive: true, force: true });
svc.kill();
fs.rmSync(DATA, { recursive: true, force: true });

console.log(`\n${pass} 项通过${process.exitCode ? "，有失败" : "，全部通过"}`);
