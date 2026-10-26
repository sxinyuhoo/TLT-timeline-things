#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一份「想法清单」md 同步进 TLT 的想法池（`<TLT>/ideas.md`）。
源文件只读，绝不修改。

源文件约定（就是 NewBrain `00-首页/idea.md` 的写法）：
  ## 1. paper            ← `##` 是分类，去掉「1. 」这类编号后作为 type
  - 一句话想法            ← 一级项目符号 = 一条想法（标题）
      - 细节 / 补充       ← 缩进的子项 = 这条想法的正文（写进 > 引用块）

输出格式（TLT 认的字段写法）：
  - 标题 [type:: paper] [star:: 1] [at:: 2026-10-25]
    > 正文第一行
    > 正文第二行

幂等：按「标题」查重，已经有的不重复追加；重跑只补新的。

用法:
  python3 tools/import-ideas.py <源md> <目标ideas.md> [--dry]
"""
import io
import os
import re
import sys
import datetime

SRC = sys.argv[1]
DST = sys.argv[2]
DRY = "--dry" in sys.argv

H2_RE = re.compile(r"^##\s+(.*)$")
BULLET_RE = re.compile(r"^(\s*)[-*+]\s+(.*)$")


def clean(text):
    """去掉行内的 TLT 字段写法，避免和转换出来的字段打架"""
    return re.sub(r"\[[a-zA-Z]+::[^\]]*\]", "", text).strip()


def parse_source(text):
    """→ [(分类, 标题, [正文行])]"""
    out = []
    section = ""
    cur = None
    for raw in text.split("\n"):
        line = raw.rstrip("\n")
        h2 = H2_RE.match(line)
        if h2:
            section = re.sub(r"^\d+[.、]\s*", "", h2.group(1).strip())
            cur = None
            continue
        b = BULLET_RE.match(line)
        if b:
            indent, body = b.group(1), b.group(2).strip()
            if not body:
                continue
            if indent == "":                       # 一级：新想法
                cur = {"type": section, "title": clean(body), "body": []}
                out.append(cur)
            elif cur:                              # 缩进：正文
                cur["body"].append(clean(body))
            continue
        if cur is not None and line.strip() and not line.startswith("#"):
            cur["body"].append(clean(line))        # 接着上一行的普通文字也算正文
    return [x for x in out if x["title"]]


def render(items, today):
    lines = []
    for it in items:
        head = f"- {it['title']}"
        if it["type"]:
            head += f" [type:: {it['type']}]"
        head += f" [star:: 1] [at:: {today}]"
        lines.append(head)
        for b in it["body"]:
            if b:
                lines.append(f"  > {b}")
    return lines


def main():
    src = io.open(SRC, encoding="utf-8").read()
    items = parse_source(src)
    today = datetime.date.today().isoformat()

    existing_titles = set()
    old_lines = []
    if os.path.exists(DST):
        old_lines = io.open(DST, encoding="utf-8").read().split("\n")
        for ln in old_lines:
            m = re.match(r"^\s*[-*+]\s+(.+)$", ln)
            if m:
                existing_titles.add(re.sub(r"\[[a-zA-Z]+::[^\]]*\]", "", m.group(1)).strip())

    new_items = [it for it in items if it["title"] not in existing_titles]
    print(f"源里 {len(items)} 条想法 · 目标已有 {len(existing_titles)} 条 · 新增 {len(new_items)} 条")
    if not new_items:
        return
    if DRY:
        for ln in render(new_items, today):
            print(ln)
        return

    os.makedirs(os.path.dirname(DST) or ".", exist_ok=True)
    body = "\n".join(render(new_items, today))
    if old_lines:
        while old_lines and old_lines[-1].strip() == "":
            old_lines.pop()
        head = "\n".join(old_lines)
        text = f"{head}\n{body}\n"
    else:
        text = f"# 想法池\n\n{body}\n"
    io.open(DST, "w", encoding="utf-8").write(text)
    print(f"写入 {DST}（+{len(new_items)} 条，共 {len(existing_titles) + len(new_items)} 条）")
    for it in new_items:
        print(f"  · [{it['type'] or '未分类'}] {it['title']}")


if __name__ == "__main__":
    main()
