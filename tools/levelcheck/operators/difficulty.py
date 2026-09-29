"""难度曲线算子 — 章内单调(容差 0.15)、章间递进(容差 -0.1)(纯函数)。

依 manuals/genres/match-3.md §2 字段表的难度约束。
分批生成时部分章节缺失属正常(量产节奏),这里只对已有数据查曲线并报章节计数;
"凑满 4×10"是验收期检查(品类手册 §4 及格线),不在此卡。
"""
from __future__ import annotations

CHAPTER_TOLERANCE = 0.15
CROSS_CHAPTER_TOLERANCE = 0.1


def check_curve(levels: list[dict]) -> list[dict]:
    issues: list[dict] = []

    def issue(message: str) -> None:
        issues.append({"check": "curve", "ref": "ALL", "message": message})

    def intended_of(level: dict):
        diff = level.get("difficulty")
        v = diff.get("intended") if isinstance(diff, dict) else None
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    valid = [l for l in levels if intended_of(l) is not None]
    if len(valid) != len(levels):
        issue(f"{len(levels) - len(valid)} 关缺 difficulty.intended,曲线检查跳过它们(结构检查会报)")
    ordered = sorted(valid, key=lambda l: (l.get("chapter", 0), l.get("index", 0)))
    by_chapter: dict[int, list[dict]] = {}
    for l in ordered:
        by_chapter.setdefault(l["chapter"], []).append(l)

    for ch in sorted(by_chapter):
        items = by_chapter[ch]
        for prev, cur in zip(items, items[1:]):
            a, b = intended_of(prev), intended_of(cur)
            if b < a - CHAPTER_TOLERANCE:
                issue(f"章 {ch} 内难度回落:{prev['id']}({a})→ {cur['id']}({b}),容差 {CHAPTER_TOLERANCE}")

    chapters = sorted(by_chapter)
    for prev_ch, cur_ch in zip(chapters, chapters[1:]):
        a = intended_of(by_chapter[prev_ch][-1])
        b = intended_of(by_chapter[cur_ch][0])
        if b < a - CROSS_CHAPTER_TOLERANCE:
            issue(f"章间难度骤降:章 {prev_ch} 末关({a})→ 章 {cur_ch} 首关({b})")
    return issues


def chapter_counts(levels: list[dict]) -> dict:
    counts: dict = {}
    for l in levels:
        counts[l.get("chapter")] = counts.get(l.get("chapter"), 0) + 1
    return counts
