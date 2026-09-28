"""占位资产生成器 — 读资产清单,为"占位"状态的图片类资产生成确定性占位 PNG。

用法(游戏工程根目录视角):
    python E:/AiProject/vibe-pipeline/tools/placeholder/gen.py \
        --manifest docs/资产清单.md [--out-root assets/art] [--legend 语义色板.json] [--force]

- 输出路径:<out-root>/<类别>/<ID>.png;规格含 frames=N 时生成 <ID>-f01..fNN 帧序列
- 颜色:语义色板(--legend,语义关键词→色值)优先,否则由 ID 哈希出确定性颜色
- 白盒纪律兑现:占位资产也挂正式 ID,文件名=资产 ID,清单可直接被评分器接手
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import manifest  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402


def _default_out_root(manifest_path: Path) -> Path:
    return manifest_path.parent.parent / "assets" / "art"  # docs/资产清单.md → 游戏工程根


def _hash_color(asset_id: str) -> tuple[int, int, int]:
    """由 ID 确定性生成柔和颜色(同 ID 永远同色)。"""
    digest = hashlib.md5(asset_id.encode("utf-8")).hexdigest()
    hue = int(digest[:4], 16) / 0xFFFF
    r, g, b = colorsys.hls_to_rgb(hue, 0.62, 0.42)
    return (int(r * 255), int(g * 255), int(b * 255))


def _legend_color(asset_id: str, legend: dict) -> tuple[int, int, int] | None:
    for keyword, hexcolor in legend.items():
        if keyword and keyword.lower() in asset_id.lower():
            hexcolor = hexcolor.lstrip("#")
            return tuple(int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))
    return None


def _shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, int(v * factor))) for v in color)


def _draw_placeholder(path: Path, asset_id: str, size: tuple[int, int],
                      color: tuple[int, int, int], frame: int | None = None,
                      with_alpha: bool = False) -> None:
    width, height = size
    mode = "RGBA" if with_alpha else "RGB"
    img = Image.new(mode, size, color)
    if with_alpha:
        img.putalpha(255)  # 占位图带 alpha 通道,满足清单 alpha 要求;换真图时整个替换
    draw = ImageDraw.Draw(img)
    draw.rectangle([1, 1, width - 2, height - 2], outline=_shade(color, 0.55), width=2)
    label = asset_id if frame is None else f"{asset_id}\nf{frame:02d}"
    # 默认位图字体仅支持 ASCII;ID 规范即 ASCII,中文标题不会出现在 ID 里
    draw.text((max(4, width // 12), max(4, height // 3)), label, fill=_shade(color, 0.25))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="占位资产生成器(占位也挂正式 ID)")
    parser.add_argument("--manifest", required=True, help="资产清单路径(docs/资产清单.md)")
    parser.add_argument("--out-root", help="输出根目录(默认 <游戏根>/assets/art)")
    parser.add_argument("--legend", help="语义色板 JSON:{\"关键词\": \"#RRGGBB\"}")
    parser.add_argument("--default-size", default="128x128", help="无规格时的默认尺寸")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的占位文件")
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    out_root = Path(args.out_root) if args.out_root else _default_out_root(manifest_path)
    legend = {}
    if args.legend:
        legend = json.loads(Path(args.legend).read_text(encoding="utf-8"))
    default_size = manifest.parse_spec(args.default_size)["size"]

    entries = [e for e in manifest.parse_manifest(manifest_path.read_text(encoding="utf-8"))
               if e.get("类别") in manifest.IMAGE_CATEGORIES]
    generated, skipped = [], []
    for entry in entries:
        asset_id = entry.get("ID", "")
        spec = manifest.parse_spec(entry.get("规格"))
        size = spec["size"] or default_size
        color = _legend_color(asset_id, legend) or _hash_color(asset_id)
        frames = spec["frames"] or 1
        for i in range(1, frames + 1):
            name = f"{asset_id}.png" if frames == 1 else f"{asset_id}-f{i:02d}.png"
            target = out_root / entry.get("类别", "") / name
            if target.exists() and not args.force:
                skipped.append(str(target))
                continue
            with_alpha = spec["alpha"] is not False  # 清单要求 alpha(或未标)→ 出 RGBA
            _draw_placeholder(target, asset_id, size, color,
                              frame=None if frames == 1 else i, with_alpha=with_alpha)
            generated.append(str(target))

    print(f"[placeholder] 生成 {len(generated)} 个,跳过已存在 {len(skipped)} 个 → {out_root}")
    for p in generated:
        print("  +", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
