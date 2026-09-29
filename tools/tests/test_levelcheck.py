"""levelcheck 测试 — 结构/引用/死局/求解器/难度曲线/运行层端到端。"""

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from levelcheck.operators import difficulty, references, solvable, structure
from levelcheck.run import main as levelcheck_main

RUN_PY = Path(__file__).resolve().parents[1] / "levelcheck" / "run.py"
EXAMPLES = RUN_PY.parent / "examples"


def valid_level(**over) -> dict:
    level = {
        "id": "g001-level-001",
        "chapter": 1,
        "index": 1,
        "board": {"cols": 6, "rows": 6},
        "start": "random",
        "rules": {"moves": 20, "objective": {"type": "collect", "targets": [{"id": "gem-red", "count": 10}]}},
        "gemTypes": ["gem-red", "gem-blue", "gem-green", "gem-yellow", "gem-purple"],
        "blockers": [],
        "mechanics": [],
        "difficulty": {"intended": 1.0, "params": {"deadlockRate": 0.05}},
        "meta": {"starThresholds": [1000, 2000, 3000], "genSource": "t", "genDate": "2026-09-29"},
    }
    level.update(over)
    return level


# ---------- 结构 ----------

def test_structure_valid_passes():
    assert structure.check_structure(valid_level()) == []


@pytest.mark.parametrize(
    "mutate,fragment",
    [
        (lambda l: l.update(id="bad-01"), "id 非法"),
        (lambda l: l.update(chapter=9), "chapter 非法"),
        (lambda l: l.update(index=11), "index 非法"),
        (lambda l: l.update(board={"cols": 5, "rows": 5}), "board 非法"),
        (lambda l: l["rules"].update(moves=5), "rules.moves 非法"),
        (lambda l: l.update(gemTypes=["gem-red", "gem-blue", "gem-green"]), "gemTypes 非法"),
        (lambda l: l.update(mechanics=["nova"]), "mechanics 非法"),
        (lambda l: l.update(blockers=[{"type": "ice", "cell": [9, 9], "hp": 1}]), "cell 越界"),
        (lambda l: l.update(blockers=[{"type": "ice", "cell": [0, 0]}]), "hp>=1"),
        (lambda l: l["rules"]["objective"].update(targets=[{"id": "gem-ghost", "count": 3}]), "不在 gemTypes"),
        (lambda l: l["meta"].update(starThresholds=[3000, 2000, 1000]), "starThresholds 非法"),
        (lambda l: l["meta"].pop("genSource"), "meta.genSource 缺失"),
        (lambda l: l["difficulty"].update(intended=0.01), "intended 非法"),
        (lambda l: l["difficulty"]["params"].update(deadlockRate=0.9), "deadlockRate 非法"),
        (lambda l: l.update(start=[[1] * 6] * 5), "start 矩阵尺寸"),
    ],
)
def test_structure_catches(mutate, fragment):
    level = valid_level()
    mutate(level)
    messages = [i["message"] for i in structure.check_structure(level)]
    assert any(fragment in m for m in messages), messages


def test_structure_explicit_matrix_values():
    level = valid_level(start=[[1, 2] * 3] * 6)
    assert structure.check_structure(level) == []
    bad = valid_level(start=[[1, 2, 3, 4, 5, 9]] * 6)
    assert any("非法值" in i["message"] for i in structure.check_structure(bad))


# ---------- 引用 ----------

def test_references_flag_missing_assets():
    ids = {"g001-spr-gem-red-000", "g001-spr-gem-blue-000"}
    level = valid_level(mechanics=["striped"], blockers=[{"type": "ice", "cell": [0, 0], "hp": 1}])
    issues = references.check_references(level, ids)
    missing = [i["message"] for i in issues]
    assert any("gem-green" in m for m in missing)
    assert any("gem-yellow" in m and "gem-purple" not in m for m in missing)
    assert any("blk-ice" in m for m in missing)
    assert any("sp-striped" in m for m in missing)
    ok = references.check_references(
        valid_level(mechanics=["striped"], blockers=[{"type": "ice", "cell": [0, 0], "hp": 1}]),
        {f"g001-spr-gem-{c}-000" for c in ("red", "blue", "green", "yellow", "purple")}
        | {"g001-spr-blk-ice-000", "g001-spr-sp-striped-000"},
    )
    assert ok == []


# ---------- 死局与求解器 ----------

def no_move_board(n=6) -> list[list[int]]:
    """模 3 循环着色:任何相邻交换都不会产生 3 连(可证),且初始无匹配。"""
    return [[(r + c) % 3 + 1 for c in range(n)] for r in range(n)]


def board_with_one_match_move() -> list[list[int]]:
    """交换 (2,2)-(3,2) 后 row2 成 1,1,1 三连;初始无匹配。"""
    board = [
        [1, 2, 1, 2, 1, 2],
        [2, 1, 2, 1, 2, 1],
        [1, 1, 2, 2, 1, 2],
        [2, 2, 1, 1, 2, 1],
        [1, 2, 1, 2, 1, 2],
        [2, 1, 2, 1, 2, 1],
    ]
    assert not solvable.find_matches(board)
    return board


