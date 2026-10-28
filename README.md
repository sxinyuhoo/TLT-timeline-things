# TLT - Timeline + Tasks · 时间线工作台

**中文** | [English](README.en.md)

**A timeline-first workbench for Obsidian**: task management + schedule + timeline + project milestones, with calendar, team workload and quick notes, plus a standalone message center (publish / subscribe). Everything is stored as plain Markdown in your vault — uninstall the plugin and your data is still there. Full English guide: [README.en.md](README.en.md).

以**时间线**为中心的任务与消息工作台：日历、任务、里程碑、人员饱和度、随手记，外加一个可以单独使用的消息中心。所有内容都是你库里的普通 Markdown —— 删掉插件，数据还在。

## 这些词你可能在找（关键词对照）

插件市场里搜 **tasks / timeline / schedule / task manager / gantt / kanban** 都可能落到这里。下面把大家常用的叫法逐条对一遍，方便你判断是不是你要的那个：

| 你在找 | TLT 里对应什么 |
| --- | --- |
| 任务管理 / Tasks / To-do / Task manager | 项目笔记里的一行 `- [ ]`，勾选即完成；按**逾期 / 要做 / 已完成 / 待排期**分组，可按标签筛 |
| 时间线 / Timeline | 打开就是「今天」：几点做了什么、这天还要做什么；记录按天攒进月文件 |
| 日程 / Schedule / 日历 / Calendar | 一天的日程排布（时间块 + 计划块），点空白处把任务排进这天 |
| 项目 / Project / 里程碑 / Milestone | 一个项目一个 md，`##` 小节就是里程碑；里程碑视图分「开展中 / 已完成」两段 |
| 甘特图 / Gantt | **没有甘特条**。用里程碑视图看排期、星图按到期日铺开，回答"哪几周最挤"够用 |
| 看板 / Kanban / Board | **没有拖拽看板**。任务按状态分组呈现（状态即分组），拖拽排序还没做 |
| 工时 / 工作量 / 产能 / Workload | 任务可写人天估算；人员页算每人饱和度（本期未完成人天 ÷ 产能） |
| 待办清单 / Checklist / Sub-task | 任务下面挂缩进子项（只有内容和完成态），**带子项的任务行尾有一个小圆环显示完成比例**，点一下就地展开、勾/改/删/加 |
| 进度 / 时间线 / Progress / Timeline | 任务自己记着创建与完成时间（`[created::]` / `[done::]`，默认不显示）；项目、里程碑、任务的起止都追加进 `TLT/events/` 的事件流，给将来的时间线图谱用 |
| 周报 / 复盘 / 日志 / Daily note | 每天的记录按 `## 日期` 攒进 `TLT/logs/YYYY-MM.md`，写周报直接抄 |
| 消息 / 通知 / Inbox / 订阅 | 独立的消息中心：消息源、时间线（卡片/轴/分带/热力）、发布与订阅 |

> 和 `obsidian-tasks`、`dataview`、`kanban`、`calendar` 这类插件**不冲突**：TLT 读的是普通 `- [ ]` 行，不要求也不写 `#task` 标签，可以同一个库里共存。

![日历视图：左边项目进度、中间日程与节奏星图、右边消息](docs/screenshots/01-calendar-day.png)

## 截图

| 视图 | 看什么 |
| --- | --- |
| ![任务视图](docs/screenshots/02-tasks.png) | **任务**：逾期 / 要做 / 已完成 / 待排期分组，可按标签筛 |
| ![里程碑视图](docs/screenshots/03-milestones.png) | **里程碑**：项目里每个 `##` 小节一张卡，展开能直接勾任务 |
| ![随手记](docs/screenshots/04-notes.png) | **随手记**：一行一条，标签筛选与标签库 |
| ![人员](docs/screenshots/05-team.png) | **人员**：档案 + 饱和度（本期未完成占比 ÷ 产能） |
| ![消息中心：卡片](docs/screenshots/06-messages-card.png) | **消息中心**：左源、中时间线、右管理 |
| ![可缩放时间轴](docs/screenshots/07-messages-axis.png) | 形态之一：**可缩放时间轴**（滚轮缩放、拖动平移） |
| ![按源分带](docs/screenshots/08-messages-bands.png) | 形态之一：**按源分带**（一个源一条泳道） |
| ![月度热力](docs/screenshots/09-messages-heat.png) | 形态之一：**月度热力**（颜色深浅 = 当天条数） |
| ![设置页·深色](docs/screenshots/10-settings-dark.png) | **设置页**：通用项在最上，目录 / 口径 / 消息服务 / 维护分节，每项都写清默认值与影响 |

## 安装

