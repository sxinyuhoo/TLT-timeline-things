#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 mvlab 的 tasks / teams 按 TLT 的数据格式转换一份，写进 TLT 数据目录。
源文件只读，绝不修改。

**一份源文件 = 一个项目。** 用户特意把同一项目的内容合并进一个文件，
所以绝不能按 `# 工作块` 拆成多个项目；块只用来给里程碑分组：

  - 单块文件（文件里只有一个 `# 工作块`）：
        `## <小节>`                        —— 直接用小节名
  - 多块文件：块名当成前缀来区分归属
        `## <块名> · <小节>`                —— 有小节时
        `## <块名>`                        —— 块里没有小节、任务挂在块下时

「成员与精力」小节不产里程碑，转成文件抬头的一行说明（每块一行），并作为该块任务的默认负责人。
字段写法：`🛫` 开始、`📅` 截止、`[pri:: 1-3]`、`[owner:: [[名字]]]`、`[tags:: 工作]`。

用法:
  python3 tools/import-mvlab.py <tasks目录> <teams目录> <目标TLT数据目录>
"""
import io
import os
import re
import sys

SRC_TASKS, SRC_TEAMS, DST = sys.argv[1], sys.argv[2], sys.argv[3]
REFRESH_CREW = "--refresh-crew" in sys.argv           # 默认不动已存在的人员档案

PRI = {"⏫": 3, "🔺": 3, "🔼": 2, "🔽": 1, "⏬": 1}
PRI_RE = re.compile(r"(⏫|🔺|🔼|🔽|⏬)")
DATE_RE = re.compile(r"(🛫|📅|➕)\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
RECUR_RE = re.compile(r"🔁[^➕📅✅]*")           # 🔁 every week … 🏁 delete
TASK_RE = re.compile(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$")
H1_RE = re.compile(r"^#\s+(.*)$")
H2_RE = re.compile(r"^##\s+(.*)$")
LINK_RE = re.compile(r"\[\[([^\[\]|]+?)(?:\|[^\[\]]*)?\]\]")
PEOPLE_SEC = "成员与精力"


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


def parse_people(lines):
    """成员与精力 → [(人名, 角色, 精力)]"""
    out = []
    for ln in lines:
        m = re.search(r"\[person::\s*\[\[([^\[\]]+)\]\]\]", ln) or \
            re.search(r"\[person::\s*([^\[\]\s][^\[\]]*)\]", ln)
        if not m:
            continue
        name = m.group(1).strip().strip("[")
        if not name:
            continue
        role = re.search(r"\[role::\s*([^\]]*)\]", ln)
        wl = re.search(r"\[workload::\s*([^\]]*)\]", ln)
        out.append((name, (role.group(1).strip() if role else ""), (wl.group(1).strip() if wl else "")))
    return out


def strip_frontmatter(text):
    lines = text.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return lines[i + 1:]
    return lines


def parse_chunk(name, chunk):
    """一段内容 → 一个块：{name, desc, sections: [[小节标题, 行]]}"""
    cur = {"name": name, "desc": "", "sections": []}
    for ln in chunk:
        if ln.strip().startswith("> [!abstract]"):
            continue
        if ln.strip().startswith(">") and not cur["desc"] and not cur["sections"]:
            cur["desc"] = ln.lstrip("> ").strip()      # 只认小节之前的那句「工作说明」
            continue
        h2 = H2_RE.match(ln)
        if h2:
            cur["sections"].append([re.sub(r"^[🌕🌗🌙🌑]\s*", "", h2.group(1).strip()), []])
            continue
        if cur["sections"]:
            cur["sections"][-1][1].append(ln)
        elif ln.strip():
            cur["sections"].append(["", [ln]])
    return cur


def parse_blocks(text, fallback_name):
    """一份文件 → [{name, desc, sections}]。

    `# ` 开头的算工作块；一个文件里有多个就是多个块（用户是刻意合并进一个文件的，
    所以块只用来给里程碑当前缀，项目仍是一份文件一个）。
    有的文件直接从 `##` 开始（没有 `# 工作块`），这时整份文件当成一个块，块名用文件名。
    """
    lines = strip_frontmatter(text)
    chunks = []                                  # [(块名, [行])]
    cur = None
    for ln in lines:
        h1 = None if ln.startswith("##") else H1_RE.match(ln)
        if h1:
            cur = (h1.group(1).strip(), [])
            chunks.append(cur)
            continue
        if cur is None:
            continue
        cur[1].append(ln)
    if not chunks:                               # 没有工作块：整份文件当一个块
        return [parse_chunk(fallback_name, lines)]
    return [parse_chunk(name, chunk) for name, chunk in chunks]


def section_notes(lines):
    """小节里（任务之前）的 `>` 说明行，原样留一份"""
    out = []
    for ln in lines:
        t = ln.strip()
        if t.startswith("-") or not t:
            if out:
                break
            continue
        if t.startswith(">"):
            out.append(t.lstrip("> ").strip())
        elif out:
            break
    return out


def milestone_label(block, section, multi):
    """多块文件用「块名 · 小节」标明归属；单块文件直接用小节名"""
    if not multi:
        return section
    return f"{block} · {section}" if section else block


def main():
    names = roster(SRC_TEAMS)
    os.makedirs(os.path.join(DST, "tasks"), exist_ok=True)
    os.makedirs(os.path.join(DST, "crew"), exist_ok=True)

    made = []
    total_tasks = 0
    for fname in sorted(os.listdir(SRC_TASKS)):
        if not fname.endswith(".md"):
            continue
        project = fname[:-3]
        text = io.open(os.path.join(SRC_TASKS, fname), encoding="utf-8").read()
        blocks = parse_blocks(text, project)
        if not blocks:
            print(f"  跳过 {project}（没有任何小节）")
            continue
        multi = len(blocks) > 1

        head = [f"# {project}", ""]
        meta = []                      # [(块, 默认负责人)]
        for b in blocks:
            people = []
            for title, lines in b["sections"]:
                if title == PEOPLE_SEC:
                    people = parse_people(lines)
            leads = [p for p, r, _ in people if r == "负责人"] or [p for p, _, _ in people]
            meta.append((b, leads))
            if b["desc"]:
                head.append(f"> {b['name']} — {b['desc']}" if multi else f"> {b['desc']}")
            if people:
                who = " · ".join(f"{n}({r or '参与'}{('/' + w + '%') if w else ''})" for n, r, w in people)
                head.append(f"> {b['name']} 成员：{who}" if multi else f"> 成员：{who}")
        head.append("")

        body_lines = list(head)
        n_tasks = 0
        for b, leads in meta:
            for title, lines in b["sections"]:
                if title == PEOPLE_SEC:
                    continue
                conv = [c for c in (convert_task(ln, leads, names) for ln in lines) if c]
                if not conv:
                    continue
                body_lines.append(f"## {milestone_label(b['name'], title, multi)}")
                body_lines.append("")
                for note in section_notes(lines):          # 小节开头的 > 说明
                    body_lines.append(f"> {note}")
                if section_notes(lines):
                    body_lines.append("")
                body_lines += conv
                body_lines.append("")
                n_tasks += len(conv)

        if n_tasks == 0:
            print(f"  跳过 {project}（没有任务）")
            continue
        io.open(os.path.join(DST, "tasks", f"{project}.md"), "w", encoding="utf-8").write(
            "\n".join(body_lines).rstrip() + "\n")
        made.append(project)
        total_tasks += n_tasks
        print(f"  写入 tasks/{project}.md（{n_tasks} 条任务 · {len(blocks)} 个工作块"
              + ("，块名已作为里程碑前缀" if multi else "") + "）")

    # teams → crew（已存在的不动：人员档案可能在 TLT 里被手工调过产能/岗位）
    n_crew = 0
    n_kept = 0
    for fname in sorted(os.listdir(SRC_TEAMS)):
        if not fname.endswith(".md"):
            continue
        name = fname[:-3]
        target = os.path.join(DST, "crew", f"{name}.md")
        if os.path.exists(target) and not REFRESH_CREW:
            n_kept += 1
            continue
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
        # 正文保留能看的信息（跳过 dataviewjs 代码块）
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
        io.open(target, "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")
        n_crew += 1

    print(f"\n共 {len(made)} 个项目 / {total_tasks} 条任务 / 人员档案：新写 {n_crew}、保留 {n_kept}"
          + ("（要重写用 --refresh-crew）" if n_kept else "") + f" → {DST}")
    print("项目文件：" + "、".join(made))


if __name__ == "__main__":
    main()
