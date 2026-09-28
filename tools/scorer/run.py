"""评分器运行层 — 唯一的 CLI 与路径注册点。

用法(游戏工程根目录视角):
    python E:/AiProject/vibe-pipeline/tools/scorer/run.py \
        --manifest docs/资产清单.md --assets-root assets/art \
        [--ref assets/art/spr/风格锚点.png] [--palette-json 色板.json] \
        [--max-mean-deltae 16] [--out evidence/资产质检/report.json]

输出:JSON 报告 + 终端摘要;有 fail 时退出码 1(可挂 CI)。
已实现检查:尺寸规格(命名/格式/尺寸/透明底)、调色板一致性。
待建:帧间一致性(动画帧序列)。
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import manifest  # noqa: E402
from scorer import imaging  # noqa: E402
from scorer.operators import palette, size_spec  # noqa: E402

LEVELS = ("fail", "warn", "pass")


def find_asset_file(assets_root: Path, entry: dict) -> Path | None:
    asset_id = entry.get("ID", "")
    candidates = [assets_root / entry.get("类别", "") / f"{asset_id}.png",
                  assets_root / f"{asset_id}.png"]
    if (spec_frames := manifest.parse_spec(entry.get("规格")).get("frames")) and spec_frames > 1:
        # 帧序列资产:主文件不存在时认第一帧
        first_frame = f"{asset_id}-f01.png"
        candidates += [assets_root / entry.get("类别", "") / first_frame,
                       assets_root / first_frame]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _default_out(manifest_path: Path) -> Path:
    game_root = manifest_path.parent.parent  # docs/资产清单.md → 游戏工程根
    return game_root / "evidence" / "资产质检" / "report.json"


def _load_ref_palette(args) -> list[tuple[int, int, int]] | None:
    if getattr(args, "ref", None):
        img = imaging.load_rgb_small(args.ref, max_side=48)
        return [c["rgb"] for c in imaging.dominant_colors(img, n=6, min_share=0.04)]
    if getattr(args, "palette_json", None):
        data = json.loads(Path(args.palette_json).read_text(encoding="utf-8"))
        out = []
        for item in data:
            rgb = item["rgb"] if isinstance(item, dict) else item
            out.append(tuple(int(v) for v in rgb))
        return out
    return None


def _worst_level(results: list[dict]) -> str:
    for level in LEVELS:
        if any(r["level"] == level for r in results):
            return level
    return "pass" if results else "skip"


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="资产质检评分器(尺寸规格+调色板)")
    parser.add_argument("--manifest", required=True, help="资产清单路径(docs/资产清单.md)")
    parser.add_argument("--assets-root", required=True, help="资产文件根目录(如 assets/art)")
    parser.add_argument("--ref", help="风格锚点图(取其主色作参考色板)")
    parser.add_argument("--palette-json", help="参考色板 JSON(与 --ref 二选一)")
    parser.add_argument("--max-mean-deltae", type=float, default=16.0, help="调色板平均色差阈值")
    parser.add_argument("--out", help="报告输出路径(默认 <游戏根>/evidence/资产质检/report.json)")
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    assets_root = Path(args.assets_root)
    entries = manifest.parse_manifest(manifest_path.read_text(encoding="utf-8"))
    if not entries:
        print(f"[scorer] 清单中没有解析到条目:{manifest_path}")
        return 1
    ref_palette = _load_ref_palette(args)
    out_path = Path(args.out) if args.out else _default_out(manifest_path)
    spec_of = {e.get("ID"): manifest.parse_spec(e.get("规格")) for e in entries}

    summary = {"pass": 0, "warn": 0, "fail": 0, "missing": 0, "skip": 0}
    report_entries = []
    for entry in entries:
        asset_id = entry.get("ID", "")
        status = entry.get("状态", "")
        row: dict = {"id": asset_id, "status": status, "category": entry.get("类别", ""),
                     "checks": [], "level": "skip"}
        if not asset_id:
            row["level"], row["message"] = "warn", "清单行缺 ID(资产 ID 是硬性规范),请补全"
            summary["warn"] += 1
            report_entries.append(row)
            continue
        if entry.get("类别") not in manifest.IMAGE_CATEGORIES:
            row["message"] = "非图片类资产,跳过(音频/字体检查器待建)"
            summary["skip"] += 1
        else:
            file_path = find_asset_file(assets_root, entry)
            if file_path is None:
                if status == "已入库":
                    row["level"], row["message"] = "missing", "清单标记已入库,但找不到文件"
                elif status == "占位":
                    row["level"], row["message"] = "warn", "占位文件未生成(可跑 tools/placeholder/gen.py)"
                else:
                    row["level"], row["message"] = "skip", f"状态={status},尚无文件,跳过"
            else:
                image = imaging.load_full(str(file_path))
                checks = size_spec.check_entry(entry, str(file_path), image, spec_of.get(asset_id, {}))
                if ref_palette is not None:
                    small = imaging.load_rgb_small(str(file_path))
                    checks.append(palette.check(imaging.dominant_colors(small),
                                                ref_palette, args.max_mean_deltae))
                row["checks"] = checks
                row["level"] = _worst_level(checks)
                row["file"] = str(file_path)
        summary[row["level"]] = summary.get(row["level"], 0) + 1
        report_entries.append(row)

    report = {
        "tool": "vibe-pipeline scorer", "version": 1,
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "manifest": str(manifest_path), "assets_root": str(assets_root),
        "ref_palette": ref_palette, "summary": summary, "entries": report_entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[scorer] 共 {len(entries)} 条:pass={summary['pass']} warn={summary['warn']} "
          f"fail={summary['fail']} missing={summary['missing']} skip={summary['skip']}")
    for row in report_entries:
        if row["level"] in ("fail", "missing", "warn"):
            detail = "; ".join(f"{c['check']}:{c['message']}" for c in row["checks"]
                               if c["level"] != "pass") or row.get("message", "")
            print(f"  [{row['level'].upper():7s}] {row['id']} — {detail}")
    print(f"[scorer] 报告:{out_path}")
    return 1 if (summary["fail"] or summary["missing"]) else 0


if __name__ == "__main__":
    sys.exit(main())
