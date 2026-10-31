/**
 * TLT 数据层：纯函数，不依赖 Obsidian API（便于单测）。
 * 语法约定见 docs/SYNTAX.md。
 */

/**
 * 把正文里第 i 个待办项翻个面（`- [ ]` ↔ `- [x]`）。找不到就原样返回。
 * 顺手把 `- [X]` 统一成小写 x。
 */
export function toggleMdCheckbox(text: string, idx: number): string {
  const lines = String(text || "").split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*[-*+]\s+\[)([ xX])(\]\s.*)$/.exec(lines[i]);
    if (!m) continue;
    seen += 1;
    if (seen !== idx) continue;
    lines[i] = `${m[1]}${m[2].trim() === "" ? "x" : " "}${m[3]}`;
    return lines.join("\n");
  }
  return text;
}

/** 任务属于工作还是个人：**只认 `[scope:: 个人]`**（老数据已一次性迁移过来，别再猜 tags） */
export function taskScopeOf(f: Record<string, string>): "工作" | "个人" {
  return f["scope"] === "个人" ? "个人" : "工作";
}

export type Pri = 0 | 1 | 2 | 3;   // 0 是历史值（老的「低」），读取时归到 1
export type Period = "w" | "m" | "q";

export interface Step { done: boolean; text: string; }

export interface Task {
  id: string;
  file: string;
  line: number;
  raw: string;
  title: string;
  done: boolean;
  start?: string;
  due?: string;
  /**
   * 排期日：被「排进时间表」时落在哪一天。
   * 和截止日**没有关系**——排期是"打算哪天做这件事"，截止是"最晚什么时候要交"。
   * 老数据没有这个字段：按截止日（已完成则按完成日）算。
   */
  plan?: string;
  st?: string;
  en?: string;
  wl: number;
  est?: number;          // 人天（新口径）
  pw: Period;
  pri: Pri;
  owners: string[];
  tags: string[];
  scope: "工作" | "个人";
  project: string;
  milestone?: string;
  steps: Step[];
  /** 生命周期时间：创建 / 完成（写回文件，界面默认不显示） */
  created?: string;
  doneAt?: string;
  extra?: boolean;
  kind: "task" | "log";
  files: string[];
  /** 记录的正文（kind === "log" 时从续行读到） */
  note?: string;
}

export interface Staff {
  name: string; file: string; role: string; capacity: number; days: number;
  skills: string[]; status: "active" | "leave" | "left"; note: string; color: string;
}

export interface Msg {
  id: string; feed: string; date: string; title: string; kind: "ask" | "event" | "risk" | "note";
  place: string; who: string[]; pin: string; star: boolean;
  state: "live" | "ended";
  /** 截止时间（可空 = 长期有效） */
  until: string;
  /** 结束发布时间：点「结束这条」时自动补，恢复时去掉 */
  ended: string;
  body: string;
  /** 5W 里剩下的两个：为什么（缘由/背景）与主题标签 */
  why: string; tags: string[];
  /** 已读只在本次会话内，不写回文件 */
  read_?: boolean;
}

export interface Feed {
  id: string; file: string;
  /** 界面显示用：有本地别名就用别名，否则用（发布者给的）名字 */
  name: string;
  desc: string; cadence: string;
  owner: string; mine: boolean; items: Msg[]; remote?: string; personal?: boolean;
  /** 订阅别人的源时：只改自己看到的叫法，不动对方的名称 */
  alias?: string;
  /** 发布者给的原始名称（本地有别名时用来对照显示） */
  remoteTitle?: string;
}

export interface Idea {
  id: string; file: string; line: number; title: string; body: string;
  type: string; stage: string; star: number; at: string; src: string; tags: string[];
}

/* ---------------- 通用 ---------------- */

/** catch 里拿到的是 unknown，取一条能显示的文案 */
export const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "未知错误";

/** frontmatter / 行内字段的取值统一按字符串读，非标量当空串 */
export const asText = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const FIELD_RE = /\[([a-zA-Z\u4e00-\u9fa5]+)::\s*((?:\[\[[^\]]*\]\]|[^\]])*)\]/g;

