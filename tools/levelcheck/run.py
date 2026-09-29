"""关卡校验器运行层 — 唯一的 CLI 与路径注册点。

用法(游戏工程根目录视角):
    python E:/AiProject/vibe-pipeline/tools/levelcheck/run.py \
        --levels-dir assets/levels \
        [--manifest docs/资产清单.md] [--prefix g001] \
        [--node-budget 50000] [--out evidence/关卡校验/report.json]

按 manuals/genres/match-3.md §2 检查:结构 / 资产引用 / 非死局 / 可解性(显式布局)/ 难度曲线。
输出:JSON 报告 + 终端摘要;有 fail 时退出码 1(可挂 CI,"校验不过不入库")。
诚实语义:求解器预算耗尽 → warn(unverified,人工复核),绝不当失败也不当通过;
随机关(start=random)的可解性由生成器保证并溯源,校验器 v1 不做求解。
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import manifest  # noqa: E402
from levelcheck.operators import difficulty, references, solvable, structure  # noqa: E402

WORST_ORDER = ("fail", "warn", "pass")


def _worst(results: list[dict]) -> str:
    for severity in WORST_ORDER:
        if any(r["severity"] == severity for r in results):
            return severity
    return "pass"


def _default_out(levels_dir: Path) -> Path:
    if levels_dir.parent.name == "assets":
        return levels_dir.parent.parent / "evidence" / "关卡校验" / "report.json"
    return Path("evidence") / "关卡校验" / "report.json"


def _solve_targets(level: dict) -> dict[int, int]:
    """collect 目标 → {宝石序号(1-based): 数量};不在 gemTypes 的目标已被结构检查报错,这里跳过。"""
    gems = level.get("gemTypes") or []
    targets: dict[int, int] = {}
    objective = (level.get("rules") or {}).get("objective") or {}
    for t in objective.get("targets") or []:
        if isinstance(t, dict) and t.get("id") in gems:
            targets[gems.index(t["id"]) + 1] = int(t.get("count", 0))
    return targets


def check_level(level: dict, args) -> list[dict]:
    results: list[dict] = []
    for iss in structure.check_structure(level, prefix=args.prefix):
        results.append({**iss, "severity": "fail"})

    if args.manifest:
        entries = manifest.parse_manifest(args.manifest.read_text(encoding="utf-8"))
        ids = {e.get("ID", "") for e in entries}
        for iss in references.check_references(level, ids, prefix=args.prefix):
            results.append({**iss, "severity": "fail"})

    otype = ((level.get("rules") or {}).get("objective") or {}).get("type")
    gems = level.get("gemTypes") or []
    start = level.get("start")
    if isinstance(start, list) and isinstance(gems, list) and gems:
        seed = zlib.crc32(str(level.get("id", "")).encode("utf-8"))
        rng = __import__("random").Random(seed)
        board = solvable.fill_empty(start, len(gems), rng)
        if solvable.find_matches(board):
            results.append({
                "check": "deadlock", "ref": level.get("id", "?"), "severity": "fail",
                "message": "开局即有匹配(显式布局不应自带可消组合)",
            })
        elif not solvable.has_valid_move(board):
            results.append({
                "check": "deadlock", "ref": level.get("id", "?"), "severity": "fail",
                "message": "非死局检查失败:棋盘没有任何能产生匹配的交换",
            })
        elif otype == "collect":
            outcome = solvable.solve(
                start, int(level["rules"]["moves"]), _solve_targets(level),
                len(gems), node_budget=args.node_budget, seed=seed,
            )
            if outcome["status"] == "solved":
                results.append({
                    "check": "solvable", "ref": level.get("id", "?"), "severity": "pass",
                    "message": f"求解通过({outcome['nodes']} 节点,{len(outcome['plan'])} 步)",
                })
            elif outcome["status"] == "unverified":
                results.append({
                    "check": "solvable", "ref": level.get("id", "?"), "severity": "warn",
                    "message": f"求解预算耗尽({outcome['nodes']} 节点),人工复核或提高 --node-budget",
                })
            else:
                results.append({
                    "check": "solvable", "ref": level.get("id", "?"), "severity": "fail",
                    "message": f"完整搜索证明 {level['rules']['moves']} 步内目标不可达",
                })
        elif otype == "score":
            results.append({
                "check": "solvable", "ref": level.get("id", "?"), "severity": "warn",
                "message": "score 型关卡 v1 不做求解检查(难度靠曲线与星档约束)",
            })
    elif start == "random":
        results.append({
            "check": "solvable", "ref": level.get("id", "?"), "severity": "pass",
            "message": "随机关:可解性由生成器保证(genSource 溯源),v1 不做求解",
        })
    return results


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="关卡校验器(三消 DSL,manuals/genres/match-3.md)")
    parser.add_argument("--levels-dir", required=True, help="关卡 JSON 目录(游戏工程 assets/levels)")
    parser.add_argument("--manifest", default=None, help="资产清单 markdown(提供则做资产引用检查)")
    parser.add_argument("--prefix", default="g001", help="游戏资产 ID 前缀")
    parser.add_argument("--node-budget", type=int, default=50000, help="求解器节点预算(耗尽→warn)")
    parser.add_argument("--out", default=None, help="报告输出路径(默认 evidence/关卡校验/report.json)")
    args = parser.parse_args(argv)
    args.manifest = Path(args.manifest) if args.manifest else None

    levels_dir = Path(args.levels_dir)
    if not levels_dir.is_dir():
        print(f"[levelcheck] 关卡目录不存在:{levels_dir}", file=sys.stderr)
        return 1
    files = sorted(levels_dir.glob("*.json"))
    if not files:
        print(f"[levelcheck] 目录里没有关卡 JSON:{levels_dir}", file=sys.stderr)
        return 1

    level_reports = []
    all_levels: list[dict] = []
    seen_ids: dict[str, str] = {}
    for path in files:
        results: list[dict] = []
        try:
            level = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            results.append({
                "check": "parse", "ref": path.name, "severity": "fail",
                "message": f"JSON 解析失败:{exc}",
            })
            level_reports.append({"file": path.name, "id": path.name, "worst": "fail", "results": results})
            continue
        lid = level.get("id") if isinstance(level.get("id"), str) else path.name
        if lid in seen_ids:
            results.append({
                "check": "structure", "ref": lid, "severity": "fail",
                "message": f"关卡 id 重复:{seen_ids[lid]} 与 {path.name}",
            })
        else:
            seen_ids[lid] = path.name
        results.extend(check_level(level, args))
        all_levels.append(level)
        level_reports.append({"file": path.name, "id": lid, "worst": _worst(results), "results": results})

    curve_issues = difficulty.check_curve(all_levels)
    curve_issues = [{**iss, "severity": "fail"} for iss in curve_issues]

    totals = {"levels": len(level_reports), "pass": 0, "warn": 0, "fail": 0}
    for rep in level_reports:
        totals[rep["worst"]] += 1
    report = {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "levelsDir": str(levels_dir),
        "prefix": args.prefix,
        "totals": totals,
        "chapters": difficulty.chapter_counts(all_levels),
        "curveIssues": curve_issues,
        "levels": level_reports,
    }

    out = Path(args.out) if args.out else _default_out(levels_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[levelcheck] 关卡 {totals['levels']} 个:pass {totals['pass']} / warn {totals['warn']} / fail {totals['fail']}")
    if curve_issues:
        for iss in curve_issues:
            print(f"  [curve:{iss['severity']}] {iss['message']}")
    for rep in level_reports:
        if rep["worst"] != "pass":
            for r in rep["results"]:
                if r["severity"] != "pass":
                    print(f"  [{rep['id']}][{r['check']}:{r['severity']}] {r['message']}")
    print(f"[levelcheck] 报告:{out}")
    if any(rep["worst"] == "fail" for rep in level_reports) or curve_issues:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
