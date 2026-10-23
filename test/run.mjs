import esbuild from "esbuild";
import { strict as assert } from "node:assert";

await esbuild.build({
  entryPoints: ["src/data.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "test/data.mjs",
  logLevel: "error",
});

const d = await import("./data.mjs?" + Date.now());

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n    ", e.message); process.exitCode = 1; }
};

console.log("data.ts");

t("任务行：标题/日期/占比/优先级/负责人", () => {
  const line = "- [ ] 抽样报告 🛫 2026-10-20 📅 2026-10-25 [wl:: 30] [pri:: 2] [owner:: [[张三]], [[我]]]";
  const task = d.parseTaskLine(line, { file: "TLT/tasks/示例工具.md", line: 3, project: "示例工具", milestone: "抽样与调优" });
  assert.equal(task.title, "抽样报告");
  assert.equal(task.start, "2026-10-20");
  assert.equal(task.due, "2026-10-25");
  assert.equal(task.wl, 30);
  assert.equal(task.pri, 2);
  assert.deepEqual(task.owners, ["张三", "我"]);
  assert.equal(task.milestone, "抽样与调优");
  assert.equal(task.done, false);
});

t("任务行：已完成 + 无字段", () => {
  const task = d.parseTaskLine("- [x] 体检预约 📅 2026-10-20", { file: "a.md", line: 0, project: "个人" });
  assert.equal(task.done, true);
  assert.equal(task.title, "体检预约");
  assert.equal(task.wl, 0);
  assert.equal(task.pw, "m");
});

t("勾选往返", () => {
  const line = "- [ ] 写周报 [wl:: 10]";
  const on = d.toggleTaskLine(line);
  assert.equal(on, "- [x] 写周报 [wl:: 10]");
  assert.equal(d.toggleTaskLine(on), line);
});

t("改截止日期：有则替换，无则追加", () => {
  assert.equal(
    d.setTaskDue("- [ ] A 📅 2026-10-20 [wl:: 10]", "2026-11-01"),
    "- [ ] A 📅 2026-11-01 [wl:: 10]"
  );
  assert.equal(d.setTaskDue("- [ ] A", "2026-11-01"), "- [ ] A 📅 2026-11-01");
});

t("改行内字段：不重复、可删除", () => {
  let s = "- [ ] A [wl:: 30] [pri:: 2]";
  s = d.setTaskField(s, "wl", 50);
  assert.equal(s, "- [ ] A [pri:: 2] [wl:: 50]".replace("[pri:: 2] ", "[pri:: 2] "));
  s = d.setTaskField(s, "pri", null);
  assert.ok(!s.includes("[pri::"));
});

t("新任务行：生成后能被解析回来", () => {
  const line = d.newTaskLine({ title: "回归测试", due: "2026-10-21", wl: 20, pri: 3, owners: ["我"] });
  const back = d.parseTaskLine(line, { file: "x.md", line: 0, project: "P" });
  assert.equal(back.title, "回归测试");
  assert.equal(back.due, "2026-10-21");
  assert.equal(back.wl, 20);
  assert.equal(back.pri, 3);
  assert.deepEqual(back.owners, ["我"]);
});

t("消息行", () => {
  const m = d.parseMsgLine(
    "- 2026-10-21 部门宣贯 [kind:: ask] [place:: 三楼会议室] [star:: true] [pin:: 九月复盘]",
    "部门通知",
    ["  > 领导要求本周内完成"]
  );
  assert.equal(m.date, "2026-10-21");
  assert.equal(m.title, "部门宣贯");
  assert.equal(m.kind, "ask");
  assert.equal(m.place, "三楼会议室");
  assert.equal(m.star, true);
  assert.equal(m.pin, "九月复盘");
  assert.equal(m.body, "领导要求本周内完成");
});

t("记录月文件：按 ## 日期分节", () => {
  const md = `# 记录 2026-10\n\n## 2026-10-20\n\n- 09:30–11:00 示例记录：核对口径 [proj:: 示例项目]\n  > 三处差异写进 V2\n- 11:00–11:40 需求对齐会 [extra:: true]\n\n## 2026-10-21\n\n- 14:00–15:00 评审 [proj:: TRC]\n`;
  const list = d.parseLogMonth(md, "TLT/logs/2026-10.md");
  assert.equal(list.length, 3);
  assert.equal(list[0].due, "2026-10-20");
  assert.equal(list[0].st, "09:30");
  assert.equal(list[0].en, "11:00");
  assert.equal(list[0].project, "示例项目");
  assert.equal(list[1].extra, true);
  assert.equal(list[2].due, "2026-10-21");
});

t("人员档案", () => {
  const s = d.parseStaff("张三", "TLT/team/张三.md", { role: "算法工程师", capacity: 80, days: 4, skills: ["评测", "数据集"], status: "active" });
  assert.equal(s.capacity, 80);
  assert.equal(s.days, 4);
  assert.deepEqual(s.skills, ["评测", "数据集"]);
});

