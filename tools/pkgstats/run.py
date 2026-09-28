"""包体统计 — 构建产物体积审计(微信交付检查链第 3/4 步的管线侧复核)。

用法(游戏工程根目录视角):
    python E:/AiProject/vibe-pipeline/tools/pkgstats/run.py \
        --build-dir build/wechatgame [--budget-mb 4] [--large-file-kb 200] [--out <report.json>]

输出:总体积 vs 预算、按扩展名分布、最大的 10 个文件、超阈大文件清单;
报告落 evidence/交付审计/,超预算退出码 1(可挂 CI)。
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from collections import defaultdict
from pathlib import Path

HUMAN = 1024.0


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{int(n)}B"
        n /= 1024


def scan(build_dir: Path) -> dict:
    total, by_ext, files = 0, defaultdict(int), []
    for path in build_dir.rglob("*"):
        if path.is_file():
            size = path.stat().st_size
            total += size
            by_ext[path.suffix.lower() or "(无后缀)"] += size
            files.append((size, path.relative_to(build_dir).as_posix()))
    files.sort(reverse=True)
    subdirs: dict[str, int] = defaultdict(int)
    for child in build_dir.iterdir():
        if child.is_dir():
            subdirs[child.name + "/"] = sum(f.stat().st_size
                                            for f in child.rglob("*") if f.is_file())
    return {"total_bytes": total,
            "by_ext": dict(sorted(by_ext.items(), key=lambda kv: -kv[1])),
            "top_files": [{"file": rel, "bytes": s} for s, rel in files[:10]],
            "file_count": len(files),
            "subdirs": dict(sorted(subdirs.items(), key=lambda kv: -kv[1]))}


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="构建产物包体统计")
    parser.add_argument("--build-dir", required=True, help="构建产物目录(如 build/wechatgame)")
    parser.add_argument("--budget-mb", type=float, default=4.0, help="主包预算 MB(默认 4)")
    parser.add_argument("--large-file-kb", type=float, default=200.0,
                        help="单文件超此 KB 列入大文件清单(默认 200)")
    parser.add_argument("--out", help="报告路径(默认 <游戏根>/evidence/交付审计/pkgstats.json)")
    args = parser.parse_args(argv)

    build_dir = Path(args.build_dir)
    if not build_dir.is_dir():
        print(f"[pkgstats] 目录不存在:{build_dir}")
        return 1
    stats = scan(build_dir)
    budget_bytes = args.budget_mb * 1024 * 1024
    large_kb = args.large_file_kb * 1024
    large_files = [f for f in stats["top_files"] if f["bytes"] > large_kb]

    over = stats["total_bytes"] > budget_bytes
    level = "FAIL" if over else "PASS"
    print(f"[pkgstats] 总体积 {human(stats['total_bytes'])} / 预算 {args.budget_mb:g}MB → {level}"
          f"({stats['file_count']} 个文件)")
    for ext, size in list(stats["by_ext"].items())[:6]:
        print(f"  {ext:8s} {human(size)}")
    if large_files:
        print(f"[pkgstats] 大文件(>{args.large_file_kb:g}KB,关注压缩/分包):")
        for f in large_files:
            print(f"  {human(f['bytes']):>10s} {f['file']}")

    report = {"tool": "vibe-pipeline pkgstats", "version": 1,
              "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
              "build_dir": str(build_dir), "budget_mb": args.budget_mb,
              "large_file_kb": args.large_file_kb,
              "over_budget": over, **stats,
              "large_files": large_files}
    out = Path(args.out) if args.out else _default_out(build_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[pkgstats] 报告:{out}")
    return 1 if over else 0


def _default_out(build_dir: Path) -> Path:
    # 约定 build/<平台>/ 位于游戏工程根下;不合约定时退回 build_dir 同级
    game_root = build_dir.parent.parent if build_dir.parent.name == "build" else build_dir.parent
    return game_root / "evidence" / "交付审计" / "pkgstats.json"


if __name__ == "__main__":
    sys.exit(main())