export function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(line)) !== null) out[m[1].trim()] = m[2].trim();
  return out;
}

export function links(v: string): string[] {
  if (!v) return [];
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v)) !== null) out.push(m[1].trim());
  if (!out.length) out.push(...v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
  return out;
}

export function stripFields(line: string): string {
  return line.replace(FIELD_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** 从行内移除某个字段（用于改写时避免重复） */
export function dropField(line: string, key: string): string {
  return line.replace(new RegExp(`\\s*\\[${key}::\\s*(?:\\[\\[[^\\]]*\\]\\]|[^\\]])*\\]`, "g"), "");
}

export function setField(line: string, key: string, value: string | number | null): string {
  const base = dropField(line, key).replace(/\s+$/, "");
  if (value === null || value === "") return base;
  return `${base} [${key}:: ${value}]`;
}

export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const D = (s?: string) => (s ? parseDate(s) : new Date(NaN));
export const todayISO = () => iso(new Date());

export function addDays(s: string, n: number): string {
  const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d);
}

export function hhmmToMin(t?: string): number {
  if (!t) return NaN;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToHHMM(m: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

/* ---------------- 任务 ---------------- */

const DATE_EMOJI: Record<string, "start" | "due"> = { "🛫": "start", "📅": "due" };
const DONE_EMOJI = ["✅"];

/**
 * 解析一行任务：
 * - [ ] 标题 🛫 2026-10-20 📅 2026-10-25 [wl:: 30] [pw:: m] [pri:: 2] [owner:: [[甲]]]
 */
export function parseTaskLine(
  raw: string, ctx: { file: string; line: number; project: string; milestone?: string; steps?: Step[] }
): Task | null {
  const m = /^(\s*)([-*+])\s+\[(.)\]\s+(.*)$/.exec(raw);
  if (!m) return null;
  const done = m[3].toLowerCase() === "x";
  let body = m[4];

  const f = fields(body);
  let start: string | undefined;
  let due: string | undefined;
  for (const [emoji, key] of Object.entries(DATE_EMOJI)) {
    const re = new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const hit = re.exec(body);
    if (hit) { (key === "start" ? (start = hit[1]) : (due = hit[1])); body = body.replace(hit[0], ""); }
  }
  for (const e of DONE_EMOJI) {
    const re = new RegExp(`${e}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const hit = re.exec(body);
    if (hit) { if (!due) due = hit[1]; body = body.replace(hit[0], ""); }
  }

  const title = stripFields(body).replace(/\s{2,}/g, " ").trim();
  if (!title) return null;

  const pri = (parseInt(f["pri"] || "1", 10) || 1) as Pri;
  return {
    id: `${ctx.file}#${ctx.line}`,
    file: ctx.file, line: ctx.line, raw,
    title, done, start, due,
    plan: f["plan"] || undefined,
    st: f["st"] || undefined, en: f["en"] || undefined,
    wl: parseInt(f["wl"] || "0", 10) || 0,
    est: f["est"] !== undefined ? Number(f["est"]) : undefined,
    pw: (f["pw"] as Period) || "m",
    pri: (Math.max(1, Math.min(3, pri)) as Pri),   // 0（低）不再支持：一律归到「普通」
    owners: links(f["owner"] || f["who"] || ""),
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    scope: taskScopeOf(f),
    project: ctx.project,
    milestone: ctx.milestone,
    steps: ctx.steps || [],
    created: f["created"] || undefined,
    doneAt: f["done"] || undefined,
    extra: f["extra"] === "true",
    kind: (f["kind"] as "task" | "log") === "log" ? "log" : "task",
    files: links(f["out"] || ""),
  };
}

/** 生成一行新任务 */
export function newTaskLine(t: Partial<Task> & { title: string }): string {
  let s = `- [ ] ${t.title}`;
  if (t.start) s += ` 🛫 ${t.start}`;
  if (t.due) s += ` 📅 ${t.due}`;
  if (t.plan) s += ` [plan:: ${t.plan}]`;
  if (t.est) s += ` [est:: ${t.est}]`;
  if (t.wl) s += ` [wl:: ${t.wl}]`;
  if (t.pw && t.pw !== "m") s += ` [pw:: ${t.pw}]`;
  if (t.pri && t.pri !== 1) s += ` [pri:: ${t.pri}]`;
  if (t.owners && t.owners.length) s += ` [owner:: ${t.owners.map((o) => `[[${o}]]`).join(", ")}]`;
  if (t.tags && t.tags.length) s += ` [tags:: ${t.tags.join(", ")}]`;
  if (t.scope === "个人") s += ` [scope:: 个人]`;
  if (t.st) s += ` [st:: ${t.st}]`;
  if (t.en) s += ` [en:: ${t.en}]`;
  if (t.created) s += ` [created:: ${t.created}]`;
  if (t.doneAt) s += ` [done:: ${t.doneAt}]`;
  if (t.files && t.files.length) s += ` [out:: ${t.files.map((o) => `[[${o}]]`).join(", ")}]`;
  return s;
}

/** 翻转勾选；force=true 强制勾上、false 强制取消（补改完成时间时要保持"已完成"） */
export function toggleTaskLine(raw: string, force?: boolean): string {
  return raw.replace(/^(\s*[-*+]\s+\[)(.)(\])/, (_m: string, a: string, c: string, b: string) => {
    const on = force === undefined ? c.toLowerCase() !== "x" : force;
    return `${a}${on ? "x" : " "}${b}`;
  });
}

export function setTaskDue(raw: string, due: string): string {
  if (/📅\s*\d{4}-\d{2}-\d{2}/.test(raw)) return raw.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `📅 ${due}`);
  return raw.replace(/(\[[^\]]*\]\s*)?$/, (tail) => ` 📅 ${due}${tail}`);
}

export function setTaskField(raw: string, key: string, value: string | number | null): string {
  return setField(raw, key, value);
}

/* ---------------- 人员 ---------------- */

export function parseStaff(name: string, file: string, fm: Record<string, unknown>): Staff {
  const num = (v: unknown, dflt: number) => (v === undefined || v === null || v === "" ? dflt : Number(v) || dflt);
  return {
    name,
    file,
    role: asText(fm["role"]),
    capacity: num(fm["capacity"], 100),
    days: num(fm["days"], 5),
    skills: Array.isArray(fm["skills"]) ? fm["skills"].map((x) => asText(x)) : asText(fm["skills"]).split(/[,，]/).filter(Boolean),
    status: (fm["status"] || "active") as Staff["status"],
    note: asText(fm["note"]),
    color: asText(fm["color"]),
  };
}

/* ---------------- 消息源 ---------------- */

/** 解析一条消息行：- 2026-10-21 标题 [kind:: ask] [place:: 会议室] [pin:: 里程碑] [star:: true] */
/** 消息的"内容键"（日期+标题+类型）：订阅同步时用它认"这条还在不在"，不受 mid 变化影响 */
export function msgKeyOf(date: string, title: string, kind: string): string {
  return `${date}|${title.trim()}|${kind || "note"}`;
}

export function parseMsgLine(line: string, feedId: string, bodyLines: string[]): Msg | null {
  const m = /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+)$/.exec(line);
  if (!m) return null;
  const f = fields(m[2]);
  const title = stripFields(m[2]).trim();
  if (!title) return null;
  return {
    id: f["mid"] || `${feedId}#${title.slice(0, 12)}`,
    feed: feedId,
    date: m[1] || f["date"] || todayISO(),
    title,
    kind: ((f["kind"] as Msg["kind"]) || "note"),
    place: f["place"] || "",
    who: links(f["who"] || ""),
    pin: f["pin"] || "",
    star: f["star"] === "true",
    state: (f["state"] as Msg["state"]) || "live",
    until: f["until"] || "",
    ended: f["ended"] || "",
    body: bodyLines.join("\n").replace(/^\s*>\s?/gm, "").trim(),
    why: f["why"] || "",
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
  };
}

export function newMsgLine(m: Partial<Msg> & { title: string }): string {
  let s = `- ${m.date || todayISO()} ${m.title}`;
  if (m.kind && m.kind !== "note") s += ` [kind:: ${m.kind}]`;
  if (m.place) s += ` [place:: ${m.place}]`;
  if (m.pin) s += ` [pin:: ${m.pin}]`;
  if (m.star) s += ` [star:: true]`;
  if (m.until) s += ` [until:: ${m.until}]`;
  if (m.ended) s += ` [ended:: ${m.ended}]`;
  if (m.who && m.who.length) s += ` [who:: ${m.who.map((o) => `[[${o}]]`).join(", ")}]`;
  if (m.why) s += ` [why:: ${m.why}]`;
  if (m.tags && m.tags.length) s += ` [tags:: ${m.tags.join(", ")}]`;
  if (m.state === "ended") s += ` [state:: ended]`;
  return s;
}

/* ---------------- 记录 / 时间块 ---------------- */

/**
 * 月文件：
 * ## 2026-10-20
 * - 09:30–11:00 做了什么 [proj:: 示例项目] [kind:: log]
 *   > 正文
 */
export function parseLogMonth(content: string, file: string): Task[] {
  const out: Task[] = [];
  let day = "";
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (h) { day = h[1]; continue; }
    const m = /^\s*[-*+]\s+(?:(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})\s+)?(.+)$/.exec(line);
    if (!m || !day) continue;
    const f = fields(m[3]);
    const title = stripFields(m[3]).trim();
    if (!title) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && /^\s{2,}>/.test(lines[j])) { body.push(lines[j]); j++; }
    out.push({
      id: `${file}#${i}`, file, line: i, raw: line,
      title, done: false,
      note: body.length ? body.map((b) => b.replace(/^\s{2,}>\s?/, "")).join("\n").trim() : undefined,
      due: day, st: m[1], en: m[2],
      wl: 0, pw: "m", pri: 1,
      owners: links(f["who"] || ""),
      tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    scope: taskScopeOf(f),
      project: f["proj"] || "",
      milestone: f["ms"] || undefined,
      steps: [],
      extra: f["extra"] === "true",
      kind: "log",
      files: links(f["out"] || ""),
    });
    if (f["z"] === "1") out[out.length - 1].note = body.join("\n");
  }
  return out;
}

