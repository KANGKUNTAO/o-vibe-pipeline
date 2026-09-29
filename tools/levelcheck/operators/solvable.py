"""可解性算子 — 匹配检测 / 非死局 / 有界求解器(三消,纯函数)。

依 manuals/genres/match-3.md §2「可解性算法定义」实现。
棋盘表示:list[list[int]];0=空,1..N=gemTypes 序号;行 0 在上,宝石向下落。

诚实语义(管线红线:绝不把"没算完"当"不可解"):
- 求解器有节点预算;预算耗尽 → status="unverified"(运行层映射为 warn,交人工复核);
- 只有搜索完整结束才允许断言 "solved" / "unsolvable";
- 显式布局中的 0(空格)在分析前用确定性 refill 补齐(与级联补充同策略)。
"""
from __future__ import annotations

import random


class _BudgetExceeded(Exception):
    pass


def find_matches(board: list[list[int]]) -> set[tuple[int, int]]:
    """所有 ≥3 连(横/纵)的格子集合;0(空)不参与匹配。"""
    rows = len(board)
    cols = len(board[0]) if rows else 0
    matched: set[tuple[int, int]] = set()
    for r in range(rows):
        c = 0
        while c < cols - 2:
            v = board[r][c]
            if v and board[r][c + 1] == v and board[r][c + 2] == v:
                e = c + 3
                while e < cols and board[r][e] == v:
                    e += 1
                matched.update((r, cc) for cc in range(c, e))
                c = e
            else:
                c += 1
    for c in range(cols):
        r = 0
        while r < rows - 2:
            v = board[r][c]
            if v and board[r + 1][c] == v and board[r + 2][c] == v:
                e = r + 3
                while e < rows and board[e][c] == v:
                    e += 1
                matched.update((rr, c) for rr in range(r, e))
                r = e
            else:
                r += 1
    return matched


def fill_empty(board: list[list[int]], gem_count: int, rng: random.Random) -> list[list[int]]:
    """拷贝并把 0(空格)确定性补齐。"""
    b = [row[:] for row in board]
    for r in range(len(b)):
        for c in range(len(b[0])):
            if b[r][c] == 0:
                b[r][c] = rng.randint(1, gem_count)
    return b


def _gravity_refill(board: list[list[int]], gem_count: int, rng: random.Random) -> None:
    rows, cols = len(board), len(board[0])
    for c in range(cols):
        column = [board[r][c] for r in range(rows) if board[r][c] != 0]
        missing = rows - len(column)
        new_col = [rng.randint(1, gem_count) for _ in range(missing)] + column
        for r in range(rows):
            board[r][c] = new_col[r]


def resolve(board: list[list[int]], gem_count: int, rng: random.Random) -> tuple[dict, int, list[list[int]]]:
    """级联到稳定:清除→下落补充→再检;返回(按宝石序号计的清除数, 级联波数, 稳定棋盘)。

    补充用传入 rng(求解器按路径派生 seed,保证同一状态前向确定,状态去重才成立)。
    不修改入参 board。
    """
    b = [row[:] for row in board]
    cleared: dict[int, int] = {}
    waves = 0
    while True:
        matched = find_matches(b)
        if not matched:
            break
        waves += 1
        for r, c in matched:
            cleared[b[r][c]] = cleared.get(b[r][c], 0) + 1
            b[r][c] = 0
        _gravity_refill(b, gem_count, rng)
    return cleared, waves, b


def has_valid_move(board: list[list[int]]) -> bool:
    """非死局检查:存在至少一个交换(含级联前首步)能产生 ≥3 匹配。"""
    if not board or not board[0]:
        return False
    rows, cols = len(board), len(board[0])

    def swap_creates_match(r1, c1, r2, c2) -> bool:
        b = [row[:] for row in board]
        b[r1][c1], b[r2][c2] = b[r2][c2], b[r1][c1]
        return bool(find_matches(b))

    for r in range(rows):
        for c in range(cols):
            if board[r][c] == 0:
                continue
            if c + 1 < cols and board[r][c + 1] != 0 and swap_creates_match(r, c, r, c + 1):
                return True
            if r + 1 < rows and board[r + 1][c] != 0 and swap_creates_match(r, c, r + 1, c):
                return True
    return False


def solve(
    start: list[list[int]],
    moves: int,
    targets: dict[int, int],
    gem_count: int,
    node_budget: int = 50000,
    seed: int = 0,
) -> dict:
    """有界求解:交换 DFS(只走能产生匹配的合法步)+ 状态去重 + 乐观剪枝。

    targets:{宝石序号(1-based): 还需数量}。
    返回 {"status": "solved"|"unsolvable"|"unverified", "nodes": int, "plan": list|None}:
    - solved:plan 是一串 (r1,c1,r2,c2) 交换序列,执行后目标达成;
    - unsolvable:搜索完整结束(未超预算)且无解;
    - unverified:节点预算耗尽(人工复核/提高预算)。
    """
    rng = random.Random(seed)
    board = fill_empty(start, gem_count, rng)
    need = {g: n for g, n in targets.items() if n > 0}
    if not need:
        return {"status": "solved", "nodes": 0, "plan": []}
    rows, cols = len(board), len(board[0])
    optimistic_gain = rows * cols  # 单步清除的乐观上界(宽松剪枝,不会误剪)
    plan: list[tuple[int, int, int, int]] = []
    seen: dict[tuple, int] = {}
    nodes = 0

    def dfs(b: list[list[int]], cleared: dict[int, int], depth: int) -> bool:
        nonlocal nodes
        if all(cleared.get(g, 0) >= n for g, n in need.items()):
            return True
        if depth >= moves:
            return False
        remaining = sum(max(0, n - cleared.get(g, 0)) for g, n in need.items())
        if remaining > (moves - depth) * optimistic_gain:
            return False
        key = (
            tuple(tuple(row) for row in b),
            tuple(cleared.get(g, 0) for g in sorted(need)),
            depth,
        )
        prev = seen.get(key)
        if prev is not None and prev <= depth:
            return False
        seen[key] = depth
        for r in range(rows):
            for c in range(cols):
                for dr, dc in ((0, 1), (1, 0)):
                    r2, c2 = r + dr, c + dc
                    if r2 >= rows or c2 >= cols:
                        continue
                    if b[r][c] == 0 or b[r2][c2] == 0 or b[r][c] == b[r2][c2]:
                        continue
                    nb = [row[:] for row in b]
                    nb[r][c], nb[r2][c2] = nb[r2][c2], nb[r][c]
                    if not find_matches(nb):
                        continue  # 三消规则:每步必须产生匹配
                    nodes += 1
                    if nodes > node_budget:
                        raise _BudgetExceeded()
                    # 前向确定性:refill 的 seed 只依赖 (seed, depth, 交换格),
                    # 与到达该状态的路径无关——状态去重的正确性前提
                    step_rng = random.Random((seed * 100003 + depth * 1009 + r * 97 + c) & 0xFFFFFFFF)
                    cleared_delta, _waves, stable = resolve(nb, gem_count, step_rng)
                    plan.append((r, c, r2, c2))
                    merged = dict(cleared)
                    for g, v in cleared_delta.items():
                        merged[g] = merged.get(g, 0) + v
                    if dfs(stable, merged, depth + 1):
                        return True
                    plan.pop()
        return False

    try:
        ok = dfs([row[:] for row in board], {}, 0)
    except _BudgetExceeded:
        return {"status": "unverified", "nodes": nodes, "plan": None}
    return {"status": "solved" if ok else "unsolvable", "nodes": nodes, "plan": plan if ok else None}
