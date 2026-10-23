/* Python 版消息服务冒烟：起真进程，走一遍发布/订阅/拉取 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>部门 RSS</title>
<item><title>周会改到周四</title><link>https://e.com/a</link><pubDate>Thu, 22 Oct 2026 09:00:00 +0800</pubDate><description><![CDATA[<p>10:00 三楼</p>]]></description></item>
</channel></rss>`;

const src = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "application/rss+xml" }); res.end(RSS); });
await new Promise((r) => src.listen(0, "127.0.0.1", r));
const srcPort = src.address().port;

const PY = fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3";
const PORT = 8802;
const dataDir = "/tmp/tlt-py-test";
fs.rmSync(dataDir, { recursive: true, force: true });

const proc = spawn(PY, ["services-py/tlt_service.py", "--port", String(PORT), "--data", dataDir, "--seed", "--refresh", "2"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const post = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ✓", name); }
  catch (e) { fail++; console.log("  ✗", name, "\n     " + e.message); }
};

await t("健康检查", async () => {
  assert.equal((await get("/health")).ok, true);
});

await t("--seed 后能列出源、取到 items", async () => {
  const feeds = await get("/feeds");
  assert.ok(feeds.feeds.length >= 3, `只有 ${feeds.feeds.length} 个源`);
  const one = await get(`/feed?id=${encodeURIComponent("算法周报")}`);
  assert.equal(one.title, "每周算法进展");
  assert.ok(one.items.length === 1 && one.items[0].title.startsWith("w42"));
});

await t("publish 覆盖写入并按 id 读回", async () => {
  await post("/publish", { id: "t1", title: "测试源", items: [{ mid: "m1", date: "2026-10-22", title: "一条", kind: "note" }] });
  const f = await get("/feed?id=t1");
  assert.equal(f.items.length, 1);
  await post("/publish", { id: "t1", title: "测试源", items: [] });
  assert.equal((await get("/feed?id=t1")).items.length, 0);
});

await t("订阅 RSS 后 /pull 能拿到解析结果", async () => {
  await post("/subscribe", { url: `http://127.0.0.1:${srcPort}/feed.xml`, name: "RSS源" });
  await new Promise((r) => setTimeout(r, 2600));
  const d = await get("/pull");
  const f = d.feeds.find((x) => x.url.includes("feed.xml"));
  assert.ok(f?.ok, "没抓到：" + (f?.error || "?"));
  assert.equal(f.items[0].title, "周会改到周四");
  assert.ok(!f.items[0].body.includes("<p>"), "HTML 没剥");
});

await t("取消订阅后不再返回", async () => {
  await fetch(`http://127.0.0.1:${PORT}/subscribe?url=${encodeURIComponent(`http://127.0.0.1:${srcPort}/feed.xml`)}`, { method: "DELETE" });
  const d = await get("/pull");
  assert.ok(!d.feeds.some((x) => x.url.includes("feed.xml")));
});

await t("取消发布会从列表消失", async () => {
  await fetch(`http://127.0.0.1:${PORT}/feed?id=t1`, { method: "DELETE" });
  const feeds = await get("/feeds");
  assert.ok(!feeds.feeds.some((f) => f.id === "t1"));
});

proc.kill();
src.close();
fs.rmSync(dataDir, { recursive: true, force: true });

console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