- **BRAT**（测试版）：装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) → *Add beta plugin* → `sxinyuhoo/TLT-timeline-things`
- **手动**：把 `main.js`、`manifest.json`、`styles.css` 放进 `<vault>/.obsidian/plugins/tlt-timeline-things/`，再到 设置 → 第三方插件 启用

首次启用会按需建目录。想先看效果：**设置 → TLT → 维护 → 生成示例数据**，会写一份虚构样例（人名、项目、消息都是编的），已存在的文件不覆盖。

需要 Obsidian **1.8.7+**（桌面端与移动端都可）。界面语言可在设置里选：跟随 Obsidian／中文／English，漏译的条目会回落成中文。

## 它和别的任务插件不一样的地方

1. **以时间线为主轴**，不是以项目树为主轴。打开就是「今天」：几点做了什么、这天还要做什么、临时插进来什么。项目和里程碑是背后的组织方式，不是入口。
2. **不另存数据**。任务写回原笔记那一行（`🛫 📅 [wl::] [owner::] [tags::] [st::] [en::]`），人员写 frontmatter，消息源就是一串列表项。插件卸载了，文件照样能读、能搜、能双链。
3. **消息中心可以独立使用**。它是单独的页面，只订阅消息、不碰任务，给不用任务管理的同事看通知也成立。

## 六个页签

| 页签 | 干什么 |
| --- | --- |
| **日历** | 当天时间轴（记录 + 计划块）、这天要做的、节奏星图（半径=时间，扇区=项目，滚轮缩放） |
| **任务** | 四组（逾期 / 要做 / 已完成 / 待排期）+ 标签筛选，点一条改截止、占比、优先级、负责人 |
| **里程碑** | 一张卡一个里程碑，展开是任务行，能直接勾完成 |
| **人员** | 档案（岗位 / 产能 / 在岗天数 / 技能）+ 饱和度 + 未来四周负载 |
| **随手记** | 一行一条，`#标签` 打标；标签库可增删改，筛选支持多选 |
| **随手画** | 预留位（草稿 / 白板 / 截图批注） |

右侧常驻消息栏，点「⤢ 消息中心」打开独立页。

## 消息中心

左栏选源，中间看消息，右栏管源。

| 源 | 从哪来 | 右栏能做什么 |
| --- | --- | --- |
| **个人** | 自己的草稿 | 新建消息、**发布消息源**（变成别人能订阅的源） |
| **我发布的** | 发布出来的源 | 手动推送、**取消发布**（内容并回个人） |
| **我订阅的** | 别人发布的源 | **取消订阅**（本地文件进回收站） |

七种展现形态：**卡片 / 河流 / 紧凑 / 按源分带 / 可缩放时间轴 / 月度热力 / 人物脉络**。

消息一行文字 + 可选行内字段，5W 都能填：

```
- 2026-10-22 周报模板定稿 [place:: 三楼] [who:: [[示例同事]], [[张三]]] [why:: 下周对口径] [tags:: 周报]
  > 把模板发群里
```

### 发布与订阅

插件不强制任何服务。三种共享方式：

1. 同一个库走 iCloud / 坚果云同步（最省事）
2. 共享库（网盘 / Git）
3. 跑一个消息服务（跨机器、可给部门用）：`services-py/tlt_service.py`，单进程、单文件、零依赖

```bash
python3 services-py/tlt_service.py --port 8787 --data ./data --seed
```

发布端与订阅端同进程同端口，插件设置里两个地址都填 `http://服务器:8787`。支持本项目 JSON、**RSS 2.0**、**Atom**。

## 数据放在哪

| 路径 | 内容 |
| --- | --- |
| `TLT/tasks/<项目>.md` | 任务：一个项目一个文件，`##` 是里程碑，一行一条任务 |
| `TLT/crew/<姓名>.md` | 人员：frontmatter 存 `role / capacity / days / skills` |
| `TLT/feeds/<源名>.md` | 消息源：一行一条消息 |
| `TLT/logs/<YYYY-MM>.md` | 记录：`## 日期` 分节，时间块 + 正文 |
| `TLT/ideas.md` | 随手记：一行一条 |
| `TLT/tags.md` | 标签库：一行一个 |

字段级格式见 [docs/data-format.md](docs/data-format.md)。

六个路径默认都在库根目录的 `TLT/` 下；**根目录可在设置里改**——它表示「TLT 目录放在哪」，改完点旁边的「更新」重建六项并创建目录（旧目录里还有文件时会问你要不要一起搬）。

## 命令

命令面板（⌘P）里搜 `TLT` 都能找到，可以自己绑快捷键。

**快捷命令**（0.5 起，原生实现，不需要 QuickAdd 之类的插件）

