"""结构校验算子 — 按 manuals/genres/match-3.md §2 字段表逐字段检查(纯函数)。

输入已解析的关卡 dict,输出问题列表 [{check, ref, message}];无问题返回 []。
资产引用 / 可解性 / 难度曲线分别在 references.py / solvable.py / difficulty.py。
"""
from __future__ import annotations

import re

CHAPTERS = (1, 4)  # 001 基线:4 章(品类手册 §4)
INDEX_PER_CHAPTER = 10
BOARD_LIMITS = (6, 9)
MOVES_LIMITS = (10, 40)
GEM_TYPES_LIMITS = (4, 6)
MECHANICS = ("striped", "bomb", "rainbow")
BLOCKER_TYPES = ("ice", "stone")
OBJECTIVE_TYPES = ("collect", "score")
INTENDED_FLOOR = 0.1
DEADLOCK_RATE_LIMIT = 0.15


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_structure(level: dict, prefix: str = "g001") -> list[dict]:
    issues: list[dict] = []
    lid = level.get("id") if isinstance(level.get("id"), str) else "?"
    ref = lid

    def issue(message: str) -> None:
        issues.append({"check": "structure", "ref": ref, "message": message})

    if not isinstance(lid, str) or not re.fullmatch(rf"{re.escape(prefix)}-level-\d{{3}}", lid):
        issue(f"id 非法:{level.get('id')!r}(应为 {prefix}-level-NNN)")

    if not _is_int(level.get("chapter")) or not CHAPTERS[0] <= level["chapter"] <= CHAPTERS[1]:
        issue(f"chapter 非法:{level.get('chapter')!r}(应 {CHAPTERS[0]}..{CHAPTERS[1]})")
    if not _is_int(level.get("index")) or not 1 <= level["index"] <= INDEX_PER_CHAPTER:
        issue(f"index 非法:{level.get('index')!r}(应 1..{INDEX_PER_CHAPTER})")

    board = level.get("board")
    cols = board.get("cols") if isinstance(board, dict) else None
    rows = board.get("rows") if isinstance(board, dict) else None
    board_ok = (
        _is_int(cols) and _is_int(rows)
        and BOARD_LIMITS[0] <= cols <= BOARD_LIMITS[1]
        and BOARD_LIMITS[0] <= rows <= BOARD_LIMITS[1]
    )
    if not board_ok:
        issue(f"board 非法:cols/rows={cols!r}/{rows!r}(应 {BOARD_LIMITS[0]}..{BOARD_LIMITS[1]})")

    gems = level.get("gemTypes")
    gems_ok = (
        isinstance(gems, list)
        and GEM_TYPES_LIMITS[0] <= len(gems) <= GEM_TYPES_LIMITS[1]
        and all(isinstance(g, str) and re.fullmatch(r"gem-\S+", g) for g in gems)
        and len(set(gems)) == len(gems)
    )
    if not gems_ok:
        issue(f"gemTypes 非法:{gems!r}({GEM_TYPES_LIMITS[0]}..{GEM_TYPES_LIMITS[1]} 个不重复的 gem-*)")
    gem_set = set(gems) if gems_ok else set()

    start = level.get("start")
    if isinstance(start, str):
        if start != "random":
            issue(f"start 非法:{start!r}(只允许 \"random\" 或显式矩阵)")
    elif isinstance(start, list) and board_ok:
        if len(start) != rows or any(not isinstance(r, list) or len(r) != cols for r in start):
            issue("start 矩阵尺寸与 board 不一致")
        else:
            bad = [
                (r, c, v)
                for r, row in enumerate(start)
                for c, v in enumerate(row)
                if not _is_int(v) or not 0 <= v <= len(gems or [])
            ]
            if bad:
                issue(f"start 矩阵含非法值(0..{len(gems or [])}):如 {bad[:3]}")
    else:
        issue(f"start 非法:{start!r}(只允许 \"random\" 或显式矩阵)")

    rules = level.get("rules")
    moves = rules.get("moves") if isinstance(rules, dict) else None
    if not _is_int(moves) or not MOVES_LIMITS[0] <= moves <= MOVES_LIMITS[1]:
        issue(f"rules.moves 非法:{moves!r}(应 {MOVES_LIMITS[0]}..{MOVES_LIMITS[1]})")

    objective = rules.get("objective") if isinstance(rules, dict) else None
    otype = objective.get("type") if isinstance(objective, dict) else None
    if otype not in OBJECTIVE_TYPES:
        issue(f"objective.type 非法:{otype!r}({'/'.join(OBJECTIVE_TYPES)})")
    targets = objective.get("targets") if isinstance(objective, dict) else None
    if otype == "collect":
        if not isinstance(targets, list) or not 1 <= len(targets) <= 3:
            issue(f"collect 目标 targets 非法:{targets!r}(1..3 项)")
        else:
            for t in targets:
                if (
                    not isinstance(t, dict)
                    or not isinstance(t.get("id"), str)
                    or not t.get("id")
                    or not _is_int(t.get("count"))
                    or t["count"] < 1
                ):
                    issue(f"collect 目标项非法:{t!r}(需 id:str / count:int>=1)")
                elif t["id"] not in gem_set:
                    issue(f"collect 目标 {t['id']} 不在 gemTypes 里(障碍产出件 v1 暂不支持作目标)")
    elif otype == "score" and targets:
        issue("score 目标不应携带 targets(星档走 meta.starThresholds)")

    blockers = level.get("blockers", [])
    if not isinstance(blockers, list):
        issue(f"blockers 非法:{blockers!r}(应为数组)")
        blockers = []
    seen_cells: set[tuple] = set()
    for b in blockers:
        if not isinstance(b, dict) or b.get("type") not in BLOCKER_TYPES:
            issue(f"障碍项非法:{b!r}(type {'/'.join(BLOCKER_TYPES)})")
            continue
        cell = b.get("cell")
        if (
            not isinstance(cell, list) or len(cell) != 2 or not all(_is_int(v) for v in cell)
            or not board_ok or not (0 <= cell[0] < rows and 0 <= cell[1] < cols)
        ):
            issue(f"障碍 cell 越界或非法:{b!r}")
        elif tuple(cell) in seen_cells:
            issue(f"障碍 cell 重复:{cell}")
        else:
            seen_cells.add(tuple(cell))
        if b.get("type") == "ice" and (not _is_int(b.get("hp")) or b["hp"] < 1):
            issue(f"ice 障碍需要 hp>=1:{b!r}")

    mechanics = level.get("mechanics", [])
    if (
        not isinstance(mechanics, list)
        or any(m not in MECHANICS for m in mechanics)
        or len(set(mechanics)) != len(mechanics)
    ):
        issue(f"mechanics 非法:{mechanics!r}(允许不重复子集:{','.join(MECHANICS)})")

    diff = level.get("difficulty")
    intended = diff.get("intended") if isinstance(diff, dict) else None
    if not _is_num(intended) or intended < INTENDED_FLOOR:
        issue(f"difficulty.intended 非法:{intended!r}(>= {INTENDED_FLOOR})")
    drate = diff.get("params", {}).get("deadlockRate") if isinstance(diff, dict) else None
    if not _is_num(drate) or not 0 <= drate <= DEADLOCK_RATE_LIMIT:
        issue(f"deadlockRate 非法:{drate!r}(0..{DEADLOCK_RATE_LIMIT})")

    meta = level.get("meta")
    if not isinstance(meta, dict):
        issue(f"meta 缺失或非法:{meta!r}")
    else:
        stars = meta.get("starThresholds")
        if (
            not isinstance(stars, list) or len(stars) != 3
            or not all(_is_int(v) for v in stars) or not stars[0] < stars[1] < stars[2]
        ):
            issue(f"starThresholds 非法:{stars!r}(3 个严格递增整数)")
        for key in ("genSource", "genDate"):
            if not isinstance(meta.get(key), str) or not meta[key]:
                issue(f"meta.{key} 缺失(生成溯源必填)")

    return issues