export function newLogLine(t: { st?: string; en?: string; title: string; project?: string; body?: string }): string {
  let s = "- ";
  if (t.st) s += `${t.st}${t.en ? "–" + t.en : ""} `;
  s += t.title;
  if (t.project) s += ` [proj:: ${t.project}]`;
  if (t.body) s += `\n  > ${t.body.replace(/\n/g, "\n  > ")}`;
  return s;
}

/* ---------------- 想法 ---------------- */

export function parseIdeaLine(line: string, file: string, idx: number, body: string): Idea | null {
  const m = /^\s*[-*+]\s+(.+)$/.exec(line);
  if (!m) return null;
  const f = fields(m[1]);
  const title = stripFields(m[1]).trim();
  if (!title) return null;
  return {
    id: `${file}#${idx}`, file, line: idx, title, body,
    // 不兜默认值：没写 type/stage 就是没有。以前兜成「想法」「沉淀」，
    // 导致每条随手记都凭空显示一个「想法」标签，删掉保存后又回来（解析时又生成了）。
    type: f["type"] || "",
    stage: f["stage"] || "",
    star: parseInt(f["star"] || "1", 10) || 1,
    at: f["at"] || todayISO(),
    src: f["src"] || "",
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
  };
}

/** 用户可能粘贴 `@url:\`http://...\`` / `url: ...` / `<...>`，统一清洗 */
export function cleanFeedUrl(raw: string): string {
  return String(raw).trim()
    .replace(/^@url\s*[:：]\s*/i, "")
    .replace(/^url\s*[:：]\s*/i, "")
    .replace(/^[<`"'\s]+|[>`"'\s]+$/g, "");
}

/** 任务标题里的快捷语法：明天 / 周五 / 10/25 / !! / #里程碑 */
export function parseQuick(text: string) {
  let t = String(text).trim();
  let pri = 1;
  const bang = /!+/.exec(t);
  if (bang) { pri = bang[0].length >= 2 ? 3 : 2; t = t.replace(bang[0], "").trim(); }
  let milestone: string | undefined;
  const ms = /#([^\s#]+)/.exec(t);
  if (ms) { milestone = ms[1]; t = t.replace(ms[0], "").trim(); }
  let due = todayISO();
  const now = new Date();
  const rel: [RegExp, number][] = [[/今天/, 0], [/明天/, 1], [/后天/, 2], [/下周/, 7]];
  for (const [re, n] of rel) {
    if (re.test(t)) { due = addDays(todayISO(), n); t = t.replace(re, "").trim(); break; }
  }
  const wk = /周([一二三四五六日天])/.exec(t);
  if (wk) {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const diff = (map[wk[1]] - now.getDay() + 7) % 7 || 7;
    due = addDays(todayISO(), diff); t = t.replace(wk[0], "").trim();
  }
  const md = /(\d{1,2})\/(\d{1,2})/.exec(t);
  if (md) {
    due = iso(new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2])));
    t = t.replace(md[0], "").trim();
  }
  return { title: t || "未命名任务", due, pri, milestone };
}

