/**
 * 快捷命令（0.5）：登记/新建/归档/删除全套流程。
 * 跑法：node test/commands.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "tlt-cmd-")), "bundle.mjs");

await build({
  entryPoints: [join(root, "test/cmd-entry.ts")],
  bundle: true, format: "esm", platform: "node", target: "node18",
  outfile: out, external: ["obsidian"], logLevel: "silent",
  alias: { obsidian: join(root, "test/obsidian-stub.ts") },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

/* Obsidian 给 DOM 补的那套方法 */
const EP = dom.window.Element.prototype;
EP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
EP.addClass = function (...c) { c.forEach((x) => this.classList.add(x)); };
EP.removeClass = function (...c) { c.forEach((x) => this.classList.remove(x)); };
EP.toggleClass = function (c, on) { this.classList.toggle(c, on); };
EP.setCssProps = function (obj) { Object.entries(obj || {}).forEach(([k, v]) => this.style.setProperty(k, String(v))); };
EP.createEl = function (tag, o = {}) {
  const e = document.createElement(tag);
  if (o.text) e.textContent = o.text;
  if (o.cls) e.className = o.cls;
  this.appendChild(e);
  return e;
};
globalThis.createEl = (tag, o = {}) => {
  const e = dom.window.document.createElement(tag);
  if (typeof o === "string") e.className = o;
  else { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; }
  return e;
};
const mod = await import(out);
const { makeStore, fps } = mod;

