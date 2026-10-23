/* 订阅层：RSS 2.0 / Atom 能不能变成统一的消息结构（起真服务测） */
import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>部门 RSS</title>
<item><title>周会改到周四</title><link>https://example.com/a</link><pubDate>Thu, 22 Oct 2026 09:00:00 +0800</pubDate><description><![CDATA[<p>时间改成 10:00。</p>]]></description></item>
<item><title>模板更新</title><link>https://example.com/b</link><pubDate>Wed, 21 Oct 2026 15:00:00 +0800</pubDate><description>v3 已发群</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 源</title>
<entry><title>Atom 一条</title><link href="https://example.com/c"/><updated>2026-10-20T10:00:00Z</updated><summary>摘要</summary></entry>
</feed>`;

const src = http.createServer((req, res) => {
  const isAtom = req.url.includes("atom");
  res.writeHead(200, { "content-type": isAtom ? "application/atom+xml" : "application/rss+xml; charset=utf-8" });
  res.end(isAtom ? ATOM : RSS);
});
await new Promise((r) => src.listen(0, "127.0.0.1", r));
const srcPort = src.address().port;

const PORT = 8897;

const PY = fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tlt-rss-"));
const hub = spawn(PY, ["services-py/tlt_service.py", "--port", String(PORT), "--data", dataDir, "--refresh", "2"], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 700));

const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const pull = async () => (await fetch(`http://127.0.0.1:${PORT}/pull`)).json();

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ✓", name); }
  catch (e) { fail++; console.log("  ✗", name, "\n     " + e.message); }
};

await t("RSS 2.0 能订阅并解析成 items", async () => {
  await post("/subscribe", { url: `http://127.0.0.1:${srcPort}/feed.xml`, name: "部门RSS" });
  await new Promise((r) => setTimeout(r, 1600));
  const d = await pull();
  const f = d.feeds.find((x) => x.url.includes("feed.xml"));
  assert.ok(f?.ok, "源没抓到：" + (f?.error || "?"));
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, "周会改到周四");
  assert.equal(f.items[0].date, "2026-10-22");
  assert.ok(!f.items[0].body.includes("<p>"), "HTML 没剥掉");
});

await t("Atom 能订阅并取到 link / updated", async () => {
  await post("/subscribe", { url: `http://127.0.0.1:${srcPort}/atom.xml`, name: "Atom源" });
  await new Promise((r) => setTimeout(r, 1600));
  const d = await pull();
  const f = d.feeds.find((x) => x.url.includes("atom.xml"));
  assert.ok(f?.ok, "源没抓到");
  assert.equal(f.items[0].date, "2026-10-20");
  assert.equal(f.items[0].mid, "https://example.com/c");
});

await t("退订后不再返回这个源", async () => {
  await fetch(`http://127.0.0.1:${PORT}/subscribe?url=${encodeURIComponent(`http://127.0.0.1:${srcPort}/atom.xml`)}`, { method: "DELETE" });
  const d = await pull();
  assert.ok(!d.feeds.some((x) => x.url.includes("atom.xml")), "退订了还在");
});

hub.kill();
src.close();
fs.rmSync(dataDir, { recursive: true, force: true });

console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