/* ---------------- 想法语法 ---------------- */

export const IDEA_TYPES = ["论文", "专利", "产品", "工具", "预研", "个人项目", "想法"];
export const IDEA_STAGES = ["沉淀", "待验证", "已验证", "已立项", "搁置"];

/** 筛选用的标签：只取类型与 #标签，不含阶段 */
export function ideaFilterTags(it: { type?: string; tags?: string[] }): string[] {
  const out = (it.tags || []).slice();
  // 「想法」是老数据里的类型名，不是标签——别把它混进标签列表（否则删不掉、一直冒出来）
  if (it.type && it.type !== "想法" && !out.includes(it.type)) out.unshift(it.type);
  return out;
}

/** 显示用的标签：老数据里的 type/stage 也当作标签，新的只用 #标签 */
export function ideaTags(it: { type?: string; stage?: string; tags?: string[] }): string[] {
  const out: string[] = [];
  if (it.type && it.type !== "想法") out.push(it.type);
  if (it.stage && it.stage !== "沉淀") out.push(it.stage);
  (it.tags || []).forEach((t) => { if (!out.includes(t)) out.push(t); });
  return out;
}

/** `#论文 @待验证 ** 标题` → {title,type,stage,star}
 *  宽容：全角＊、类型前后空格、`@立项` 等同 `@已立项`、星写在任意位置 */