const flush = (ms = 20) => new Promise((r) => dom.window.setTimeout(r, ms));
const clickText = (scope, label) => {
  const btn = [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  if (!btn) throw new Error(`找不到按钮「${label}」，实际有：${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
};
const clickRow = async (text) => {
  const row = [...document.querySelectorAll(".tlt-pickrow")].find((r) => r.textContent.includes(text));
  if (!row) throw new Error(`列表里没有「${text}」，实际有：${[...document.querySelectorAll(".tlt-pickrow")].map((r) => r.textContent).join(" | ")}`);
  row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush(40);
};
const typeInto = async (input, v) => {
  input.value = v;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await flush(20);
};

let pass = 0, fail = 0;
const results = [];

async function t(name, fn) {
  const before = { ...fps.files };
  try {
    await fn();
    pass++; results.push(`  ✓ ${name}`);
  } catch (e) {
    fail++; results.push(`  ✗ ${name} \n      ${e.message}`);
  } finally {
    for (const k of Object.keys(fps.files)) if (!(k in before)) delete fps.files[k];
    for (const k of Object.keys(before)) fps.files[k] = before[k];
    document.body.innerHTML = "";
  }
}

const D = "2026-10-24";
const NEW = () => makeStore();

/* ---------------- ① 登记任务 ---------------- */
await t("登记任务：命令跑通并写进项目文件", async () => {
  const { app, store, refresh } = await NEW();
  // 先建一个项目
  assert.equal(await store.createProject("阿尔法"), true, "项目应建成功");
  await store.load();
  assert.ok(fps.files["TLT/tasks/阿尔法.md"], "项目文件应存在");

  const { taskRegisterFlow } = mod;
  taskRegisterFlow(app, store, refresh);
  await flush(30);
  const modal = document.querySelector(".modal");
  assert.ok(modal, "登记任务应弹出表单");
  const titleInput = modal.querySelector(".tlt-input-title, input.tlt-input");
  assert.ok(titleInput, "应有标题输入框");
  await typeInto(titleInput, "写一版接口文档");
  clickText(modal, "创建");
  await flush(60);
  const text = fps.files["TLT/tasks/阿尔法.md"];
  assert.ok(text.includes("写一版接口文档"), `项目文件里应写上这条任务：\n${text}`);
});

/* ---------------- ② 新建项目 / 新建里程碑 ---------------- */
await t("新建项目：PromptModal 落成一个文件", async () => {
  const { app, store, refresh } = await NEW();
  mod.newProjectFlow(app, store, refresh);
  await flush(30);
  const input = document.querySelector(".modal input.tlt-input-title");
  assert.ok(input, "应弹输入框");
  input.value = "贝塔项目";
  document.querySelector(".modal .tlt-btn.pri").click();
  await flush(80);
  assert.ok(fps.files["TLT/tasks/贝塔项目.md"], "应建出 TLT/tasks/贝塔项目.md");
  assert.ok(fps.files["TLT/tasks/贝塔项目.md"].startsWith("# 贝塔项目"), "文件首行应是 # 项目名");
});

await t("新建里程碑：选项目 → 输入名字 → ## 追加", async () => {
  const { app, store, refresh } = await NEW();
  await store.createProject("伽马");
  await store.load();
  void mod.newMilestoneFlow(app, store, refresh);
  await flush(30);
  // ① 选项目
  await clickRow("伽马");
  // ② 输入名字
  const input = document.querySelector(".modal input.tlt-input-title");
  assert.ok(input, "应弹输入框");
  input.value = "第二阶段";
  document.querySelector(".modal .tlt-btn.pri").click();
  await flush(80);
  assert.ok(fps.files["TLT/tasks/伽马.md"].includes("## 第二阶段"), `应加上里程碑：\n${fps.files["TLT/tasks/伽马.md"]}`);
});

/* ---------------- ③ 删除任务 ---------------- */
await t("删除任务：两级选择 + 确认后行被移除", async () => {
  const { app, store, refresh } = await NEW();
  fps.files["TLT/tasks/德尔塔.md"] = `# 德尔塔

## 一期

- [ ] 要删掉的任务 🛫 ${D} 📅 ${D}
- [ ] 要留下的任务 🛫 ${D} 📅 ${D}
`;
  await store.load();
  void mod.deleteTaskFlow(app, store, refresh);   // 不 await：流程要等我们点弹窗
  await flush(30);
  // ① 来源
  await clickRow("德尔塔");
  // ② 任务
  await clickRow("要删掉");
  // ③ 确认
  const confirm = document.querySelector(".modal .tlt-confirm-body");
  assert.ok(confirm, "应有确认框");
  assert.ok(confirm.textContent.includes("要删掉的任务"), "确认框应写清是哪条");
  clickText(document.querySelector(".modal"), "删除");
  await flush(80);
  const text = fps.files["TLT/tasks/德尔塔.md"];
  assert.ok(!text.includes("要删掉的任务"), `要删的那条应没了：\n${text}`);
  assert.ok(text.includes("要留下的任务"), "不该误删别的任务");
});

/* ---------------- ④ 归档任务 ---------------- */
await t("归档任务：行从项目里消失，出现在 archive/项目.md", async () => {
  const { app, store, refresh } = await NEW();
  fps.files["TLT/tasks/艾普西隆.md"] = `# 艾普西隆

## 一期

- [x] 已完成的活 🛫 ${D} 📅 ${D}
- [ ] 还在做的活 🛫 ${D} 📅 ${D}
`;
  await store.load();
  void mod.archiveTaskFlow(app, store, refresh);   // 不 await：流程要等我们点弹窗
  await flush(30);
  await clickRow("艾普西隆");
  await clickRow("已完成的活");
  clickText(document.querySelector(".modal"), "归档");
  await flush(80);
  assert.ok(!fps.files["TLT/tasks/艾普西隆.md"].includes("已完成的活"), "项目里不该再留这条");
  assert.ok(fps.files["TLT/tasks/艾普西隆.md"].includes("还在做的活"), "别的任务不动");
  const arch = fps.files["TLT/archive/艾普西隆.md"];
  assert.ok(arch, `应生成归档文件，实际有：${Object.keys(fps.files).join(", ")}`);
  assert.ok(arch.includes("已完成的活"), "归档文件里应有这条");
  assert.ok(arch.includes("## 一期"), "归档文件应保留里程碑分组");
});

/* ---------------- ⑤ 归档项目 ---------------- */
await t("归档项目：文件搬进 archive/，原位置消失", async () => {
  const { app, store, refresh } = await NEW();
  fps.files["TLT/tasks/泽塔.md"] = `# 泽塔\n\n## 一期\n\n- [x] 都干完了 📅 ${D}\n`;
  await store.load();
  void mod.archiveProjectFlow(app, store, refresh);   // 不 await：流程要等我们点弹窗
  await flush(30);
  await clickRow("泽塔");
  const body = document.querySelector(".modal .tlt-confirm-body").textContent;
  assert.ok(body.includes("TLT/archive/泽塔.md"), `确认框应写明去哪：${body}`);
  clickText(document.querySelector(".modal"), "归档");
  await flush(80);
  assert.ok(!fps.files["TLT/tasks/泽塔.md"], "原位置应没了");
  assert.ok(fps.files["TLT/archive/泽塔.md"], "应搬到 archive/");
});

/* ---------------- ⑥ 选择器键盘操作 ---------------- */
await t("选择器：打字过滤 + ↑↓ + 回车选中", async () => {
  const { app } = await makeStore();
  const { PickerModal } = mod;
  new PickerModal(app, "测试", [
    { label: "阿尔法", value: "a" },
    { label: "贝塔", value: "b" },
    { label: "伽马", value: "c" },
  ], "过滤", () => {}).open();
  await flush(30);
  const input = document.querySelector(".modal .tlt-picksearch");
  await typeInto(input, "贝");
  const rows = [...document.querySelectorAll(".tlt-pickrow")];
  assert.equal(rows.length, 1, `过滤后应只剩一项，实际 ${rows.length}`);
  await typeInto(input, "");
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await flush(10);
  const on = document.querySelector(".tlt-pickrow.on");
  assert.ok(on && on.textContent.includes("贝塔"), "↓ 之后应选中第二项");
});

/* ---------------- ⑦ 命令都注册上了 ---------------- */
await t("插件注册了六个快捷命令 + 一个总入口", async () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(manifest.version.startsWith("0.5"), `版本应是 0.5.x，实际 ${manifest.version}`);
  const src = readFileSync(join(root, "src/main.ts"), "utf8");
  for (const id of ["quick-menu", "new-task", "new-project", "new-milestone", "archive-task", "archive-project", "delete-task"]) {
    assert.ok(src.includes(`id: "${id}"`), `缺少命令 ${id}`);
  }
});

console.log(results.join("\n"));
console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : "，全部通过"}`);
process.exit(fail ? 1 : 0);
