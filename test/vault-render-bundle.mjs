// test/obsidian-stub.ts
var TFile = class {
  path = "";
  basename = "";
  name = "";
  extension = "md";
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() || path;
    this.basename = this.name.replace(/\.md$/, "");
  }
};
function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
}
var ItemView = class {
  app;
  leaf;
  containerEl;
  contentEl;
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf?.app ?? globalThis.__app;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
    document.body.appendChild(this.containerEl);
  }
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
  getIcon() {
    return "";
  }
  async onOpen() {
  }
  async onClose() {
  }
};
var Modal = class {
  app;
  contentEl;
  containerEl;
  modalEl;
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal";
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.modalEl);
    document.body.appendChild(this.containerEl);
  }
  open() {
    this.onOpen?.();
  }
  close() {
    this.onClose?.();
    this.containerEl.remove();
  }
};
var Notice = class {
  constructor(message) {
    this.message = message;
    globalThis.__notices?.push(message);
  }
};
async function requestUrl(req) {
  const res = await fetch(req.url, {
    method: req.method || "GET",
    headers: req.contentType ? { "content-type": req.contentType } : void 0,
    body: req.body
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: text ? JSON.parse(text) : null
  };
}

// src/data.ts
var errMsg = (e) => e instanceof Error ? e.message : typeof e === "string" ? e : "\u672A\u77E5\u9519\u8BEF";
var asText = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
var FIELD_RE = /\[([a-zA-Z\u4e00-\u9fa5]+)::\s*((?:\[\[[^\]]*\]\]|[^\]])*)\]/g;
function fields(line) {
  const out = {};
  let m;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(line)) !== null) out[m[1].trim()] = m[2].trim();
  return out;
}
function links(v) {
  if (!v) return [];
  const out = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(v)) !== null) out.push(m[1].trim());
  if (!out.length) out.push(...v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
  return out;
}
function stripFields(line) {
  return line.replace(FIELD_RE, "").replace(/\s{2,}/g, " ").trim();
}
function dropField(line, key) {
  return line.replace(new RegExp(`\\s*\\[${key}::\\s*(?:\\[\\[[^\\]]*\\]\\]|[^\\]])*\\]`, "g"), "");
}
function setField(line, key, value) {
  const base = dropField(line, key).replace(/\s+$/, "");
  if (value === null || value === "") return base;
  return `${base} [${key}:: ${value}]`;
}
function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
var D = (s) => s ? parseDate(s) : /* @__PURE__ */ new Date(NaN);
var todayISO = () => iso(/* @__PURE__ */ new Date());
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function hhmmToMin(t2) {
  if (!t2) return NaN;
  const [h, m] = t2.split(":").map(Number);
  return h * 60 + (m || 0);
}
function minToHHMM(m) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}
var DATE_EMOJI = { "\u{1F6EB}": "start", "\u{1F4C5}": "due" };
var DONE_EMOJI = ["\u2705"];
function parseTaskLine(raw, ctx) {
  const m = /^(\s*)([-*+])\s+\[(.)\]\s+(.*)$/.exec(raw);
  if (!m) return null;
  const done = m[3].toLowerCase() === "x";
  let body = m[4];
  const f = fields(body);
  let start;
  let due;
  for (const [emoji, key] of Object.entries(DATE_EMOJI)) {
    const re = new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const hit = re.exec(body);
    if (hit) {
      key === "start" ? start = hit[1] : due = hit[1];
      body = body.replace(hit[0], "");
    }
  }
  for (const e of DONE_EMOJI) {
    const re = new RegExp(`${e}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const hit = re.exec(body);
    if (hit) {
      if (!due) due = hit[1];
      body = body.replace(hit[0], "");
    }
  }
  const title = stripFields(body).replace(/\s{2,}/g, " ").trim();
  if (!title) return null;
  const pri = parseInt(f["pri"] || "1", 10) || 0;
  return {
    id: `${ctx.file}#${ctx.line}`,
    file: ctx.file,
    line: ctx.line,
    raw,
    title,
    done,
    start,
    due,
    st: f["st"] || void 0,
    en: f["en"] || void 0,
    wl: parseInt(f["wl"] || "0", 10) || 0,
    est: f["est"] !== void 0 ? Number(f["est"]) : void 0,
    pw: f["pw"] || "m",
    pri: Math.max(0, Math.min(3, pri)),
    owners: links(f["owner"] || f["who"] || ""),
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    scope: f["scope"] === "\u4E2A\u4EBA" ? "\u4E2A\u4EBA" : "\u5DE5\u4F5C",
    project: ctx.project,
    milestone: ctx.milestone,
    steps: ctx.steps || [],
    extra: f["extra"] === "true",
    kind: f["kind"] === "log" ? "log" : "task",
    files: links(f["out"] || "")
  };
}
function newTaskLine(t2) {
  let s = `- [ ] ${t2.title}`;
  if (t2.start) s += ` \u{1F6EB} ${t2.start}`;
  if (t2.due) s += ` \u{1F4C5} ${t2.due}`;
  if (t2.est) s += ` [est:: ${t2.est}]`;
  if (t2.wl) s += ` [wl:: ${t2.wl}]`;
  if (t2.pw && t2.pw !== "m") s += ` [pw:: ${t2.pw}]`;
  if (t2.pri && t2.pri !== 1) s += ` [pri:: ${t2.pri}]`;
  if (t2.owners && t2.owners.length) s += ` [owner:: ${t2.owners.map((o) => `[[${o}]]`).join(", ")}]`;
  if (t2.tags && t2.tags.length) s += ` [tags:: ${t2.tags.join(", ")}]`;
  if (t2.scope === "\u4E2A\u4EBA") s += ` [scope:: \u4E2A\u4EBA]`;
  if (t2.st) s += ` [st:: ${t2.st}]`;
  if (t2.en) s += ` [en:: ${t2.en}]`;
  if (t2.extra) s += ` [extra:: true]`;
  if (t2.files && t2.files.length) s += ` [out:: ${t2.files.map((o) => `[[${o}]]`).join(", ")}]`;
  return s;
}
function toggleTaskLine(raw) {
  return raw.replace(/^(\s*[-*+]\s+\[)(.)(\])/, (_m, a, c, b) => `${a}${c.toLowerCase() === "x" ? " " : "x"}${b}`);
}
function setTaskDue(raw, due) {
  if (/📅\s*\d{4}-\d{2}-\d{2}/.test(raw)) return raw.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `\u{1F4C5} ${due}`);
  return raw.replace(/(\[[^\]]*\]\s*)?$/, (tail) => ` \u{1F4C5} ${due}${tail}`);
}
function setTaskField(raw, key, value) {
  return setField(raw, key, value);
}
function parseStaff(name, file, fm) {
  const num = (v, dflt) => v === void 0 || v === null || v === "" ? dflt : Number(v) || dflt;
  return {
    name,
    file,
    role: asText(fm["role"]),
    capacity: num(fm["capacity"], 100),
    days: num(fm["days"], 5),
    skills: Array.isArray(fm["skills"]) ? fm["skills"].map((x) => asText(x)) : asText(fm["skills"]).split(/[,，]/).filter(Boolean),
    status: fm["status"] || "active",
    note: asText(fm["note"]),
    color: asText(fm["color"])
  };
}
function parseMsgLine(line, feedId, bodyLines) {
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
    kind: f["kind"] || "note",
    place: f["place"] || "",
    who: links(f["who"] || ""),
    pin: f["pin"] || "",
    star: f["star"] === "true",
    state: f["state"] || "live",
    until: f["until"] || "",
    body: bodyLines.join("\n").replace(/^\s*>\s?/gm, "").trim(),
    why: f["why"] || "",
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  };
}
function newMsgLine(m) {
  let s = `- ${m.date || todayISO()} ${m.title}`;
  if (m.kind && m.kind !== "note") s += ` [kind:: ${m.kind}]`;
  if (m.place) s += ` [place:: ${m.place}]`;
  if (m.pin) s += ` [pin:: ${m.pin}]`;
  if (m.star) s += ` [star:: true]`;
  if (m.until) s += ` [until:: ${m.until}]`;
  if (m.who && m.who.length) s += ` [who:: ${m.who.map((o) => `[[${o}]]`).join(", ")}]`;
  if (m.why) s += ` [why:: ${m.why}]`;
  if (m.tags && m.tags.length) s += ` [tags:: ${m.tags.join(", ")}]`;
  if (m.state === "ended") s += ` [state:: ended]`;
  return s;
}
function parseLogMonth(content, file) {
  const out = [];
  let day = "";
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (h) {
      day = h[1];
      continue;
    }
    const m = /^\s*[-*+]\s+(?:(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})\s+)?(.+)$/.exec(line);
    if (!m || !day) continue;
    const f = fields(m[3]);
    const title = stripFields(m[3]).trim();
    if (!title) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && /^\s{2,}>/.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    out.push({
      id: `${file}#${i}`,
      file,
      line: i,
      raw: line,
      title,
      done: false,
      due: day,
      st: m[1],
      en: m[2],
      wl: 0,
      pw: "m",
      pri: 1,
      owners: links(f["who"] || ""),
      tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      scope: f["scope"] === "\u4E2A\u4EBA" ? "\u4E2A\u4EBA" : "\u5DE5\u4F5C",
      project: f["proj"] || "",
      milestone: f["ms"] || void 0,
      steps: [],
      extra: f["extra"] === "true",
      kind: "log",
      files: links(f["out"] || "")
    });
    if (f["z"] === "1") out[out.length - 1].note = body.join("\n");
  }
  return out;
}
function newLogLine(t2) {
  let s = "- ";
  if (t2.st) s += `${t2.st}${t2.en ? "\u2013" + t2.en : ""} `;
  s += t2.title;
  if (t2.project) s += ` [proj:: ${t2.project}]`;
  if (t2.extra) s += ` [extra:: true]`;
  if (t2.body) s += `
  > ${t2.body.replace(/\n/g, "\n  > ")}`;
  return s;
}
function parseIdeaLine(line, file, idx, body) {
  const m = /^\s*[-*+]\s+(.+)$/.exec(line);
  if (!m) return null;
  const f = fields(m[1]);
  const title = stripFields(m[1]).trim();
  if (!title) return null;
  return {
    id: `${file}#${idx}`,
    file,
    line: idx,
    title,
    body,
    type: f["type"] || "\u60F3\u6CD5",
    stage: f["stage"] || "\u6C89\u6DC0",
    star: parseInt(f["star"] || "1", 10) || 1,
    at: f["at"] || todayISO(),
    src: f["src"] || "",
    tags: (f["tags"] || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  };
}
function cleanFeedUrl(raw) {
  return String(raw).trim().replace(/^@url\s*[:：]\s*/i, "").replace(/^url\s*[:：]\s*/i, "").replace(/^[<`"'\s]+|[>`"'\s]+$/g, "");
}
function ideaFilterTags(it) {
  const out = (it.tags || []).slice();
  if (it.type && !out.includes(it.type)) out.unshift(it.type);
  return out;
}
function ideaTags(it) {
  const out = [];
  if (it.type && it.type !== "\u60F3\u6CD5") out.push(it.type);
  if (it.stage && it.stage !== "\u6C89\u6DC0") out.push(it.stage);
  (it.tags || []).forEach((t2) => {
    if (!out.includes(t2)) out.push(t2);
  });
  return out;
}
function parseIdeaText(text) {
  let t2 = String(text).replace(/\u3000/g, " ").trim();
  const tags = [];
  t2 = t2.replace(/[#＃]\s*([^\s#＃]+)/g, (_m, word) => {
    const w = word.replace(/[*＊]+$/, "");
    if (w) tags.push(w);
    return " ";
  });
  return { title: t2.replace(/\s{2,}/g, " ").trim() || "\u672A\u547D\u540D\u60F3\u6CD5", tags };
}
function inPeriod(dateISO, period, ref = /* @__PURE__ */ new Date()) {
  if (!dateISO) return false;
  const d = parseDate(dateISO);
  if (period === "m") return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  if (period === "q") {
    const q = Math.floor(ref.getMonth() / 3);
    return d.getFullYear() === ref.getFullYear() && Math.floor(d.getMonth() / 3) === q;
  }
  const start = new Date(ref);
  start.setDate(ref.getDate() - (ref.getDay() + 6) % 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const k = iso(d);
  return k >= iso(start) && k <= iso(end);
}
function availableDays(period, days = 5, capacity = 100) {
  const weeks = period === "w" ? 1 : period === "m" ? 4.33 : 13;
  return days * weeks * (capacity / 100);
}
function saturation(tasks, person, period, opts = {}, ref = /* @__PURE__ */ new Date()) {
  const avail = availableDays(period, opts.days ?? 5, opts.capacity ?? 100);
  const sum = tasks.filter((t2) => t2.kind === "task" && !t2.done && t2.owners.includes(person) && inPeriod(t2.due || "", period, ref)).reduce((n, t2) => n + (t2.est !== void 0 ? t2.est : t2.wl ? t2.wl / 100 * avail : 0), 0);
  return { sum: Math.round(sum * 10) / 10, avail: Math.round(avail * 10) / 10, pct: avail ? Math.round(sum / avail * 100) : 0 };
}
function monthBounds(ref = /* @__PURE__ */ new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { start: iso(start), end: iso(end), label: `${ref.getFullYear()} \u5E74 ${ref.getMonth() + 1} \u6708` };
}

// src/store.ts
var PEOPLE_COLORS = ["#F0C24B", "#6C8CFF", "#27C1A3", "#B57BFF", "#F2994A", "#FF7A9C", "#5FD6B4", "#7C8BA1"];
var Store = class {
  constructor(app, settings) {
    this.tasks = [];
    this.logs = [];
    this.staff = [];
    this.feeds = [];
    this.ideas = [];
    this.loaded = false;
    this.loading = null;
    /* ---------- 标签库（TLT/tags.md，一行一个） ---------- */
    this.tags = [];
    this.app = app;
    this.settings = settings;
  }
  /* ---------------- 读 ---------------- */
  inFolder(path, folder) {
    const f = folder.replace(/\/+$/, "");
    return path === f || path.startsWith(f + "/");
  }
  filesIn(folder) {
    return this.app.vault.getMarkdownFiles().filter((f) => this.inFolder(f.path, folder));
  }
  async ensureFolder(folder) {
    const parts = normalizePath(folder).split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch {
        }
      }
    }
  }
  /** 个人源：私用草稿，可从这里发布 */
  async ensurePersonalFeed() {
    const path = normalizePath(`${this.settings.feedsFolder}/\u4E2A\u4EBA.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    await this.ensureFolder(this.settings.feedsFolder);
    await this.app.vault.create(
      path,
      `---
title: \u4E2A\u4EBA
personal: true
owner: me
---

# \u4E2A\u4EBA

\uFF08\u53EA\u6709\u81EA\u5DF1\u770B\u7684\u8349\u7A3F\uFF1B\u4ECE\u8FD9\u91CC\u53EF\u4EE5\u53D1\u5E03\u5230\u300C\u6211\u53D1\u5E03\u7684\u6E90\u300D\uFF09
`
    );
  }
  async ensureVault() {
    await this.ensureFolder(this.settings.tasksFolder);
    await this.ensureFolder(this.settings.teamFolder);
    await this.ensureFolder(this.settings.feedsFolder);
    await this.ensureFolder(this.settings.logsFolder);
    await this.ensureFolder(this.settings.ideasFile.split("/").slice(0, -1).join("/") || ".");
    await this.ensurePersonalFeed();
  }
  /** 只加载一次；并发调用共用同一个 Promise（视图在插件 onload 完成前就恢复时会用到） */
  async ensureLoaded() {
    if (this.loaded) return;
    const pending = this.loading ?? this.load().finally(() => {
      this.loading = null;
    });
    this.loading = pending;
    await pending;
  }
  async load() {
    this.tasks = [];
    this.logs = [];
    this.staff = [];
    this.feeds = [];
    this.ideas = [];
    this.tags = [];
    for (const file of this.filesIn(this.settings.tasksFolder)) {
      const text = await this.app.vault.cachedRead(file);
      const project = file.basename;
      let milestone;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const h = /^##\s+(.+?)\s*$/.exec(line);
        if (h) {
          milestone = h[1].trim();
          continue;
        }
        if (/^#\s/.test(line)) {
          milestone = void 0;
          continue;
        }
        const t2 = parseTaskLine(line, { file: file.path, line: i, project, milestone });
        if (!t2) continue;
        const steps = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}[-*+]\s+\[.\]/.test(lines[j])) {
          const s = /^\s{2,}[-*+]\s+\[(.)\]\s+(.*)$/.exec(lines[j]);
          if (s) steps.push({ done: s[1].toLowerCase() === "x", text: s[2].replace(/\[[a-zA-Z\u4e00-\u9fa5]+::[^\]]*\]/g, "").trim() });
          j++;
        }
        if (steps.length) t2.steps = steps;
        this.tasks.push(t2);
        i = j - 1;
      }
    }
    const staff = this.filesIn(this.settings.teamFolder);
    staff.forEach((file, idx) => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const s = parseStaff(file.basename, file.path, fm);
      if (!s.color) s.color = PEOPLE_COLORS[idx % PEOPLE_COLORS.length];
      this.staff.push(s);
    });
    for (const file of this.filesIn(this.settings.feedsFolder)) {
      const text = await this.app.vault.cachedRead(file);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const lines = text.split(/\r?\n/);
      const items = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^#/.test(lines[i])) continue;
        if (!/^\s*[-*+]\s+/.test(lines[i])) continue;
        const body = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}>/.test(lines[j])) {
          body.push(lines[j]);
          j++;
        }
        const m = parseMsgLine(lines[i], file.basename, body);
        if (m) items.push(m);
        i = j - 1;
      }
      this.feeds.push({
        id: file.basename,
        file: file.path,
        name: asText(fm["title"]) || file.basename,
        desc: asText(fm["desc"]) || asText(fm["description"]),
        cadence: asText(fm["cadence"]),
        owner: asText(fm["owner"]),
        mine: fm["mine"] === true || fm["owner"] === "me",
        remote: asText(fm["remote"]),
        personal: fm["personal"] === true,
        items
      });
    }
    for (const file of this.filesIn(this.settings.logsFolder)) {
      const text = await this.app.vault.cachedRead(file);
      this.logs.push(...parseLogMonth(text, file.path));
    }
    const ideasPath = normalizePath(this.settings.ideasFile);
    const ideaFile = this.asFile(this.app.vault.getAbstractFileByPath(ideasPath));
    if (ideaFile) {
      const text = await this.app.vault.cachedRead(ideaFile);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const body = [];
        let j = i + 1;
        while (j < lines.length && /^\s{2,}>/.test(lines[j])) {
          body.push(lines[j].replace(/^\s*>\s?/, ""));
          j++;
        }
        const it = parseIdeaLine(lines[i], ideaFile.path, i, body.join("\n"));
        if (it) this.ideas.push(it);
        i = Math.max(i, j - 1);
      }
    }
    await this.loadTags();
    this.loaded = true;
  }
  /* ---------------- 写 ---------------- */
  asFile(f) {
    return f instanceof TFile ? f : null;
  }
  async fileByPath(path) {
    return this.asFile(this.app.vault.getAbstractFileByPath(normalizePath(path)));
  }
  /** 只改目标那一行，不重写整个文件 */
  async patchLine(path, lineNo, fn) {
    const file = await this.fileByPath(path);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      if (lineNo < 0 || lineNo >= lines.length) return data;
      lines[lineNo] = fn(lines[lineNo]);
      return lines.join("\n");
    });
    return true;
  }
  /** 删除一条任务（连同它下面缩进的步骤） */
  async deleteTask(t2) {
    const file = await this.fileByPath(t2.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = t2.line;
      if (!/^\s*[-*+]\s+\[[ xX]\]/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l) && l.includes(t2.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}[-*+]\s+\[[ xX]\]/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }
  async toggleTask(t2) {
    await this.patchLine(t2.file, t2.line, toggleTaskLine);
  }
  async setDue(t2, due) {
    await this.patchLine(t2.file, t2.line, (l) => setTaskDue(l, due));
  }
  async setField(t2, key, value) {
    await this.patchLine(t2.file, t2.line, (l) => setTaskField(l, key, value));
  }
  /** 追加任务到项目文件；若里程碑段落不存在则补 H2 */
  async addTask(project, milestone, t2) {
    await this.ensureFolder(this.settings.tasksFolder);
    const path = normalizePath(`${this.settings.tasksFolder}/${project}.md`);
    let file = await this.fileByPath(path);
    const line = newTaskLine(t2);
    if (!file) {
      const head = `# ${project}

${milestone ? `## ${milestone}

` : ""}${line}
`;
      await this.app.vault.create(path, head);
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      if (milestone) {
        const h = lines.findIndex((l) => new RegExp(`^##\\s+${milestone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(l));
        if (h >= 0) {
          let anchor = h + 1;
          for (let i = h + 1; i < lines.length; i++) {
            if (/^#{1,2}\s/.test(lines[i])) break;
            if (/^\s*[-*+]\s+\[.\]/.test(lines[i])) anchor = i + 1;
          }
          lines.splice(anchor, 0, line);
          return lines.join("\n");
        }
        lines.push("", `## ${milestone}`, "", line);
        return lines.join("\n");
      }
      lines.push(line);
      return lines.join("\n");
    });
  }
  /** 追加记录到月文件（按 ## 日期分节） */
  async addLog(dateISO, rec) {
    await this.ensureFolder(this.settings.logsFolder);
    const month = dateISO.slice(0, 7);
    const path = normalizePath(`${this.settings.logsFolder}/${month}.md`);
    let file = await this.fileByPath(path);
    const body = newLogLine(rec);
    if (!file) {
      await this.app.vault.create(path, `# \u8BB0\u5F55 ${month}

## ${dateISO}

${body}
`);
      return;
    }
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const h = lines.findIndex((l) => new RegExp(`^##\\s+${dateISO}\\s*$`).test(l));
      if (h < 0) {
        lines.push("", `## ${dateISO}`, "", body);
        return lines.join("\n");
      }
      let anchor = h + 1;
      for (let i = h + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        if (/^\s*[-*+]\s+/.test(lines[i])) {
          anchor = i + 1;
          while (anchor < lines.length && /^\s{2,}>/.test(lines[anchor])) anchor++;
        }
      }
      lines.splice(anchor, 0, body);
      return lines.join("\n");
    });
  }
  /** 新建一个「我发布的源」文件 */
  async createFeed(id, name) {
    const safe = id.replace(/[\\/:*?"<>|]/g, "-");
    const path = normalizePath(`${this.settings.feedsFolder}/${safe}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return { ok: false, path };
    await this.ensureFolder(this.settings.feedsFolder);
    await this.app.vault.create(path, `---
title: ${name}
owner: me
mine: true
---

# ${name}

`);
    return { ok: true, path };
  }
  /** 改源名称：只改 frontmatter 的 title，文件名与 id 不动 */
  async renameFeed(feed, name) {
    const n = name.trim();
    if (!n) return false;
    const file = await this.fileByPath(feed.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      if (/^---\r?\n/.test(data)) {
        const end = data.indexOf("\n---", 3);
        const head = end > 0 ? data.slice(0, end) : data;
        const rest = end > 0 ? data.slice(end) : "";
        const next = /^title:.*$/m.test(head) ? head.replace(/^title:.*$/m, `title: ${n}`) : `${head}
title: ${n}`;
        return next + rest;
      }
      return `---
title: ${n}
---

${data}`;
    });
    feed.name = n;
    return true;
  }
  /** 从一个源里搬走若干条消息（连同正文续行） */
  async takeMessages(from, msgs) {
    const file = await this.fileByPath(from.file);
    if (!file) return;
    const keys = msgs.map((m) => `${m.date}\0${m.title}`);
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const m = /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l);
        if (m && keys.includes(`${m[1] || ""}\0${stripFields(m[2]).trim()}`)) {
          while (i + 1 < lines.length && /^\s{2,}>/.test(lines[i + 1])) i++;
          continue;
        }
        out.push(l);
      }
      return out.join("\n");
    });
  }
  /**
   * 发布一个源：
   * - 个人 → 我发布的：新建 `feeds/<id>.md`，把选中的草稿搬过去
   * - 已是发布源：只改 id/名称/说明
   */
  async publishSource(from, opts) {
    const name = (opts.name || "").trim();
    if (!name) return { ok: false, reason: "empty" };
    const remembered = (this.settings.feedIds || {})[from.id];
    const banned = new Set('\\/:*?"<>|#[]^'.split(""));
    const clean = (t2) => Array.from(t2).map((c) => banned.has(c) ? "-" : c).join("");
    let id = remembered || clean(name).replace(/\s+/g, "-").slice(0, 40) || "feed";
    let target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
    if (!remembered) {
      let base = id, n = 2;
      while (this.app.vault.getAbstractFileByPath(target) && target !== from.file) {
        id = `${base}-${n++}`;
        target = normalizePath(`${this.settings.feedsFolder}/${id}.md`);
      }
    }
    const head = [
      "---",
      `title: ${name}`,
      "owner: me",
      "mine: true",
      opts.desc ? `desc: ${opts.desc}` : "",
      opts.cadence ? `cadence: ${opts.cadence}` : "",
      "---",
      "",
      `# ${name}`,
      ""
    ].filter((x, i) => x !== "" || i === 3).join("\n") + "\n";
    const lineOf = (m) => newMsgLine(m) + (m.body ? `
  > ${m.body.replace(/\r?\n/g, "\n  > ")}` : "");
    const msgs = from.items.slice();
    const keyOf = (date, title) => `${date}\0${title}`;
    const file = this.asFile(this.app.vault.getAbstractFileByPath(target));
    let moved = 0;
    if (!file) {
      await this.ensureFolder(this.settings.feedsFolder);
      await this.app.vault.create(target, head + msgs.map(lineOf).join("\n") + "\n");
      moved = msgs.length;
    } else {
      const old = await this.app.vault.cachedRead(file);
      const have = new Set(
        old.split(/\r?\n/).map((l) => /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l)).filter(Boolean).map((m) => keyOf(m[1] || "", stripFields(m[2]).trim()))
      );
      const fresh = msgs.filter((m) => !have.has(keyOf(m.date, m.title)));
      await this.app.vault.process(file, (data) => {
        const updated = /^---\r?\n[\s\S]*?\r?\n---/.test(data) ? data.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_all, body) => {
          const b = /^title:.*$/m.test(body) ? body.replace(/^title:.*$/m, `title: ${name}`) : `${body}
title: ${name}`;
          return `---
${b}
---`;
        }) : `${head}${data}`;
        const tail = fresh.length ? `
${fresh.map(lineOf).join("\n")}` : "";
        return `${updated.replace(/\s*$/, "")}
${tail}
`.replace(/\n{3,}/g, "\n\n");
      });
      moved = fresh.length;
    }
    if (from.file !== target && msgs.length) {
      try {
        await this.takeMessages(from, msgs);
      } catch {
      }
    }
    this.settings.feedIds = { ...this.settings.feedIds || {}, [from.id]: id };
    return { ok: true, path: target, moved, id };
  }
  /** 取消发布：把内容并回个人源，然后把这个源文件删掉（进系统回收站） */
  async foldBackToPersonal(feed, personalId) {
    const personal = this.feeds.find((f) => f.id === personalId);
    const home = personal ? personal.file : normalizePath(`${this.settings.feedsFolder}/${personalId}.md`);
    const src = await this.fileByPath(feed.file);
    let body = "";
    if (src) {
      const raw = await this.app.vault.read(src);
      body = String(raw).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s*#.*$/gm, "").trim();
    }
    const count = (body.match(/^\s*[-*+]\s+/gm) || []).length;
    let pf = await this.fileByPath(home);
    if (!pf) {
      const t2 = personal ? personal.name : "\u4E2A\u4EBA";
      await this.ensureFolder(this.settings.feedsFolder);
      await this.app.vault.create(home, `---
title: ${t2}
personal: true
owner: me
---

# ${t2}

`);
      pf = await this.fileByPath(home);
    }
    if (!pf) return -1;
    if (body) {
      await this.app.vault.process(pf, (data) => {
        const have = new Set(
          data.split(/\r?\n/).map((l) => /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l)).filter(Boolean).map((m) => `${m[1] || ""}\0${stripFields(m[2]).trim()}`)
        );
        const add = body.split(/\r?\n/).filter((l) => {
          const m = /^\s*[-*+]\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)(?:\s+\[|$)/.exec(l);
          if (!m) return false;
          return !have.has(`${m[1] || ""}\0${stripFields(m[2]).trim()}`);
        });
        return `${data.replace(/\s*$/, "")}
${add.join("\n")}
`;
      });
    }
    await this.trashFeedFile(feed);
    return count;
  }
  /** 删掉一个源文件（默认进回收站，可直接恢复） */
  async trashFeedFile(feed) {
    const file = await this.fileByPath(feed.file);
    if (!file) return false;
    try {
      const fm = this.app.fileManager;
      if (fm && typeof fm.trashFile === "function") {
        await fm.trashFile(file);
        return true;
      }
    } catch {
    }
    return false;
  }
  /** 在某个源里发布一条消息 */
  async addMessage(feedName, m) {
    const feed = this.feeds.find((f) => f.id === feedName);
    const path = feed ? feed.file : normalizePath(`${this.settings.feedsFolder}/${feedName}.md`);
    let file = await this.fileByPath(path);
    const line = newMsgLine(m) + (m.body ? `
  > ${m.body.replace(/\n/g, "\n  > ")}` : "");
    if (!file) {
      const head = `---
title: ${feedName}
mine: true
owner: me
---

# ${feedName}

${line}
`;
      await this.app.vault.create(path, head);
      return;
    }
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}
${line}
`);
  }
  /** 改一条消息：整行 + 续行一起重写（5W 都在行内字段里） */
  async updateMessage(feedId, msg, patch) {
    const feed = this.feeds.find((f) => f.id === feedId);
    const path = feed ? feed.file : normalizePath(`${this.settings.feedsFolder}/${feedId}.md`);
    const file = await this.fileByPath(path);
    if (!file) return false;
    const next = { ...msg, ...patch, feed: feedId, id: msg.id, title: patch.title ?? msg.title };
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(msg.title) && (l.includes(`[mid:: ${msg.id}]`) || !msg.id.includes("#")));
      if (start < 0) start = lines.findIndex((l) => l.includes(msg.title));
      if (start < 0) return data;
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      const head = newMsgLine(next) + (next.body ? `
  > ${next.body.replace(/\r?\n/g, "\n  > ")}` : "");
      lines.splice(start, end - start, ...head.split("\n"));
      return lines.join("\n");
    });
    return true;
  }
  /** 改写记录正文：替换该行后面的引用块 */
  async updateLogBody(log, body) {
    const file = await this.fileByPath(log.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = log.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => l.includes(log.title) && /^\s*[-*+]\s+/.test(l));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      const quoted = body.trim() ? body.trim().split(/\r?\n/).map((l) => `  > ${l}`) : [];
      lines.splice(start + 1, end - start - 1, ...quoted);
      return lines.join("\n");
    });
    return true;
  }
  /** 删除一条记录（含它的引用块） */
  async deleteLog(log) {
    const file = await this.fileByPath(log.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = log.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => l.includes(log.title) && /^\s*[-*+]\s+/.test(l));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }
  async setMsgState(feedName, msg, state) {
    const feed = this.feeds.find((f) => f.id === feedName);
    if (!feed) return;
    const file = await this.fileByPath(feed.file);
    if (!file) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!/^\s*[-*+]\s+/.test(lines[i])) continue;
        if (!lines[i].includes(msg.title)) continue;
        if (msg.date && !lines[i].includes(msg.date)) continue;
        lines[i] = state === "live" ? setTaskField(lines[i], "state", null) : setTaskField(lines[i], "state", "ended");
        break;
      }
      return lines.join("\n");
    });
  }
  async loadTags() {
    const path = normalizePath(this.settings.tagsFile || "TLT/tags.md");
    const file = await this.fileByPath(path);
    if (!file) {
      this.tags = [];
      return;
    }
    const text = await this.app.vault.cachedRead(file);
    this.tags = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*+]\s*/, "").trim()).filter((l) => l && !l.startsWith("#"));
  }
  async tagsFileOrCreate() {
    const path = normalizePath(this.settings.tagsFile || "TLT/tags.md");
    let file = await this.fileByPath(path);
    if (!file) {
      await this.ensureFolder(path.split("/").slice(0, -1).join("/") || ".");
      await this.app.vault.create(path, `# \u6807\u7B7E

