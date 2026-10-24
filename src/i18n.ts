/**
 * 界面文案的中英双语。
 *
 * 以中文原文作为 key（gettext 式）：调用处写 t("任务")，英文界面查表换成 Tasks。
 * 表里没有的条目直接回落成中文原文，所以漏译只会显示中文，不会出现空串或 undefined。
 * 用户数据（任务名、消息正文、人员档案）不在这里——它们不是界面文案。
 */
import { getLanguage } from "obsidian";

export type Language = "auto" | "zh" | "en";

/** 中文原文 → 英文译文 */
export const EN: Record<string, string> = {
  /* ---------- 通用 ---------- */
  "取消": "Cancel",
  "保存": "Save",
  "删除": "Delete",
  "创建": "Create",
  "发布": "Publish",
  "确定": "OK",
  "未知错误": "Unknown error",
  "任务：未完成": "Task: open",
  "任务：已完成": "Task: done",
  "同一个人": "Same person",
  "半径＝时间，一圈 7 天": "Radius = time, one ring = 7 days",
  "内圈是今天；扇区＝项目；滚轮缩放、拖动平移": "Inner ring is today; sectors = projects; scroll to zoom, drag to pan",
  "源名称：{name}": "Feed name: {name}",

  "TLT 加载出错：{msg}": "TLT failed to load: {msg}",
  "关闭": "Off",
  "全部": "All",
  "本周": "This week",
  "本月": "This month",
  "本季度": "This quarter",
  "今天": "Today",
  "回到今天": "Back to today",
  "新建": "New",
  "＋ 新建": "＋ New",
  "暂无": "None",

  /* ---------- 主题与语言 ---------- */
  "主题": "Theme",
  "跟随 Obsidian": "Match Obsidian",
  "跟随系统": "Match system",
  "深色": "Dark",
  "浅色": "Light",
  "跟随 Obsidian，或强制深色/浅色。主界面右上角也能切。": "Follow Obsidian, or force dark/light. Also switchable from the top-right of the main view.",
  "界面语言": "Interface language",
  "设置面板与插件界面用什么语言。": "Language used by the settings panel and the plugin UI.",
  "自动（跟随 Obsidian）": "Automatic (match Obsidian)",

  /* ---------- 设置：目录 ---------- */
  "目录": "Folders",
  "根目录": "Root folder",
  "TLT 目录放在这里：下面六项都在它的 TLT 子目录下；留空表示放在库根目录（即 TLT/）。输入时可直接选已有目录；目录不存在就先手打。点「更新」时连数据一起搬过去。":
    "The TLT folder lives here: the six paths below sit under its TLT subfolder; leave empty to put it at the vault root (i.e. TLT/). Pick an existing folder while typing, or type a new one. Click Update to move your data over as well.",
  "TLT 目录放在这里：下面六项都在它的 TLT 子目录下；留空表示放在库根目录（即 TLT/）。输入时有候选可 Tab/点击选中；目录不存在就先手打。点「更新」时连数据一起搬过去。":
    "The TLT folder lives here: the six paths below sit under its TLT subfolder; leave empty to put it at the vault root (i.e. TLT/). Suggestions appear while typing (Tab or click to pick), or type a new path. Click Update to move your data over as well.",
  "任务目录": "Tasks folder",
  "一个项目一个文件，## 小节是里程碑，任务一行一条。": "One file per project; a ## heading is a milestone; one task per line.",
  "人员目录": "People folder",
  "人员目录已由 TLT/team 改为 TLT/crew": "People folder moved from TLT/team to TLT/crew",
  "一人一个文件，frontmatter 写 role / capacity / days / skills。": "One file per person; put role / capacity / days / skills in the frontmatter.",
  "消息源目录": "Feeds folder",
  "一个源一个文件，正文列表一行一条消息。": "One file per feed; each list item in the body is one message.",
  "记录目录": "Logs folder",
  "按月一个文件，正文用 ## 日期 分节。": "One file per month; split days with ## date headings.",
  "随手记文件": "Notes file",
  "单文件，一行一条。": "A single file, one note per line.",
  "标签库文件": "Tags file",
  "单文件，一行一个标签。": "A single file, one tag per line.",

  /* ---------- 设置：口径 ---------- */
  "口径": "Period",
  "默认占比周期": "Default workload period",
  "占比与饱和度的默认口径，界面上随时可切。": "Default period for workload and saturation; switchable in the UI at any time.",

  /* ---------- 设置：消息服务 ---------- */
  "消息服务": "Message service",
  "发布服务地址": "Publish service URL",
  "把「我发布的源」推到这里。发布端与订阅端可以是同一个地址。": "Published feeds are pushed here. The publish and pull endpoints can be the same address.",
  "拉取服务地址": "Pull service URL",
  "从这里同步订阅的源。留空则完全离线，只用库内 Markdown。": "Subscribed feeds are pulled from here. Leave empty to stay fully offline with local Markdown only.",
  "自动同步间隔": "Auto-pull interval",
  "按这个间隔自动拉取订阅的源。": "Pull subscribed feeds at this interval.",
  "自动推送间隔": "Auto-push interval",
  "按这个间隔把我发布的源推上去。": "Push my published feeds at this interval.",
  "5 分钟": "5 minutes",
  "15 分钟": "15 minutes",
  "30 分钟": "30 minutes",
  "1 小时": "1 hour",

  /* ---------- 设置：维护 ---------- */
  "维护": "Maintenance",
  "推送到发布服务": "Push to publish service",
  "立刻把所有「我发布的源」推一遍。": "Push every published feed right now.",
  "从拉取服务同步": "Sync from pull service",
  "立刻拉取一次订阅的源。": "Pull subscribed feeds once, right now.",
  "更新": "Update",
  "按根目录重建六个路径并创建目录": "Rebuild the six paths from the root folder and create the folders",
  "按上面的根目录重建六个路径，并把旧目录里的数据一起搬过去（目标已有同名文件时才会问你）。":
    "Rebuild the six paths from the root folder above and move the existing data over (you are only asked when a file with the same name is already at the destination).",
  "已记录新的根目录，点「更新」生效": "New root folder recorded — click Update to apply",
  "六个路径已更新，目录已就位": "Six paths updated; folders are ready",
  "已搬 {n} 个文件到新目录": "moved {n} file(s) to the new folder",
  "旧目录 {dir} 已清空，空文件夹保留（需要的话自行删除）": "old folder {dir} is now empty; the empty folders are kept (delete them if you like)",
  "旧目录 {dir} 仍有 {n} 个文件（同名未覆盖）": "{n} file(s) still in the old folder {dir} (same-name files were not overwritten)",
  "取消更新": "Cancel update",
  "确认搬运": "Move files",
  "已取消更新，设置与目录都保持原样": "Update cancelled — settings and folders are unchanged",
  "{n} 项路径已同步": "{n} path(s) synced",
  "{n} 项手工设置保持不变": "{n} hand-set path(s) kept as-is",
  "已搬 {n} 个文件到 {dir}": "moved {n} file(s) to {dir}",
  "目录已就位": "folders are ready",
  "已按根目录更新六个路径，目录已就位": "Six paths rebuilt from the root folder; folders are ready",
  "根目录已更新；旧目录里还有 {n} 个文件，点「更新」可以搬过去": "Root folder updated; {n} file(s) are still in the old folder — click Update to move them over",
  "生成示例数据": "Generate sample data",
  "写一份虚构的样例（人名和项目都是编的），方便先看界面。已存在的文件不覆盖。":
    "Write a fictional sample (made-up names and projects) so you can see the UI. Existing files are never overwritten.",
  "根目录已更新": "Root folder updated",
  "已把 {n} 个文件搬到 {dir}（旧目录空了，文件夹可以自己删）": "Moved {n} file(s) to {dir} (the old folders are now empty and can be deleted)",
  "根目录已更新，{n} 项自定义路径保持不变": "Root folder updated; {n} custom path(s) left untouched",
  "六个路径已按根目录重排，目录已就位": "All six paths re-aligned to the root folder; folders are ready",
  "目录已更新": "Folder updated",
  "已记录，点「更新」生效": "Recorded — click Update to apply",

  /* ---------- 工作台 ---------- */
  "日历": "Calendar",
  "任务": "Tasks",
  "里程碑": "Milestones",
  "开展中": "In progress",
  "已完成": "Done",
  "人员": "People",
  "随手记": "Notes",
  "随手画": "Sketch",
  "时间线工作台": "Timeline workbench",
  "打开工作台": "Open workbench",
  "打开消息中心（独立页）": "Open message center (own tab)",
  "新建任务": "New task",
  "切换明暗": "Toggle theme",
  "项目 · 进度": "Projects · progress",
  "已按项目筛选": "filtered by project",
  "只看这一个项目，点击回到全部": "Showing this project only — click to go back to all",
  "项目 • 进度": "Projects · progress",
  "{dir} 里还没有任务文件": "No task files in {dir} yet",
  "搜索任务/记录": "Search tasks / logs",
  "条带": "Bars",
  "星图": "Star map",
  "节奏": "Rhythm",
  "完成": "Done",
  "未完成": "Open",
  "逾期": "Overdue",
  "待排期": "Unscheduled",

  /* ---------- 消息中心 ---------- */
  "消息中心": "Message center",
  "个人": "Personal",
  "我发布的": "Published",
  "我订阅的": "Subscribed",
  "新建消息": "New message",
  "新建消息到这个源": "New message in this feed",
  "发布消息源…": "Publish this feed…",
  "手动推送": "Push now",
  "取消发布": "Unpublish",
  "取消订阅": "Unsubscribe",
  "推送我的源": "Push my feeds",
  "同步订阅": "Sync subscriptions",
  "订阅这个源": "Subscribe to this feed",
  "feeds/ 里还没有源": "No feeds in feeds/ yet",
  "没有符合条件的消息": "No messages match",
  "这个范围里没有消息": "No messages in this range",
  "这天没有消息": "No messages on this day",
  "近 7 天": "Last 7 days",
  "近7天": "Last 7 days",
  "近 30 天": "Last 30 days",
  "近30天": "Last 30 days",
  "这天要做的": "To do that day",
  "点一下排进时间表": "click one to put it on the schedule",
  "都排上了": "Everything is scheduled",
  "这天 · 计划与实际": "That day · plan vs actual",
  "节奏 · 21 天": "Rhythm · 21 days",
  "＋ 添加成员": "＋ Add member",
  "＋ 随手记": "＋ Note",
  "{dir} 里还没有人员档案": "No people in {dir} yet",
  "记一条 · {d}": "Log one · {d}",
  "卡片": "Cards",
  "河流": "River",
  "紧凑": "Compact",
  "按源分带": "Bands by feed",
  "可缩放时间轴": "Zoomable axis",
  "月度热力": "Monthly heat",
  "人物脉络": "People threads",

  /* ---------- 弹窗字段 ---------- */
  "任务名": "Task name",
  "做了什么": "What did you do",
  "项目": "Project",
  "负责人": "Owner",
  "日期": "Date",
  "开始": "Start",
  "结束": "End",
  "占比": "Workload",
  "优先级": "Priority",
  "标签": "Tags",
  "步骤": "Steps",
  "标题": "Title",
  "内容": "Details",
  "时间": "Time",
  "地点": "Place",
  "人物": "People",
  "缘由": "Why",
};

let current: Language = "zh";

/** 自动模式：用 Obsidian 自己的语言（中文系一律按简体中文处理） */
function detect(): "zh" | "en" {
  try {
    const lang = getLanguage() || "";
    if (lang) return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    /* 测试替身里没有这个 API，退回浏览器语言 */
  }
  const nav = typeof navigator === "undefined" ? "" : navigator.language || "";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** 跟随设置切换语言；auto 会按环境判断 */
export function setLanguage(setting: string | undefined): void {
  current = setting === "zh" || setting === "en" ? setting : detect();
}

export function currentLanguage(): "zh" | "en" {
  return current === "en" ? "en" : "zh";
}

/** 取当前语言下的文案；vars 用 {name} 占位 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  const template = currentLanguage() === "zh" ? zh : EN[zh] ?? zh;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

/** 语言下拉里的选项，任何语言下都按各自母语显示 */
export const LANGUAGE_LABELS: Record<Exclude<Language, "auto">, string> = {
  zh: "中文",
  en: "English",
};