/** 只用 `#标签`：`#论文 #测试 一句话` → tags=[论文,测试], title=一句话 */
export function parseIdeaText(text: string) {
  let t = String(text).replace(/\u3000/g, " ").trim();
  const tags: string[] = [];
  t = t.replace(/[#＃]\s*([^\s#＃]+)/g, (_m, word: string) => {
    const w = word.replace(/[*＊]+$/, "");
    if (w) tags.push(w);
    return " ";
  });
  return { title: t.replace(/\s{2,}/g, " ").trim() || "未命名想法", tags };
}

/* ---------------- 周期与饱和度 ---------------- */

/** 某个日期是否落在周期内（w=本周一~周日, m=当月, q=当季） */
export function inPeriod(dateISO: string, period: Period, ref = new Date()): boolean {
  if (!dateISO) return false;
  const d = parseDate(dateISO);
  if (period === "m") return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  if (period === "q") {
    const q = Math.floor(ref.getMonth() / 3);
    return d.getFullYear() === ref.getFullYear() && Math.floor(d.getMonth() / 3) === q;
  }
  const start = new Date(ref); start.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const k = iso(d);
  return k >= iso(start) && k <= iso(end);
}

/** 周期内可用人天：每周在岗天数 × 周数 × 产能 */
export function availableDays(period: Period, days = 5, capacity = 100) {
  const weeks = period === "w" ? 1 : period === "m" ? 4.33 : 13;
  return days * weeks * (capacity / 100);
}

