#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把日记里的 Tasks 插件查询块（```tasks）换成 TLT 自己的日记块（```tlt-daily）。

支持两种历史写法：
  ① `> [!todo]+ 今日完成情况` + 两块查询（not done / done <date>）
     → 保留 callout 标题，两块合并成一个 tlt-daily 块，删掉「今日待做 / 今日已完成」两行小标题
  ② `> [!summary]- 点击展开` + 一块查询（happens <date>）
     → 原地换成 tlt-daily 块

日期基准不用写：tlt-daily 默认按文件名日期算（和日记模板原来的约定一致）。

用法:
  python3 tools/migrate-diary-queries.py <diary根目录> [--dry] [--backup <备份目录>]
"""
import io
import os
import re
import shutil
import sys

ROOT = sys.argv[1]
DRY = "--dry" in sys.argv
BACKUP = None
if "--backup" in sys.argv:
    BACKUP = sys.argv[sys.argv.index("--backup") + 1]

START_RE = re.compile(r"^(?:>\s*)+```tasks\s*$")   # 允许 `> > ``` 这种嵌套引用
START_PLAIN_RE = re.compile(r"^```tasks\s*$")
END_RE = re.compile(r"^(?:>\s*)*```\s*$")
END_PLAIN_RE = re.compile(r"^```\s*$")
LABEL_RE = re.compile(r"^>\s*\*\*(今日待做|今日已完成)\*\*\s*$")

BLOCK = ["> ```tlt-daily", "> date: auto", "> ```"]


def collapse(out):
    """同一个 callout 里如果连着两个 tlt-daily 块（历史遗留），只留第一个"""
    res = []
    i = 0
    seen_at = -10
    while i < len(out):
        is_open = out[i].strip() in ("> ```tlt-daily", "```tlt-daily")
        if is_open:
            j = i + 1
            while j < len(out) and not out[j].strip().endswith("```"):
                j += 1
            block = out[i:j + 1]
            # 看这个块与上一个块之间是不是只有空行 / 空引用行
            between = out[seen_at + 1:i] if seen_at >= 0 else None
            if between is not None and all(x.strip() in ("", ">") for x in between):
                i = j + 1
                continue
            res.extend(block)
            seen_at = len(res) - 1
            i = j + 1
            continue
        res.append(out[i])
        i += 1
    return res


def convert(lines):
    """→ (新行列表, 改动数)"""
    out = []
    i = 0
    replaced = 0
    changed = 0
    while i < len(lines):
        ln = lines[i]
        if START_RE.match(ln) or START_PLAIN_RE.match(ln):
            prefixed = bool(START_RE.match(ln))
            i += 1
            while i < len(lines) and not (END_RE.match(lines[i]) or END_PLAIN_RE.match(lines[i])):
                i += 1
            i += 1                                   # 跳过结束的 ```
            changed += 1
            if replaced == 0:                        # 第一块换成 tlt-daily
                out.extend(BLOCK if prefixed else [b[2:] for b in BLOCK])
                replaced += 1
            continue
        if LABEL_RE.match(ln):
            changed += 1
            i += 1
            continue
        out.append(ln)
        i += 1
    return collapse(out), changed


def main():
    targets = []
    for dirpath, _dirs, files in os.walk(ROOT):
        for f in files:
            if f.endswith(".md"):
                targets.append(os.path.join(dirpath, f))
    targets.sort()

    hit, miss, total_blocks = [], [], 0
    for path in targets:
        text = io.open(path, encoding="utf-8").read()
        lines = text.split("\n")
        if "```tasks" in text:
            new, changed = convert(lines)
        else:
            new, changed = collapse(lines), 0          # 只做去重（历史遗留的重复块）
        if changed == 0 and new == lines:
            continue
        total_blocks += changed
        hit.append(path)
        if not DRY:
            if BACKUP:
                rel = os.path.relpath(path, ROOT)
                bp = os.path.join(BACKUP, rel)
                os.makedirs(os.path.dirname(bp), exist_ok=True)
                shutil.copy2(path, bp)
            io.open(path, "w", encoding="utf-8").write("\n".join(new))

    print(f"{'（dry-run）' if DRY else ''}改了 {len(hit)} 篇日记，替掉 {total_blocks} 处查询块")
    if miss:
        print("没匹配到、原样保留的：")
        for m in miss:
            print("  ", os.path.relpath(m, ROOT))
    if BACKUP and not DRY:
        print(f"原文备份在：{BACKUP}")


if __name__ == "__main__":
    main()
