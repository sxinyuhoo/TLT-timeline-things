# TLT 消息服务（Python）

消息中心的发布 + 订阅服务。**单进程、单端口、只用标准库**——部门服务器上

```bash
python3 tlt_service.py --port 8787 --data ./data
```

就能跑，不用装依赖、不用建 venv。

## 为什么要有它

插件本身**不依赖**这个服务：任务、随手记、消息、发布订阅全部落在库里的 Markdown，删掉服务照样用。

服务只解决一件事：**跨机器换内容**。没有它也可以用「同一个库走网盘同步」「共享库」来替代。

## 接口

发布端和订阅端跑在同一个进程里，所以插件设置里**两个地址填同一个** `http://服务器:8787` 即可。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/register` | `{id,title,desc,owner}` 注册/更新一个源 |
| POST | `/publish` | `{id,title,items[]}` 覆盖一个源的全部消息 |
| GET | `/feeds` | 列出已发布的源 |
| GET | `/feed?id=` | 取一个源（**这就是订阅地址**） |
| DELETE | `/feed?id=` | 取消发布 |
| POST | `/subscribe` | `{url,name}` 订阅一个地址 |
| DELETE | `/subscribe?url=` | 取消订阅 |
| GET | `/subscriptions` | 列出订阅（含上次抓取状态） |
| GET | `/pull` | 拉所有订阅的最新内容（带缓存） |
| GET | `/health` | 健康检查 |
| GET | `/` | 一页状态（浏览器直接看） |

## 支持的源格式

- 本项目的 JSON（`{id,title,items[]}`）
- **RSS 2.0**、**Atom**（按 `content-type` 与内容自动识别，HTML 会剥成纯文本）
- 所以博客、内网公告、GitHub Releases 的 RSS 都能直接订阅

## 数据

`--data` 目录下只有一个 `tlt.db`（SQLite，标准库 `sqlite3`）：

```sql
feeds(id, title, desc, owner, items, updated)
subs(url, name, cache, fetched_at, ok, err)
```

备份就是拷这个文件。

## 参数

```
--port 8787        端口
--host 0.0.0.0     监听地址（只想本机用就 127.0.0.1）
--data ./data      数据目录
--refresh 30       订阅刷新间隔（秒）
--seed             写入三个示例源，方便先试
```

## 部署备忘

- 内网直接用：`python3 tlt_service.py --port 8787`
- 开机自启（systemd）：

```ini
[Unit]
Description=TLT message service
After=network.target

[Service]
WorkingDirectory=/opt/tlt
ExecStart=/usr/bin/python3 /opt/tlt/tlt_service.py --port 8787 --data /opt/tlt/data
Restart=always

[Install]
WantedBy=multi-user.target
```

- 要鉴权就在前面套 nginx（插件只发 `POST/GET/DELETE` + `content-type: json`，加个 `Authorization` 头校验即可）
- 需要更高并发/接口文档时，把 `Handler` 换成 FastAPI 路由即可——**数据格式不用动**，插件无需改

## 自测

```bash
python3 tlt_service.py --port 8801 --data /tmp/tlt --seed &
curl -s localhost:8801/feeds
curl -s "localhost:8801/feed?id=算法周报"
curl -s -X POST localhost:8801/subscribe -H 'content-type: application/json' \
     -d '{"url":"https://example.com/feed.xml","name":"试试RSS"}'
curl -s localhost:8801/pull
```