/**
 * 饱和度（人天口径）：周期内未完成任务的 est 之和 ÷ 可用人天。
 * 老数据只有 [wl:: 30]（占比）时，按 `占比 × 该周期可用人天` 折算成人天，避免数字凭空消失。
 */
export function saturation(
  tasks: Task[], person: string, period: Period,
  opts: { capacity?: number; days?: number } = {}, ref = new Date()
) {
  const avail = availableDays(period, opts.days ?? 5, opts.capacity ?? 100);
  const sum = tasks
    .filter((t) => t.kind === "task" && !t.done && t.owners.includes(person) && inPeriod(t.due || "", period, ref))
    .reduce((n, t) => n + (t.est !== undefined ? t.est : t.wl ? (t.wl / 100) * avail : 0), 0);
  return { sum: Math.round(sum * 10) / 10, avail: Math.round(avail * 10) / 10, pct: avail ? Math.round((sum / avail) * 100) : 0 };
}

/**
 * 一个人的工作量拆解——把「为什么是 0」摊开给人看。
 * 百分比＝**本周期内**未完成任务的人天 ÷ 可用人天，所以只有三件事都齐了才会进这个数：
 * 人分对了、任务有截止日（落在本周期）、任务填了工作量（est 或旧的 wl）。
 * 缺哪个就在哪个桶里，卡片上直接写出来，别让人对着 0 猜。
 */
/** 人员视图的时间窗口：本月 / 下个月 / 全部（全部＝不看日期，所有未完成任务都算） */
export type StaffDim = "m" | "nm" | "all";

/** 下个月的起止（ISO） */
export function nextMonthBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 2, 0);
  return { start: iso(start), end: iso(end), label: `${start.getFullYear()} 年 ${start.getMonth() + 1} 月` };
}

/** 某个任务算不算进这个窗口 */
export function inStaffWindow(due: string | undefined, dim: StaffDim, ref = new Date()): boolean {
  if (dim === "all") return true;
  if (!due) return false;
  if (dim === "m") return inPeriod(due, "m", ref);
  const b = nextMonthBounds(ref);
  return due >= b.start && due <= b.end;
}

/** 窗口对应的可用人天：本月/下月＝一个月，全部＝一个季度（分母写清楚，别让人误会） */
export function staffWindowDays(dim: StaffDim, days = 5, capacity = 100) {
  return availableDays(dim === "all" ? "q" : "m", days, capacity);
}

export function workloadBreakdown(
  tasks: Task[], person: string, period: Period | StaffDim,
  opts: { capacity?: number; days?: number } = {}, ref = new Date()
) {
  const mine = tasks.filter((t) => t.kind === "task" && !t.done && t.owners.includes(person));
  const inWin = mine.filter((t) => (period === "w" || period === "q"
    ? t.due && inPeriod(t.due, period, ref)
    : inStaffWindow(t.due, period, ref)));
  const noDue = mine.filter((t) => !t.due);
  const noEst = inWin.filter((t) => t.est === undefined && !t.wl);
  const est = inWin.filter((t) => t.est !== undefined || t.wl);
  // 与人天口径同一套算法：est 优先，老数据只有 wl 就按占比折算出人天
  const avail = staffWindowDays(period === "w" || period === "q" ? "m" : period, opts.days ?? 5, opts.capacity ?? 100);
  const sum = inWin.reduce((n, t) => n + (t.est !== undefined ? t.est : t.wl ? (t.wl / 100) * avail : 0), 0);
  const round1 = (x: number) => Math.round(x * 10) / 10;
  return {
    mine, inWin, noDue, noEst, est,
    /** 有截止日、但不在这个窗口里（例如排到下个月） */
    otherPeriod: mine.filter((t) => t.due && !inWin.includes(t)).length,
    /** 这个周期到底有没有"能算"的数据：没有就别显示 0%，那个 0 是假的 */
    hasEst: est.length > 0,
    sum: round1(sum),
    avail: round1(avail),
    pct: avail ? Math.round((sum / avail) * 100) : 0,
  };
}

export function monthBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { start: iso(start), end: iso(end), label: `${ref.getFullYear()} 年 ${ref.getMonth() + 1} 月` };
}
