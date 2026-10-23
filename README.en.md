# TLT - Timeline Things

> Listed in the Obsidian directory as **TLT - Timeline Things** (ASCII only, hence no Chinese name). TLT stands for Timeline Things; the repo `TLT-timeline-things` and the plugin id `tlt-timeline-things` follow the same name.

A **timeline-first** workbench for tasks and messages: calendar, tasks, milestones, team load, quick notes — plus a message center that works on its own.

[中文](README.md) | **English**

Everything is plain Markdown inside your vault. Uninstall the plugin and your data is still there.

![Calendar view: project progress on the left, schedule and rhythm chart in the middle, messages on the right](docs/screenshots/01-calendar-day.png)

## Screenshots

| View | What you see |
| --- | --- |
| ![Tasks](docs/screenshots/02-tasks.png) | **Tasks**: overdue / to do / done / unscheduled, filterable by tag |
| ![Milestones](docs/screenshots/03-milestones.png) | **Milestones**: one card per `##` section, expand to tick tasks |
| ![Quick notes](docs/screenshots/04-notes.png) | **Quick notes**: one line per idea, tag filter and tag library |
| ![Team](docs/screenshots/05-team.png) | **Team**: profiles plus load (unfinished share ÷ capacity) |
| ![Message center: cards](docs/screenshots/06-messages-card.png) | **Message center**: sources, timeline, source management |
| ![Zoomable timeline](docs/screenshots/07-messages-axis.png) | Layout: **zoomable timeline** (wheel to zoom, drag to pan) |
| ![Source lanes](docs/screenshots/08-messages-bands.png) | Layout: **source lanes** (one lane per feed) |
| ![Month heatmap](docs/screenshots/09-messages-heat.png) | Layout: **month heatmap** (darker = more messages that day) |

## Install

- **BRAT** (beta): install [BRAT](https://github.com/TfTHacker/obsidian42-brat) → *Add beta plugin* → `sxinyuhoo/TLT-timeline-things`
- **Manual**: copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/tlt-timeline/`, then enable it in Settings → Community plugins

Folders are created on demand. There is a command **“生成示例数据” (seed demo data)** that writes a small sample under `TLT/` without overwriting existing files.

## What makes it different

1. **Timeline first, project tree second.** You open onto today: what happened hour by hour, what is still due, what got inserted. Projects and milestones organise things behind the scenes.
2. **No side database.** Tasks are written back into the original note line (`🛫 📅 [wl::] [owner::] [tags::] [st::] [en::]`), people live in frontmatter, a feed is just a list. Remove the plugin and the files still read, search and link.
3. **The message center stands alone.** It is a separate view that only deals with messages, so colleagues who do not use the task side can still subscribe to notices.

## Six tabs

| Tab | What it does |
| --- | --- |
| **日历 / Calendar** | Day timeline (records + planned blocks), what is due that day, rhythm chart (radius = time, sector = project, wheel to zoom) |
| **任务 / Tasks** | Four groups (overdue / to do / done / unscheduled) plus tag filter; click a row to change due date, share, priority, owners |
| **里程碑 / Milestones** | One card per milestone, expandable into task rows you can tick |
| **人员 / Team** | Profiles (role / capacity / working days / skills), load and next-four-week bars |
| **随手记 / Notes** | One line per idea, `#tags`, editable tag library, multi-select filter |
| **随手画 / Sketch** | Reserved tab (drafts, whiteboard, screenshot annotations) |

A message rail is always on the right; “⤢ 消息中心” opens the standalone message center.

## Message center

Pick sources on the left, read in the middle, manage a source on the right.

| Source | Where it comes from | Right panel |
| --- | --- | --- |
| **个人 / Personal** | Your own drafts | New message, **publish as a source** |
| **我发布的 / Published by me** | Sources you published | Push now, **unpublish** (content folds back into Personal) |
| **我订阅的 / Subscribed** | Sources written by others | **Unsubscribe** (local file goes to the trash) |

Seven layouts: **cards / river / compact / source lanes / zoomable timeline / month heatmap / people graph**.

A message is one line plus optional inline fields — the 5W fit in:

```
- 2026-10-22 Weekly report template finalised [place:: Room 3] [who:: [[Sun]], [[Xu]]] [why:: align next week] [tags:: weekly]
  > Send the template to the group
```

### Publishing and subscribing

No service is required. Three ways to share:

1. Sync the same vault through iCloud / Dropbox / Syncthing (simplest)
2. A shared vault (network drive or Git)
3. Run the message service (cross-machine, good for a department): `services-py/tlt_service.py` — one file, one process, standard library only

```bash
python3 services-py/tlt_service.py --port 8787 --data ./data --seed
```

Publishing and subscribing live in the same process and port; put `http://server:8787` in both fields of the plugin settings. Feeds can be our JSON, **RSS 2.0** or **Atom**.

## Where data lives

| Path | Content |
| --- | --- |
| `TLT/tasks/<project>.md` | Tasks: one file per project, `##` = milestone, one line per task |
| `TLT/team/<name>.md` | People: frontmatter with `role / capacity / days / skills` |
| `TLT/feeds/<source>.md` | Message sources: one line per message |
| `TLT/logs/<YYYY-MM>.md` | Records: `## date` sections with time blocks and bodies |
| `TLT/ideas.md` | Quick notes: one line each |
| `TLT/tags.md` | Tag library: one per line |

Field-level syntax: [docs/data-format.md](docs/data-format.md). All five folders are configurable.

## Commands

| Command | Effect |
| --- | --- |
| 打开工作台 | Open the workbench |
| 打开消息中心（独立页） | Open the message center only |
| 新建任务 | Quick-add a task |
| 生成示例数据 | Seed a sample under `TLT/` (never overwrites) |
| 切换明暗 | Toggle dark / light |
| 推送到发布服务 / 从拉取服务同步 | Manual message sync |

## Privacy and network

- Requests only happen when **you** configure a message service; without one the plugin is fully offline.
- No telemetry, no analytics, no content upload.
- Service URLs and publish IDs live in the plugin's own `data.json`.

## Known limits

- No drag-to-reschedule on the day timeline yet (click a block to edit its time).
- Recurring tasks (`🔁`) are not parsed.
- “Read” state lasts for the session only.
- Publishing replaces a whole source; there is no incremental diff.

## Development

```bash
npm install
npm run build      # produces main.js
npm test           # data layer + render smoke
npm run test:all   # also source lifecycle, RSS, Python service, hub end-to-end
npm run preview    # export each view as static HTML for styling work
```

TypeScript + esbuild (CJS); tests run real rendering through jsdom with an Obsidian stub. `npm run play` builds a clickable browser harness, `npm run serve` serves it.

## Roadmap

See [ROADMAP.md](ROADMAP.md). Next up: **calendar interoperability** (import from macOS Calendar / `.ics`, two-way sync).

## License

MIT