def test_has_valid_move():
    assert not solvable.has_valid_move(no_move_board())  # 模 3 循环着色无任何可行交换
    assert solvable.has_valid_move(board_with_one_match_move())


def test_resolve_cascades_and_counts():
    import random

    board = [
        [1, 1, 1, 2],
        [2, 1, 2, 1],
        [1, 2, 1, 2],
        [2, 1, 2, 1],
    ]
    cleared, waves, stable = solvable.resolve(board, 2, random.Random(0))
    assert cleared.get(1, 0) >= 3  # 顶行三连至少清 3 个 1
    assert waves >= 1
    assert not solvable.find_matches(stable)  # 级联到稳定
    assert board[0][:3] == [1, 1, 1]  # 入参不被修改


def test_solver_solves_finds_plan():
    board = board_with_one_match_move()
    out = solvable.solve(board, moves=5, targets={1: 3}, gem_count=2, node_budget=10000, seed=1)
    assert out["status"] == "solved"
    assert out["plan"] and len(out["plan"]) <= 5


def test_solver_proves_unsolvable_when_exhausted():
    out = solvable.solve(no_move_board(), moves=3, targets={1: 1}, gem_count=3, node_budget=100000)
    assert out["status"] == "unsolvable"  # 无合法步,搜索完整结束


def test_solver_unverified_on_tiny_budget():
    out = solvable.solve(board_with_one_match_move(), moves=6, targets={1: 30}, gem_count=2, node_budget=1)
    assert out["status"] == "unverified"  # 预算耗尽≠不可解


# ---------- 难度曲线 ----------

def test_curve_ok_and_violations():
    ok = [
        valid_level(index=1, difficulty={"intended": 1.0, "params": {"deadlockRate": 0.05}}),
        valid_level(index=2, difficulty={"intended": 1.2, "params": {"deadlockRate": 0.05}}),
    ]
    assert difficulty.check_curve(ok) == []

    drop = [valid_level(index=1, difficulty={"intended": 2.0, "params": {"deadlockRate": 0.05}}),
            valid_level(index=2, difficulty={"intended": 1.0, "params": {"deadlockRate": 0.05}})]
    assert any("章 1 内难度回落" in i["message"] for i in difficulty.check_curve(drop))

    cross = [
        valid_level(chapter=1, index=1, difficulty={"intended": 3.0, "params": {"deadlockRate": 0.05}}),
        valid_level(chapter=2, index=1, difficulty={"intended": 1.0, "params": {"deadlockRate": 0.05}}),
    ]
    assert any("章间难度骤降" in i["message"] for i in difficulty.check_curve(cross))


# ---------- 运行层端到端 ----------

def _write_game(tmp_path: Path, mutate=None) -> Path:
    (tmp_path / "assets" / "levels").mkdir(parents=True)
    (tmp_path / "docs").mkdir()
    for f in sorted(EXAMPLES.glob("levels/*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if mutate:
            mutate(data)
        (tmp_path / "assets" / "levels" / f.name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    (tmp_path / "docs" / "资产清单.md").write_text(
        (EXAMPLES / "manifest.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return tmp_path


def test_runner_e2e_green(tmp_path, capsys):
    root = _write_game(tmp_path)
    rc = levelcheck_main([
        "--levels-dir", str(root / "assets" / "levels"),
        "--manifest", str(root / "docs" / "资产清单.md"),
    ])
    assert rc == 0
    report = json.loads(
        (root / "evidence" / "关卡校验" / "report.json").read_text(encoding="utf-8")
    )
    assert report["totals"]["levels"] == 2
    assert report["totals"]["fail"] == 0
    assert report["chapters"] == {"1": 2}


def test_runner_catches_broken_level(tmp_path, capsys):
    def mutate(data):
        if data["id"] == "g001-level-001":
            data["rules"]["moves"] = 5  # 低于下限
    root = _write_game(tmp_path, mutate)
    rc = levelcheck_main([
        "--levels-dir", str(root / "assets" / "levels"),
        "--manifest", str(root / "docs" / "资产清单.md"),
    ])
    assert rc == 1
    report = json.loads((root / "evidence" / "关卡校验" / "report.json").read_text(encoding="utf-8"))
    assert report["totals"]["fail"] == 1


def test_runner_reference_failure_blocks(tmp_path):
    root = _write_game(tmp_path)
    manifest_path = root / "docs" / "资产清单.md"
    manifest_path.write_text(
        manifest_path.read_text(encoding="utf-8").replace("g001-spr-gem-red-000", "g001-spr-gem-redX-000"),
        encoding="utf-8",
    )
    rc = levelcheck_main([
        "--levels-dir", str(root / "assets" / "levels"),
        "--manifest", str(manifest_path),
    ])
    assert rc == 1


def test_runner_missing_dir_friendly():
    assert levelcheck_main(["--levels-dir", "Z:/no/such/dir"]) == 1
