#!/usr/bin/env python3
"""
TLT 消息中心服务（发布 + 订阅代理，单进程单端口，只用标准库）

为什么是标准库：部门服务器上 `python3 tlt_service.py` 就能跑，不用装依赖、不用建 venv。
需要高并发/鉴权时，外面套 nginx 或直接用 FastAPI 重写路由即可，数据格式不变。

接口（和插件里的默认地址完全一致，发布与拉取可以填同一个地址）：

  发布端
    POST   /register            {id,title,desc,owner}     注册/更新一个源
    POST   /publish             {id,title,items[]}        覆盖一个源的全部消息
    GET    /feeds                                         列出所有已发布的源
    GET    /feed?id=xxx                                   取一个源（别人订阅的就是这个）
    DELETE /feed?id=xxx                                   取消发布

  订阅端
    POST   /subscribe           {url,name}                订阅一个 URL（本项目 JSON / RSS / Atom）
    DELETE /subscribe?url=                                取消订阅
    GET    /subscriptions                                 列出订阅
    GET    /pull                                          拉取所有订阅的最新内容（带缓存）

  其它
    GET    /health                                        健康检查
    GET    /                                              一页状态

启动：
    python3 tlt_service.py --port 8787 --data ./data
    python3 tlt_service.py --seed          # 造三个示例源，方便先试
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

DB_LOCK = threading.Lock()
DB_PATH = "data/tlt.db"
REFRESH_SEC = 30


# --------------------------------------------------------------------------- 存储
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with DB_LOCK, db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS feeds (
              id TEXT PRIMARY KEY, title TEXT, desc TEXT, owner TEXT,
              items TEXT, updated TEXT
            );
            CREATE TABLE IF NOT EXISTS subs (
              url TEXT PRIMARY KEY, name TEXT, cache TEXT, fetched_at TEXT, ok INTEGER, err TEXT
            );
            """
        )


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------- RSS / Atom
def unxml(s: str) -> str:
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    for a, b in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def pick(block: str, *tags: str) -> str:
    for t in tags:
        m = re.search(rf"<{t}[^>]*>(.*?)</{t}>", block, re.S | re.I)
        if m:
            return unxml(m.group(1))
    return ""


def to_iso(value: str, fallback: str) -> str:
    if not value:
        return fallback
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:  # 带毫秒/时区的 ISO
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except ValueError:
        return fallback


def xml_to_feed(text: str, sub: dict) -> dict:
    is_atom = re.search(r"<feed[\s>]", text, re.I) is not None
    pattern = r"<entry[^>]*>(.*?)</entry>" if is_atom else r"<item[^>]*>(.*?)</item>"
    blocks = re.findall(pattern, text, re.S | re.I)
    head = re.split(r"<entry[\s>]" if is_atom else r"<item[\s>]", text, maxsplit=1, flags=re.I)[0]
    channel = pick(head, "title")
    fallback = datetime.now().strftime("%Y-%m-%d")
    items = []
    for i, b in enumerate(blocks):
        link = re.search(r'<link[^>]*href=["\']([^"\']+)["\']', b, re.I)
        mid = link.group(1) if link else pick(b, "link", "guid", "id") or f"{sub.get('url','')}#{i}"
        raw_date = pick(b, "updated", "published") if is_atom else pick(b, "pubDate", "dc:date")
        body = pick(b, "content" if is_atom else "description", "summary", "encoded")
        items.append({
            "mid": mid,
            "date": to_iso(raw_date, fallback),
            "title": pick(b, "title") or "(无标题)",
            "kind": "note",
            "place": "",
            "who": [],
            "star": False,
            "state": "live",
            "until": "",
            "body": body[:800],
        })
    return {"id": sub.get("name") or channel or sub.get("url"), "title": channel or sub.get("name") or sub.get("url"), "items": items}


