#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 mvlab 的 tasks / teams 按 TLT 的数据格式转换一份，写进 TLT 数据目录。
源文件只读，绝不修改。

tasks 的一个文件里可能有多个 `# 工作块`，每个块输出成一个 TLT 任务文件
（TLT 里「一个文件 = 一个项目」，`##` 小节 = 里程碑）。

用法:
  python3 tools/import-mvlab.py <tasks目录> <teams目录> <目标TLT数据目录>
"""
import io
import os
import re
import sys

SRC_TASKS, SRC_TEAMS, DST = sys.argv[1], sys.argv[2], sys.argv[3]

PRI = {"⏫": 3, "🔺": 3, "🔼": 2, "🔽": 1, "⏬": 1}
PRI_RE = re.compile(r"(⏫|🔺|🔼|🔽|⏬)")
DATE_RE = re.compile(r"(🛫|📅|➕)\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
RECUR_RE = re.compile(r"🔁[^➕📅✅]*")           # 🔁 every week … 🏁 delete
TASK_RE = re.compile(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$")
H1_RE = re.compile(r"^#\s+(.*)$")
H2_RE = re.compile(r"^##\s+(.*)$")
LINK_RE = re.compile(r"\[\[([^\[\]|]+?)(?:\|[^\[\]]*)?\]\]")


def roster(teams_dir):
    names = []
    for f in os.listdir(teams_dir):
        if f.endswith(".md"):
            names.append(f[:-3])
    return sorted(names, key=len, reverse=True)          # 长名字优先，避免「刘爽」被「刘」抢先


def split_people(text, names):
    """从标题里摘出人名（[[X]] 或（A、B）这种），返回 (干净标题, [人名])"""
    found = []
    for m in LINK_RE.finditer(text):
        if m.group(1) in names:
            found.append(m.group(1))
    text = LINK_RE.sub(lambda m: "" if m.group(1) in names else m.group(0), text)

    def paren(m):
        inner = m.group(1).strip()
        if not inner:
            return " "                                   # 链接被摘掉后剩下的空括号
        parts = [p.strip() for p in re.split(r"[、,，/]", inner) if p.strip()]
        if parts and all(p in names for p in parts):
            found.extend(parts)
            return " "
        return m.group(0)

    text = re.sub(r"（([^（）]*)）", paren, text)
    text = re.sub(r"（\s*[、,，/]*\s*）", " ", text)          # 兜底：彻底空的括号
    # 去重保序
    uniq = []
    for n in found:
        if n not in uniq:
            uniq.append(n)
    return text, uniq


def convert_task(line, default_owners, names):
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
    body = DATE_RE.sub("", body)
    body = DONE_RE.sub("", body)
    body = RECUR_RE.sub("", body)
    body = re.sub(r"#task\b", "", body).replace("#工作", "").replace("#个人", "")

    pri = 1
    for e in PRI_RE.findall(body):
        pri = PRI[e]
        break
    body = PRI_RE.sub("", body)

    body, people = split_people(body, names)
    title = re.sub(r"\s{2,}", " ", body).strip(" -—·")
    if not title:
        return None
    owners = people or default_owners

    parts = [f"- [{'x' if done else ' '}] {title}"]
    if start:
        parts.append(f"🛫 {start}")
    if due:
        parts.append(f"📅 {due}")
    parts.append(f"[pri:: {pri}]")
    if owners:
        parts.append("[owner:: " + ", ".join(f"[[{p}]]" for p in owners) + "]")
    parts.append("[tags:: 工作]")
    return " ".join(parts)


def parse_person_lines(lines):
    """成员与精力 → [(人名, 角色, 精力)]"""
    out = []
    for ln in lines:
        m = re.search(r"\[person::\s*\[\[([^\[\]]+)\]\]\]", ln) or re.search(r"\[person::\s*([^\[\]\s]+)\]", ln)
        if not m:
            continue
        role = re.search(r"\[role::\s*([^\]]*)\]", ln)
        wl = re.search(r"\[workload::\s*([^\]]*)\]", ln)
        out.append((m.group(1).strip(), (role.group(1).strip() if role else ""), (wl.group(1).strip() if wl else "")))
    return out


def main():
    names = roster(SRC_TEAMS)
    os.makedirs(os.path.join(DST, "tasks"), exist_ok=True)
    os.makedirs(os.path.join(DST, "crew"), exist_ok=True)

    total_blocks = 0
    total_tasks = 0
    for fname in sorted(os.listdir(SRC_TASKS)):
        if not fname.endswith(".md"):
            continue
        text = io.open(os.path.join(SRC_TASKS, fname), encoding="utf-8").read()
        # 按 `# ` 工作块切分（第一个 H1 之前的内容丢弃：只有 frontmatter）
        blocks = []
        cur = None
        for ln in text.split("\n"):
            h1 = H1_RE.match(ln)
            if h1 and not ln.startswith("##"):
                cur = {"name": h1.group(1).strip(), "desc": "", "members": [], "ms": []}
                blocks.append(cur)
                continue
            if cur is None:
                continue
            if ln.strip().startswith("> [!abstract]"):
                continue
            if ln.strip().startswith(">") and not cur["desc"] and not cur["members"]:
                cur["desc"] = ln.lstrip("> ").strip()
                continue
            h2 = H2_RE.match(ln)
            if h2:
                title = re.sub(r"^[🌕🌗🌙🌑]\s*", "", h2.group(1).strip())
                if title.replace(" ", "") == "成员与精力":
                    cur["ms"].append(("__people__", []))
                else:
                    cur["ms"].append((title, []))
                continue
            if not cur["ms"]:
                cur["ms"].append(("", []))
            cur["ms"][-1][1].append(ln)

        for b in blocks:
            # 成员与精力 → 默认负责人 + 一行备注
            lines_by_ms = {t: ls for t, ls in b["ms"]}
            members = parse_person_lines(lines_by_ms.get("__people__", []))
            leads = [m[0] for m in members if m[1] == "负责人"] or [m[0] for m in members]
            body = [f"# {b['name']}", ""]
            if b["desc"]:
                body += [f"> {b['desc']}", ""]
            if members:
                body += ["> 成员：" + " · ".join(f"{n}({r or '参与'}{('/' + w + '%') if w else ''})" for n, r, w in members), ""]
            n_tasks = 0
            for title, lines in b["ms"]:
                if title == "__people__":
                    continue
                conv = [convert_task(ln, leads, names) for ln in lines]
                conv = [c for c in conv if c]
                if not conv:
                    continue
                body.append(f"## {title}")
                body.append("")
                body += conv
                body.append("")
                n_tasks += len(conv)
            if n_tasks == 0:
                print(f"  跳过 {b['name']}（没有任务）")
                continue
            target = os.path.join(DST, "tasks", f"{b['name']}.md")
            io.open(target, "w", encoding="utf-8").write("\n".join(body).rstrip() + "\n")
            total_blocks += 1
            total_tasks += n_tasks
            print(f"  写入 tasks/{b['name']}.md（{n_tasks} 条任务，{len(b['ms'])} 个小节）")

    # teams → crew
    n_crew = 0
    for fname in sorted(os.listdir(SRC_TEAMS)):
        if not fname.endswith(".md"):
            continue
        name = fname[:-3]
        text = io.open(os.path.join(SRC_TEAMS, fname), encoding="utf-8").read()
        fm = {}
        m = re.match(r"^---\n(.*?)\n---", text, re.S)
        if m:
            for ln in m.group(1).split("\n"):
                if ":" in ln:
                    k, v = ln.split(":", 1)
                    fm[k.strip()] = v.strip()
        role = fm.get("岗位", "") or "成员"
        skills = [s for s in re.split(r"[、,，/]", fm.get("核心能力", "")) if s]
        status = "active" if fm.get("状态", "在职") == "在职" else "left"
        out = [
            "---",
            "tlt: staff",
            f"role: {role}",
            "capacity: 100",
            "days: 5",
            f"skills: [{', '.join(skills)}]",
            f"status: {status}",
            "---",
            "",
        ]
        # 正文保留能看的信息（跳过 dataviewjs）
        keep = []
        skip = False
        in_fm = False
        for i, ln in enumerate(text.split("\n")):
            if i == 0 and ln.strip() == "---":
                in_fm = True
                continue
            if in_fm:
                if ln.strip() == "---":
                    in_fm = False
                continue
            if ln.strip().startswith("```"):
                skip = not skip
                continue
            if skip or ln.startswith("# ") or ln.startswith("## 当前任务"):
                continue
            keep.append(ln)
        body = "\n".join(keep).strip()
        if body:
            out += [body, ""]
        io.open(os.path.join(DST, "crew", f"{name}.md"), "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")
        n_crew += 1

    print(f"\n共 {total_blocks} 个项目 / {total_tasks} 条任务 / {n_crew} 位成员 → {DST}")


if __name__ == "__main__":
    main()