t("人员档案：字段缺失有兜底", () => {
  const s = d.parseStaff("新同学", "x.md", {});
  assert.equal(s.capacity, 100);
  assert.equal(s.days, 5);
  assert.equal(s.status, "active");
});

t("想法行", () => {
  const i = d.parseIdeaLine("- 门架数据做拥堵溯源 [type:: 论文] [stage:: 待验证] [star:: 2] [at:: 2026-10-20]", "TLT/ideas.md", 0, "正文");
  assert.equal(i.type, "论文");
  assert.equal(i.stage, "待验证");
  assert.equal(i.star, 2);
  assert.equal(i.body, "正文");
});

t("周期判定", () => {
  const ref = new Date(2026, 9, 21); // 2026-10-21 周三
  assert.equal(d.inPeriod("2026-10-20", "w", ref), true);
  assert.equal(d.inPeriod("2026-10-12", "w", ref), false);
  assert.equal(d.inPeriod("2026-10-01", "m", ref), true);
  assert.equal(d.inPeriod("2026-09-30", "m", ref), false);
  assert.equal(d.inPeriod("2026-11-02", "q", ref), true);
  assert.equal(d.inPeriod("2027-01-02", "q", ref), false);
});

t("饱和度：人天 ÷ 可用人天", () => {
  const mk = (o) => Object.assign({ kind: "task", done: false, owners: ["我"], due: "2026-10-21", est: 0 }, o);
  const tasks = [mk({ est: 2 }), mk({ est: 3 }), mk({ est: 4, done: true }), mk({ est: 5, owners: ["甲"] })];
  const ref = new Date(2026, 9, 21);
  const s = d.saturation(tasks, "我", "m", { capacity: 100, days: 5 }, ref);
  assert.equal(s.sum, 5);                    // 只算未完成的 2+3
  assert.equal(s.avail, 21.7);               // 5×4.33
  assert.equal(s.pct, 23);
  // 老数据只有 wl 时按占比折算
  const legacy = [Object.assign({ kind: "task", done: false, owners: ["我"], due: "2026-10-21", wl: 50 }, {})];
  const s2 = d.saturation(legacy, "我", "m", { capacity: 100, days: 5 }, ref);
  assert.ok(Math.abs(s2.sum - 10.8) < 0.2, String(s2.sum));
});

t("订阅地址清洗", () => {
  const c = d.cleanFeedUrl;
  assert.equal(c("@url:`http://127.0.0.1:8787/feed?id=部门通知`"), "http://127.0.0.1:8787/feed?id=部门通知");
  assert.equal(c("url: http://x/y"), "http://x/y");
  assert.equal(c("  <http://127.0.0.1:8787/feed?id=a>  "), "http://127.0.0.1:8787/feed?id=a");
  assert.equal(c("@URL：http://x"), "http://x");
});

t("想法语法：只用 # 标签", () => {
  const a = d.parseIdeaText("#论文 #测试 空间检索");
  assert.deepEqual(a.tags, ["论文", "测试"]);
  assert.equal(a.title, "空间检索");
  const b = d.parseIdeaText("做个体检脚本 ＃工具");
  assert.deepEqual(b.tags, ["工具"]);
  assert.equal(b.title, "做个体检脚本");
  const c = d.parseIdeaText("随手一记");
  assert.deepEqual(c.tags, []);
  assert.equal(c.title, "随手一记");
});

t("想法标签：老数据 type/stage 也算标签", () => {
  assert.deepEqual(d.ideaTags({ type: "论文", stage: "待验证", tags: ["测试"] }), ["论文", "待验证", "测试"]);
  assert.deepEqual(d.ideaTags({ type: "想法", stage: "沉淀", tags: [] }), []);
});

t("想法语法：@ 不再参与（会留在标题里）", () => {
  const r = d.parseIdeaText("#论文 test @初稿");
  assert.deepEqual(r.tags, ["论文"]);
  assert.equal(r.title, "test @初稿");
});

t("任务快捷语法", () => {
  const r = d.parseQuick("抽样报告 #抽样与调优 明天 !!");
  assert.equal(r.title, "抽样报告");
  assert.equal(r.milestone, "抽样与调优");
  assert.equal(r.pri, 3);
  assert.equal(r.due, d.addDays(d.todayISO(), 1));
});

t("日期工具", () => {
  assert.equal(d.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(d.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(d.minToHHMM(570), "09:30");
  assert.equal(d.hhmmToMin("09:30"), 570);
  const b = d.monthBounds(new Date(2026, 1, 15));
  assert.equal(b.start, "2026-02-01");
  assert.equal(b.end, "2026-02-28");
});

console.log(`\n${pass} 项通过${process.exitCode ? "，有失败" : "，全部通过"}`);