def fetch_feed(sub: dict) -> dict:
    # 允许订阅地址里带中文（插件里点出来的地址是编码过的，手填的可能没有）
    url = quote(sub["url"], safe=":/?&=#%[]@!$'()*+,;~")
    req = Request(url, headers={"user-agent": "TLT/1.0 (+obsidian)"})
    with urlopen(req, timeout=8) as r:
        ctype = (r.headers.get("content-type") or "").lower()
        raw = r.read()
    text = raw.decode("utf-8", "replace")
    if "json" in ctype or text.strip().startswith("{"):
        return json.loads(text)
    if "xml" in ctype or re.match(r"\s*(<\?xml|<rss|<feed)", text, re.I):
        return xml_to_feed(text, sub)
    raise ValueError(f"不认识的格式：{ctype or '无 content-type'}")


def refresh_subs() -> None:
    with DB_LOCK, db() as conn:
        subs = [dict(r) for r in conn.execute("SELECT * FROM subs")]
    for sub in subs:
        try:
            feed = fetch_feed(sub)
            with DB_LOCK, db() as conn:
                conn.execute(
                    "UPDATE subs SET cache=?, fetched_at=?, ok=1, err=NULL WHERE url=?",
                    (json.dumps(feed, ensure_ascii=False), now_iso(), sub["url"]),
                )
        except Exception as exc:  # noqa: BLE001 网络问题不该让线程死掉
            with DB_LOCK, db() as conn:
                conn.execute("UPDATE subs SET fetched_at=?, ok=0, err=? WHERE url=?", (now_iso(), str(exc)[:200], sub["url"]))


def refresher() -> None:
    while True:
        time.sleep(REFRESH_SEC)
        try:
            refresh_subs()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- HTTP
