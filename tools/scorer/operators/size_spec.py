"""尺寸规格算子 — 纯函数:给清单条目与图像,给检查结论。不懂路径与 CLI。"""
from __future__ import annotations

import re
from pathlib import Path

from lib.manifest import has_alpha_channel

_POW2 = {1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096}
_FRAME_SUFFIX_RE = re.compile(r"-f\d{2,}$")


def _result(check: str, level: str, message: str, **detail) -> dict:
    return {"check": check, "level": level, "message": message, "detail": detail}


def check_naming(entry: dict, file_path: str) -> dict:
    stem = Path(file_path).stem
    asset_id = entry.get("ID", "")
    if stem == asset_id or (asset_id and stem.startswith(asset_id)
                            and _FRAME_SUFFIX_RE.fullmatch(stem[len(asset_id):])):
        return _result("size_spec/命名", "pass", f"文件名=资产 ID{('(帧)' if stem != asset_id else '')}")
    return _result("size_spec/命名", "fail", f"文件名 {stem} != 资产 ID {asset_id}")


def check_format(entry: dict, file_path: str) -> dict:
    if Path(file_path).suffix.lower() == ".png":
        return _result("size_spec/格式", "pass", "PNG")
    return _result("size_spec/格式", "fail", f"图片类资产必须 PNG,实际 {Path(file_path).suffix}")


def check_dimensions(entry: dict, image, spec: dict) -> dict:
    width, height = image.size
    want = spec.get("size")
    if want is not None:
        if (width, height) == want:
            return _result("size_spec/尺寸", "pass", f"{width}x{height}")
        return _result("size_spec/尺寸", "fail", f"清单要求 {want[0]}x{want[1]},实际 {width}x{height}")
    if entry.get("类别") in ("spr", "eff", "tileset") and (width not in _POW2 or height not in _POW2):
        return _result("size_spec/尺寸", "warn",
                       f"{width}x{height} 非 2 的幂(未写明规格,按默认约定提醒)")
    return _result("size_spec/尺寸", "pass", f"{width}x{height}(无规格要求)")


def check_alpha(entry: dict, image, spec: dict) -> dict:
    has_alpha = has_alpha_channel(image)
    want = spec.get("alpha")
    if want is True and not has_alpha:
        return _result("size_spec/透明底", "fail", "规格要求 alpha,图像无透明通道")
    if want is False and has_alpha:
        return _result("size_spec/透明底", "warn", "规格标注 nonalpha 但图像带透明通道")
    if want is None and entry.get("类别") == "spr" and not has_alpha:
        return _result("size_spec/透明底", "warn", "spr 默认期望透明底;确不需要请在规格标 nonalpha")
    return _result("size_spec/透明底", "pass", f"alpha={has_alpha}")


def check_entry(entry: dict, file_path: str, image, spec: dict) -> list[dict]:
    """整组检查。任一 fail 不影响其余检查照跑(一次给全量结论)。"""
    return [
        check_naming(entry, file_path),
        check_format(entry, file_path),
        check_dimensions(entry, image, spec),
        check_alpha(entry, image, spec),
    ]