`);
      file = await this.fileByPath(path);
    }
    return file;
  }
  async addTag(name) {
    const n = name.trim().replace(/^#/, "");
    if (!n || this.tags.includes(n)) return false;
    const file = await this.tagsFileOrCreate();
    if (!file) return false;
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}
- ${n}
`);
    this.tags.push(n);
    return true;
  }
  /** 改名：标签库 + 所有用到它的随手记一起改 */
  async renameTag(from, to) {
    const n = to.trim().replace(/^#/, "");
    if (!n || n === from) return false;
    const file = await this.tagsFileOrCreate();
    if (file) {
      await this.app.vault.process(file, (data) => data.split(/\r?\n/).map((l) => /^\s*[-*+]\s+/.test(l) && l.replace(/^\s*[-*+]\s*/, "").trim() === from ? `- ${n}` : l).join("\n"));
    }
    for (const it of this.ideas) {
      if (!(it.tags || []).includes(from)) continue;
      it.tags = (it.tags || []).map((t2) => t2 === from ? n : t2);
      await this.updateIdea(it);
    }
    this.tags = this.tags.map((t2) => t2 === from ? n : t2);
    return true;
  }
  async deleteTag(name) {
    const file = await this.tagsFileOrCreate();
    if (file) {
      await this.app.vault.process(file, (data) => `${data.split(/\r?\n/).filter((l) => !(/^\s*[-*+]\s+/.test(l) && l.replace(/^\s*[-*+]\s*/, "").trim() === name)).join("\n")}
`);
    }
    for (const it of this.ideas) {
      if (!(it.tags || []).includes(name)) continue;
      it.tags = (it.tags || []).filter((t2) => t2 !== name);
      await this.updateIdea(it);
    }
    this.tags = this.tags.filter((t2) => t2 !== name);
    return true;
  }
  async addIdea(it) {
    const path = normalizePath(this.settings.ideasFile);
    let file = await this.fileByPath(path);
    const line = `- ${it.title} [at:: ${todayISO()}]` + (it.tags && it.tags.length ? ` [tags:: ${it.tags.join(", ")}]` : "") + (it.body ? `
  > ${it.body}` : "");
    if (!file) {
      await this.app.vault.create(path, `# \u60F3\u6CD5\u6C60

${line}
`);
      return;
    }
    await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}
${line}
`);
  }
  async deleteIdea(it) {
    const file = await this.fileByPath(it.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = it.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(it.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      lines.splice(start, end - start);
      return lines.join("\n");
    });
    return true;
  }
  async updateIdea(it) {
    const file = await this.fileByPath(it.file);
    if (!file) return false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split(/\r?\n/);
      let start = it.line;
      if (!/^\s*[-*+]\s+/.test(lines[start] || "")) {
        start = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.includes(it.title));
        if (start < 0) return data;
      }
      let end = start + 1;
      while (end < lines.length && /^\s{2,}>/.test(lines[end])) end++;
      let head = `- ${it.title} [at:: ${it.at}]`;
      if (it.tags && it.tags.length) head += ` [tags:: ${it.tags.join(", ")}]`;
      const body = it.body && it.body.trim() ? it.body.trim().split(/\r?\n/).map((l) => `  > ${l}`) : [];
      lines.splice(start, end - start, head, ...body);
      return lines.join("\n");
    });
    return true;
  }
  /* ---------------- 人员 ---------------- */
  async addStaff(name) {
    const path = normalizePath(`${this.settings.teamFolder}/${name}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return false;
    await this.ensureFolder(this.settings.teamFolder);
    await this.app.vault.create(path, `---
tlt: staff
role: \u7B97\u6CD5\u5DE5\u7A0B\u5E08
capacity: 100
days: 5
skills: []
status: active
---

# ${name}
`);
    return true;
  }
  async removeStaff(staff) {
    const f = this.asFile(this.app.vault.getAbstractFileByPath(staff.file));
    if (!f) return false;
    await this.app.fileManager.trashFile(f);
    return true;
  }
  /* ---------------- Hub：发布 / 拉取 ---------------- */
  /** 统一走 requestUrl：不受 CORS 限制，也不触发审核的 fetch 警告 */
  async httpJson(url, init = {}) {
    const res = await requestUrl({
      url,
      method: init.method || "GET",
      contentType: "application/json",
      body: init.body === void 0 ? void 0 : JSON.stringify(init.body),
      throw: false
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return res.json;
  }
  /** 把一个本地源的全部消息推给发布服务 */
  async publishFeed(feed, hubUrl, publishId) {
    const base = hubUrl.replace(/\/$/, "");
    const pid = publishId || (this.settings.feedIds || {})[feed.id] || feed.id;
    await this.httpJson(`${base}/register`, {
      method: "POST",
      body: { id: pid, title: feed.name, desc: feed.desc, owner: feed.owner }
    });
    const items = feed.items.map((m, i) => ({
      mid: `${pid}-${m.date}-${i}`,
      date: m.date,
      title: m.title,
      kind: m.kind,
      place: m.place,
      who: m.who,
      star: m.star,
      state: m.state,
      until: m.until,
      body: m.body
    }));
    return await this.httpJson(`${base}/publish`, {
      method: "POST",
      body: { id: pid, title: feed.name, items }
    });
  }
  /** 取消发布：从发布服务上摘掉这个源 */
  async unpublishFeed(publishId, hubUrl) {
    const base = hubUrl.replace(/\/$/, "");
    try {
      await this.httpJson(`${base}/feed?id=${encodeURIComponent(publishId)}`, { method: "DELETE" });
      return true;
    } catch {
      return false;
    }
  }
  /** 给拉取服务加一个订阅地址 */
  /** 订阅（按规范化 URL 去重，返回 { ok, count, existed }） */
  async subscribeRemote(syncUrl, feedUrl, name) {
    const base = syncUrl.replace(/\/$/, "");
    const norm = (u) => {
      try {
        const x = new URL(u);
        return `${x.origin}${x.pathname}?${decodeURIComponent(x.search.replace(/^\?/, ""))}`;
      } catch {
        return u;
      }
    };
    const mine = this.feeds.filter((f) => f.mine);
    if (mine.some((f) => norm(feedUrl).includes(`id=${f.id}`) || norm(feedUrl).includes(`id=${encodeURIComponent(f.id)}`))) {
      return { ok: false, count: 0, existed: true, reason: "self" };
    }
    const cur = await this.httpJson(`${base}/subscriptions`).catch(() => ({ subs: [] }));
    const subs = cur.subs ?? [];
    if (subs.some((sub) => norm(sub.url ?? "") === norm(feedUrl))) {
      return { ok: true, count: subs.length, existed: true };
    }
    const res = await this.httpJson(`${base}/subscribe`, { method: "POST", body: { url: feedUrl, name } });
    return { ...res, existed: false };
  }
  async unsubscribeRemote(syncUrl, feedUrl) {
    const base = syncUrl.replace(/\/$/, "");
    try {
      await this.httpJson(`${base}/subscribe?url=${encodeURIComponent(feedUrl)}`, { method: "DELETE" });
      return true;
    } catch {
      return false;
    }
  }
  /** 从拉取服务同步：把远端消息写进 TLT/feeds/<id>.md（按 mid 去重） */
  async pullFromHub(syncUrl) {
    const base = syncUrl.replace(/\/$/, "");
    const data = await this.httpJson(`${base}/pull`);
    let added = 0, updated = 0;
    for (const feed of data.feeds ?? []) {
      const items = feed.items ?? [];
      if (!feed.ok || !items.length) continue;
      const title = asText(feed.title) || asText(feed.id) || "\u8FDC\u7A0B\u6E90";
      const rawId = title;
      const id = rawId.replace(/[\\/:*?"<>|]/g, "-");
      const path = normalizePath(`${this.settings.feedsFolder}/\u8FDC\u7A0B-${id}.md`);
      let file = this.asFile(this.app.vault.getAbstractFileByPath(path));
      if (!file) {
        await this.ensureFolder(this.settings.feedsFolder);
        file = await this.app.vault.create(
          path,
          `---
title: ${title}
remote: ${asText(feed.url)}
own: false
---

# ${title}

`
        );
      }
      await this.app.vault.process(file, (text) => {
        const lines = text.split(/\r?\n/);
        for (const it of items) {
          const mid = asText(it.mid) || `${id}-${asText(it.date)}-${asText(it.title)}`;
          const idx = lines.findIndex((l) => l.includes(`[mid:: ${mid}]`));
          const stateField = it.state === "ended" ? " [state:: ended]" : "";
          if (idx >= 0) {
            if (it.state === "ended" && !lines[idx].includes("[state:: ended]")) {
              lines[idx] = lines[idx] + stateField;
              updated++;
            }
            continue;
          }
          const head = `- ${asText(it.date)} ${asText(it.title)}` + (it.kind && it.kind !== "note" ? ` [kind:: ${it.kind}]` : "") + (it.place ? ` [place:: ${it.place}]` : "") + (it.who?.length ? ` [who:: ${it.who.join(", ")}]` : "") + (it.star ? ` [star:: true]` : "") + (it.until ? ` [until:: ${it.until}]` : "") + stateField + ` [mid:: ${mid}]`;
          const body = it.body ? [`  > ${String(it.body).replace(/\n/g, "\n  > ")}`] : [];
          lines.push(head, ...body);
          added++;
        }
        return lines.join("\n");
      });
    }
    return { added, updated, at: data.pulledAt };
  }
  /* ---------------- 派生 ---------------- */
  allTasks() {
    return [...this.tasks, ...this.logs];
  }
  projects() {
    return Array.from(new Set(this.tasks.map((t2) => t2.project))).sort();
  }
  milestones(project) {
    const map = /* @__PURE__ */ new Map();
    for (const t2 of this.tasks) {
      if (project && t2.project !== project) continue;
      if (!t2.milestone) continue;
      const k = `${t2.project}::${t2.milestone}`;
      map.set(k, [...map.get(k) || [], t2]);
    }
    return Array.from(map.entries()).map(([k, tasks]) => {
      const [p, n] = k.split("::");
      return { name: n, project: p, tasks };
    });
  }
  monthTasks(ref = /* @__PURE__ */ new Date()) {
    const { start, end } = monthBounds(ref);
    const live = this.tasks.filter((t2) => t2.kind === "task");
    const inM = (d) => !!d && d >= start && d <= end;
    return {
      late: live.filter((t2) => !t2.done && inM(t2.due) && t2.due < todayISO()),
      todo: live.filter((t2) => !t2.done && inM(t2.due) && t2.due >= todayISO()),
      done: live.filter((t2) => t2.done && inM(t2.due)),
      pending: live.filter((t2) => !t2.done && !t2.due)
    };
  }
};

// src/i18n.ts
var EN = {
  /* ---------- 通用 ---------- */
  "\u53D6\u6D88": "Cancel",
  "\u4FDD\u5B58": "Save",
  "\u5220\u9664": "Delete",
  "\u521B\u5EFA": "Create",
  "\u53D1\u5E03": "Publish",
  "\u786E\u5B9A": "OK",
  "\u672A\u77E5\u9519\u8BEF": "Unknown error",
  "\u5173\u95ED": "Off",
  "\u5168\u90E8": "All",
  "\u672C\u5468": "This week",
  "\u672C\u6708": "This month",
  "\u672C\u5B63\u5EA6": "This quarter",
  "\u4ECA\u5929": "Today",
  "\u56DE\u5230\u4ECA\u5929": "Back to today",
  "\u65B0\u5EFA": "New",
  "\uFF0B \u65B0\u5EFA": "\uFF0B New",
  "\u6682\u65E0": "None",
  /* ---------- 主题与语言 ---------- */
  "\u4E3B\u9898": "Theme",
  "\u8DDF\u968F Obsidian": "Match Obsidian",
  "\u8DDF\u968F\u7CFB\u7EDF": "Match system",
  "\u6DF1\u8272": "Dark",
  "\u6D45\u8272": "Light",
  "\u8DDF\u968F Obsidian\uFF0C\u6216\u5F3A\u5236\u6DF1\u8272/\u6D45\u8272\u3002\u4E3B\u754C\u9762\u53F3\u4E0A\u89D2\u4E5F\u80FD\u5207\u3002": "Follow Obsidian, or force dark/light. Also switchable from the top-right of the main view.",
  "\u754C\u9762\u8BED\u8A00": "Interface language",
  "\u8BBE\u7F6E\u9762\u677F\u4E0E\u63D2\u4EF6\u754C\u9762\u7528\u4EC0\u4E48\u8BED\u8A00\u3002": "Language used by the settings panel and the plugin UI.",
  "\u81EA\u52A8\uFF08\u8DDF\u968F Obsidian\uFF09": "Automatic (match Obsidian)",
  /* ---------- 设置：目录 ---------- */
  "\u76EE\u5F55": "Folders",
  "\u6839\u76EE\u5F55": "Root folder",
  "\u4E0B\u9762\u516D\u9879\u9ED8\u8BA4\u90FD\u653E\u5728\u8FD9\u4E2A\u76EE\u5F55\u4E0B\uFF1B\u7559\u7A7A\u8868\u793A\u76F4\u63A5\u7528\u5E93\u7684\u6839\u76EE\u5F55\u3002\u6539\u8FD9\u91CC\u4F1A\u4E00\u8D77\u66F4\u65B0\u5B83\u4EEC\uFF0C\u5355\u72EC\u6539\u8FC7\u7684\u90A3\u9879\u4E0D\u4F1A\u88AB\u8986\u76D6\u3002": "The six paths below default to this folder; leave empty to use the vault root. Changing it updates them together, but a path you edited by hand stays as it is.",
  "\u4EFB\u52A1\u76EE\u5F55": "Tasks folder",
  "\u4E00\u4E2A\u9879\u76EE\u4E00\u4E2A\u6587\u4EF6\uFF0C## \u5C0F\u8282\u662F\u91CC\u7A0B\u7891\uFF0C\u4EFB\u52A1\u4E00\u884C\u4E00\u6761\u3002": "One file per project; a ## heading is a milestone; one task per line.",
  "\u4EBA\u5458\u76EE\u5F55": "People folder",
  "\u4E00\u4EBA\u4E00\u4E2A\u6587\u4EF6\uFF0Cfrontmatter \u5199 role / capacity / days / skills\u3002": "One file per person; put role / capacity / days / skills in the frontmatter.",
  "\u6D88\u606F\u6E90\u76EE\u5F55": "Feeds folder",
  "\u4E00\u4E2A\u6E90\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6B63\u6587\u5217\u8868\u4E00\u884C\u4E00\u6761\u6D88\u606F\u3002": "One file per feed; each list item in the body is one message.",
  "\u8BB0\u5F55\u76EE\u5F55": "Logs folder",
  "\u6309\u6708\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6B63\u6587\u7528 ## \u65E5\u671F \u5206\u8282\u3002": "One file per month; split days with ## date headings.",
  "\u968F\u624B\u8BB0\u6587\u4EF6": "Notes file",
  "\u5355\u6587\u4EF6\uFF0C\u4E00\u884C\u4E00\u6761\u3002": "A single file, one note per line.",
  "\u6807\u7B7E\u5E93\u6587\u4EF6": "Tags file",
  "\u5355\u6587\u4EF6\uFF0C\u4E00\u884C\u4E00\u4E2A\u6807\u7B7E\u3002": "A single file, one tag per line.",
  /* ---------- 设置：口径 ---------- */
  "\u53E3\u5F84": "Period",
  "\u9ED8\u8BA4\u5360\u6BD4\u5468\u671F": "Default workload period",
  "\u5360\u6BD4\u4E0E\u9971\u548C\u5EA6\u7684\u9ED8\u8BA4\u53E3\u5F84\uFF0C\u754C\u9762\u4E0A\u968F\u65F6\u53EF\u5207\u3002": "Default period for workload and saturation; switchable in the UI at any time.",
  /* ---------- 设置：消息服务 ---------- */
  "\u6D88\u606F\u670D\u52A1": "Message service",
  "\u53D1\u5E03\u670D\u52A1\u5730\u5740": "Publish service URL",
  "\u628A\u300C\u6211\u53D1\u5E03\u7684\u6E90\u300D\u63A8\u5230\u8FD9\u91CC\u3002\u53D1\u5E03\u7AEF\u4E0E\u8BA2\u9605\u7AEF\u53EF\u4EE5\u662F\u540C\u4E00\u4E2A\u5730\u5740\u3002": "Published feeds are pushed here. The publish and pull endpoints can be the same address.",
  "\u62C9\u53D6\u670D\u52A1\u5730\u5740": "Pull service URL",
  "\u4ECE\u8FD9\u91CC\u540C\u6B65\u8BA2\u9605\u7684\u6E90\u3002\u7559\u7A7A\u5219\u5B8C\u5168\u79BB\u7EBF\uFF0C\u53EA\u7528\u5E93\u5185 Markdown\u3002": "Subscribed feeds are pulled from here. Leave empty to stay fully offline with local Markdown only.",
  "\u81EA\u52A8\u540C\u6B65\u95F4\u9694": "Auto-pull interval",
  "\u6309\u8FD9\u4E2A\u95F4\u9694\u81EA\u52A8\u62C9\u53D6\u8BA2\u9605\u7684\u6E90\u3002": "Pull subscribed feeds at this interval.",
  "\u81EA\u52A8\u63A8\u9001\u95F4\u9694": "Auto-push interval",
  "\u6309\u8FD9\u4E2A\u95F4\u9694\u628A\u6211\u53D1\u5E03\u7684\u6E90\u63A8\u4E0A\u53BB\u3002": "Push my published feeds at this interval.",
  "5 \u5206\u949F": "5 minutes",
  "15 \u5206\u949F": "15 minutes",
  "30 \u5206\u949F": "30 minutes",
  "1 \u5C0F\u65F6": "1 hour",
  /* ---------- 设置：维护 ---------- */
  "\u7EF4\u62A4": "Maintenance",
  "\u63A8\u9001\u5230\u53D1\u5E03\u670D\u52A1": "Push to publish service",
  "\u7ACB\u523B\u628A\u6240\u6709\u300C\u6211\u53D1\u5E03\u7684\u6E90\u300D\u63A8\u4E00\u904D\u3002": "Push every published feed right now.",
  "\u4ECE\u62C9\u53D6\u670D\u52A1\u540C\u6B65": "Sync from pull service",
  "\u7ACB\u523B\u62C9\u53D6\u4E00\u6B21\u8BA2\u9605\u7684\u6E90\u3002": "Pull subscribed feeds once, right now.",
  "\u6309\u6839\u76EE\u5F55\u91CD\u6392\u516D\u4E2A\u8DEF\u5F84": "Re-align the six paths to the root folder",
  "\u628A\u4E0B\u9762\u516D\u9879\u91CD\u65B0\u5BF9\u9F50\u5230\u5F53\u524D\u6839\u76EE\u5F55\u3002\u8DEF\u5F84\u88AB\u6539\u4E71\u3001\u6216\u6539\u4E86\u6839\u76EE\u5F55\u540E\u6CA1\u8DDF\u4E0A\u65F6\u7528\u8FD9\u4E2A\uFF1B\u4F1A\u8986\u76D6\u4F60\u5355\u72EC\u8BBE\u8FC7\u7684\u8DEF\u5F84\u3002": "Re-align the six paths below to the current root folder. Use this when paths got out of sync or you changed the root and they did not follow. It overwrites paths you set by hand.",
  "\u91CD\u6392": "Re-align",
  "\u751F\u6210\u793A\u4F8B\u6570\u636E": "Generate sample data",
  "\u5199\u4E00\u4EFD\u865A\u6784\u7684\u6837\u4F8B\uFF08\u4EBA\u540D\u548C\u9879\u76EE\u90FD\u662F\u7F16\u7684\uFF09\uFF0C\u65B9\u4FBF\u5148\u770B\u754C\u9762\u3002\u5DF2\u5B58\u5728\u7684\u6587\u4EF6\u4E0D\u8986\u76D6\u3002": "Write a fictional sample (made-up names and projects) so you can see the UI. Existing files are never overwritten.",
  "\u6839\u76EE\u5F55\u5DF2\u66F4\u65B0": "Root folder updated",
  "\u6839\u76EE\u5F55\u5DF2\u66F4\u65B0\uFF0C{n} \u9879\u81EA\u5B9A\u4E49\u8DEF\u5F84\u4FDD\u6301\u4E0D\u53D8": "Root folder updated; {n} custom path(s) left untouched",
  "\u516D\u4E2A\u8DEF\u5F84\u5DF2\u6309\u6839\u76EE\u5F55\u91CD\u6392\uFF0C\u76EE\u5F55\u5DF2\u5C31\u4F4D": "All six paths re-aligned to the root folder; folders are ready",
  "\u76EE\u5F55\u5DF2\u66F4\u65B0": "Folder updated",
  /* ---------- 工作台 ---------- */
  "\u65E5\u5386": "Calendar",
  "\u4EFB\u52A1": "Tasks",
  "\u91CC\u7A0B\u7891": "Milestones",
  "\u4EBA\u5458": "People",
  "\u968F\u624B\u8BB0": "Notes",
  "\u968F\u624B\u753B": "Sketch",
  "\u65F6\u95F4\u7EBF\u5DE5\u4F5C\u53F0": "Timeline workbench",
  "\u6253\u5F00\u5DE5\u4F5C\u53F0": "Open workbench",
  "\u6253\u5F00\u6D88\u606F\u4E2D\u5FC3\uFF08\u72EC\u7ACB\u9875\uFF09": "Open message center (own tab)",
  "\u65B0\u5EFA\u4EFB\u52A1": "New task",
  "\u5207\u6362\u660E\u6697": "Toggle theme",
  "\u9879\u76EE \xB7 \u8FDB\u5EA6": "Projects \xB7 progress",
  "\u9879\u76EE \u2022 \u8FDB\u5EA6": "Projects \xB7 progress",
  "TLT/tasks \u91CC\u8FD8\u6CA1\u6709\u4EFB\u52A1\u6587\u4EF6": "No task files in TLT/tasks yet",
  "\u641C\u7D22\u4EFB\u52A1/\u8BB0\u5F55": "Search tasks / logs",
  "\u6761\u5E26": "Bars",
  "\u661F\u56FE": "Star map",
  "\u8282\u594F": "Rhythm",
  "\u5B8C\u6210": "Done",
  "\u672A\u5B8C\u6210": "Open",
  "\u903E\u671F": "Overdue",
  "\u5F85\u6392\u671F": "Unscheduled",
  /* ---------- 消息中心 ---------- */
  "\u6D88\u606F\u4E2D\u5FC3": "Message center",
  "\u4E2A\u4EBA": "Personal",
  "\u6211\u53D1\u5E03\u7684": "Published",
  "\u6211\u8BA2\u9605\u7684": "Subscribed",
  "\u65B0\u5EFA\u6D88\u606F": "New message",
  "\u65B0\u5EFA\u6D88\u606F\u5230\u8FD9\u4E2A\u6E90": "New message in this feed",
  "\u53D1\u5E03\u6D88\u606F\u6E90\u2026": "Publish this feed\u2026",
  "\u624B\u52A8\u63A8\u9001": "Push now",
  "\u53D6\u6D88\u53D1\u5E03": "Unpublish",
  "\u53D6\u6D88\u8BA2\u9605": "Unsubscribe",
  "\u63A8\u9001\u6211\u7684\u6E90": "Push my feeds",
  "\u540C\u6B65\u8BA2\u9605": "Sync subscriptions",
  "\u8BA2\u9605\u8FD9\u4E2A\u6E90": "Subscribe to this feed",
  "feeds/ \u91CC\u8FD8\u6CA1\u6709\u6E90": "No feeds in feeds/ yet",
  "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6D88\u606F": "No messages match",
  "\u8FD9\u4E2A\u8303\u56F4\u91CC\u6CA1\u6709\u6D88\u606F": "No messages in this range",
  "\u8FD9\u5929\u6CA1\u6709\u6D88\u606F": "No messages on this day",
  "\u8FD1 7 \u5929": "Last 7 days",
  "\u8FD17\u5929": "Last 7 days",
  "\u8FD1 30 \u5929": "Last 30 days",
  "\u8FD130\u5929": "Last 30 days",
  "\u8FD9\u5929\u8981\u505A\u7684": "To do that day",
  "\u70B9\u4E00\u4E0B\u6392\u8FDB\u65F6\u95F4\u8868": "click one to put it on the schedule",
  "\u90FD\u6392\u4E0A\u4E86": "Everything is scheduled",
  "\u8FD9\u5929 \xB7 \u8BA1\u5212\u4E0E\u5B9E\u9645": "That day \xB7 plan vs actual",
  "\u8282\u594F \xB7 21 \u5929": "Rhythm \xB7 21 days",
  "\uFF0B \u6DFB\u52A0\u6210\u5458": "\uFF0B Add member",
  "\uFF0B \u968F\u624B\u8BB0": "\uFF0B Note",
  "TLT/team \u91CC\u8FD8\u6CA1\u6709\u4EBA\u5458\u6863\u6848": "No people in TLT/team yet",
  "\u8BB0\u4E00\u6761 \xB7 {d}": "Log one \xB7 {d}",
  "\u5361\u7247": "Cards",
  "\u6CB3\u6D41": "River",
  "\u7D27\u51D1": "Compact",
  "\u6309\u6E90\u5206\u5E26": "Bands by feed",
  "\u53EF\u7F29\u653E\u65F6\u95F4\u8F74": "Zoomable axis",
  "\u6708\u5EA6\u70ED\u529B": "Monthly heat",
  "\u4EBA\u7269\u8109\u7EDC": "People threads",
  /* ---------- 弹窗字段 ---------- */
  "\u4EFB\u52A1\u540D": "Task name",
  "\u505A\u4E86\u4EC0\u4E48": "What did you do",
  "\u9879\u76EE": "Project",
  "\u8D1F\u8D23\u4EBA": "Owner",
  "\u65E5\u671F": "Date",
  "\u5F00\u59CB": "Start",
  "\u7ED3\u675F": "End",
  "\u5360\u6BD4": "Workload",
  "\u4F18\u5148\u7EA7": "Priority",
  "\u6807\u7B7E": "Tags",
  "\u6B65\u9AA4": "Steps",
  "\u6807\u9898": "Title",
  "\u5185\u5BB9": "Details",
  "\u65F6\u95F4": "Time",
  "\u5730\u70B9": "Place",
  "\u4EBA\u7269": "People",
  "\u7F18\u7531": "Why"
};
var current = "zh";
function currentLanguage() {
  return current === "en" ? "en" : "zh";
}
function t(zh, vars) {
  const template = currentLanguage() === "zh" ? zh : EN[zh] ?? zh;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (all, key) => key in vars ? String(vars[key]) : all);
}

// src/views/modals.ts
function el(tag, cls, text) {
  const e = createEl(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  return e;
}
function row(parent, label) {
  const r = el("div", "tlt-row");
  r.appendChild(el("span", "tlt-row-l", label));
  const v = el("div", "tlt-row-v");
  r.appendChild(v);
  parent.appendChild(r);
  return v;
}
function seg(parent, opts, cur, onPick) {
  const wrap = el("div", "tlt-seg");
  opts.forEach((o) => {
    const b = el("button", "tlt-seg-b" + (o.v === cur ? " on" : ""), o.t);
    b.onclick = () => {
      wrap.querySelectorAll(".tlt-seg-b").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      onPick(o.v);
    };
    wrap.appendChild(b);
  });
  parent.appendChild(wrap);
  return wrap;
}
var TltModal = class extends Modal {
  constructor(app) {
    super(app);
    this.modalEl?.addClass("tlt-host");
  }
};
var TaskModal = class extends TltModal {
  constructor(app, store, task, onChange) {
    super(app);
    this.store = store;
    this.task = task;
    this.onChange = onChange;
    this.draft = { due: task.due, wl: task.wl, pw: task.pw, pri: task.pri, owners: [...task.owners], start: task.start };
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const t2 = this.task;
    contentEl.appendChild(el("div", "tlt-m-title", t2.title));
    const meta = el(
      "div",
      "tlt-m-meta",
      `${t2.project}${t2.milestone ? " \xB7 " + t2.milestone : ""} \xB7 ${t2.done ? "\u5DF2\u5B8C\u6210" : "\u8FDB\u884C\u4E2D"}`
    );
    contentEl.appendChild(meta);
    const due = row(contentEl, "\u622A\u6B62");
    const dIn = el("input", "tlt-input");
    dIn.type = "date";
    dIn.value = this.draft.due || "";
    dIn.onchange = () => {
      this.draft.due = dIn.value || void 0;
    };
    due.appendChild(dIn);
    const quick = el("div", "tlt-quick");
    [["\u4ECA\u5929", 0], ["\u660E\u5929", 1], ["\u4E09\u5929\u540E", 3], ["\u4E00\u5468\u540E", 7]].forEach(([lbl, n]) => {
      const b = el("button", "tlt-chip", String(lbl));
      b.onclick = () => {
        this.draft.due = addDays(todayISO(), Number(n));
        dIn.value = this.draft.due;
      };
      quick.appendChild(b);
    });
    due.appendChild(quick);
    const wl = row(contentEl, "\u5360\u6BD4");
    seg(wl, [10, 20, 30, 50, 100].map((v) => ({ v, t: v + "%" })), this.draft.wl || 10, (v) => this.draft.wl = v);
    const per = el("div", "tlt-quick");
    ["w", "m", "q"].forEach((p) => {
      const b = el("button", "tlt-chip" + (this.draft.pw === p ? " on" : ""), { w: "\u672C\u5468", m: "\u672C\u6708", q: "\u672C\u5B63\u5EA6" }[p]);
      b.onclick = () => {
        this.draft.pw = p;
        per.querySelectorAll(".tlt-chip").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      };
      per.appendChild(b);
    });
    wl.appendChild(per);
    const pri = row(contentEl, "\u4F18\u5148\u7EA7");
    seg(pri, [{ v: 0, t: "\u4F4E" }, { v: 1, t: "\u666E\u901A" }, { v: 2, t: "\u9AD8" }, { v: 3, t: "\u7D27\u6025" }], this.draft.pri || 1, (v) => this.draft.pri = v);
    const owners = row(contentEl, "\u8D1F\u8D23\u4EBA");
    const whoBox = el("div", "tlt-ownerbox");
    const cur = el("div", "tlt-quick");
    const pool = el("div", "tlt-quick tlt-ownerpick");
    pool.addClass("tlt-hidden");
    let picking = false;
    const paintOwners = () => {
      cur.empty();
      const names = this.draft.owners || [];
      if (!names.length) cur.appendChild(el("span", "tlt-owner-none", "\u672A\u6307\u6D3E"));
      names.forEach((n) => {
        const st = this.store.staff.find((x) => x.name === n);
        const chip = el("span", "tlt-chip on tlt-owner-chip");
        chip.append(el("span", "", n));
        if (st) chip.title = `${st.role} \xB7 \u4EA7\u80FD ${st.capacity}%`;
        if (picking) {
          const x = el("i", "", "\xD7");
          x.onclick = () => {
            this.draft.owners = (this.draft.owners || []).filter((y) => y !== n);
            paintOwners();
          };
          chip.appendChild(x);
        }
        cur.appendChild(chip);
      });
      const toggle = el("button", "tlt-btn tiny", picking ? "\u5B8C\u6210" : names.length ? "\u8C03\u6574\u2026" : "\u6307\u6D3E\u2026");
      toggle.onclick = () => {
        picking = !picking;
        paintOwners();
      };
      cur.appendChild(toggle);
      pool.empty();
      if (picking) pool.removeClass("tlt-hidden");
      else pool.addClass("tlt-hidden");
      if (!picking) return;
      const rest = this.store.staff.filter((x) => !(this.draft.owners || []).includes(x.name));
      if (!rest.length) pool.appendChild(el("span", "tlt-owner-none", "\u90FD\u6307\u6D3E\u8FC7\u4E86"));
      rest.forEach((st2) => {
        const b = el("button", "tlt-chip", st2.name);
        b.title = `${st2.role} \xB7 \u4EA7\u80FD ${st2.capacity}%`;
        b.onclick = () => {
          this.draft.owners = [...this.draft.owners || [], st2.name];
          paintOwners();
        };
        pool.appendChild(b);
      });
    };
    paintOwners();
    whoBox.append(cur, pool);
    owners.appendChild(whoBox);
    const foot = el("div", "tlt-m-foot");
    const save = el("button", "tlt-btn pri", "\u4FDD\u5B58");
    save.onclick = () => {
      void (async () => {
        const d = this.draft;
        if (d.due !== t2.due) await this.store.setDue(t2, d.due || "");
        if (d.wl !== t2.wl) await this.store.setField(t2, "wl", d.wl ?? 0);
        if (d.pw !== t2.pw) await this.store.setField(t2, "pw", d.pw ?? "m");
        if (d.pri !== t2.pri) await this.store.setField(t2, "pri", d.pri ?? 1);
        if ((d.owners || []).join(",") !== t2.owners.join(",")) {
          await this.store.setField(t2, "owner", (d.owners || []).map((o) => `[[${o}]]`).join(", "));
        }
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u5199\u56DE\u4EFB\u52A1\u884C");
      })();
    };
    const done = el("button", "tlt-btn", t2.done ? "\u6807\u4E3A\u672A\u5B8C\u6210" : "\u6807\u8BB0\u5B8C\u6210");
    done.onclick = async () => {
      await this.store.toggleTask(t2);
      this.close();
      void this.onChange();
    };
    const del = el("button", "tlt-btn danger", "\u5220\u9664\u4EFB\u52A1");
    del.onclick = () => {
      void (async () => {
        await this.store.deleteTask(t2);
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u5220\u9664\u4EFB\u52A1");
      })();
    };
    const open = el("button", "tlt-btn", "\u6253\u5F00\u6240\u5728\u7B14\u8BB0");
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(t2.file);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
      this.close();
    };
    foot.append(del, done, open, save);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LogModal = class extends TltModal {
  constructor(app, store, log, onChange) {
    super(app);
    this.store = store;
    this.log = log;
    this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.log.title));
    contentEl.appendChild(el(
      "div",
      "tlt-m-meta",
      `${this.log.due} \xB7 ${this.log.st || ""}${this.log.en ? "\u2013" + this.log.en : ""}${this.log.extra ? " \xB7 \u8BA1\u5212\u5916" : ""}${this.log.project ? " \xB7 " + this.log.project : ""}`
    ));
    const body = el("textarea", "tlt-textarea");
    body.placeholder = "\u8C08\u4E86\u4EC0\u4E48 / \u51B3\u5B9A\u4E86\u4EC0\u4E48 / \u4E0B\u4E00\u6B65\uFF08\u4F1A\u5199\u6210\u6587\u4EF6\u91CC\u7684\u5F15\u7528\u5757\uFF09";
    body.value = this.log.note || "";
    contentEl.appendChild(body);
    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "\u5220\u9664\u8FD9\u6761\u8BB0\u5F55");
    del.onclick = () => {
      void (async () => {
        await this.store.deleteLog(this.log);
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u5220\u9664\u8BB0\u5F55");
      })();
    };
    const open = el("button", "tlt-btn", "\u6253\u5F00\u6708\u6587\u4EF6");
    open.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(this.log.file);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
      this.close();
    };
    const ok = el("button", "tlt-btn pri", "\u4FDD\u5B58");
    ok.onclick = () => {
      void (async () => {
        await this.store.updateLogBody(this.log, body.value);
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u5199\u56DE\u8BB0\u5F55");
      })();
    };
    foot.append(del, open, ok);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QuickTaskModal = class extends TltModal {
  constructor(app, store, onChange, preset) {
    super(app);
    this.preset = {};
    this.store = store;
    this.onChange = onChange;
    this.preset = preset || {};
    const proj = store.projects()[0] || "\u672A\u5F52\u5C5E";
    const ms = store.milestones(proj)[0]?.name || "";
    this.draft = {
      start: todayISO(),
      due: preset?.due || todayISO(),
      est: 1,
      pri: 1,
      owners: [],
      project: proj,
      milestone: ms,
      tags: []
    };
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u65B0\u5EFA\u4EFB\u52A1"));
    const title = el("input", "tlt-input wide");
    title.placeholder = "\u4EFB\u52A1\u540D";
    title.value = this.preset.title || "";
    contentEl.appendChild(title);
    const projRow = row(contentEl, "\u9879\u76EE");
    const projWrap = el("div", "tlt-pick");
    const proj = el("select", "tlt-input");
    const fillProjects = (keep) => {
      proj.empty();
      [...this.store.projects(), "\u672A\u5F52\u5C5E"].forEach((p) => {
        const o = createEl("option");
        o.value = p;
        o.textContent = p;
        if (p === (keep || this.draft.project)) o.selected = true;
        proj.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__";
      n.textContent = "\uFF0B \u65B0\u5EFA\u9879\u76EE\u2026";
      proj.appendChild(n);
    };
    fillProjects();
    const projNew = el("input", "tlt-input");
    projNew.placeholder = "\u65B0\u9879\u76EE\u540D\uFF08= \u6587\u4EF6\u540D\uFF09";
    projNew.addClass("tlt-hidden");
    proj.onchange = () => {
      if (proj.value === "__new__") {
        projNew.removeClass("tlt-hidden");
        projNew.focus();
        this.draft.project = "";
      } else {
        projNew.addClass("tlt-hidden");
        this.draft.project = proj.value;
        fillMs();
      }
    };
    projNew.oninput = () => {
      this.draft.project = projNew.value.trim();
    };
    projWrap.append(proj, projNew);
    projRow.appendChild(projWrap);
    const msRow = row(contentEl, "\u91CC\u7A0B\u7891");
    const msWrap = el("div", "tlt-pick");
    const msSel = el("select", "tlt-input");
    const msNew = el("input", "tlt-input");
    msNew.placeholder = "\u65B0\u91CC\u7A0B\u7891\u540D";
    msNew.addClass("tlt-hidden");
    const fillMs = () => {
      msSel.empty();
      const list = this.draft.project ? this.store.milestones(this.draft.project).map((m) => m.name) : [];
      const o0 = createEl("option");
      o0.value = "";
      o0.textContent = "\uFF08\u4E0D\u5F52\u91CC\u7A0B\u7891\uFF09";
      msSel.appendChild(o0);
      list.forEach((name) => {
        const o = createEl("option");
        o.value = name;
        o.textContent = name;
        msSel.appendChild(o);
      });
      const n = createEl("option");
      n.value = "__new__";
      n.textContent = "\uFF0B \u65B0\u5EFA\u91CC\u7A0B\u7891\u2026";
      msSel.appendChild(n);
      msSel.value = list.includes(this.draft.milestone) ? this.draft.milestone : "";
    };
    fillMs();
    msSel.onchange = () => {
      if (msSel.value === "__new__") {
        msNew.removeClass("tlt-hidden");
        msNew.focus();
        this.draft.milestone = "";
      } else {
        msNew.addClass("tlt-hidden");
        this.draft.milestone = msSel.value;
      }
    };
    msNew.oninput = () => {
      this.draft.milestone = msNew.value.trim();
    };
    msWrap.append(msSel, msNew);
    msRow.appendChild(msWrap);
    const tagRow = row(contentEl, "\u6807\u7B7E");
    const tagWrap = el("div", "tlt-quick");
    const knownTags = Array.from(new Set(this.store.tasks.flatMap((t2) => t2.tags || [])));
    const allTags = Array.from(/* @__PURE__ */ new Set(["\u5DE5\u4F5C", "\u4E2A\u4EBA", ...knownTags]));
    const paintTags = () => {
      tagWrap.empty();
      allTags.forEach((tg) => {
        const b = el("button", "tlt-chip" + (this.draft.tags.includes(tg) ? " on" : ""), tg);
        b.onclick = () => {
          const a = this.draft.tags;
          this.draft.tags = a.includes(tg) ? a.filter((x) => x !== tg) : [...a, tg];
          paintTags();
        };
        tagWrap.appendChild(b);
      });
      const add = el("input", "tlt-input small");
      add.placeholder = "\u65B0\u6807\u7B7E";
      add.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        const v = add.value.trim();
        if (!v) return;
        if (!allTags.includes(v)) allTags.push(v);
        if (!this.draft.tags.includes(v)) this.draft.tags.push(v);
        paintTags();
      };
      tagWrap.appendChild(add);
    };
    paintTags();
    tagRow.appendChild(tagWrap);
    const startRow = row(contentEl, "\u5F00\u59CB");
    const start = el("input", "tlt-input");
    start.type = "date";
    start.value = this.draft.start;
    start.onchange = () => this.draft.start = start.value;
    startRow.appendChild(start);
    const dueRow = row(contentEl, "\u622A\u6B62");
    const due = el("input", "tlt-input");
    due.type = "date";
    due.value = this.draft.due;
    due.onchange = () => this.draft.due = due.value;
    dueRow.appendChild(due);
    const quick = el("div", "tlt-quick");
    [["\u4ECA\u5929", 0], ["\u660E\u5929", 1], ["\u4E09\u5929\u540E", 3], ["\u4E00\u5468\u540E", 7]].forEach(([lbl, n]) => {
      const b = el("button", "tlt-chip", String(lbl));
      b.onclick = () => {
        this.draft.due = addDays(todayISO(), Number(n));
        due.value = this.draft.due;
      };
      quick.appendChild(b);
    });
    dueRow.appendChild(quick);
    const estRow = row(contentEl, "\u5DE5\u4F5C\u91CF");
    seg(estRow, [0.5, 1, 2, 3, 5].map((v) => ({ v, t: v + " \u5929" })), this.draft.est, (v) => {
      this.draft.est = v;
      estInput.value = String(v);
    });
    const estInput = el("input", "tlt-input small");
    estInput.type = "number";
    estInput.step = "0.5";
    estInput.min = "0";
    estInput.value = String(this.draft.est);
    estInput.oninput = () => {
      this.draft.est = Number(estInput.value) || 0;
    };
    estRow.appendChild(estInput);
    const priRow = row(contentEl, "\u4F18\u5148\u7EA7");
    seg(priRow, [{ v: 0, t: "\u4F4E" }, { v: 1, t: "\u666E\u901A" }, { v: 2, t: "\u9AD8" }, { v: 3, t: "\u7D27\u6025" }], this.draft.pri, (v) => this.draft.pri = v);
    const whoRow = row(contentEl, "\u8D1F\u8D23\u4EBA");
    const whoWrap = el("div", "tlt-people");
    if (!this.store.staff.length) whoWrap.appendChild(el("div", "tlt-hint", "\u8FD8\u6CA1\u6709\u4EBA\u5458\u6863\u6848\uFF08\u4EBA\u5458\u9875\u53EF\u4EE5\u65B0\u5EFA\uFF09"));
    this.store.staff.forEach((st) => {
      const sat = saturation(this.store.tasks, st.name, "m", { capacity: st.capacity, days: st.days });
      const b = el("button", "tlt-chip" + (this.draft.owners.includes(st.name) ? " on" : ""), `${st.name} \xB7 ${sat.pct}%`);
      b.title = `${st.role || ""} \xB7 \u672C\u6708\u5DF2\u6392 ${sat.sum} / ${sat.avail} \u4EBA\u5929`;
      b.onclick = () => {
        const a = this.draft.owners;
        this.draft.owners = a.includes(st.name) ? a.filter((x) => x !== st.name) : [...a, st.name];
        b.classList.toggle("on");
      };
      whoWrap.appendChild(b);
    });
    whoRow.appendChild(whoWrap);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u521B\u5EFA");
    ok.onclick = () => {
      void (async () => {
        const name = title.value.trim();
        if (!name) {
          new Notice("\u5148\u5199\u4EFB\u52A1\u540D");
          return;
        }
        await this.store.addTask(this.draft.project, this.draft.milestone || void 0, {
          title: name,
          start: this.draft.start,
          due: this.draft.due,
          est: this.draft.est,
          pri: this.draft.pri,
          owners: this.draft.owners,
          tags: this.draft.tags
        });
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u521B\u5EFA\u4EFB\u52A1");
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ok.click();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QuickLogModal = class extends TltModal {
  constructor(app, store, date, onChange, startAt = "09:00") {
    super(app);
    this.store = store;
    this.date = date;
    this.onChange = onChange;
    this.startAt = startAt;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", `\u8BB0\u4E00\u6761 \xB7 ${this.date}`));
    contentEl.appendChild(el("div", "tlt-m-meta", "\u8BB0\u5F55\u662F\u300C\u5B9E\u9645\u53D1\u751F\u300D\u7684\u4E8B\uFF1B\u8BA1\u5212\u5916\u7684\u4E8B\u4E5F\u8BB0\u5728\u8FD9\u91CC"));
    const st = el("input", "tlt-input");
    st.type = "time";
    st.value = this.startAt;
    const en = el("input", "tlt-input");
    en.type = "time";
    const [hh, mm] = this.startAt.split(":").map(Number);
    en.value = minToHHMM(hh * 60 + (mm || 0) + 30);
    const times = el("div", "tlt-times");
    times.append(st, el("span", "tlt-dash", "\u2013"), en);
    contentEl.appendChild(times);
    const title = el("input", "tlt-input wide");
    title.placeholder = "\u505A\u4E86\u4EC0\u4E48";
    contentEl.appendChild(title);
    const body = el("textarea", "tlt-textarea");
    body.placeholder = "\u6B63\u6587\uFF08\u53EF\u7559\u7A7A\uFF09";
    contentEl.appendChild(body);
    const extra = el("label", "tlt-check");
    const cb = el("input");
    cb.type = "checkbox";
    extra.append(cb, el("span", "", "\u8BA1\u5212\u5916\uFF08\u4E34\u65F6\u63D2\u5165\uFF09"));
    contentEl.appendChild(extra);
    const foot = el("div", "tlt-m-foot");
    const ok = el("button", "tlt-btn pri", "\u8BB0\u5F55");
    ok.onclick = () => {
      void (async () => {
        if (!title.value.trim()) return;
        await this.store.addLog(this.date, {
          st: st.value,
          en: en.value,
          title: title.value.trim(),
          body: body.value.trim() || void 0,
          extra: cb.checked
        });
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u5199\u5165\u8BB0\u5F55");
      })();
    };
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var StaffModal = class extends TltModal {
  constructor(app, store, staff, onChange) {
    super(app);
    this.store = store;
    this.staff = staff;
    this.onChange = onChange;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const s = this.staff;
    const head = el("div", "tlt-staff-head");
    const av = el("span", "tlt-av big", s.name.slice(-2));
    if (s.color) av.style.background = s.color;
    const who = el("div", "tlt-who");
    who.append(el("div", "tlt-staff-name", s.name), el("div", "tlt-staff-role", s.role || "\u672A\u586B\u5C97\u4F4D"));
    head.append(av, who);
    contentEl.appendChild(head);
    const sat = saturation(this.store.tasks, s.name, this.store.settings.defaultPeriod, { capacity: s.capacity, days: s.days });
    const grid = el("div", "tlt-staff-grid");
    const cell = (label, value) => {
      const c = el("div", "tlt-staff-cell");
      c.append(el("span", "tlt-staff-l", label), el("b", "", value));
      grid.appendChild(c);
    };
    cell("\u4EA7\u80FD", `${s.capacity}%`);
    cell("\u5728\u5C97", `\u6BCF\u5468 ${s.days} \u5929`);
    cell("\u53EF\u7528", `${sat.avail} \u4EBA\u5929/\u6708`);
    cell("\u5DF2\u6392", `${sat.sum} \u4EBA\u5929\uFF08${sat.pct}%\uFF09`);
    contentEl.appendChild(grid);
    const skillRow = el("div", "tlt-staff-line");
    skillRow.appendChild(el("span", "tlt-staff-l", "\u6280\u80FD"));
    const chips = el("div", "tlt-quick");
    (s.skills || []).length ? s.skills.forEach((k) => chips.appendChild(el("span", "tlt-chip on", k))) : chips.appendChild(el("span", "tlt-hint", "\u8FD8\u6CA1\u586B"));
    skillRow.appendChild(chips);
    contentEl.appendChild(skillRow);
    if (s.note) {
      const noteRow = el("div", "tlt-staff-line");
      noteRow.appendChild(el("span", "tlt-staff-l", "\u5907\u6CE8"));
      noteRow.appendChild(el("div", "tlt-staff-note", s.note));
      contentEl.appendChild(noteRow);
    }
    const tasks = this.store.tasks.filter((t2) => !t2.done && t2.owners.includes(s.name));
    const listRow = el("div", "tlt-staff-line");
    listRow.appendChild(el("span", "tlt-staff-l", "\u624B\u4E0A"));
    const ul = el("div", "tlt-staff-tasks");
    tasks.length ? tasks.slice(0, 6).forEach((t2) => {
      const r = el("div", "tlt-staff-task");
      r.append(el("span", "", t2.title), el("span", "tlt-hint", t2.est !== void 0 ? `${t2.est} \u4EBA\u5929` : t2.due || ""));
      ul.appendChild(r);
    }) : ul.appendChild(el("div", "tlt-hint", "\u8FD9\u4E2A\u5468\u671F\u6CA1\u6709\u4EFB\u52A1"));
    listRow.appendChild(ul);
    contentEl.appendChild(listRow);
    contentEl.appendChild(el("div", "tlt-hint", `\u6863\u6848\u6587\u4EF6\uFF1A${s.file}`));
    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "\u5220\u9664\u6863\u6848");
    del.onclick = () => {
      void (async () => {
        await this.store.removeStaff(s);
        this.close();
        void this.onChange?.();
        new Notice(`\u5DF2\u5220\u9664 ${s.name} \u7684\u6863\u6848`);
      })();
    };
    const open = el("button", "tlt-btn pri", "\u6253\u5F00\u6863\u6848\u6587\u4EF6");
    open.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(s.file);
      if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    };
    foot.append(del, open);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TaskPeekModal = class extends TltModal {
  constructor(app, store, task, onJump) {
    super(app);
    this.store = store;
    this.task = task;
    this.onJump = onJump;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.addClass("tlt-peek");
    const t2 = this.task;
    contentEl.appendChild(el("div", "tlt-peek-title", t2.title));
    const rows = [
      ["\u9879\u76EE", `${t2.project}${t2.milestone ? " \xB7 " + t2.milestone : ""}`],
      ["\u65F6\u95F4", `${t2.start ? t2.start + " \u2192 " : ""}${t2.due || "\u672A\u6392\u671F"}`],
      ["\u5DE5\u4F5C\u91CF", t2.est !== void 0 ? `${t2.est} \u4EBA\u5929` : t2.wl ? `${t2.wl}%` : "\u672A\u4F30"],
      ["\u8D1F\u8D23\u4EBA", t2.owners.length ? t2.owners.join("\u3001") : "\u672A\u5206\u914D"],
      ["\u72B6\u6001", t2.done ? "\u5DF2\u5B8C\u6210" : "\u8FDB\u884C\u4E2D"]
    ];
    rows.forEach(([k, v]) => {
      const r = el("div", "tlt-peek-row");
      r.append(el("span", "tlt-peek-k", k), el("span", "tlt-peek-v", v));
      contentEl.appendChild(r);
    });
    const foot = el("div", "tlt-m-foot");
    const open = el("button", "tlt-btn pri", "\u6253\u5F00\u4EFB\u52A1 \u2192");
    open.onclick = () => {
      this.close();
      void this.onJump();
    };
    foot.appendChild(open);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var MilestonePeekModal = class extends TltModal {
  constructor(app, store, milestone, onOpenMs) {
    super(app);
    this.store = store;
    this.milestone = milestone;
    this.onOpenMs = onOpenMs;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const m = this.milestone;
    const done = m.tasks.filter((t2) => t2.done).length;
    contentEl.appendChild(el("div", "tlt-peek-title", m.name));
    const rows = [
      ["\u9879\u76EE", m.project],
      ["\u8FDB\u5EA6", `${done}/${m.tasks.length}\uFF08${Math.round(done / m.tasks.length * 100)}%\uFF09`],
      ["\u4EBA\u5929", `${m.tasks.reduce((n, t2) => n + (t2.est || 0), 0)} \u5929`],
      ["\u8D1F\u8D23\u4EBA", Array.from(new Set(m.tasks.flatMap((t2) => t2.owners))).join("\u3001") || "\u672A\u5206\u914D"]
    ];
    rows.forEach(([k, v]) => {
      const r = el("div", "tlt-peek-row");
      r.append(el("span", "tlt-peek-k", k), el("span", "tlt-peek-v", v));
      contentEl.appendChild(r);
    });
    const list = el("div", "tlt-peek-tasks");
    m.tasks.slice(0, 8).forEach((t2) => {
      const r = el("div", "tlt-peek-task");
      r.append(el("span", "", `${t2.done ? "\u2713" : "\u25CB"} ${t2.title}`), el("span", "tlt-hint", t2.due || ""));
      list.appendChild(r);
    });
    contentEl.appendChild(list);
    const foot = el("div", "tlt-m-foot");
    const open = el("button", "tlt-btn pri", "\u6253\u5F00\u91CC\u7A0B\u7891 \u2192");
    open.onclick = () => {
      this.close();
      this.onOpenMs();
    };
    foot.appendChild(open);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AddStaffModal = class extends TltModal {
  constructor(app, store, onChange) {
    super(app);
    this.store = store;
    this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u6DFB\u52A0\u6210\u5458"));
    contentEl.appendChild(el(
      "div",
      "tlt-m-meta",
      `\u4F1A\u5728 ${this.store.settings.teamFolder}/ \u65B0\u5EFA\u4E00\u4E2A\u6863\u6848\u6587\u4EF6\uFF0Cfrontmatter \u91CC\u586B\u5C97\u4F4D\u4E0E\u4EA7\u80FD\u3002`
    ));
    const name = el("input", "tlt-input wide");
    name.placeholder = "\u59D3\u540D\uFF08= \u6587\u4EF6\u540D\uFF09";
    contentEl.appendChild(name);
    const role = el("input", "tlt-input wide");
    role.placeholder = "\u5C97\u4F4D\uFF0C\u9ED8\u8BA4\u300C\u7B97\u6CD5\u5DE5\u7A0B\u5E08\u300D";
    contentEl.appendChild(role);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u521B\u5EFA");
    ok.onclick = () => {
      void (async () => {
        const n = name.value.trim();
        if (!n) return;
        const created = await this.store.addStaff(n);
        if (!created) {
          new Notice("\u540C\u540D\u6863\u6848\u5DF2\u5B58\u5728");
          return;
        }
        this.close();
        void this.onChange();
        new Notice(`\u5DF2\u521B\u5EFA ${n} \u7684\u6863\u6848\uFF0C\u70B9\u5361\u7247\u53EF\u67E5\u770B/\u7F16\u8F91`);
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => name.focus(), 50);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok.click();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var IdeaModal = class extends TltModal {
  constructor(app, store, idea, onChange) {
    super(app);
    this.store = store;
    this.idea = idea;
    this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    const isNew = !this.idea;
    contentEl.appendChild(el("div", "tlt-idea-kicker", isNew ? "\u65B0\u5EFA\u968F\u624B\u8BB0" : "\u968F\u624B\u8BB0"));
    const title = el("input", "tlt-idea-title");
    title.placeholder = "\u4E00\u53E5\u8BDD\u8BB0\u4E0B\u6765";
    title.value = this.idea?.title || "";
    contentEl.appendChild(title);
    let tags = this.idea ? ideaFilterTags(this.idea) : [];
    contentEl.appendChild(el("div", "tlt-field-label", "\u6807\u7B7E"));
    const tagWrap = el("div", "tlt-idea-tagwrap");
    const paint = () => {
      tagWrap.empty();
      tags.forEach((tg) => {
        const chip = el("span", "tlt-tagchip");
        chip.append(el("span", "", tg));
        const x = el("i", "", "\xD7");
        x.onclick = () => {
          tags = tags.filter((t2) => t2 !== tg);
          paint();
        };
        chip.appendChild(x);
        tagWrap.appendChild(chip);
      });
      const add = el("input", "tlt-tagin");
      add.placeholder = tags.length ? "\u518D\u52A0\u2026" : "\u52A0\u6807\u7B7E\uFF0C\u56DE\u8F66";
      add.onkeydown = (e) => {
        void (async () => {
          if (e.key !== "Enter") return;
          const v = e.target.value.trim().replace(/^#/, "");
          if (!v) return;
          if (!tags.includes(v)) tags.push(v);
          if (!this.store.tags.includes(v)) await this.store.addTag(v);
          e.target.value = "";
          paint();
          tagWrap.querySelector(".tlt-tagin")?.focus();
        })();
      };
      tagWrap.appendChild(add);
    };
    paint();
    contentEl.appendChild(tagWrap);
    contentEl.appendChild(el("div", "tlt-field-label", "\u6807\u7B7E\u5E93\uFF08\u70B9\u4E00\u4E0B\u52A0\u5165\uFF0C\u270E \u4FEE\u6539\uFF09"));
    const lib = el("div", "tlt-taglib");
    const libTags = () => Array.from(/* @__PURE__ */ new Set([
      ...this.store.tags,
      ...this.store.ideas.flatMap((i) => ideaFilterTags(i)),
      ...this.store.tasks.flatMap((t2) => t2.tags || [])
    ])).filter((t2) => !tags.includes(t2));
    const paintLib = () => {
      lib.empty();
      libTags().forEach((tg) => {
        const one = el("span", "tlt-taglib-i" + (tags.includes(tg) ? " on" : ""));
        one.append(el("span", "tlt-taglib-n", tg));
        const edit = el("i", "", "\u270E");
        edit.onclick = (ev) => {
          ev.stopPropagation();
          new TagEditModal(this.app, this.store, tg, () => {
            tags = tags.map((t2) => t2 === tg ? "" : t2).filter(Boolean);
            paint();
            paintLib();
          }).open();
        };
        one.appendChild(edit);
        one.onclick = () => {
          if (!tags.includes(tg)) tags.push(tg);
          paint();
          paintLib();
        };
        lib.appendChild(one);
      });
      const plus = el("span", "tlt-taglib-i plus", "\uFF0B");
      plus.onclick = () => {
        new PromptModal(this.app, "\u65B0\u5EFA\u6807\u7B7E", "\u6807\u7B7E\u540D", async (v) => {
          const name = v.trim().replace(/^#/, "");
          if (!name) return;
          await this.store.addTag(name);
          paintLib();
        }).open();
      };
      lib.appendChild(plus);
    };
    paintLib();
    contentEl.appendChild(lib);
    contentEl.appendChild(el("div", "tlt-field-label", "\u4E3A\u4EC0\u4E48\u505A / \u600E\u4E48\u9A8C\u8BC1"));
    const body = el("textarea", "tlt-textarea tall");
    body.placeholder = "\u503C\u5F97\u505A\u7684\u7406\u7531\u3001\u53EF\u80FD\u7684\u9A8C\u8BC1\u65B9\u5F0F\uFF08\u53EF\u4EE5\u7559\u7A7A\uFF09";
    body.value = this.idea?.body || "";
    contentEl.appendChild(body);
    const foot = el("div", "tlt-m-foot");
    if (!isNew) {
      const del = el("button", "tlt-btn danger", "\u5220\u9664");
      del.onclick = () => {
        void (async () => {
          await this.store.deleteIdea(this.idea);
          this.close();
          void this.onChange();
          new Notice("\u5DF2\u5220\u9664\u60F3\u6CD5");
        })();
      };
      foot.appendChild(del);
      foot.appendChild(el("span", "tlt-spacer"));
    }
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", isNew ? "\u6536\u5F55" : "\u4FDD\u5B58");
    ok.onclick = () => {
      void (async () => {
        const t2 = title.value.trim();
        if (!t2) {
          new Notice("\u5148\u5199\u4E00\u53E5\u8BDD");
          return;
        }
        const bd = body.value.trim();
        if (this.idea) {
          this.idea.title = t2;
          this.idea.tags = tags;
          this.idea.body = bd;
          await this.store.updateIdea(this.idea);
        } else {
          await this.store.addIdea({ title: t2, tags, body: bd || void 0 });
        }
        this.close();
        void this.onChange();
        new Notice(isNew ? "\u5DF2\u6536\u8FDB\u60F3\u6CD5\u6C60" : "\u5DF2\u4FDD\u5B58");
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => title.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
function popMenu(anchor, items, align = "left") {
  document.querySelectorAll(".tlt-menu").forEach((n) => n.remove());
  const m = el("div", "tlt-menu");
  items.forEach((it) => {
    const b = el("button", "tlt-menu-i", it.label);
    b.onclick = () => {
      m.remove();
      void it.onClick();
    };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth || 150;
  const left = align === "right" ? Math.min(r.right - w, window.innerWidth - w - 8) : Math.max(8, r.left);
  m.style.left = `${Math.round(left)}px`;
  m.style.top = `${Math.round(Math.min(r.top - m.offsetHeight - 6, window.innerHeight - m.offsetHeight - 8))}px`;
  const off = (e) => {
    if (!m.contains(e.target)) {
      m.remove();
      document.removeEventListener("mousedown", off);
    }
  };
  window.setTimeout(() => document.addEventListener("mousedown", off), 0);
}
function buildMsgFields(parent, init, store) {
  const d = {
    title: init.title || "",
    date: init.date || todayISO(),
    place: init.place || "",
    who: init.who || "",
    why: init.why || "",
    body: init.body || "",
    tags: init.tags || "",
    kind: "note"
  };
  const title = el("input", "tlt-input wide tlt-input-title");
  title.placeholder = "\u6807\u9898\uFF1A\u4E00\u53E5\u8BDD\u8BF4\u6E05\u8FD9\u6761\u6D88\u606F";
  title.value = d.title;
  title.oninput = () => d.title = title.value;
  parent.appendChild(title);
  const body = el("textarea", "tlt-textarea tlt-input-body");
  body.placeholder = "\u5185\u5BB9\uFF1A\u5177\u4F53\u8981\u8BF4\u4EC0\u4E48\uFF08\u53EF\u7559\u7A7A\uFF09";
  body.value = d.body;
  body.oninput = () => d.body = body.value;
  parent.appendChild(body);
  const rowOf = (label) => {
    const r = el("div", "tlt-row");
    r.appendChild(el("span", "tlt-row-l", label));
    parent.appendChild(r);
    return r;
  };
  const whenRow = rowOf("\u65F6\u95F4");
  const when = el("input", "tlt-input");
  when.type = "date";
  when.value = d.date;
  when.oninput = () => d.date = when.value;
  whenRow.appendChild(when);
  const whereRow = rowOf("\u5730\u70B9");
  const where = el("input", "tlt-input");
  where.placeholder = "\u4F1A\u8BAE\u5BA4 / \u7EBF\u4E0A / \u53EF\u7559\u7A7A";
  where.value = d.place;
  where.oninput = () => d.place = where.value;
  whereRow.appendChild(where);
  const whoRow = rowOf("\u4EBA\u7269");
  const who = el("input", "tlt-input");
  who.placeholder = "\u8C01\u5728\u573A / \u8C01\u4EA4\u529E\uFF0C\u9017\u53F7\u5206\u5F00";
  who.value = d.who;
  who.oninput = () => d.who = who.value;
  whoRow.appendChild(who);
  const whyRow = rowOf("\u7F18\u7531");
  const why = el("input", "tlt-input");
  why.placeholder = "\u4E3A\u4EC0\u4E48\u53D1\u8FD9\u6761\uFF08\u53EF\u7559\u7A7A\uFF09";
  why.value = d.why;
  why.oninput = () => d.why = why.value;
  whyRow.appendChild(why);
  const tagRow = rowOf("\u6807\u7B7E");
  const tags = el("input", "tlt-input");
  tags.placeholder = "\u9017\u53F7\u5206\u5F00\uFF0C\u53EF\u7559\u7A7A";
  tags.value = d.tags;
  tags.oninput = () => d.tags = tags.value;
  tagRow.appendChild(tags);
  return {
    titleEl: title,
    value: () => ({
      title: d.title.trim(),
      date: d.date || todayISO(),
      place: d.place.trim(),
      who: d.who.split(/[,，、]/).map((x) => x.trim().replace(/^\[\[|\]\]$/g, "")).filter(Boolean),
      why: d.why.trim(),
      body: d.body.trim(),
      tags: d.tags.split(/[,，]/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean),
      kind: "note"
    })
  };
}
var MsgModal = class extends TltModal {
  constructor(app, store, msg, onChange) {
    super(app);
    this.editing = false;
    this.store = store;
    this.msg = msg;
    this.onChange = onChange;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tlt-modal");
    const m = this.msg;
    const feed = this.store.feeds.find((f) => f.id === m.feed);
    const writable = !!feed?.mine || !!feed?.personal;
    if (this.editing) {
      this.openEdit(contentEl, m, feed);
      return;
    }
    contentEl.appendChild(el("div", "tlt-m-title", m.title));
    if (m.body) contentEl.appendChild(el("div", "tlt-m-body", m.body));
    const w = el("div", "tlt-5w");
    const cell = (k, v) => {
      if (!v) return;
      const c = el("div", "tlt-5w-c");
      c.append(el("span", "tlt-5w-k", k), el("span", "tlt-5w-v", v));
      w.appendChild(c);
    };
    cell("\u65F6\u95F4", m.date);
    cell("\u5730\u70B9", m.place);
    cell("\u4EBA\u7269", m.who.join("\u3001"));
    cell("\u7F18\u7531", m.why);
    if (w.children.length) contentEl.appendChild(w);
    if (m.tags.length) {
      const tg = el("div", "tlt-quick tlt-msg-tags");
      m.tags.forEach((t2) => tg.appendChild(el("span", "tlt-tag", t2)));
      contentEl.appendChild(tg);
    }
    const foot = el("div", "tlt-m-foot");
    const left = el("div", "tlt-foot-left");
    if (feed) left.appendChild(el("span", "tlt-srcbadge", feed.personal ? "\u4E2A\u4EBA" : feed.name));
    if (m.star) left.appendChild(el("span", "tlt-srcbadge star", "\u2605 \u91CD\u8981"));
    if (m.state === "ended") left.appendChild(el("span", "tlt-srcbadge off", "\u5DF2\u7ED3\u675F"));
    foot.appendChild(left);
    const more = el("button", "tlt-btn tlt-more", "\u22EF");
    more.title = "\u66F4\u591A";
    const moreItems = [];
    if (writable) {
      moreItems.push({
        label: m.state === "ended" ? "\u6062\u590D\u53D1\u5E03" : "\u7ED3\u675F\u8FD9\u6761",
        onClick: async () => {
          await this.store.setMsgState(m.feed, m, m.state === "ended" ? "live" : "ended");
          this.close();
          void this.onChange();
          new Notice("\u72B6\u6001\u5DF2\u66F4\u65B0");
        }
      });
    }
    if (feed?.personal) {
      moreItems.push({
        label: "\u53D1\u5E03\u4E3A\u6D88\u606F\u6E90\u2026",
        onClick: () => {
          this.close();
          if (feed) new PublishPersonalModal(this.app, this.store, feed, m, () => {
            void this.onChange();
          }).open();
        }
      });
    }
    if (writable) {
      const edit = el("button", "tlt-btn", "\u7F16\u8F91");
      edit.onclick = () => {
        this.editing = true;
        this.onOpen();
      };
      foot.appendChild(edit);
    }
    if (moreItems.length) {
      more.onclick = () => popMenu(more, moreItems, "right");
      foot.appendChild(more);
    }
    const toTask = el("button", "tlt-btn pri", "\u8F6C\u4E3A\u4EFB\u52A1\u2026");
    toTask.onclick = () => {
      this.close();
      new QuickTaskModal(this.app, this.store, this.onChange, { title: m.title, due: m.date }).open();
    };
    const close = el("button", "tlt-btn", "\u5173\u95ED");
    close.onclick = () => this.close();
    foot.append(toTask, close);
    contentEl.appendChild(foot);
  }
  openEdit(contentEl, m, feed) {
    contentEl.appendChild(el("div", "tlt-m-title", "\u7F16\u8F91\u6D88\u606F"));
    const f = buildMsgFields(contentEl, {
      title: m.title,
      date: m.date,
      place: m.place,
      who: m.who.join("\u3001"),
      why: m.why,
      body: m.body,
      tags: m.tags.join(", "),
      kind: m.kind
    }, this.store);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => {
      this.editing = false;
      this.onOpen();
    };
    const save = el("button", "tlt-btn pri", "\u4FDD\u5B58");
    save.onclick = () => {
      void (async () => {
        const v = f.value();
        if (!v.title) {
          new Notice("\u6807\u9898\u4E0D\u80FD\u7A7A");
          return;
        }
        await this.store.updateMessage(m.feed, m, v);
        this.close();
        void this.onChange();
        new Notice("\u5DF2\u4FDD\u5B58");
      })();
    };
    foot.append(cancel, save);
    contentEl.appendChild(foot);
    window.setTimeout(() => f.titleEl.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var PublishPersonalModal = class extends TltModal {
  constructor(app, store, from, msg, onDone) {
    super(app);
    this.store = store;
    this.from = from;
    this.msg = msg;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u53D1\u5E03\u4E3A\u6D88\u606F\u6E90"));
    contentEl.appendChild(el("div", "tlt-m-meta", `\u628A\u300C${this.msg.title}\u300D\u653E\u8FDB\u4E00\u4E2A\u65B0\u6E90\uFF0C\u522B\u4EBA\u8BA2\u9605\u8FD9\u4E2A\u6E90\u5C31\u80FD\u6536\u5230\u3002`));
    const idIn = el("input", "tlt-input wide");
    idIn.placeholder = "\u6E90 ID\uFF08\u82F1\u6587/\u6570\u5B57\u6700\u7A33\uFF0C\u4F5C\u4E3A ?ID=\uFF09";
    idIn.value = "my-feed";
    contentEl.appendChild(idIn);
    const nameIn = el("input", "tlt-input wide");
    nameIn.placeholder = "\u6E90\u540D\u79F0\uFF08\u663E\u793A\u7528\uFF09";
    nameIn.value = "\u6211\u7684\u65B0\u6E90";
    contentEl.appendChild(nameIn);
    contentEl.appendChild(el("div", "tlt-hint", "ID \u5C31\u662F\u8BA2\u9605\u5730\u5740\u91CC\u7684 ?id=\uFF0C\u5EFA\u597D\u540E\u522B\u6539\u3002"));
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u521B\u5EFA\u5E76\u653E\u5165");
    ok.onclick = () => {
      void (async () => {
        const id = idIn.value.trim();
        const name = nameIn.value.trim() || id;
        if (!id) {
          new Notice("\u5148\u5199\u6E90 ID");
          return;
        }
        const r = await this.store.createFeed(id, name);
        if (!r.ok) {
          new Notice("\u540C\u540D\u6E90\u5DF2\u5B58\u5728\uFF0C\u6362\u4E2A ID");
          return;
        }
        await this.store.addMessage(id, {
          title: this.msg.title,
          date: this.msg.date,
          kind: this.msg.kind,
          place: this.msg.place,
          body: this.msg.body
        });
        await this.store.setMsgState(this.from.id, this.msg, "ended");
        this.close();
        void this.onDone();
        new Notice(`\u5DF2\u53D1\u5E03\u5230\u300C${name}\u300D\xB7 \u53BB\u6D88\u606F\u4E2D\u5FC3\u53F3\u680F\u63A8\u9001\u5B83`);
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => idIn.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TagEditModal = class extends TltModal {
  constructor(app, store, name, onDone) {
    super(app);
    this.store = store;
    this.name = name;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u7F16\u8F91\u6807\u7B7E"));
    contentEl.appendChild(el("div", "tlt-m-meta", `\u6539\u540D\u4F1A\u540C\u65F6\u66F4\u65B0 ${this.store.ideas.filter((i) => (i.tags || []).includes(this.name)).length} \u6761\u968F\u624B\u8BB0\u3002`));
    const input = el("input", "tlt-input wide");
    input.value = this.name;
    contentEl.appendChild(input);
    const foot = el("div", "tlt-m-foot");
    const del = el("button", "tlt-btn danger", "\u5220\u9664\u6807\u7B7E");
    del.onclick = () => {
      void (async () => {
        await this.store.deleteTag(this.name);
        this.close();
        void this.onDone();
        new Notice(`\u5DF2\u5220\u9664\u300C${this.name}\u300D`);
      })();
    };
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u4FDD\u5B58");
    ok.onclick = () => {
      void (async () => {
        const v = input.value.trim().replace(/^#/, "");
        if (!v) {
          new Notice("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
          return;
        }
        if (v !== this.name) await this.store.renameTag(this.name, v);
        this.close();
        void this.onDone();
        new Notice("\u5DF2\u6539\u597D");
      })();
    };
    foot.append(del, cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => input.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var PromptModal = class extends TltModal {
  constructor(app, title, label, onSubmit) {
    super(app);
    this.title = title;
    this.label = label;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", this.title));
    const input = el("input", "tlt-input wide tlt-input-title");
    input.placeholder = this.label;
    contentEl.appendChild(input);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", "\u53D6\u6D88");
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u786E\u5B9A");
    ok.onclick = () => {
      const v = input.value.trim();
      this.close();
      if (v) void this.onSubmit(v);
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ok.click();
      }
    });
    window.setTimeout(() => input.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/views/dom.ts
function setSvgMarkup(svg, markup) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml"
  );
  const nodes = Array.from(doc.documentElement.childNodes).map((node) => svg.ownerDocument.importNode(node, true));
  svg.replaceChildren(...nodes);
}

// src/views/workbench.ts
var VIEW_TYPE_WORKBENCH = "tlt-workbench";
var DAY_FROM = 7 * 60;
var DAY_TO = 23 * 60;
var HOUR_PX = 62;
var PERIOD_LABEL = { w: "\u672C\u5468", m: "\u672C\u6708", q: "\u672C\u5B63\u5EA6" };
var KIND_LABEL = { ask: "\u8981\u6C42", event: "\u6D3B\u52A8", risk: "\u98CE\u9669", note: "\u901A\u77E5" };
var KIND_COLOR = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
var WEEK = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
var escapeXml = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
var WorkbenchView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.tab = "today";
    this.viewDate = todayISO();
    this.proj = null;
    this.q = "";
    this.expanded = /* @__PURE__ */ new Set();
    this.rhythmView = "star";
    this.taskDim = "m";
    this.taskTag = null;
    this.starZoom = 1;
    this.scrollToMin = null;
    this.ideaTags = /* @__PURE__ */ new Set();
    this.starPan = { x: 0, y: 0 };
    this.plugin = plugin;
    this.period = plugin.settings.defaultPeriod;
  }
  get store() {
    return this.plugin.store;
  }
  getViewType() {
    return VIEW_TYPE_WORKBENCH;
  }
  getDisplayText() {
    return "\u65F6\u95F4\u7EBF\u5DE5\u4F5C\u53F0";
  }
  getIcon() {
    return "activity";
  }
  async onOpen() {
    this.contentEl.addEventListener("click", (ev) => {
      void this.onClick(ev);
    });
    await this.store.ensureLoaded();
    await this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  async refresh() {
    await this.store.load();
    await this.render();
  }
  /* ================= 渲染 ================= */
  async render() {
    const root = this.contentEl;
    const prevScroll = root.querySelector(".tlt-work")?.scrollTop || 0;
    const ae = document.activeElement;
    const focusKey = ae?.instanceOf(HTMLInputElement) && ae.dataset.focuskey ? { key: ae.dataset.focuskey, start: ae.selectionStart ?? 0, end: ae.selectionEnd ?? 0 } : null;
    root.empty();
    root.addClass("tlt-root");
    const app = el("div", "tlt");
    app.appendChild(this.sidebar());
    app.appendChild(this.main());
    app.appendChild(this.rail());
    root.appendChild(app);
    this.bindInputs(app);
    const work = app.querySelector(".tlt-work");
    if (work) work.scrollTop = prevScroll;
    if (focusKey) {
      const again = root.querySelector(`[data-focuskey="${focusKey.key}"]`);
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(focusKey.start, focusKey.end);
        } catch {
        }
      }
    }
    const grid = root.querySelector(".tlt-daygrid");
    if (grid?.dataset.scrollTop) {
      grid.scrollTop = Number(grid.dataset.scrollTop) || 0;
      delete grid.dataset.scrollTop;
    }
  }
  /* ---------- 左栏 ---------- */
  sidebar() {
    const s = el("aside", "tlt-side");
    const top = el("div", "tlt-brand");
    const dot = el("span", "tlt-mark");
    top.append(dot, el("b", "", "TLT"));
    const folder = el("span", "tlt-fold", "TLT/");
    folder.title = `${this.store.settings.tasksFolder} \xB7 ${this.store.settings.teamFolder}`;
    top.appendChild(folder);
    s.appendChild(top);
    const scroll = el("div", "tlt-side-scroll");
    scroll.appendChild(el("div", "tlt-shead", t("\u9879\u76EE \xB7 \u8FDB\u5EA6")));
    const projects = this.store.projects();
    const all = this.store.tasks;
    projects.forEach((p) => {
      const list = all.filter((t2) => t2.project === p);
      const pct = list.length ? Math.round(list.filter((t2) => t2.done).length / list.length * 100) : 0;
      const card = el("div", "tlt-proj" + (this.proj === p ? " on" : ""));
      card.dataset.proj = p;
      const row2 = el("div", "tlt-prow");
      row2.append(el("span", "tlt-sw"), el("span", "tlt-pname", p), el("span", "tlt-ppct", pct + "%"));
      const bar = el("div", "tlt-pbar");
      const fill = el("i");
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      const meta = el("div", "tlt-pmeta", `${list.filter((t2) => !t2.done).length} \u9879\u672A\u5B8C\u6210 \xB7 ${list.filter((t2) => t2.milestone).length} \u4E2A\u91CC\u7A0B\u7891\u4EFB\u52A1`);
      card.append(row2, bar, meta);
      scroll.appendChild(card);
    });
    if (!projects.length) scroll.appendChild(el("div", "tlt-empty", t("TLT/tasks \u91CC\u8FD8\u6CA1\u6709\u4EFB\u52A1\u6587\u4EF6")));
    const seg2 = el("div", "tlt-seg tlt-period");
    ["w", "m", "q"].forEach((p) => {
      const b = el("button", "tlt-seg-b" + (this.period === p ? " on" : ""), PERIOD_LABEL[p]);
      b.dataset.period = p;
      seg2.appendChild(b);
    });
    scroll.appendChild(seg2);
    const idea = this.store.ideas;
    const box = el("div", "tlt-ideabox");
    box.dataset.tab = "ideas";
    box.append(el("span", "", "\u2726 \u968F\u624B\u8BB0"), el("b", "", String(idea.length)));
    const stale = idea.filter((i) => i.stage !== "\u5DF2\u7ACB\u9879" && (Date.now() - D(i.at).getTime()) / 864e5 > 14).length;
    if (stale) box.append(el("span", "tlt-stale", `${stale} \u6761\u5F85\u56DE\u770B`));
    scroll.appendChild(box);
    s.appendChild(scroll);
    const done = all.filter((t2) => t2.done).length;
    const mine = this.store.staff[0]?.name || "";
    const me = this.store.staff.find((x) => x.name === mine);
    const sat = saturation(this.store.tasks, mine, this.period, { capacity: me?.capacity ?? 100, days: me?.days ?? 5 });
    const foot = el("div", "tlt-sfoot");
    foot.append(el("span", "", `\u5B8C\u6210 ${done}/${all.length}`), el("span", "", `${PERIOD_LABEL[this.period]}\u6211 ${sat.pct}%`));
    s.appendChild(foot);
    return s;
  }
  /* ---------- 主区 ---------- */
  main() {
    const m = el("main", "tlt-main");
    const top = el("div", "tlt-top");
    const crumbs = el("div", "tlt-crumbs");
    crumbs.append(el("b", "", this.proj || "\u5168\u90E8\u5DE5\u4F5C"), el("span", "tlt-sep", "/"), el("span", "", this.tabName()));
    top.appendChild(crumbs);
    top.appendChild(el("div", "tlt-spacer"));
    const search = el("div", "tlt-search");
    const input = el("input");
    input.placeholder = { today: "\u641C\u7D22\u4EFB\u52A1 / \u8BB0\u5F55", month: "\u641C\u7D22\u4EFB\u52A1", ms: "\u641C\u7D22\u91CC\u7A0B\u7891", staff: "\u641C\u7D22\u4EBA\u5458", ideas: "\u641C\u7D22\u968F\u624B\u8BB0", draw: "" }[this.tab] || "\u641C\u7D22";
    input.value = this.q;
    input.dataset.search = "1";
    input.dataset.focuskey = "search";
    search.appendChild(input);
    top.appendChild(search);
    const theme = el("button", "tlt-btn", this.plugin.isLight() ? "\u263E" : "\u2600");
    theme.dataset.theme = "1";
    theme.title = "\u5207\u6362\u660E\u6697";
    const add = el("button", "tlt-btn pri lg", t("\uFF0B \u65B0\u5EFA"));
    add.dataset.newtask = "1";
    top.append(theme, add);
    m.appendChild(top);
    const tabs = el("div", "tlt-tabs");
    [["today", "\u65E5\u5386"], ["month", "\u4EFB\u52A1"], ["ms", "\u91CC\u7A0B\u7891"], ["staff", "\u4EBA\u5458"], ["ideas", "\u968F\u624B\u8BB0"], ["draw", "\u968F\u624B\u753B"]].forEach(([k, label]) => {
      const b = el("button", "tlt-tab" + (this.tab === k ? " on" : ""), t(label));
      b.dataset.tab = k;
      tabs.appendChild(b);
    });
    m.appendChild(tabs);
    const work = el("div", "tlt-work");
    if (this.tab === "today") work.appendChild(this.paneToday());
    if (this.tab === "month") work.appendChild(this.paneMonth());
    if (this.tab === "staff") work.appendChild(this.paneStaff());
    if (this.tab === "ideas") work.appendChild(this.paneIdeas());
    if (this.tab === "ms") work.appendChild(this.paneMilestones());
    if (this.tab === "draw") work.appendChild(this.paneDraw());
    m.appendChild(work);
    return m;
  }
  tabName() {
    const names = { today: "\u65E5\u5386", month: "\u4EFB\u52A1", ms: "\u91CC\u7A0B\u7891", staff: "\u4EBA\u5458", ideas: "\u968F\u624B\u8BB0", draw: "\u968F\u624B\u753B" };
    return names[this.tab] ? t(names[this.tab]) : "";
  }
  /* ---------- 日历 ---------- */
  tasksForDay(k) {
    return this.store.tasks.filter((t2) => t2.due === k || t2.start && t2.due && t2.start <= k && t2.due >= k);
  }
  paneToday() {
    const p = el("div", "tlt-pane");
    const sel = this.viewDate;
    const bar = el("div", "tlt-dbar");
    const prev = el("button", "tlt-dnav", "\u2039");
    prev.dataset.dnav = "-1";
    const next = el("button", "tlt-dnav", "\u203A");
    next.dataset.dnav = "1";
    const dl = D(sel);
    const lab = el("div", "tlt-dlabel");
    lab.append(`${dl.getMonth() + 1} \u6708 ${dl.getDate()} \u65E5`);
    lab.createEl("em", { text: `\u5468${WEEK[dl.getDay()]}${sel === todayISO() ? " \xB7 \u4ECA\u5929" : ""}` });
    const todayBtn = el("button", "tlt-btn", t("\u56DE\u5230\u4ECA\u5929"));
    todayBtn.dataset.today = "1";
    bar.append(
      prev,
      lab,
      next,
      todayBtn,
      el("span", "tlt-spacer"),
      el("span", "tlt-dhint", `${this.logsOn(sel).length} \u6761\u8BB0\u5F55 \xB7 ${this.unscheduled(sel).length} \u672A\u6392`)
    );
    const strip = el("div", "tlt-strip");
    for (let i = -3; i <= 3; i++) {
      const k = addDays(sel, i);
      const cell = el("div", "tlt-ds" + (k === sel ? " sel" : "") + (k === todayISO() ? " today" : ""));
      cell.dataset.day = k;
      cell.append(el("span", "tlt-dw", WEEK[D(k).getDay()]), el("span", "tlt-dn", String(D(k).getDate())));
      const b = el("span", "tlt-db" + (this.tasksForDay(k).length ? " on" : ""));
      cell.appendChild(b);
      strip.appendChild(cell);
    }
    p.appendChild(this.rhythm());
    p.appendChild(bar);
    p.appendChild(strip);
    const wrap = el("div", "tlt-daywrap");
    const grid = el("div", "tlt-daygrid");
    grid.dataset.slotgrid = "1";
    const inner = el("div", "tlt-dayinner");
    inner.style.height = `${(DAY_TO - DAY_FROM) / 60 * HOUR_PX}px`;
    for (let mnt = DAY_FROM; mnt <= DAY_TO; mnt += 60) {
      const h = el("div", "tlt-hour");
      h.style.top = `${(mnt - DAY_FROM) / 60 * HOUR_PX}px`;
      h.appendChild(el("span", "", minToHHMM(mnt)));
      inner.appendChild(h);
    }
    const logs = this.logsOn(sel);
    const planned = this.store.tasks.filter((t2) => t2.due === sel && t2.st && !t2.done);
    planned.forEach((t2) => {
      const a = hhmmToMin(t2.st) || DAY_FROM;
      const b = hhmmToMin(t2.en) || a + 60;
      const blk = el("div", "tlt-blk plan");
      blk.dataset.task = t2.id;
      blk.style.top = `${(a - DAY_FROM) / 60 * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, (b - a) / 60 * HOUR_PX)}px`;
      const c = el("div", "tlt-blk-c");
      c.append(
        el("div", "tlt-blk-t", t2.title),
        el("div", "tlt-blk-m", `${t2.st}\u2013${t2.en} \xB7 \u8BA1\u5212${t2.wl ? " \xB7 " + t2.wl + "%" : ""}`)
      );
      blk.appendChild(c);
      inner.appendChild(blk);
    });
    logs.forEach((l) => {
      const a = hhmmToMin(l.st) || DAY_FROM;
      const b = hhmmToMin(l.en) || a + 30;
      const blk = el("div", "tlt-blk " + (l.extra ? "extra" : "log"));
      blk.dataset.log = l.id;
      blk.style.top = `${(a - DAY_FROM) / 60 * HOUR_PX}px`;
      blk.style.height = `${Math.max(26, (b - a) / 60 * HOUR_PX)}px`;
      const c = el("div", "tlt-blk-c");
      c.append(
        el("div", "tlt-blk-t", l.title),
        el("div", "tlt-blk-m", `${l.st}\u2013${l.en} \xB7 ${l.extra ? "\u4E34\u65F6" : "\u8BB0\u5F55"}${l.project ? " \xB7 " + l.project : ""}`)
      );
      blk.appendChild(c);
      inner.appendChild(blk);
    });
    if (sel === todayISO()) {
      const now = /* @__PURE__ */ new Date();
      const nm = now.getHours() * 60 + now.getMinutes();
      if (nm > DAY_FROM && nm < DAY_TO) {
        const line = el("div", "tlt-now");
        line.style.top = `${(nm - DAY_FROM) / 60 * HOUR_PX}px`;
        line.appendChild(el("b", "", `\u73B0\u5728 ${minToHHMM(nm)}`));
        inner.appendChild(line);
      }
    }
    grid.appendChild(inner);
    wrap.appendChild(grid);
    const side = el("div", "tlt-dayside");
    const uns = this.unscheduled(sel);
    const b1 = el("div", "tlt-box");
    const h1 = el("div", "tlt-box-h");
    h1.append(el("span", "", t("\u8FD9\u5929\u8981\u505A\u7684")), el("span", "tlt-hint2", t("\u70B9\u4E00\u4E0B\u6392\u8FDB\u65F6\u95F4\u8868")));
    b1.appendChild(h1);
    if (uns.length) {
      const chips = el("div", "tlt-chips");
      uns.forEach((t2) => {
        const c = el("span", "tlt-chipq");
        c.dataset.sched = t2.id;
        c.title = "\u70B9\u4E00\u4E0B\u6392\u8FDB\u8FD9\u5929\u7684\u65F6\u95F4\u8868";
        c.textContent = `${t2.title}${t2.wl ? " \xB7 " + t2.wl + "%" : ""}`;
        chips.appendChild(c);
      });
      b1.appendChild(chips);
    } else b1.appendChild(el("div", "tlt-empty", t("\u90FD\u6392\u4E0A\u4E86")));
    side.appendChild(b1);
    const plan = logs.filter((l) => !l.extra).length;
    const extra = logs.filter((l) => l.extra).length;
    const b2 = el("div", "tlt-box");
    b2.appendChild(el("div", "tlt-box-h", t("\u8FD9\u5929 \xB7 \u8BA1\u5212\u4E0E\u5B9E\u9645")));
    [["\u8BA1\u5212", plan], ["\u8BB0\u5F55", logs.length], ["\u5176\u4E2D\u4E34\u65F6", extra]].forEach(([n, v]) => {
      const r = el("div", "tlt-sum");
      r.append(el("span", "tlt-sum-n", String(n)));
      const bar2 = el("span", "tlt-sum-b");
      const fill = el("i");
      fill.style.width = `${Math.min(100, Number(v) / 6 * 100)}%`;
      bar2.appendChild(fill);
      r.append(bar2, el("span", "tlt-sum-v", `${v} \u6761`));
      b2.appendChild(r);
    });
    if (logs.length) {
      const pct = Math.round(extra / logs.length * 100);
      b2.appendChild(el("div", "tlt-hint", `\u4E34\u65F6\u5360\u4E86\u8FD9\u5929\u8BB0\u5F55\u7684 ${pct}%`));
    }
    side.appendChild(b2);
    wrap.appendChild(side);
    p.appendChild(wrap);
    const jump = this.scrollToMin;
    this.scrollToMin = null;
    const d0 = /* @__PURE__ */ new Date();
    const nowMin = d0.getHours() * 60 + d0.getMinutes();
    const focus = jump !== null ? jump : sel === todayISO() ? Math.max(DAY_FROM, nowMin) : 9 * 60;
    grid.dataset.scrollTop = String(Math.max(0, (focus - DAY_FROM) / 60 * HOUR_PX - 90));
    return p;
  }
  logsOn(k) {
    return this.store.logs.filter((l) => l.due === k).sort((a, b) => (hhmmToMin(a.st) || 0) - (hhmmToMin(b.st) || 0));
  }
  unscheduled(k) {
    return this.store.tasks.filter((t2) => !t2.done && t2.due === k && !t2.st);
  }
  rhythm() {
    const wrap = el("div", "tlt-rhythm");
    const days = [];
    for (let i = -3; i <= 17; i++) days.push(addDays(todayISO(), i));
    const load = (k) => this.store.tasks.filter((t2) => t2.due && t2.start ? t2.start <= k && t2.due >= k : t2.due === k).length;
    const max = Math.max(1, ...days.map(load));
    const dueN = this.store.tasks.filter((t2) => !t2.done && t2.due && t2.due >= todayISO() && t2.due <= days[days.length - 1]).length;
    const msN = this.store.milestones().filter((m) => m.tasks.some((t2) => t2.due && t2.due >= todayISO())).length;
    let busy = days[0], bn = -1;
    days.forEach((k) => {
      const n = load(k);
      if (n > bn) {
        bn = n;
        busy = k;
      }
    });
    const head = el("div", "tlt-rhythm-h");
    head.append(el("span", "tlt-rhythm-t", t("\u8282\u594F \xB7 21 \u5929")));
    head.appendChild(el("span", "tlt-rhythm-s", `${dueN} \u4E2A\u5230\u671F \xB7 ${msN} \u4E2A\u91CC\u7A0B\u7891 \xB7 \u6700\u6324 ${D(busy).getMonth() + 1}/${D(busy).getDate()}\uFF08${bn} \u4EF6\uFF09`));
    head.appendChild(el("span", "tlt-spacer"));
    const seg2 = el("div", "tlt-seg tlt-rhythm-seg");
    [["bars", "\u6761\u5E26"], ["star", "\u661F\u56FE"]].forEach(([k, t2]) => {
      const b = el("button", "tlt-seg-b" + (this.rhythmView === k ? " on" : ""), t2);
      b.dataset.rhythm = k;
      seg2.appendChild(b);
    });
    head.appendChild(seg2);
    wrap.appendChild(head);
    if (this.rhythmView === "star") {
      wrap.appendChild(this.starMap());
      return wrap;
    }
    const mini = el("div", "tlt-mini");
    days.forEach((k) => {
      const n = load(k);
      const c = el("span", "tlt-mcell" + (k === todayISO() ? " today" : ""));
      c.dataset.day = k;
      const i = el("i");
      i.style.height = `${n ? 6 + Math.round(n / max * 22) : 3}px`;
      i.style.opacity = String(n ? 0.35 + Math.min(0.55, n * 0.13) : 0.08);
      c.appendChild(i);
      c.title = `${k} \xB7 ${n} \u4EF6`;
      mini.appendChild(c);
    });
    wrap.appendChild(mini);
    return wrap;
  }
  /** 极坐标时间线：半径=时间，扇区=项目，连线=同一个人 */
  starMap() {
    const box = el("div", "tlt-star-box");
    const svg = createSvg("svg");
    svg.setAttribute("class", "tlt-star");
    svg.setAttribute("viewBox", "0 0 560 210");
    const redraw = () => {
      setSvgMarkup(svg, this.starBody(560, 210));
    };
    redraw();
    box.appendChild(svg);
    box.appendChild(el(
      "div",
      "tlt-star-legend",
      "\u534A\u5F84=\u65F6\u95F4\uFF08\u5185\u5708\u4ECA\u5929\uFF0C\u6BCF\u5708 7 \u5929\uFF09 \xB7 \u6247\u533A=\u9879\u76EE \xB7 \u5706\u70B9=\u4EFB\u52A1 \xB7 \u83F1\u5F62=\u91CC\u7A0B\u7891 \xB7 \u7EC6\u7EBF=\u540C\u4E00\u4E2A\u4EBA \xB7 \u6EDA\u8F6E\u7F29\u653E\uFF0C\u62D6\u52A8\u5E73\u79FB"
    ));
    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = this.starZoom * (e.deltaY < 0 ? 1.12 : 0.89);
      this.starZoom = Math.max(0.6, Math.min(2.6, next));
      redraw();
    }, { passive: false });
    let dragging = false, sx = 0, sy = 0, px = 0, py = 0;
    svg.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-peek],[data-mspeek]")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      px = this.starPan.x;
      py = this.starPan.y;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.starPan = { x: px + (e.clientX - sx), y: py + (e.clientY - sy) };
      redraw();
    });
    svg.addEventListener("pointerup", () => {
      dragging = false;
    });
    svg.addEventListener("pointercancel", () => {
      dragging = false;
    });
    return box;
  }
  /** 星图的 SVG 内容（随缩放/平移变化） */
  starBody(W, H) {
    const cx = W / 2 + this.starPan.x, cy = H / 2 + this.starPan.y;
    const r0 = 30 * this.starZoom, R = 76 * this.starZoom;
    const FROM = -3, TO = 21;
    const tasks = this.store.tasks.filter((t2) => t2.due);
    const projects = Array.from(new Set(tasks.map((t2) => t2.project))).slice(0, 8);
    const span = 360 / Math.max(1, projects.length);
    const at = (d) => {
      const diff = Math.round((D(d).getTime() - D(todayISO()).getTime()) / 864e5);
      const f = Math.max(0, Math.min(1, (diff - FROM) / (TO - FROM)));
      return r0 + f * (R - r0);
    };
    const pos = {};
    const byP = {};
    tasks.forEach((t2) => {
      if (t2.due) (byP[t2.project] = byP[t2.project] || []).push(t2);
    });
    let body = "";
    [0, 7, 14, 21].forEach((d) => {
      const r = r0 + d / 21 * (R - r0);
      body += `<circle class="tlt-ring" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/>`;
      body += `<text class="tlt-rlab" x="${(cx + 3).toFixed(1)}" y="${(cy - r + 9).toFixed(1)}">${d === 0 ? "\u4ECA\u5929" : "+" + d + "\u5929"}</text>`;
    });
    projects.forEach((p, i) => {
      const a = (-90 + i * span) * Math.PI / 180;
      body += `<line class="tlt-spoke" x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * (R + 8)).toFixed(1)}" y2="${(cy + Math.sin(a) * (R + 8)).toFixed(1)}"/>`;
      const lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 18);
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      body += `<text class="tlt-plab" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${escapeXml(p.slice(0, 8))}</text>`;
    });
    projects.forEach((p, i) => {
      const list = (byP[p] || []).slice().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      list.forEach((t2, j) => {
        const base = -90 + i * span;
        const off = list.length > 1 ? (j / (list.length - 1) - 0.5) * span * 0.62 : 0;
        const a = (base + off) * Math.PI / 180;
        const r = at(t2.due);
        pos[t2.id] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      });
    });
    const owners = Array.from(new Set(tasks.flatMap((t2) => t2.owners)));
    owners.forEach((o) => {
      const list = tasks.filter((t2) => t2.owners.includes(o) && t2.due).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      if (list.length < 2) return;
      for (let i = 0; i < list.length - 1; i++) {
        const a = pos[list[i].id], b2 = pos[list[i + 1].id];
        if (!a || !b2) continue;
        body += `<path class="tlt-plink" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b2[0].toFixed(1)} ${b2[1].toFixed(1)}"/>`;
      }
    });
    tasks.forEach((t2) => {
      const p = pos[t2.id];
      if (!p) return;
      const r = (2.2 + Math.min(3, (t2.est || 0) * 0.4)) * Math.max(0.85, this.starZoom);
      body += `<g class="tlt-node-g" data-peek="${t2.id}">
        <circle class="tlt-hit" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(r + 7).toFixed(1)}"/>
        <circle class="tlt-node" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}"
          fill="${t2.done ? "var(--tlt-ink4)" : "var(--tlt-acc)"}" opacity="${t2.done ? 0.45 : 0.9}"/>
        <title>${escapeXml(t2.title)}</title></g>`;
    });
    this.store.milestones().forEach((m) => {
      const dues = m.tasks.map((t2) => t2.due).filter((d) => !!d).sort();
      if (!dues.length) return;
      const i = projects.indexOf(m.project);
      if (i < 0) return;
      const a = (-90 + i * span) * Math.PI / 180;
      const r = at(dues[dues.length - 1]);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      body += `<g class="tlt-ms-g" data-mspeek="${escapeXml(m.project)}::${escapeXml(m.name)}">
        <rect class="tlt-hit" x="${(x - 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="16" height="16"/>
        <rect class="tlt-ms-dia" x="${(x - 3.2).toFixed(1)}" y="${(y - 3.2).toFixed(1)}" width="6.4" height="6.4"
          transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>
        <title>${escapeXml(m.name)}</title></g>`;
    });
    return body;
  }
  /* ---------- 本月 ---------- */
  paneMonth() {
    const p = el("div", "tlt-pane");
    const m = this.tasksInDim();
    const head = el("div", "tlt-pane-h");
    const label = { w: "\u672C\u5468", m: "\u672C\u6708", q: "\u672C\u5B63\u5EA6", all: "\u5168\u90E8" }[this.taskDim];
    head.append(el("span", "", `${label} \xB7 ${m.late.length} \u903E\u671F / ${m.todo.length} \u8981\u505A / ${m.done.length} \u5DF2\u5B8C\u6210 / ${m.pending.length} \u5F85\u6392\u671F`));
    head.appendChild(el("span", "tlt-spacer"));
    const tags = Array.from(/* @__PURE__ */ new Set(["\u5DE5\u4F5C", "\u4E2A\u4EBA", ...this.store.tasks.flatMap((t2) => t2.tags || [])]));
    const tf = el("div", "tlt-seg tlt-tag-seg");
    [{ v: null, t: "\u5168\u90E8" }, ...tags.map((t2) => ({ v: t2, t: t2 }))].forEach(({ v: tv, t: t2 }) => {
      const b = el("button", "tlt-seg-b" + (this.taskTag === tv ? " on" : ""), t2);
      b.dataset.tag = tv ?? "";
      tf.appendChild(b);
    });
    head.appendChild(tf);
    const seg2 = el("div", "tlt-seg tlt-dim-seg");
    [["w", "\u672C\u5468"], ["m", "\u672C\u6708"], ["q", "\u672C\u5B63\u5EA6"], ["all", "\u5168\u90E8"]].forEach(([k, t2]) => {
      const b2 = el("button", "tlt-seg-b" + (this.taskDim === k ? " on" : ""), t2);
      b2.dataset.dim = k;
      seg2.appendChild(b2);
    });
    head.appendChild(seg2);
    p.appendChild(head);
    const groups = [
      [`${label}\u903E\u671F`, m.late, "#D98B5F"],
      [`${label}\u8981\u505A`, m.todo, "#5B6CFF"],
      [`${label}\u5DF2\u5B8C\u6210`, m.done, "#4FB59A"],
      ["\u5F85\u6392\u671F\uFF08\u672A\u5206\u914D\u65F6\u95F4\uFF09", m.pending, "#8B7CF6"]
    ];
    groups.forEach(([name, list, color]) => {
      const g = el("div", "tlt-mgrp");
      const h = el("div", "tlt-mgh");
      const dot = el("span", "tlt-dot");
      dot.style.background = color;
      h.append(dot, el("span", "", name), el("span", "tlt-mgc", String(list.length)));
      g.appendChild(h);
      if (!list.length) g.appendChild(el("div", "tlt-empty", "\u6CA1\u6709"));
      list.forEach((t2) => g.appendChild(this.taskRow(t2)));
      p.appendChild(g);
    });
    return p;
  }
  /** 任务视图的维度：本周 / 本月 / 本季度 / 全部 */
  tasksInDim() {
    const all = this.store.tasks.filter((t2) => t2.kind === "task").filter((t2) => !this.q || t2.title.includes(this.q) || (t2.project || "").includes(this.q) || (t2.milestone || "").includes(this.q)).filter((t2) => !this.taskTag || (this.taskTag === "\u5DE5\u4F5C" || this.taskTag === "\u4E2A\u4EBA" ? t2.scope === this.taskTag : (t2.tags || []).includes(this.taskTag)));
    const dim = this.taskDim;
    const inDim = (d) => dim === "all" ? true : !!d && inPeriod(d, dim);
    const today = todayISO();
    return {
      late: all.filter((t2) => !t2.done && t2.due && t2.due < today && inDim(t2.due)),
      todo: all.filter((t2) => !t2.done && t2.due && t2.due >= today && inDim(t2.due)),
      done: all.filter((t2) => t2.done && inDim(t2.due)),
      pending: all.filter((t2) => !t2.done && !t2.due)
    };
  }
  taskRow(t2) {
    const r = el("div", "tlt-task" + (t2.done ? " done" : ""));
    r.dataset.task = t2.id;
    const cb = el("i", "tlt-cb" + (t2.done ? " on" : ""));
    cb.dataset.ck = t2.id;
    r.appendChild(cb);
    const body = el("div", "tlt-task-b");
    const title = el("div", "tlt-task-t");
    if (t2.pri >= 2) {
      const pr = el("i", "tlt-pd" + (t2.pri >= 3 ? " u" : ""));
      title.appendChild(pr);
    }
    title.appendChild(document.createTextNode(t2.title));
    body.appendChild(title);
    const meta = el("div", "tlt-task-m");
    if (t2.milestone) meta.appendChild(el("span", "tlt-tag", t2.milestone));
    meta.appendChild(el("span", "", t2.due ? t2.due.slice(5) : "\u5F85\u6392\u671F"));
    if (t2.est !== void 0) meta.appendChild(el("span", "tlt-wl", `${t2.est} \u4EBA\u5929`));
    else if (t2.wl) meta.appendChild(el("span", "tlt-wl", `${t2.wl}%`));
    if (t2.scope === "\u4E2A\u4EBA") meta.appendChild(el("span", "tlt-tag own", "\u4E2A\u4EBA"));
    (t2.tags || []).forEach((tg) => meta.appendChild(el("span", "tlt-tag", tg)));
    if (t2.owners.length) meta.appendChild(el("span", "", t2.owners.join("\u3001")));
    if (t2.files.length) meta.appendChild(el("span", "", `\u25A4 ${t2.files.length}`));
    body.appendChild(meta);
    r.appendChild(body);
    return r;
  }
  /* ---------- 人员 ---------- */
  paneStaff() {
    const p = el("div", "tlt-pane");
    const rows = this.store.staff.map((s) => ({
      s,
      sat: saturation(this.store.tasks, s.name, this.period, { capacity: s.capacity, days: s.days })
    }));
    const over = rows.filter((r) => r.sat.pct >= 100).length;
    const idle = rows.filter((r) => r.sat.pct < 60).length;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.sat.pct, 0) / rows.length) : 0;
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", `${rows.length} \u4EBA \xB7 \u5E73\u5747 ${avg}% \xB7 ${over} \u4EBA\u8D85\u8F7D \xB7 ${idle} \u4EBA\u504F\u95F2`));
    head.appendChild(el("span", "tlt-src", this.store.settings.teamFolder));
    head.appendChild(el("span", "tlt-spacer"));
    const add = el("button", "tlt-btn", t("\uFF0B \u6DFB\u52A0\u6210\u5458"));
    add.dataset.addstaff = "1";
    head.appendChild(add);
    p.appendChild(head);
    p.appendChild(el("div", "tlt-hint", "\u6863\u6848\u6765\u81EA team/<\u59D3\u540D>.md \u7684 frontmatter\u2014\u2014\u5C97\u4F4D\u3001\u4EA7\u80FD\u3001\u5728\u5C97\u5929\u6570\u90FD\u5728\u6587\u4EF6\u91CC\u6539\uFF1BTLT \u53EA\u8BFB\uFF0C\u4EFB\u52A1\u4FA7\u53EA\u8D1F\u8D23\u5206\u914D\u4E0E\u7EDF\u8BA1\u3002"));
    const grid = el("div", "tlt-staffgrid");
    rows.forEach(({ s, sat }) => {
      const card = el("div", "tlt-scard" + (sat.pct >= 100 ? " hot" : ""));
      card.dataset.staff = s.name;
      const h = el("div", "tlt-sh");
      const av = el("span", "tlt-av", s.name.slice(-2));
      av.style.background = s.color;
      const who = el("div", "tlt-who");
      who.append(el("div", "tlt-sname", s.name), el("div", "tlt-srole", `${s.role || "\u2014"}${s.days < 5 ? ` \xB7 \u6BCF\u5468 ${s.days} \u5929` : ""}`));
      const pct = el("span", "tlt-spct", String(sat.pct) + "%");
      h.append(av, who, pct);
      card.appendChild(h);
      const bar = el("div", "tlt-sbar");
      const fill = el("i");
      fill.style.width = `${Math.min(100, sat.pct)}%`;
      if (sat.pct >= 100) fill.addClass("hot");
      else if (sat.pct < 60) fill.addClass("idle");
      bar.appendChild(fill);
      card.appendChild(bar);
      const list = this.store.tasks.filter((t2) => !t2.done && t2.owners.includes(s.name) && (t2.pw || "m") === this.period);
      const meta = el("div", "tlt-smeta");
      meta.append(
        el("span", "", `${list.length} \u9879\u4EFB\u52A1`),
        el("span", "", `${sat.sum} / ${sat.avail} \u4EBA\u5929`)
      );
      card.appendChild(meta);
      grid.appendChild(card);
    });
    p.appendChild(grid);
    if (!rows.length) p.appendChild(el("div", "tlt-empty", t("TLT/team \u91CC\u8FD8\u6CA1\u6709\u4EBA\u5458\u6863\u6848")));
    return p;
  }
  /* ---------- 想法 ---------- */
  paneIdeas() {
    const p = el("div", "tlt-pane");
    const cap = el("div", "tlt-cap");
    const i = el("input");
    i.placeholder = "\u968F\u624B\u8BB0\u4E00\u53E5\uFF0C\u524D\u9762\u53EF\u4EE5\u52A0 #\u6807\u7B7E\uFF0C\u4F8B\uFF1A#\u8BBA\u6587 #\u7075\u611F \u628A\u5E38\u7528\u811A\u672C\u6574\u7406\u6210\u5DE5\u5177";
    i.dataset.ideanew = "1";
    const plus = el("button", "tlt-btn lg", t("\uFF0B \u968F\u624B\u8BB0"));
    plus.dataset.ideanewmodal = "1";
    cap.append(el("span", "tlt-plus", "\u2726"), i, plus);
    p.appendChild(cap);
    p.appendChild(el("div", "tlt-hint", "\u7528 # \u6253\u6807\u7B7E\uFF0C\u60F3\u6253\u51E0\u4E2A\u6253\u51E0\u4E2A\u3002\u56DE\u8F66\u6536\u5F55\uFF1B\u4E5F\u53EF\u4EE5\u70B9\u300C\uFF0B \u968F\u624B\u8BB0\u300D\u7528\u8868\u5355\u3002"));
    const prev = el("div", "tlt-idea-prev");
    prev.dataset.ideaprev = "1";
    p.appendChild(prev);
    const allTags = Array.from(/* @__PURE__ */ new Set([...this.store.tags, ...this.store.ideas.flatMap((i2) => ideaFilterTags(i2))]));
    const shown = this.store.ideas.filter((i2) => !this.q || i2.title.includes(this.q) || (i2.body || "").includes(this.q)).filter((i2) => !this.ideaTags.size || ideaFilterTags(i2).some((t2) => this.ideaTags.has(t2)));
    const stale = this.store.ideas.filter((x) => (Date.now() - D(x.at).getTime()) / 864e5 > 14).length;
    const meta = el("div", "tlt-ideas-meta");
    meta.append(
      el("span", "", `${shown.length} \u6761\u968F\u624B\u8BB0`),
      el("span", "tlt-sep-dot", "\xB7"),
      el("span", "", stale ? `${stale} \u6761\u8D85\u8FC7\u4E24\u5468\u6CA1\u52A8` : "\u6CA1\u6709\u6401\u592A\u4E45\u7684")
    );
    p.appendChild(meta);
    if (allTags.length) {
      const tf = el("div", "tlt-tagpick");
      const all = el("button", "tlt-tagp" + (this.ideaTags.size ? "" : " on"), "\u5168\u90E8");
      all.dataset.itag = "";
      tf.appendChild(all);
      allTags.forEach((t2) => {
        const b = el("button", "tlt-tagp" + (this.ideaTags.has(t2) ? " on" : ""), t2);
        b.dataset.itag = t2;
        tf.appendChild(b);
      });
      p.appendChild(tf);
    }
    const grid = el("div", "tlt-ideagrid");
    shown.forEach((it) => {
      const c = el("div", "tlt-icard");
      c.dataset.idea = it.id;
      const h = el("div", "tlt-ih");
      ideaTags(it).forEach((tg) => h.append(el("span", "tlt-chip-s", tg)));
      if (!ideaTags(it).length) h.append(el("span", "tlt-itype", "\u672A\u6253\u6807\u7B7E"));
      c.append(h, el("div", "tlt-it", it.title));
      if (it.body) c.appendChild(el("div", "tlt-ib", it.body));
      const meta2 = el("div", "tlt-im");
      meta2.append(el("span", "", it.at));
      c.appendChild(meta2);
      grid.appendChild(c);
    });
    p.appendChild(grid);
    if (!this.store.ideas.length) p.appendChild(el("div", "tlt-empty", "\u8FD8\u6CA1\u6709\u968F\u624B\u8BB0\u3002\u4E00\u884C\u5C31\u80FD\u8BB0\uFF0C\u6B63\u6587\u53EF\u4EE5\u6C38\u8FDC\u4E0D\u5199\u3002"));
    return p;
  }
  /* ---------- 里程碑 ---------- */
  /** 随手画：功能预留 */
  paneDraw() {
    const p = el("div", "tlt-pane");
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", "\u968F\u624B\u753B \xB7 \u529F\u80FD\u9884\u7559"));
    p.appendChild(head);
    const box = el("div", "tlt-emptybox");
    box.append(
      el("div", "tlt-empty-k", "\u968F\u624B\u753B"),
      el("div", "tlt-empty-d", "\u5148\u5360\u4E2A\u4F4D\u7F6E\uFF1A\u968F\u624B\u8BB0\u91CC\u7684\u8349\u56FE\u3001\u767D\u677F\u3001\u622A\u56FE\u6279\u6CE8\u4F1A\u5728\u8FD9\u91CC\u3002\u8FD8\u6CA1\u6709\u5B9E\u73B0\uFF0C\u6807\u8BB0\u4E3A\u9884\u7559\u3002")
    );
    const chips = el("div", "tlt-quick");
    ["\u624B\u7ED8\u8349\u56FE", "\u601D\u7EF4\u5BFC\u56FE", "\u622A\u56FE\u6279\u6CE8", "\u4E0E\u968F\u624B\u8BB0\u4E92\u8F6C"].forEach((t2) => chips.appendChild(el("span", "tlt-chip off", t2)));
    box.appendChild(chips);
    p.appendChild(box);
    return p;
  }
  paneMilestones() {
    const p = el("div", "tlt-pane");
    const ms = this.store.milestones(this.proj || void 0).filter((m) => !this.q || m.name.includes(this.q) || (m.project || "").includes(this.q) || m.tasks.some((t2) => t2.title.includes(this.q)));
    const head = el("div", "tlt-pane-h");
    head.append(el("span", "", `${ms.length} \u4E2A\u91CC\u7A0B\u7891 \xB7 ${ms.filter((m) => m.tasks.every((t2) => t2.done)).length} \u5DF2\u5B8C\u6210`));
    p.appendChild(head);
    if (!ms.length) p.appendChild(el("div", "tlt-empty", "\u4EFB\u52A1\u6587\u4EF6\u91CC\u7528\u300C## \u91CC\u7A0B\u7891\u540D\u300D\u5206\u8282\uFF0C\u8FD9\u91CC\u5C31\u4F1A\u51FA\u73B0\u91CC\u7A0B\u7891\u3002"));
    ms.forEach((m) => {
      const done = m.tasks.filter((t2) => t2.done).length;
      const pct = Math.round(done / m.tasks.length * 100);
      const card = el("div", "tlt-ms" + (this.expanded.has(m.name) ? " open" : ""));
      card.dataset.ms = m.name;
      const h = el("div", "tlt-ms-h");
      const dot = el("span", "tlt-dot");
      dot.addClass("k-ms");
      h.append(dot, el("span", "tlt-ms-n", m.name), el("span", "tlt-ms-p", m.project));
      const bar = el("span", "tlt-pbar small");
      const fill = el("i");
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      h.append(el("span", "tlt-spacer"), bar, el("span", "tlt-ms-c", `${done}/${m.tasks.length}`));
      card.appendChild(h);
      if (this.expanded.has(m.name)) {
        const body = el("div", "tlt-ms-b");
        m.tasks.forEach((t2) => body.appendChild(this.taskRow(t2)));
        card.appendChild(body);
      }
      p.appendChild(card);
    });
    return p;
  }
  /* ---------- 右栏：消息 ---------- */
  rail() {
    const r = el("aside", "tlt-msgs");
    const head = el("div", "tlt-msgs-h");
    const unread = this.allMsgs().filter((m) => !m.read_ && m.state !== "ended").length;
    head.append(el("b", "", "\u6D88\u606F"));
    const badge = el("span", "tlt-badge", String(unread));
    head.appendChild(badge);
    const expand = el("button", "tlt-expand-btn");
    expand.dataset.expand = "1";
    expand.title = "\u5728\u72EC\u7ACB\u9875\u6253\u5F00\u6D88\u606F\u4E2D\u5FC3";
    expand.append(el("span", "tlt-expand-i", "\u2922"), el("span", "", "\u6D88\u606F\u4E2D\u5FC3"));
    head.appendChild(expand);
    r.appendChild(head);
    const list = el("div", "tlt-mtl");
    const items = this.allMsgs().sort((a, b) => a.date.localeCompare(b.date));
    let last = "";
    items.forEach((m) => {
      if (m.date !== last) {
        const d = D(m.date);
        list.appendChild(el("div", "tlt-mday" + (m.date === todayISO() ? " today" : ""), `${d.getMonth() + 1}/${d.getDate()} \xB7 \u5468${WEEK[d.getDay()]}`));
        last = m.date;
      }
      const n = el("div", "tlt-mnode" + (m.star ? " star" : "") + (m.read_ ? " read" : "") + (m.state === "ended" ? " ended" : ""));
      n.dataset.msg = m.id;
      const dot = el("span", "tlt-nd");
      dot.style.background = KIND_COLOR[m.kind];
      n.appendChild(dot);
      const nh = el("div", "tlt-nh");
      nh.append(el("span", "tlt-nm", m.title));
      if (m.star) nh.appendChild(el("span", "tlt-sk", "\u2605"));
      n.appendChild(nh);
      n.appendChild(el(
        "div",
        "tlt-nm2",
        `${KIND_LABEL[m.kind]}${m.place ? " \xB7 " + m.place : ""}${m.state === "ended" ? " \xB7 \u5DF2\u7ED3\u675F" : ""}`
      ));
      list.appendChild(n);
    });
    if (!items.length) list.appendChild(el("div", "tlt-empty", "\u8FD8\u6CA1\u6709\u6D88\u606F\u3002\u5728 feeds/ \u91CC\u5EFA\u4E00\u4E2A\u6E90\uFF0C\u6216\u70B9 \uFF0B \u53D1\u5E03\u4E00\u6761\u3002"));
    r.appendChild(list);
    const foot = el("div", "tlt-mfoot", `\u6E90 ${this.store.feeds.length} \xB7 \u6D88\u606F ${items.length}`);
    r.appendChild(foot);
    return r;
  }
  allMsgs() {
    return this.store.feeds.flatMap((f) => f.items);
  }
  /* ---------- 交互 ---------- */
  bindInputs(root) {
    const search = root.querySelector("[data-search]");
    if (search) {
      let composing = false;
      search.addEventListener("compositionstart", () => {
        composing = true;
      });
      search.addEventListener("compositionend", () => {
        composing = false;
        this.q = search.value.trim();
        void this.render();
      });
      search.addEventListener("input", () => {
        if (composing) return;
        this.q = search.value.trim();
        void this.render();
      });
    }
    const ideaNew = root.querySelector("[data-ideanew]");
    const ideaPrev = root.querySelector("[data-ideaprev]");
    if (ideaNew && ideaPrev) {
      const paint = () => {
        const c = parseIdeaText(ideaNew.value.trim());
        if (!c.tags.length) {
          ideaPrev.empty();
          ideaPrev.addClass("hide");
          return;
        }
        ideaPrev.removeClass("hide");
        ideaPrev.empty();
        ideaPrev.createSpan({ cls: "tlt-pv-l", text: "\u8BC6\u522B\u5230" });
        c.tags.forEach((tg) => {
          ideaPrev.createSpan({ cls: "tlt-pv on", text: `#${tg}` });
        });
      };
      ideaNew.addEventListener("input", paint);
      paint();
    }
    if (ideaNew) {
      ideaNew.addEventListener("keydown", (e) => {
        void (async () => {
          if (e.key !== "Enter") return;
          const v = e.target.value.trim();
          if (!v) return;
          const parsed = parseIdeaText(v);
          await this.store.addIdea({ title: parsed.title, tags: parsed.tags });
          await this.refresh();
          new Notice("\u5DF2\u6536\u8FDB\u60F3\u6CD5\u6C60");
        })();
      });
    }
  }
  /** 空白处点击 → 按坐标算时间 */
  async onClick(ev) {
    const t2 = ev.target;
    const pick = (sel) => t2.closest(sel);
    const tab = pick("[data-tab]");
    if (tab) {
      this.tab = tab.dataset.tab;
      await this.render();
      return;
    }
    const day = pick("[data-day]");
    if (day && !pick("[data-slotgrid]")) {
      this.viewDate = day.dataset.day;
      await this.render();
      return;
    }
    const dnav = pick("[data-dnav]");
    if (dnav) {
      this.viewDate = addDays(this.viewDate, Number(dnav.dataset.dnav));
      await this.render();
      return;
    }
    if (pick("[data-today]")) {
      this.viewDate = todayISO();
      await this.render();
      return;
    }
    const msCard = pick("[data-ms]");
    if (msCard && !ev.target.closest("[data-task],[data-ck]")) {
      const key = msCard.dataset.ms ?? "";
      if (this.expanded.has(key)) this.expanded.delete(key);
      else this.expanded.add(key);
      await this.render();
      return;
    }
    const itag = pick("[data-itag]");
    if (itag) {
      const v = itag.dataset.itag || "";
      if (!v) this.ideaTags.clear();
      else if (this.ideaTags.has(v)) this.ideaTags.delete(v);
      else this.ideaTags.add(v);
      await this.render();
      return;
    }
    const tagBtn = pick("[data-tag]");
    if (tagBtn) {
      this.taskTag = tagBtn.dataset.tag || null;
      await this.render();
      return;
    }
    const dim = pick("[data-dim]");
    if (dim) {
      this.taskDim = dim.dataset.dim;
      await this.render();
      return;
    }
    const rv = pick("[data-rhythm]");
    if (rv) {
      this.rhythmView = rv.dataset.rhythm;
      await this.render();
      return;
    }
    const period = pick("[data-period]");
    if (period) {
      this.period = period.dataset.period;
      await this.render();
      return;
    }
    const proj = pick("[data-proj]");
    if (proj) {
      const name = proj.dataset.proj ?? "";
      this.proj = this.proj === name ? null : name;
      await this.render();
      return;
    }
    if (pick("[data-theme]")) {
      this.plugin.toggleTheme();
      return;
    }
    if (pick("[data-newtask]")) {
      new QuickTaskModal(this.app, this.store, () => this.refresh()).open();
      return;
    }
    if (pick("[data-ideanewmodal]")) {
      new IdeaModal(this.app, this.store, void 0, () => this.refresh()).open();
      return;
    }
    if (pick("[data-expand]")) {
      await this.plugin.activateMessages();
      return;
    }
    const ck = pick("[data-ck]");
    if (ck) {
      ev.stopPropagation();
      const task2 = this.findTask(ck.dataset.ck ?? "");
      if (task2) {
        await this.store.toggleTask(task2);
        await this.refresh();
      }
      return;
    }
    const log = pick("[data-log]");
    if (log) {
      const l = this.store.logs.find((x) => x.id === log.dataset.log);
      if (l) new LogModal(this.app, this.store, l, () => this.refresh()).open();
      return;
    }
    const idea = pick("[data-idea]");
    if (idea) {
      const it = this.store.ideas.find((x) => x.id === idea.dataset.idea);
      new IdeaModal(this.app, this.store, it, () => this.refresh()).open();
      return;
    }
    if (pick("[data-addstaff]")) {
      new AddStaffModal(this.app, this.store, () => this.refresh()).open();
      return;
    }
    const staff = pick("[data-staff]");
    if (staff) {
      const s = this.store.staff.find((x) => x.name === staff.dataset.staff);
      if (s) new StaffModal(this.app, this.store, s, () => this.refresh()).open();
      return;
    }
    const msg = pick("[data-msg]");
    if (msg) {
      const m = this.allMsgs().find((x) => x.id === msg.dataset.msg);
      if (m) new MsgModal(this.app, this.store, m, () => this.refresh()).open();
      return;
    }
    const sched = pick("[data-sched]");
    if (sched) {
      const t3 = this.findTask(sched.dataset.sched ?? "");
      if (t3) await this.scheduleTask(t3);
      return;
    }
    const msPeek = pick("[data-mspeek]");
    if (msPeek) {
      const [proj2, name] = (msPeek.dataset.mspeek ?? "").split("::");
      const ms = this.store.milestones(proj2).find((m) => m.name === name);
      if (ms) {
        new MilestonePeekModal(this.app, this.store, ms, () => {
          this.tab = "ms";
          this.proj = proj2 || null;
          this.expanded.add(name);
          void this.render();
        }).open();
      }
      return;
    }
    const peek = pick("[data-peek]");
    if (peek) {
      const t3 = this.findTask(peek.dataset.peek ?? "");
      if (t3) new TaskPeekModal(this.app, this.store, t3, () => {
        new TaskModal(this.app, this.store, t3, () => this.refresh()).open();
      }).open();
      return;
    }
    const task = pick("[data-task]");
    if (task) {
      const tk = this.findTask(task.dataset.task ?? "");
      if (tk) new TaskModal(this.app, this.store, tk, () => this.refresh()).open();
      return;
    }
    const grid = pick("[data-slotgrid]");
    if (grid && !pick(".tlt-blk")) {
      const rect = grid.getBoundingClientRect();
      const y = ev.clientY - rect.top + grid.scrollTop;
      const mins = Math.max(DAY_FROM, Math.min(DAY_TO - 30, Math.round((DAY_FROM + y / HOUR_PX * 60) / 15) * 15));
      new QuickLogModal(this.app, this.store, this.viewDate, () => this.refresh(), minToHHMM(mins)).open();
    }
  }
  /** 把一条任务排进当前日期的第一个空档（排完写回 [st::] [en::]） */
  async scheduleTask(t2) {
    const day = this.viewDate;
    const busy = [
      ...this.store.logs.filter((l) => l.due === day),
      ...this.store.tasks.filter((x) => x.due === day && x.st && !x.done)
    ];
    let start = 9 * 60;
    if (busy.length) {
      start = Math.max(...busy.map((b) => hhmmToMin(b.en) || (hhmmToMin(b.st) || 540) + 30));
    }
    if (start >= 22 * 60) {
      new Notice("\u8FD9\u5929\u6392\u6EE1\u4E86\uFF0C\u6362\u4E00\u5929\u8BD5\u8BD5");
      return;
    }
    const end = Math.min(23 * 60, start + 60);
    if (t2.due !== day) await this.store.setDue(t2, day);
    await this.store.setField(t2, "st", minToHHMM(start));
    await this.store.setField(t2, "en", minToHHMM(end));
    this.scrollToMin = start;
    await this.refresh();
    new Notice(`\u5DF2\u6392\u5165 ${minToHHMM(start)}\u2013${minToHHMM(end)}`);
  }
  findTask(id) {
    return [...this.store.tasks, ...this.store.logs].find((t2) => t2.id === id);
  }
};

// src/views/messages.ts
var VIEW_TYPE_MESSAGES = "tlt-messages";
var KIND_COLOR2 = { ask: "#8B7CF6", event: "#4FB59A", risk: "#D98B5F", note: "#7C8BA1" };
var WEEK2 = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
var escapeXml2 = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
var MessagesView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    /** 左栏多选：选中哪些源（空 = 全部源） */
    this.selected = /* @__PURE__ */ new Set();
    this.zoom = "w";
    this.filter = "all";
    this.range = "all";
    this.mode = "card";
    /** 横轴时间线：窗口跨度（天）与中心（相对今天的偏移） */
    this.tlSpan = 33;
    this.tlCenter = 13.5;
    this.heatMonth = todayISO().slice(0, 7);
    this.heatDay = "";
    this.q = "";
    this.plugin = plugin;
  }
  get store() {
    return this.plugin.store;
  }
  getViewType() {
    return VIEW_TYPE_MESSAGES;
  }
  getDisplayText() {
    return "\u6D88\u606F\u4E2D\u5FC3";
  }
  getIcon() {
    return "rss";
  }
  async onOpen() {
    await this.store.ensureLoaded();
    await this.render();
  }
  async refresh() {
    await this.store.load();
    await this.render();
  }
  msgs() {
    return this.store.feeds.flatMap((f) => f.items);
  }
  async render() {
    const alive = new Set(this.store.feeds.map((f) => f.id));
    [...this.selected].forEach((id) => {
      if (!alive.has(id)) this.selected.delete(id);
    });
    const root = this.contentEl;
    const ae = document.activeElement;
    const keep = ae?.instanceOf(HTMLInputElement) && ae.dataset.focuskey ? { key: ae.dataset.focuskey, start: ae.selectionStart ?? 0, end: ae.selectionEnd ?? 0 } : null;
    root.empty();
    root.addClass("tlt-root");
    const outer = el("div", "tlt-fm");
    const head = el("div", "tlt-fm-h");
    head.append(el("b", "", "\u6D88\u606F\u4E2D\u5FC3"), el("span", "tlt-fm-hint", "\u4E2A\u4EBA \xB7 \u53D1\u5E03 \xB7 \u8BA2\u9605"));
    head.appendChild(el("span", "tlt-spacer"));
    const th = el("button", "tlt-btn", this.plugin.isLight() ? "\u263E" : "\u2600");
    th.onclick = () => this.plugin.toggleTheme();
    head.appendChild(th);
    outer.appendChild(head);
    const body = el("div", "tlt-fm-body");
    body.append(this.rail(), this.center(), this.side());
    outer.appendChild(body);
    root.appendChild(outer);
    if (keep) {
      const again = root.querySelector(`[data-focuskey="${keep.key}"]`);
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(keep.start, keep.end);
        } catch {
        }
      }
    }
  }
  /* ---------------- 左栏：多选筛选 ---------------- */
  railRow(f) {
    const on = this.selected.has(f.id);
    const row2 = el("div", "tlt-fr" + (on ? " on" : "") + (f.mine ? " mine" : "") + (f.personal ? " personal" : ""));
    row2.append(
      el("span", "tlt-ck" + (on ? " on" : "")),
      el("span", "tlt-fr-n", f.name),
      el("span", "tlt-fr-c", String(f.items.length))
    );
    row2.onclick = (ev) => {
      if (ev.metaKey || ev.ctrlKey) {
        if (this.selected.has(f.id)) this.selected.delete(f.id);
        else this.selected.add(f.id);
      } else if (this.selected.size === 1 && this.selected.has(f.id)) {
        this.selected.clear();
      } else {
        this.selected.clear();
        this.selected.add(f.id);
      }
      void this.render();
    };
    return row2;
  }
  rail() {
    const r = el("aside", "tlt-fm-rail");
    const personal = this.store.feeds.filter((f) => f.personal);
    const mine = this.store.feeds.filter((f) => f.mine && !f.personal);
    const subs = this.store.feeds.filter((f) => !f.mine && !f.personal);
    r.appendChild(el("div", "tlt-fgrp", "\u4E2A\u4EBA"));
    personal.forEach((f) => r.appendChild(this.railRow(f)));
    r.appendChild(el("div", "tlt-fgrp", "\u6211\u53D1\u5E03\u7684"));
    mine.forEach((f) => r.appendChild(this.railRow(f)));
    r.appendChild(el("div", "tlt-fgrp", "\u6211\u8BA2\u9605\u7684"));
    subs.forEach((f) => r.appendChild(this.railRow(f)));
    if (!personal.length && !mine.length && !subs.length) r.appendChild(el("div", "tlt-empty", t("feeds/ \u91CC\u8FD8\u6CA1\u6709\u6E90")));
    const all = el("div", "tlt-fr add");
    all.append(el("span", "tlt-fr-n", this.selected.size ? `\u5DF2\u9009 ${this.selected.size} \u4E2A \xB7 \u6E05\u9664` : "\u2318 \u70B9\u53EF\u591A\u9009 \xB7 \u5168\u90E8\u6E90"));
    all.onclick = () => {
      this.selected.clear();
      void this.render();
    };
    r.appendChild(all);
    return r;
  }
  /* ---------------- 中栏：新建 + 筛选 + 时间线 ---------------- */
  center() {
    const m = el("main", "tlt-fm-main");
    const items = this.visible();
    const bar = el("div", "tlt-fm-bar");
    const sb = el("div", "tlt-fm-search");
    const si = el("input");
    si.placeholder = "\u641C\u7D22\u6D88\u606F";
    si.value = this.q;
    si.dataset.focuskey = "msgsearch";
    let composing = false;
    si.addEventListener("compositionstart", () => {
      composing = true;
    });
    si.addEventListener("compositionend", () => {
      composing = false;
      this.q = si.value.trim();
      void this.render();
    });
    si.addEventListener("input", () => {
      if (composing) return;
      this.q = si.value.trim();
      void this.render();
    });
    sb.appendChild(si);
    bar.appendChild(sb);
    const add = el("button", "tlt-btn pri lg", "\uFF0B \u65B0\u5EFA");
    add.onclick = () => new ComposeModal(this.app, this.store, () => this.refresh()).open();
    bar.appendChild(add);
    m.appendChild(bar);
    const t1 = el("div", "tlt-fm-tools");
    const dg = el("div", "tlt-tgrp");
    dg.appendChild(el("span", "tlt-tgrp-l", "\u65F6\u95F4"));
    const range = el("div", "tlt-seg");
    [["all", "\u5168\u90E8"], ["today", "\u4ECA\u5929"], ["7", "\u8FD1 7 \u5929"], ["30", "\u8FD1 30 \u5929"]].forEach(([v, t3]) => {
      const b = el("button", "tlt-seg-b" + (this.range === v ? " on" : ""), t3);
      b.onclick = () => {
        this.range = v;
        void this.render();
      };
      range.appendChild(b);
    });
    dg.appendChild(range);
    t1.appendChild(dg);
    t1.appendChild(el("span", "tlt-spacer"));
    const today = el("button", "tlt-tlink", t("\u56DE\u5230\u4ECA\u5929"));
    today.onclick = () => this.jumpToday();
    t1.appendChild(today);
    m.appendChild(t1);
    const t2 = el("div", "tlt-fm-tools sub");
    t2.appendChild(el("span", "tlt-count", `${items.length} \u6761`));
    t2.appendChild(el("span", "tlt-spacer"));
    const MODES = [
      ["card", "\u5361\u7247"],
      ["spine", "\u6CB3\u6D41"],
      ["compact", "\u7D27\u51D1"],
      ["bands", "\u6309\u6E90\u5206\u5E26"],
      ["axis", "\u53EF\u7F29\u653E\u65F6\u95F4\u8F74"],
      ["heat", "\u6708\u5EA6\u70ED\u529B"],
      ["net", "\u4EBA\u7269\u8109\u7EDC"]
    ];
    const cur = MODES.find(([v]) => v === this.mode) ?? MODES[0];
    const viewBtn = el("button", "tlt-btn tlt-viewbtn");
    viewBtn.append(el("span", "tlt-viewbtn-i", "\u25A4"), el("span", "", t(cur[1])), el("span", "tlt-viewbtn-c", "\u2304"));
    viewBtn.onclick = () => {
      popMenu(viewBtn, MODES.map(([v, label]) => ({
        label: (v === this.mode ? "\u2713 " : "   ") + t(label),
        onClick: () => {
          this.mode = v;
          void this.render();
        }
      })), "right");
    };
    t2.appendChild(viewBtn);
    m.appendChild(t2);
    if (this.mode === "heat") m.appendChild(this.heat());
    else if (this.mode === "axis") m.appendChild(this.axis(items));
    else if (this.mode === "bands") m.appendChild(this.bands(items));
    else if (this.mode === "net") m.appendChild(this.net(items));
    else m.appendChild(this.timeline(items));
    return m;
  }
  /** 时间线（卡片 / 河流 / 紧凑共用） */
  timeline(items) {
    const list = el("div", "tlt-mtl wide mode-" + this.mode);
    if (!items.length) list.appendChild(el("div", "tlt-empty", t("\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6D88\u606F")));
    let last = "";
    items.forEach((x) => {
      const key = this.zoom === "m" ? x.date.slice(0, 7) : x.date;
      if (key !== last) {
        const d = D(x.date);
        const isToday = x.date === todayISO();
        const mk = el("div", "tlt-mday" + (isToday ? " today" : ""));
        mk.dataset.day = isToday ? "today" : x.date;
        mk.append(el(
          "span",
          "tlt-mday-n",
          this.zoom === "m" ? `${d.getFullYear()} \u5E74 ${d.getMonth() + 1} \u6708` : `${d.getDate()}`
        ));
        if (this.zoom !== "m") mk.append(el("span", "tlt-mday-u", `${d.getMonth() + 1} \u6708`));
        if (this.zoom !== "m") mk.append(el("span", "tlt-mday-w", `\u5468${WEEK2[d.getDay()]}`));
        if (isToday) mk.append(el("span", "tlt-mday-t", "\u4ECA\u5929"));
        list.appendChild(mk);
        last = key;
      }
      list.appendChild(this.item(x));
    });
    return list;
  }
  /** 可缩放时间轴：横轴是日期，滚轮缩放、拖动平移、双击复位 */
  axis(items) {
    const box = el("div", "tlt-axis");
    const svg = createSvg("svg");
    svg.setAttribute("class", "tlt-axis-svg");
    svg.setAttribute("viewBox", "0 0 760 260");
    const W = 760;
    const label = el("div", "tlt-axis-hint", "");
    const redraw = () => {
      const lanes = this.axisLanes(items);
      const H = Math.max(120, 54 + lanes.length * 30);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      setSvgMarkup(svg, this.axisBody(W, H, items));
      label.textContent = `\u7A97\u53E3 ${Math.round(this.tlSpan)} \u5929 \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u62D6\u52A8\u5E73\u79FB \xB7 \u53CC\u51FB\u56DE\u5230\u9ED8\u8BA4\uFF08\u524D 3 \u5929\u540E 30 \u5929\uFF09`;
    };
    redraw();
    box.appendChild(svg);
    box.appendChild(label);
    const dayOf = (clientX) => {
      const r = svg.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      const to = this.tlCenter + this.tlSpan / 2;
      const from = to - this.tlSpan;
      return from + frac * this.tlSpan;
    };
    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const at = dayOf(e.clientX);
      const next = Math.max(2, Math.min(400, this.tlSpan * (e.deltaY < 0 ? 0.86 : 1.16)));
      const r = svg.getBoundingClientRect();
      const frac = (e.clientX - r.left) / r.width;
      this.tlCenter = at - frac * next + next / 2;
      this.tlSpan = next;
      redraw();
    }, { passive: false });
    let drag = false, sx = 0, c0 = 0;
    svg.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-msg]")) return;
      drag = true;
      sx = e.clientX;
      c0 = this.tlCenter;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("grabbing");
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      this.tlCenter = c0 - (e.clientX - sx) / r.width * this.tlSpan;
      redraw();
    });
    const stop = () => {
      drag = false;
      svg.classList.remove("grabbing");
    };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("dblclick", () => {
      this.tlSpan = 33;
      this.tlCenter = 13.5;
      redraw();
    });
    svg.addEventListener("click", (e) => {
      const target = e.target;
      const g = target instanceof Element ? target.closest("[data-msg]") : null;
      if (!g) return;
      const m = items.find((x) => x.id === g.getAttribute("data-msg"));
      if (m) this.openMsg(m);
    });
    return box;
  }
  axisLanes(items) {
    return this.store.feeds.map((f) => ({ feed: f, items: items.filter((x) => x.feed === f.id) })).filter((l) => l.items.length);
  }
  /** 横轴时间线的 SVG：日期刻度 + 每个源一条泳道 + 今天竖线 */
  axisBody(W, H, items) {
    const left = 92, right = W - 18;
    const plotW = right - left;
    const to = this.tlCenter + this.tlSpan / 2;
    const from = to - this.tlSpan;
    const baseDay = Math.floor(+D(todayISO()) / 864e5);
    const x = (off) => left + (off - from) / this.tlSpan * plotW;
    const offsetOf = (iso2) => Math.floor(+D(iso2) / 864e5) - baseDay;
    const steps = [1, 2, 3, 7, 14, 30, 90];
    const step = steps.find((s) => this.tlSpan / s <= 12) || 90;
    let g = "";
    for (let d = Math.ceil(from / step) * step; d <= to; d += step) {
      const px = x(d);
      if (px < left - 1 || px > right + 1) continue;
      g += `<line class="tlt-axis-grid" x1="${px.toFixed(1)}" y1="34" x2="${px.toFixed(1)}" y2="${H - 10}"/>`;
      const dt = new Date((baseDay + d) * 864e5);
      const label = step >= 30 ? `${dt.getMonth() + 1}\u6708` : `${dt.getMonth() + 1}/${dt.getDate()}`;
      g += `<text class="tlt-axis-tick" x="${px.toFixed(1)}" y="24" text-anchor="middle">${label}</text>`;
    }
    const tx = x(0);
    if (tx >= left && tx <= right) {
      g += `<line class="tlt-axis-today" x1="${tx.toFixed(1)}" y1="30" x2="${tx.toFixed(1)}" y2="${H - 8}"/>`;
      g += `<text class="tlt-axis-today-l" x="${(tx + 3).toFixed(1)}" y="40">\u4ECA\u5929</text>`;
    }
    const lanes = this.axisLanes(items);
    lanes.forEach((lane, i) => {
      const y = 52 + i * 30;
      g += `<text class="tlt-axis-lane" x="${left - 10}" y="${y + 4}" text-anchor="end">${escapeXml2(lane.feed.name.slice(0, 8))}</text>`;
      g += `<line class="tlt-axis-lane-l" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`;
      lane.items.forEach((m) => {
        const px = x(offsetOf(m.date));
        if (px < left - 6 || px > right + 6) return;
        const r = 3.2;
        g += `<g class="tlt-axis-g" data-msg="${escapeXml2(m.id)}">
          <circle class="tlt-axis-hit" cx="${px.toFixed(1)}" cy="${y}" r="9"/>
          <circle class="tlt-axis-d" cx="${px.toFixed(1)}" cy="${y}" r="${r}" fill="${m.star ? "var(--tlt-acc)" : "var(--tlt-ink3)"}"/>
          <title>${escapeXml2(`${m.date} ${m.title}`)}</title></g>`;
      });
    });
    if (!lanes.length) g += `<text class="tlt-axis-empty" x="${left}" y="70">\u8FD9\u4E2A\u7A97\u53E3\u91CC\u6CA1\u6709\u6D88\u606F</text>`;
    return g;
  }
  /** 按源分带：每个消息源一条泳道，横轴＝时间 */
  bands(items) {
    const { from, to } = this.bounds();
    const a = +D(from), b = +D(to);
    const span = Math.max(864e5, b - a);
    const box = el("div", "tlt-bands");
    const axis = el("div", "tlt-band-axis");
    axis.append(el("span", "", from.slice(5)), el("span", "tlt-spacer"), el("span", "", to.slice(5)));
    box.appendChild(axis);
    const feeds = this.store.feeds.filter((f) => items.some((x) => x.feed === f.id));
    feeds.forEach((f) => {
      const row2 = el("div", "tlt-band");
      const name = el("div", "tlt-band-n");
      name.append(el("span", "tlt-band-dot"), el("span", "", f.name));
      const lane = el("div", "tlt-band-lane");
      items.filter((x) => x.feed === f.id).forEach((x) => {
        const p = el("i", "tlt-band-i");
        p.style.left = `${Math.max(0, Math.min(100, (+D(x.date) - a) / span * 100)).toFixed(2)}%`;
        p.style.background = KIND_COLOR2[x.kind];
        p.title = `${x.date} \xB7 ${x.title}`;
        p.onclick = () => this.openMsg(x);
        lane.appendChild(p);
      });
      row2.append(name, lane);
      box.appendChild(row2);
    });
    if (!feeds.length) box.appendChild(el("div", "tlt-empty", t("\u8FD9\u4E2A\u8303\u56F4\u91CC\u6CA1\u6709\u6D88\u606F")));
    return box;
  }
  /** 月度热力：一个月一张格子，颜色深浅＝当天消息数 */
  heat() {
    const box = el("div", "tlt-heat");
    const all = this.msgs().filter((x) => !this.selected.size || this.selected.has(x.feed));
    const [y, mo] = this.heatMonth.split("-").map(Number);
    const head = el("div", "tlt-heat-h");
    const prev = el("button", "tlt-tlink", "\u2039");
    prev.onclick = () => {
      this.heatMonth = this.shiftMonth(-1);
      void this.render();
    };
    const next = el("button", "tlt-tlink", "\u203A");
    next.onclick = () => {
      this.heatMonth = this.shiftMonth(1);
      void this.render();
    };
    head.append(
      prev,
      el("b", "", `${y} \u5E74 ${mo} \u6708`),
      next,
      el("span", "tlt-spacer"),
      el("span", "tlt-heat-l", "\u5C11"),
      el("span", "tlt-heat-i lv1"),
      el("span", "tlt-heat-i lv2"),
      el("span", "tlt-heat-i lv3"),
      el("span", "tlt-heat-i lv4"),
      el("span", "tlt-heat-l", "\u591A")
    );
    box.appendChild(head);
    const grid = el("div", "tlt-heat-grid");
    ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"].forEach((w) => grid.appendChild(el("div", "tlt-heat-w", w)));
    const first = new Date(y, mo - 1, 1);
    const days = new Date(y, mo, 0).getDate();
    for (let i = 0; i < first.getDay(); i++) grid.appendChild(el("div", "tlt-heat-c blank"));
    const count = {};
    all.forEach((x) => {
      count[x.date] = (count[x.date] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(count));
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const n = count[key] || 0;
      const lv = n === 0 ? 0 : Math.min(4, 1 + Math.floor(n / max * 3));
      const c = el("div", "tlt-heat-c" + (lv ? ` lv${lv}` : "") + (key === todayISO() ? " today" : "") + (this.heatDay === key ? " on" : ""));
      c.title = `${key} \xB7 ${n} \u6761`;
      c.append(el("span", "tlt-heat-d", String(d)));
      if (n) c.append(el("span", "tlt-heat-n", String(n)));
      c.onclick = () => {
        this.heatDay = key;
        void this.render();
      };
      grid.appendChild(c);
    }
    box.appendChild(grid);
    if (this.heatDay) {
      const list = el("div", "tlt-heat-day");
      list.appendChild(el("div", "tlt-count", `${this.heatDay} \u7684\u6D88\u606F`));
      all.filter((x) => x.date === this.heatDay).forEach((x) => {
        const row2 = el("div", "tlt-crow");
        const dot = el("span", "tlt-nd");
        dot.style.background = KIND_COLOR2[x.kind];
        row2.append(dot, el("span", "tlt-crow-t", x.title));
        row2.onclick = () => this.openMsg(x);
        list.appendChild(row2);
      });
      if (!all.some((x) => x.date === this.heatDay)) list.appendChild(el("div", "tlt-empty", t("\u8FD9\u5929\u6CA1\u6709\u6D88\u606F")));
      box.appendChild(list);
    }
    return box;
  }
  /** 人物脉络：谁发的源 → 哪些源 → 多少条 */
  net(items) {
    const box = el("div", "tlt-net");
    const feeds = this.store.feeds.filter((f) => f.items.length);
    const owners = Array.from(new Set(feeds.map((f) => f.owner || "\u6211")));
    const W = 640, H = Math.max(240, owners.length * 64);
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "tlt-net-svg");
    const oy = (i) => 34 + i * (H - 68) / Math.max(1, owners.length - 1);
    const fy = (i) => 26 + i * (H - 52) / Math.max(1, feeds.length - 1);
    let g = "";
    feeds.forEach((f, i) => {
      const oi = owners.indexOf(f.owner || "\u6211");
      g += `<path class="tlt-net-e" d="M150 ${oy(oi).toFixed(1)} C 260 ${oy(oi).toFixed(1)}, 300 ${fy(i).toFixed(1)}, 400 ${fy(i).toFixed(1)}"/>`;
    });
    owners.forEach((o, i) => {
      const n = feeds.filter((f) => (f.owner || "\u6211") === o).reduce((s, f) => s + f.items.length, 0);
      const label = o === "me" ? "\u6211" : o;
      g += `<g class="tlt-net-g"><circle class="tlt-net-o" cx="130" cy="${oy(i).toFixed(1)}" r="${(11 + Math.min(9, n)).toFixed(1)}"/>
        <text class="tlt-net-t" x="130" y="${(oy(i) + 30).toFixed(1)}" text-anchor="middle">${escapeXml2(label.slice(0, 6))}</text>
        <text class="tlt-net-n" x="130" y="${(oy(i) + 3).toFixed(1)}" text-anchor="middle">${n}</text></g>`;
    });
    feeds.forEach((f, i) => {
      const y = fy(i);
      g += `<g class="tlt-net-g" data-feed="${escapeXml2(f.id)}">
        <rect class="tlt-net-hit" x="392" y="${(y - 12).toFixed(1)}" width="196" height="24"/>
        <rect class="tlt-net-f" x="400" y="${(y - 10).toFixed(1)}" width="${(56 + Math.min(96, f.items.length * 12)).toFixed(0)}" height="20" rx="10"/>
        <text class="tlt-net-t2" x="410" y="${(y + 4).toFixed(1)}">${escapeXml2(f.name.slice(0, 12))}</text>
        <text class="tlt-net-n2" x="586" y="${(y + 4).toFixed(1)}">${f.items.length}</text></g>`;
    });
    setSvgMarkup(svg, g);
    svg.addEventListener("click", (ev) => {
      const target = ev.target;
      const t2 = target instanceof Element ? target.closest("[data-feed]") : null;
      if (!t2) return;
      const id = t2.getAttribute("data-feed") ?? "";
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      void this.render();
    });
    box.appendChild(svg);
    box.appendChild(el("div", "tlt-hint", "\u5706\uFF1D\u4EBA\uFF08\u6570\u5B57\u662F\u4ED6\u4EEC\u53D1\u7684\u6D88\u606F\u6570\uFF09\uFF0C\u80F6\u56CA\uFF1D\u6D88\u606F\u6E90\uFF0C\u7C97\u7EC6\u4E0D\u4EE3\u8868\u4EC0\u4E48\u3002\u70B9\u6E90\u53EF\u4EE5\u53EA\u770B\u5B83\u3002"));
    return box;
  }
  openMsg(x) {
    x.read_ = true;
    new MsgModal(this.app, this.store, x, () => this.refresh()).open();
  }
  shiftMonth(d) {
    const [y, mo] = this.heatMonth.split("-").map(Number);
    const dt = new Date(y, mo - 1 + d, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }
  /** 一条消息：三种形态共用一套数据，只换外壳 */
  item(x) {
    const feed = this.store.feeds.find((f) => f.id === x.feed);
    const dot = () => {
      const d = el("span", "tlt-nd");
      d.style.background = KIND_COLOR2[x.kind];
      return d;
    };
    const open = () => this.openMsg(x);
    if (this.mode === "compact") {
      const row2 = el("div", "tlt-crow" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
      row2.append(dot());
      row2.append(el("span", "tlt-crow-t", x.title));
      row2.append(el("span", "tlt-crow-s", feed ? feed.name : ""));
      row2.onclick = open;
      return row2;
    }
    if (this.mode === "spine") {
      const row2 = el("div", "tlt-srow" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
      const rail = el("div", "tlt-srail");
      rail.appendChild(dot());
      row2.appendChild(rail);
      const body = el("div", "tlt-sbody");
      const nh = el("div", "tlt-nh");
      nh.append(el("span", "tlt-nm", x.title));
      if (x.star) nh.appendChild(el("span", "tlt-sk", "\u2605"));
      body.appendChild(nh);
      body.appendChild(el(
        "div",
        "tlt-nm2",
        [feed ? feed.name : "", x.place || "", x.who.length ? x.who.join("\u3001") : "", x.state === "ended" ? "\u5DF2\u7ED3\u675F" : ""].filter(Boolean).join("  \xB7  ")
      ));
      if (x.body) body.appendChild(el("div", "tlt-nb", x.body));
      row2.appendChild(body);
      row2.onclick = open;
      return row2;
    }
    const card = el("div", "tlt-card" + (x.star ? " star" : "") + (x.state === "ended" ? " ended" : ""));
    const top = el("div", "tlt-card-top");
    const kd = el("span", "tlt-carddot");
    kd.style.background = KIND_COLOR2[x.kind];
    top.append(kd, el("span", "tlt-nm", x.title));
    if (x.star) top.appendChild(el("span", "tlt-sk", "\u2605"));
    card.appendChild(top);
    const bits = [feed ? feed.name : "", x.place || "", x.who.length ? x.who.join("\u3001") : "", x.state === "ended" ? "\u5DF2\u7ED3\u675F" : ""].filter(Boolean);
    if (bits.length) card.appendChild(el("div", "tlt-nm2", bits.join("  \xB7  ")));
    if (x.body) card.appendChild(el("div", "tlt-nb", x.body));
    card.onclick = open;
    return card;
  }
  bounds() {
    const back = this.zoom === "m" ? 60 : this.zoom === "d" ? 5 : 14;
    const fwd = this.zoom === "m" ? 120 : this.zoom === "d" ? 10 : 60;
    let from = addDays(todayISO(), -back), to = addDays(todayISO(), fwd);
    if (this.range === "today") {
      from = todayISO();
      to = todayISO();
    }
    if (this.range === "7") from = addDays(todayISO(), -7);
    if (this.range === "30") from = addDays(todayISO(), -30);
    return { from, to };
  }
  visible() {
    const { from, to } = this.bounds();
    return this.msgs().filter((x) => this.filter === "star" ? x.star : this.filter === "unread" ? !x.read_ : true).filter((x) => !this.selected.size || this.selected.has(x.feed)).filter((x) => !this.q || x.title.includes(this.q) || (x.body || "").includes(this.q) || (x.place || "").includes(this.q)).filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  }
  /** 回到今天：找得到就滚过去，找不到就把范围放宽再滚 */
  jumpToday() {
    const go = () => {
      const el2 = document.querySelector('.tlt-mtl [data-day="today"]');
      if (el2) el2.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    if (document.querySelector('.tlt-mtl [data-day="today"]')) {
      go();
      return;
    }
    this.range = "7";
    if (!this.msgs().some((x) => x.date === todayISO())) this.range = "all";
    void this.render().then(() => window.setTimeout(go, 60));
  }
  /* ---------------- 右栏：消息源管理 ---------------- */
  side() {
    const s = el("aside", "tlt-fm-side");
    const ids = Array.from(this.selected);
    if (ids.length === 1) {
      const f = this.store.feeds.find((x) => x.id === ids[0]);
      if (f) {
        const tw = el("div", "tlt-d-titlewrap");
        const tEl = el("div", "tlt-d-title", f.name);
        const pen = el("button", "tlt-rename", "\u270E");
        pen.title = "\u6539\u6E90\u540D\u79F0";
        pen.onclick = () => {
          const inp = el("input", "tlt-input");
          inp.value = f.name;
          tw.empty();
          tw.appendChild(inp);
          inp.focus();
          inp.select();
          let done = false;
          const commit = () => {
            void (async () => {
              if (done) return;
              done = true;
              const v = inp.value.trim();
              if (v && v !== f.name) {
                await this.store.renameFeed(f, v);
                new Notice(`\u5DF2\u6539\u540D\u4E3A\u300C${v}\u300D`);
              }
              await this.refresh();
            })();
          };
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") void this.render();
          });
          inp.addEventListener("blur", commit);
        };
        tw.append(tEl, pen);
        s.appendChild(tw);
        s.appendChild(el(
          "div",
          "tlt-d-meta",
          `${f.personal ? "\u4E2A\u4EBA\u6E90" : f.mine ? "\u6211\u53D1\u5E03\u7684\u6E90" : "\u6211\u8BA2\u9605\u7684\u6E90"} \xB7 ${f.items.length} \u6761`
        ));
        const act = el("div", "tlt-d-act");
        if (f.personal) {
          s.appendChild(el("div", "tlt-d-body", "\u65B0\u6D88\u606F\u9ED8\u8BA4\u8FDB\u8FD9\u91CC\uFF0C\u53EA\u6709\u81EA\u5DF1\u770B\u3002\u70B9\u5F00\u67D0\u6761\u8349\u7A3F\u53EF\u4EE5\u300C\u53D1\u5E03\u4E3A\u6D88\u606F\u6E90\u300D\u3002"));
          const n = el("button", "tlt-btn pri", t("\u65B0\u5EFA\u6D88\u606F\u5230\u8FD9\u4E2A\u6E90"));
          n.onclick = () => new ComposeModal(this.app, this.store, () => this.refresh(), f.id).open();
          act.appendChild(n);
          const pub = el("button", "tlt-btn", t("\u53D1\u5E03\u6D88\u606F\u6E90\u2026"));
          pub.title = "\u628A\u8FD9\u91CC\u7684\u8349\u7A3F\u53D8\u6210\u4E00\u4E2A\u522B\u4EBA\u80FD\u8BA2\u9605\u7684\u6E90";
          pub.onclick = () => new PublishFeedModal(this.app, this.store, f, () => this.refresh()).open();
          act.appendChild(pub);
        } else if (f.mine) {
          const st = this.plugin.hubState();
          const pid = (this.store.settings.feedIds || {})[f.id] || f.id;
          s.appendChild(el("div", "tlt-d-body", `\u8BA2\u9605\u5730\u5740\uFF1A${st.publish}/feed?id=${encodeURIComponent(pid)}`));
          const push = el("button", "tlt-btn pri", t("\u624B\u52A8\u63A8\u9001"));
          push.onclick = () => {
            void (async () => {
              try {
                const r = await this.store.publishFeed(f, st.publish, pid);
                new Notice(`\u5DF2\u63A8\u9001 ${r.count} \u6761`);
              } catch (e) {
                new Notice("\u63A8\u9001\u5931\u8D25\uFF1A" + errMsg(e));
              }
            })();
          };
          const unpub = el("button", "tlt-btn danger", t("\u53D6\u6D88\u53D1\u5E03"));
          unpub.onclick = () => {
            void (async () => {
              try {
                await this.store.unpublishFeed(pid, st.publish);
              } catch {
              }
              const back = f.personal ? 0 : await this.store.foldBackToPersonal(f, "\u4E2A\u4EBA");
              this.selected.delete(f.id);
              await this.refresh();
              if (back < 0) new Notice("\u5E76\u56DE\u4E2A\u4EBA\u5931\u8D25\uFF0C\u6E90\u6587\u4EF6\u5DF2\u4FDD\u7559\uFF0C\u7A0D\u540E\u518D\u8BD5");
              else new Notice(back ? `\u5DF2\u53D6\u6D88\u53D1\u5E03\uFF0C${back} \u6761\u56DE\u5230\u300C\u4E2A\u4EBA\u300D` : "\u5DF2\u53D6\u6D88\u53D1\u5E03\uFF08\u8FD9\u4E2A\u6E90\u91CC\u6CA1\u6709\u5185\u5BB9\uFF09");
            })();
          };
          act.append(push, unpub);
        } else {
          const st = this.plugin.hubState();
          if (f.remote) s.appendChild(el("div", "tlt-d-body", f.remote));
          const un = el("button", "tlt-btn danger", t("\u53D6\u6D88\u8BA2\u9605"));
          un.onclick = () => {
            void (async () => {
              try {
                await this.store.unsubscribeRemote(st.sync, f.remote || "");
              } catch {
              }
              this.selected.delete(f.id);
              const gone = await this.store.trashFeedFile(f);
              await this.refresh();
              new Notice(gone ? `\u5DF2\u53D6\u6D88\u8BA2\u9605\u300C${f.name}\u300D\uFF0C\u672C\u5730\u6587\u4EF6\u5DF2\u8FDB\u56DE\u6536\u7AD9` : `\u5DF2\u53D6\u6D88\u8BA2\u9605\u300C${f.name}\u300D`);
            })();
          };
          act.appendChild(un);
        }
        s.appendChild(act);
        s.appendChild(el("div", "tlt-hint", "\u5DE6\u680F\u53EF\u591A\u9009\u6E90\u6765\u8FC7\u6EE4\u65F6\u95F4\u7EBF\uFF1B\u8FD9\u91CC\u53EA\u7BA1\u7406\u5F53\u524D\u8FD9\u4E00\u4E2A\u6E90\u3002"));
        return s;
      }
    }
    if (ids.length > 1) {
      s.appendChild(el("div", "tlt-d-title", `\u5DF2\u9009 ${ids.length} \u4E2A\u6E90`));
      s.appendChild(el("div", "tlt-d-meta", "\u8981\u7BA1\u7406\u67D0\u4E2A\u6E90\uFF0C\u53EA\u9009\u5B83\u4E00\u4E2A\u3002"));
      const list = el("div", "tlt-src-list");
      ids.forEach((id) => {
        const f = this.store.feeds.find((x) => x.id === id);
        if (!f) return;
        const row2 = el("div", "tlt-src-row");
        row2.append(
          el("span", "tlt-src-name", f.name),
          el("span", "tlt-src-kind", f.personal ? "\u4E2A\u4EBA" : f.mine ? "\u6211\u53D1\u5E03" : "\u8BA2\u9605")
        );
        list.appendChild(row2);
      });
      s.appendChild(list);
      return s;
    }
    return this.overviewSide(s);
  }
  overviewSide(s) {
    const unread = this.msgs().filter((x) => !x.read_).length;
    const star = this.msgs().filter((x) => x.star).length;
    s.appendChild(el("div", "tlt-d-title", "\u6D88\u606F\u6E90\u7BA1\u7406"));
    const stats = el("div", "tlt-d-stats");
    [[String(unread), "\u672A\u8BFB"], [String(star), "\u91CD\u8981"], [String(this.store.feeds.length), "\u6E90"]].forEach(([v, l]) => {
      const c = el("div", "tlt-d-stat");
      c.append(el("b", "", v), el("span", "", l));
      stats.appendChild(c);
    });
    s.appendChild(stats);
    s.appendChild(this.hubPanel());
    s.appendChild(el("div", "tlt-hint", "\u70B9\u5DE6\u680F\u67D0\u4E2A\u6E90\uFF0C\u8FD9\u91CC\u6362\u6210\u5B83\u7684\u7BA1\u7406\u9762\u677F\uFF08\u53EF\u591A\u9009\u7B5B\u9009\u65F6\u95F4\u7EBF\uFF09\u3002"));
    return s;
  }
  hubPanel() {
    const box = el("div", "tlt-hub-side");
    const st = this.plugin.hubState();
    box.appendChild(el("div", "tlt-fgrp", "\u670D\u52A1"));
    const row2 = (label, value) => {
      const d = el("div", "tlt-hub-row");
      d.append(el("span", "tlt-hub-l", label), el("code", "", value));
      return d;
    };
    box.appendChild(row2(t("\u53D1\u5E03"), st.publish));
    box.appendChild(row2("\u62C9\u53D6", st.sync));
    box.appendChild(el(
      "div",
      "tlt-hub-note",
      `\u81EA\u52A8\u540C\u6B65\uFF1A${st.syncMin ? `\u6BCF ${st.syncMin} \u5206\u949F` : "\u5173\u95ED"} \xB7 \u81EA\u52A8\u63A8\u9001\uFF1A${st.pushMin ? `\u6BCF ${st.pushMin} \u5206\u949F` : "\u5173\u95ED"}\uFF08\u5728\u8BBE\u7F6E\u91CC\u6539\uFF09`
    ));
    const btns = el("div", "tlt-hub-btns");
    const push = el("button", "tlt-btn", t("\u63A8\u9001\u6211\u7684\u6E90"));
    push.onclick = () => new PublishModal(this.app, this.store, this.plugin, () => this.render()).open();
    const sync = el("button", "tlt-btn", t("\u540C\u6B65\u8BA2\u9605"));
    sync.onclick = () => {
      void (async () => {
        try {
          const r = await this.store.pullFromHub(st.sync);
          const stamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          this.plugin.setHubState({ lastSync: stamp, lastResult: `\u65B0\u589E ${r.added} \u6761`, lastError: "" });
          await this.refresh();
          new Notice(`\u540C\u6B65\u5B8C\u6210\uFF1A\u65B0\u589E ${r.added} \u6761`);
        } catch (e) {
          new Notice("\u540C\u6B65\u5931\u8D25\uFF1A" + errMsg(e));
        }
      })();
    };
    btns.append(push, sync);
    box.appendChild(btns);
    const input = el("input", "tlt-input");
    input.placeholder = "\u8BA2\u9605\u5730\u5740\uFF08\u53EF\u7C98\u8D34 @URL:\u2026\uFF09";
    box.appendChild(input);
    const sub = el("button", "tlt-btn", t("\u8BA2\u9605\u8FD9\u4E2A\u6E90"));
    sub.onclick = () => {
      void (async () => {
        const url = cleanFeedUrl(input.value);
        if (!url) {
          new Notice("\u5148\u586B\u8BA2\u9605\u5730\u5740");
          return;
        }
        try {
          const r = await this.store.subscribeRemote(st.sync, url);
          if (r.reason === "self") {
            new Notice("\u8FD9\u662F\u4F60\u81EA\u5DF1\u53D1\u5E03\u7684\u6E90\uFF0C\u4E0D\u9700\u8981\u8BA2\u9605");
            return;
          }
          if (r.existed) {
            new Notice("\u5DF2\u7ECF\u8BA2\u9605\u8FC7\u8FD9\u4E2A\u6E90");
            input.value = "";
            return;
          }
          input.value = "";
          const p = await this.store.pullFromHub(st.sync);
          await this.refresh();
          new Notice(`\u5DF2\u8BA2\u9605\u5E76\u540C\u6B65 ${p.added} \u6761`);
        } catch (e) {
          new Notice("\u8BA2\u9605\u5931\u8D25\uFF1A" + errMsg(e));
        }
      })();
    };
    box.appendChild(sub);
    return box;
  }
};
var PublishFeedModal = class extends TltModal {
  constructor(app, store, from, onDone) {
    super(app);
    this.store = store;
    this.from = from;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u53D1\u5E03\u6D88\u606F\u6E90"));
    contentEl.appendChild(el(
      "div",
      "tlt-m-meta",
      `\u628A\u300C${this.from.name}\u300D\u91CC\u7684\u8349\u7A3F\u53D8\u6210\u4E00\u4E2A\u522B\u4EBA\u80FD\u8BA2\u9605\u7684\u6E90\uFF1B\u53D1\u5E03\u540E\u5B83\u4F1A\u51FA\u73B0\u5728\u300C\u6211\u53D1\u5E03\u7684\u300D\u91CC\u3002`
    ));
    const nameIn = el("input", "tlt-input wide tlt-input-title");
    nameIn.placeholder = "\u6E90\u540D\u79F0\uFF08\u522B\u4EBA\u770B\u5230\u7684\u540D\u5B57\uFF09";
    nameIn.value = (this.store.settings.feedNames || {})[this.from.id] || this.from.name;
    nameIn.oninput = () => {
      this.store.settings.feedNames = { ...this.store.settings.feedNames || {}, [this.from.id]: nameIn.value.trim() };
    };
    contentEl.appendChild(nameIn);
    const descRow = el("div", "tlt-row");
    descRow.appendChild(el("span", "tlt-row-l", "\u8BF4\u660E"));
    const descIn = el("input", "tlt-input");
    descIn.placeholder = "\u8FD9\u4E2A\u6E90\u53D1\u4EC0\u4E48\uFF08\u53EF\u7559\u7A7A\uFF09";
    descRow.appendChild(descIn);
    const cadRow = el("div", "tlt-row");
    cadRow.appendChild(el("span", "tlt-row-l", "\u8282\u594F"));
    const cadIn = el("input", "tlt-input");
    cadIn.placeholder = "\u6BD4\u5982 \u6BCF\u5468 2\u20133 \u6761\uFF08\u53EF\u7559\u7A7A\uFF09";
    cadRow.appendChild(cadIn);
    contentEl.append(descRow, cadRow);
    contentEl.appendChild(el(
      "div",
      "tlt-hint",
      "\u540D\u79F0\u4F1A\u8BB0\u4F4F\uFF0C\u4E0B\u6B21\u53D1\u5E03\u8FD8\u662F\u5B83\uFF1B\u5EFA\u597D\u4E4B\u540E\u4E5F\u80FD\u5728\u53F3\u680F \u270E \u6539\u3002\u8BA2\u9605\u5730\u5740\u7531\u63D2\u4EF6\u81EA\u52A8\u751F\u6210\uFF0C\u4E0D\u7528\u81EA\u5DF1\u8D77 ID\u3002"
    ));
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", t("\u53D6\u6D88"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", t("\u53D1\u5E03"));
    ok.onclick = () => {
      void (async () => {
        const name = nameIn.value.trim();
        if (!name) {
          new Notice("\u5148\u5199\u6E90\u540D\u79F0");
          return;
        }
        try {
          const r = await this.store.publishSource(this.from, {
            name,
            desc: descIn.value.trim(),
            cadence: cadIn.value.trim()
          });
          if (!r.ok) {
            new Notice("\u53D1\u5E03\u5931\u8D25\uFF1A\u540D\u79F0\u7A7A\u7740");
            return;
          }
          this.close();
          void this.onDone();
          new Notice(`\u5DF2\u53D1\u5E03\u300C${name}\u300D\xB7 \u8BA2\u9605\u5730\u5740\u5728\u53F3\u680F\u91CC`);
        } catch (e) {
          new Notice("\u53D1\u5E03\u5931\u8D25\uFF1A" + errMsg(e));
        }
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => nameIn.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ComposeModal = class extends TltModal {
  constructor(app, store, onDone, presetFeed) {
    super(app);
    this.store = store;
    this.onDone = onDone;
    this.presetFeed = presetFeed;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u65B0\u5EFA\u6D88\u606F"));
    contentEl.appendChild(el("div", "tlt-m-meta", "\u53EA\u6709\u6807\u9898\u5FC5\u586B\uFF1B\u65F6\u95F4\u5730\u70B9\u4EBA\u7269\u8FD9\u4E9B\u7559\u7740\u66F4\u597D\u627E\uFF0C\u4E5F\u53EF\u4EE5\u7A7A\u7740\u3002"));
    const f = buildMsgFields(contentEl, { date: todayISO() }, this.store);
    const srcRow = el("div", "tlt-row");
    srcRow.appendChild(el("span", "tlt-row-l", "\u6D88\u606F\u6E90"));
    const src = el("select", "tlt-input");
    const options = [
      ...this.store.feeds.filter((x) => x.personal),
      ...this.store.feeds.filter((x) => x.mine && !x.personal)
    ];
    options.forEach((x) => {
      const o = createEl("option");
      o.value = x.id;
      o.textContent = `${x.name}\uFF08${x.personal ? "\u4E2A\u4EBA" : "\u5DF2\u53D1\u5E03"}\uFF09`;
      src.appendChild(o);
    });
    if (this.presetFeed) src.value = this.presetFeed;
    srcRow.appendChild(src);
    contentEl.appendChild(srcRow);
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", t("\u53D6\u6D88"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", t("\u521B\u5EFA"));
    ok.onclick = () => {
      void (async () => {
        const v = f.value();
        if (!v.title) {
          new Notice("\u5148\u5199\u6807\u9898");
          return;
        }
        if (!src.value) {
          new Notice("\u5148\u9009\u4E00\u4E2A\u6D88\u606F\u6E90");
          return;
        }
        await this.store.addMessage(src.value, v);
        this.close();
        void this.onDone();
        new Notice("\u5DF2\u521B\u5EFA\u6D88\u606F");
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
    window.setTimeout(() => f.titleEl.focus(), 50);
    f.titleEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) ok.click();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var PublishModal = class extends TltModal {
  constructor(app, store, plugin, onDone) {
    super(app);
    this.store = store;
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("tlt-modal");
    contentEl.appendChild(el("div", "tlt-m-title", "\u63A8\u9001\u5230\u53D1\u5E03\u670D\u52A1"));
    contentEl.appendChild(el("div", "tlt-m-meta", "\u4E0B\u9762\u7684 ID \u5C31\u662F\u522B\u4EBA\u8BA2\u9605\u5730\u5740\u91CC\u7684 ?id=\u3002"));
    const rows = [];
    this.store.feeds.filter((f) => f.mine && !f.personal).forEach((f) => {
      const r = el("div", "tlt-row");
      r.appendChild(el("span", "tlt-row-l", f.name.slice(0, 6)));
      const box = el("div", "tlt-row-v");
      const input = el("input", "tlt-input");
      input.value = (this.store.settings.feedIds || {})[f.id] || f.id;
      box.append(input, el("div", "tlt-hint", `${f.items.length} \u6761`));
      r.appendChild(box);
      contentEl.appendChild(r);
      rows.push({ feed: f, input });
    });
    if (!rows.length) contentEl.appendChild(el("div", "tlt-hint", "\u6CA1\u6709\u53EF\u53D1\u5E03\u7684\u6E90"));
    const foot = el("div", "tlt-m-foot");
    const cancel = el("button", "tlt-btn", t("\u53D6\u6D88"));
    cancel.onclick = () => this.close();
    const ok = el("button", "tlt-btn pri", "\u4FDD\u5B58\u5E76\u63A8\u9001");
    ok.onclick = () => {
      void (async () => {
        const ids = {};
        rows.forEach(({ feed, input }) => {
          ids[feed.id] = input.value.trim() || feed.id;
        });
        this.store.settings.feedIds = ids;
        await this.plugin.saveSettings();
        try {
          let total = 0;
          for (const { feed, input } of rows) {
            const r = await this.store.publishFeed(feed, this.plugin.hubState().publish, input.value.trim() || feed.id);
            total += r.count || 0;
          }
          new Notice(`\u5DF2\u63A8\u9001 ${rows.length} \u4E2A\u6E90\uFF08${total} \u6761\uFF09`);
        } catch (e) {
          new Notice("\u63A8\u9001\u5931\u8D25\uFF1A" + errMsg(e));
        }
        this.close();
        void this.onDone();
      })();
    };
    foot.append(cancel, ok);
    contentEl.appendChild(foot);
  }
  onClose() {
    this.contentEl.empty();
  }
};
export {
  MessagesView,
  Store,
  TFile,
  WorkbenchView
};