def json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "TLT/1.0"

    def log_message(self, fmt, *args):  # 安静点，只留错误
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    # -- 工具
    def send(self, code: int, body) -> None:
        payload = json_bytes(body)
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def send_html(self, code: int, html: str) -> None:
        payload = html.encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def body(self) -> dict:
        n = int(self.headers.get("content-length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    # -- 路由
    def do_OPTIONS(self):  # noqa: N802
        self.send(204, {})

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        path = u.path.rstrip("/") or "/"

        if path == "/health":
            return self.send(200, {"ok": True, "time": now_iso()})
        if path == "/":
            return self.send_html(200, status_page())

        if path in ("/feeds", "/api/feeds"):
            with DB_LOCK, db() as conn:
                rows = conn.execute("SELECT id, title, desc, owner, updated, items FROM feeds ORDER BY updated DESC").fetchall()
            feeds = []
            for r in rows:
                d = {k: r[k] for k in ("id", "title", "desc", "owner", "updated")}
                d["count"] = len(json.loads(r["items"] or "[]"))
                feeds.append(d)
            return self.send(200, {"feeds": feeds})

        if path in ("/feed", "/api/feed"):
            fid = q.get("id", "")
            with DB_LOCK, db() as conn:
                row = conn.execute("SELECT * FROM feeds WHERE id=?", (fid,)).fetchone()
            if not row:
                return self.send(404, {"error": "no such feed", "id": fid})
            return self.send(200, {
                "id": row["id"], "title": row["title"], "desc": row["desc"],
                "owner": row["owner"], "updated": row["updated"],
                "items": json.loads(row["items"] or "[]"),
            })

        if path in ("/subscriptions", "/api/subscriptions"):
            with DB_LOCK, db() as conn:
                rows = conn.execute("SELECT url, name, fetched_at, ok, err FROM subs").fetchall()
            return self.send(200, {"subs": [dict(r) for r in rows]})

        if path in ("/pull", "/api/pull"):
            with DB_LOCK, db() as conn:
                rows = conn.execute("SELECT * FROM subs").fetchall()
            feeds = []
            for r in rows:
                cache = json.loads(r["cache"]) if r["cache"] else None
                feeds.append({
                    "url": r["url"],
                    "ok": bool(r["ok"]),
                    "error": r["err"],
                    "fetchedAt": r["fetched_at"],
                    "id": (cache or {}).get("id") or r["name"] or r["url"],
                    "title": (cache or {}).get("title") or r["name"] or r["url"],
                    "owner": (cache or {}).get("owner") or "",
                    "items": (cache or {}).get("items") or [],
                })
            return self.send(200, {"feeds": feeds, "pulledAt": now_iso()})

        return self.send(404, {"error": "not found", "path": path})

    def do_POST(self):  # noqa: N802
        u = urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        data = self.body()

        if path in ("/register", "/api/register"):
            fid = str(data.get("id") or "").strip()
            if not fid:
                return self.send(400, {"error": "id required"})
            owner = str(data.get("owner") or "").strip()
            with DB_LOCK, db() as conn:
                old = conn.execute("SELECT items, owner FROM feeds WHERE id=?", (fid,)).fetchone()
                # 别人已经用了这个 id：拒绝，别互相覆盖
                if old and (old["owner"] or "") and owner and old["owner"] != owner:
                    return self.send(409, {"error": "id taken by another publisher", "id": fid,
                                           "owner": old["owner"]})
                conn.execute(
                    "INSERT INTO feeds(id,title,desc,owner,items,updated) VALUES(?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET title=excluded.title, desc=excluded.desc, "
                    "owner=excluded.owner, updated=excluded.updated",
                    (fid, data.get("title", fid), data.get("desc", ""), data.get("owner", ""),
                     old["items"] if old else "[]", now_iso()),
                )
            return self.send(200, {"ok": True, "id": fid})

        if path in ("/publish", "/api/publish"):
            fid = str(data.get("id") or "").strip()
            if not fid:
                return self.send(400, {"error": "id required"})
            items = data.get("items") or []
            with DB_LOCK, db() as conn:
                conn.execute(
                    "INSERT INTO feeds(id,title,desc,owner,items,updated) VALUES(?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET items=excluded.items, updated=excluded.updated, "
                    "title=COALESCE(NULLIF(excluded.title,''), feeds.title)",
                    (fid, data.get("title", fid), data.get("desc", ""), data.get("owner", ""),
                     json.dumps(items, ensure_ascii=False), now_iso()),
                )
            return self.send(200, {"ok": True, "id": fid, "count": len(items)})

        if path in ("/subscribe", "/api/subscribe"):
            url = str(data.get("url") or "").strip()
            if not url:
                return self.send(400, {"error": "url required"})
            with DB_LOCK, db() as conn:
                cur = conn.execute("SELECT url FROM subs WHERE url=?", (url,)).fetchone()
                if cur:
                    return self.send(200, {"ok": True, "existed": True})
                conn.execute("INSERT INTO subs(url,name,ok) VALUES(?,?,0)", (url, data.get("name", "")))
            # 先同步抓一次，客户端订阅完立刻 /pull 就有内容；失败也没关系，后台线程会重试
            try:
                feed = fetch_feed({"url": url, "name": data.get("name", "")})
                with DB_LOCK, db() as conn:
                    conn.execute("UPDATE subs SET cache=?, fetched_at=?, ok=1, err=NULL WHERE url=?",
                                 (json.dumps(feed, ensure_ascii=False), now_iso(), url))
            except Exception as exc:  # noqa: BLE001
                with DB_LOCK, db() as conn:
                    conn.execute("UPDATE subs SET fetched_at=?, ok=0, err=? WHERE url=?", (now_iso(), str(exc)[:200], url))
            return self.send(200, {"ok": True, "count": sub_count()})

        return self.send(404, {"error": "not found", "path": path})

    def do_DELETE(self):  # noqa: N802
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        path = u.path.rstrip("/") or "/"

        if path in ("/feed", "/api/feed"):
            fid = q.get("id", "")
            with DB_LOCK, db() as conn:
                n = conn.execute("DELETE FROM feeds WHERE id=?", (fid,)).rowcount
            return self.send(200, {"ok": bool(n), "id": fid})

        if path in ("/subscribe", "/api/subscribe"):
            url = q.get("url", "")
            with DB_LOCK, db() as conn:
                n = conn.execute("DELETE FROM subs WHERE url=?", (url,)).rowcount
            return self.send(200, {"ok": bool(n), "count": sub_count()})

        return self.send(404, {"error": "not found", "path": path})


def sub_count() -> int:
    with DB_LOCK, db() as conn:
        return conn.execute("SELECT COUNT(*) c FROM subs").fetchone()["c"]


def status_page() -> str:
    with DB_LOCK, db() as conn:
        feeds = conn.execute("SELECT id,title,updated FROM feeds").fetchall()
        subs = conn.execute("SELECT url,name,ok,fetched_at FROM subs").fetchall()
    rows = "".join(f"<li><b>{f['title']}</b> · <code>?id={f['id']}</code> · {f['updated'] or ''}</li>" for f in feeds) or "<li>还没有源</li>"
    srows = "".join(f"<li>{'✅' if s['ok'] else '⏳'} {s['name'] or s['url']} <code>{s['url']}</code></li>" for s in subs) or "<li>还没有订阅</li>"
    return f"""<!doctype html><meta charset="utf-8"><title>TLT 消息服务</title>
<style>body{{font:14px/1.7 -apple-system,"PingFang SC",sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}}
code{{background:#f2f3f7;padding:1px 5px;border-radius:4px}}h2{{margin-top:28px}}</style>
<h1>TLT 消息服务</h1>
<p>发布与订阅跑在同一个进程里，插件里两个地址都填 <code>http://本机:端口</code> 即可。</p>
<h2>已发布的源（{len(feeds)}）</h2><ul>{rows}</ul>
<h2>已订阅的源（{len(subs)}）</h2><ul>{srows}</ul>"""


def seed() -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    demo = [
        ("部门消息通知", "部门公告与通知", [
            {"mid": "seed-1", "date": today, "title": "周五部门例会改到 10:00", "kind": "ask",
             "place": "三楼会议室", "who": ["孙晙书"], "star": True, "state": "live", "until": "",
             "body": "请各组长提前十分钟到。"},
            {"mid": "seed-2", "date": today, "title": "团建报名截止周四", "kind": "event",
             "place": "", "who": [], "star": False, "state": "live", "until": "", "body": ""},
        ]),
        ("算法周报", "每周算法进展", [
            {"mid": "seed-3", "date": today, "title": "w42：抽检脚本收敛", "kind": "note",
             "place": "", "who": ["卢冠宇"], "star": False, "state": "live", "until": "",
             "body": "三类通用任务在小数据量上跑通。"},
        ]),
        ("千数万问动态", "产品侧进展", [
            {"mid": "seed-4", "date": today, "title": "POC 提前到 11 月中", "kind": "risk",
             "place": "周会", "who": ["胡昕宇"], "star": True, "state": "live", "until": "",
             "body": "需要重排 11 月排期。"},
        ]),
    ]
    for fid, title, items in demo:
        with DB_LOCK, db() as conn:
            conn.execute(
                "INSERT INTO feeds(id,title,desc,owner,items,updated) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET items=excluded.items, updated=excluded.updated",
                (fid, title, "", "demo", json.dumps(items, ensure_ascii=False), now_iso()),
            )
    print(f"seeded {len(demo)} feeds")


def main() -> None:
    global DB_PATH, REFRESH_SEC
    ap = argparse.ArgumentParser(description="TLT 消息服务（发布 + 订阅）")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--data", default="data", help="数据目录（sqlite 文件放这里）")
    ap.add_argument("--refresh", type=int, default=30, help="订阅刷新间隔（秒）")
    ap.add_argument("--seed", action="store_true", help="写入三个示例源")
    args = ap.parse_args()

    DB_PATH = os.path.join(args.data, "tlt.db")
    REFRESH_SEC = args.refresh
    init_db()
    if args.seed:
        seed()

    threading.Thread(target=refresher, daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"TLT 服务已启动 → http://{args.host}:{args.port}  (db={DB_PATH})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
