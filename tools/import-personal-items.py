#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 NewBrain 的「个人事项」按 TLT 的数据格式转换一份，写进 TLT 数据目录。
源文件只读，绝不修改。

用法:
  python3 tools/import-personal-items.py <源目录> <目标TLT数据目录>
"""
import io
import os
import re
import sys

SRC = sys.argv[1]
DST = sys.argv[2]

PRI = {"⏫": 3, "🔺": 3, "🔼": 2, "🔽": 1, "⏬": 1}
DATE_RE = re.compile(r"(🛫|📅|➕)\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
PRI_RE = re.compile(r"(⏫|🔺|🔼|🔽|⏬)")
TASK_RE = re.compile(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$")
H2_RE = re.compile(r"^##\s+(.*)$")


def parse_source(text):
    """返回 (说明, 成员, [(里程碑, [任务行...])])"""
    lines = text.split("\n")
    desc = ""
    people = []
    groups = []          # [(milestone, [lines])]
    cur = None
    in_people = False
    for ln in lines:
        if ln.startswith("# "):
            continue
        h2 = H2_RE.match(ln)
        if h2:
            title = h2.group(1).strip().lstrip("🌗 ").strip()
            in_people = title.replace(" ", "") == "成员与精力"
            cur = (title, [])
            if not in_people:
                groups.append(cur)
            continue
        if ln.startswith(">"):
            body = ln.lstrip("> ").strip()
            if body and "工作说明" not in body and not desc:
                desc = body
            continue
        if in_people:
            # 只认非空的人名：`[[名字]]` 或 `名字`；`[[]]` 这种空链接要跳过
            m = re.search(r"\[person::\s*\[\[([^\[\]]+)\]\]", ln) or \
                re.search(r"\[person::\s*([^\[\]\s][^\[\]]*)\]", ln)
            if m:
                name = m.group(1).strip().strip("[")
                role = re.search(r"\[role::\s*([^\]]*)\]", ln)
                people.append((name, role.group(1).strip() if role else "负责人"))
            continue
        if cur is not None:
            cur[1].append(ln)
    return desc, people, groups


def convert_task(line, owner, tags):
    t = TASK_RE.match(line)
    if not t:
        return None
    done = t.group(1).lower() == "x"
    body = t.group(2)
    due = ""
    start = ""
    for emoji, date in DATE_RE.findall(body):
        if emoji == "📅":
            due = date
        elif emoji == "🛫":
            start = date
    for _ in DONE_RE.findall(body):
        pass
    # 清掉 Tasks 插件专属标记与标签：🛫/📅（后面按 TLT 的写法重排）、➕ 创建日期、✅ 完成日期、#task、#个人
    body = DATE_RE.sub("", body)
    body = DONE_RE.sub("", body)
    body = re.sub(r"#task\b", "", body)
    body = re.sub(r"#个人\b", "", body)
    pri = 1
    for e in PRI_RE.findall(body):
        pri = PRI[e]
        break
    body = PRI_RE.sub("", body)
    title = re.sub(r"\s{2,}", " ", body).strip()
    if not title:
        return None
    parts = [f"- [{'x' if done else ' '}] {title}"]
    if start:
        parts.append(f"🛫 {start}")
    if due:
        parts.append(f"📅 {due}")
    parts.append(f"[pri:: {pri}]")
    parts.append(f"[owner:: [[{owner}]]]")
    if tags:
        parts.append(f"[tags:: {', '.join(tags)}]")
    return " ".join(parts)


def main():
    os.makedirs(os.path.join(DST, "tasks"), exist_ok=True)
    os.makedirs(os.path.join(DST, "crew"), exist_ok=True)
    made_tasks = []
    made_crew = {}
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(SRC, name)
        text = io.open(path, encoding="utf-8").read()
        desc, people, groups = parse_source(text)
        project = name[:-3]
        owner = people[0][0] if people else "我"
        for p, role in people:
            made_crew.setdefault(p, role)
        out = [f"# {project}", ""]
        if desc:
            out += [f"> {desc}", ""]
        task_count = 0
        for ms, lines in groups:
            body = [convert_task(ln, owner, ["个人"]) for ln in lines]
            body = [b for b in body if b]
            if not body:
                continue
            out.append(f"## {ms}")
            out.append("")
            out += body
            out.append("")
            task_count += len(body)
        if task_count == 0:
            print(f"  跳过 {project}（没有任务）")
            continue
        target = os.path.join(DST, "tasks", f"{project}.md")
        io.open(target, "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")
        made_tasks.append((project, task_count))
        print(f"  写入 tasks/{project}.md（{task_count} 条任务，负责人 {owner}）")

    for p, role in made_crew.items():
        target = os.path.join(DST, "crew", f"{p}.md")
        if os.path.exists(target):
            continue
        io.open(target, "w", encoding="utf-8").write(
            f"---\ntlt: staff\nrole: {role}\ncapacity: 100\ndays: 5\nskills: [个人事项]\nstatus: active\n---\n"
        )
        print(f"  写入 crew/{p}.md（{role}）")
    if "我" not in made_crew:
        target = os.path.join(DST, "crew", "我.md")
        if not os.path.exists(target):
            io.open(target, "w", encoding="utf-8").write(
                "---\ntlt: staff\nrole: 负责人\ncapacity: 100\ndays: 5\nskills: [个人事项]\nstatus: active\n---\n"
            )
            print("  写入 crew/我.md（负责人）")
    print(f"\n共 {len(made_tasks)} 个项目 → {DST}/tasks")


if __name__ == "__main__":
    main()