| 命令 | 作用 |
| --- | --- |
| 快捷命令… | 一个总入口，列出下面这些，直接选 |
| 登记任务 | 一句话记一条任务，顺手选项目 / 里程碑 / 时间 / 优先级 / 负责人 |
| 随手记 | 一句想法进想法池（`TLT/ideas.md`），可带 `#标签` |
| 新建消息 | 写一条消息到个人源 / 我发布的源 |
| 新建项目 | 建一个项目文件（`##` 就是里程碑） |
| 新建里程碑 | 给已有项目加一个 `##` 小节 |
| 归档项目 | 项目结束了：整个项目文件移进 `TLT/archive/`，不再出现在工作台 |
| 删除任务 | 选项目 → 选任务 → 确认（两级都可打字过滤，还能跨项目搜） |

列表都能打字过滤、↑↓ 选择、回车确认、Esc 取消。

**其他命令**

| 命令 | 作用 |
| --- | --- |
| 打开工作台 | 主界面 |
| 打开消息中心（独立页） | 只用消息时开这个 |
| 切换明暗 | 在深色 / 浅色之间切 |
| （设置 → 维护）生成示例数据 | 在 `TLT/` 下写一份虚构样例（已存在的不覆盖） |
| 推送到发布服务 / 从拉取服务同步 | 手动同步消息 |

## 工作台里的归档入口

- **项目卡右键**（或悬停出现 `⋯`）：新建里程碑 / 归档项目 / 打开项目文件
- **左侧「已归档 · N」**（默认收起，点标题展开）：列着归档过的项目；点项目名打开文件，右键或 `⋯` 可「还原到开展中」
- **任务行右键**：打开详情 / 删除任务（任务不归档，见下）

归档和还原都会先确认，确认框里写明「从哪搬到哪」「还剩几条未完成」。

## 归档怎么回事

- 归档只做**项目级**：整个 `TLT/tasks/<项目>.md` 搬到 `TLT/archive/`，移出工作台，文件内容和双链都不动。
- **可以还原**：已归档项目右键 →「还原到开展中」，文件搬回 `TLT/tasks/`（同名已存在时加序号，不覆盖）。
- 任务不单独归档。任务的生命周期就是「做完了打勾 / 不想做就删掉」；把某条任务搬到另一个文件会让「一个项目一个文件」不再成立，进度统计也会两边不一致。
- 不删任何内容；想彻底删，走「删除任务」或自己删文件。

## 界面语言

设置 → 外观/通用里的「界面语言」：自动（跟随 Obsidian）/ 中文 / English。

- 切完**立即生效**：设置页、工作台、消息中心、所有弹窗、命令面板里的命令名一起换，不用重启。
- 数据不动：任务标题、项目名、`工作/个人` 这类标签仍按原文写回文件，只有界面文案跟着语言走。

## 隐私与网络

- 只在**你自己配置了消息服务**时才发请求，地址由你填；不配置就完全离线。
- 没有遥测、没有统计、不上传内容。
- 服务地址与发布 ID 存在插件自己的 `data.json` 里。

## 已知边界

- 时间轴不支持拖拽改时间（点击块改时间）。
- 重复任务（`🔁`）不解析。
- 「已读」只在本次会话内，不写回文件。
- 消息的「推送」是整源覆盖，不做增量 diff。

## 开发

```bash
npm install
npm run build      # 产出 main.js
npm test           # 数据层 + 渲染冒烟
npm run test:all   # 含源生命周期、RSS、Python 服务、Hub 端到端
npm run preview    # 导出各视图静态 HTML，用于看样式
```

- TypeScript + esbuild（CJS）；测试用 jsdom + 桩件跑真实渲染。
- 交互验证：`npm run play` 生成能在浏览器里真点的测试台，`npm run serve` 起静态服务。

## 路线图

见 [ROADMAP.md](ROADMAP.md)。下一步是**日历互操作**（导入 macOS 日历 / `.ics`，双向同步）。

## 关键词

任务管理 · 任务清单 · 待办 · 时间线 · 时间轴 · 日程 · 日程安排 · 日历 · 项目 · 项目管理 · 里程碑 · 甘特 · 看板 · 工时 · 工作量 · 饱和度 · 人员排期 · 随手记 · 想法池 · 每日记录 · 周报 · 消息中心 · 通知 · 订阅 · 发布 · 纯 Markdown · 本地优先

tasks · todo · to-do · task manager · task list · checklist · timeline · time line · schedule · scheduler · calendar · planner · project · project management · milestone · gantt · kanban · board · workload · capacity · effort · team · notes · inbox · messages · notifications · feeds · rss · plain markdown · local-first · offline

## 许可

MIT
