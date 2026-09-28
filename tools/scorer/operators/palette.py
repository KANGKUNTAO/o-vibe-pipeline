"""调色板一致性算子 — 纯函数:资产主色 vs 参考色板,Lab 距离打分。

参考色板来源(运行层负责解析):
  --ref 锚点图(第一件达标的风格锚点资产)取主色
  --palette-json 显式色板文件 [{"rgb":[r,g,b]},...] 或 [[r,g,b],...]
"""
from __future__ import annotations

import math


def _srgb_to_linear(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    """sRGB(D65)→ CIELab,纯 Python 实现,无 numpy 依赖。"""
    r, g, b = (_srgb_to_linear(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    """CIE76 色差:Lab 欧氏距离。≈2.3 是人眼可辨,风格容差一般 10~20。"""
    (l1, a1, b1), (l2, a2, b2) = rgb_to_lab(c1), rgb_to_lab(c2)
    return math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)


def check(asset_colors: list[dict], ref_palette: list[tuple[int, int, int]],
          max_mean: float = 16.0) -> dict:
    """给资产主色与参考色板,给一致性结论。

    asset_colors: imaging.dominant_colors() 的输出
    ref_palette:  参考 RGB 列表
    max_mean:     主色到参考色最近邻距离的平均值上限
    """
    if not asset_colors or not ref_palette:
        return {"check": "palette", "level": "warn", "message": "主色或参考色板为空,跳过",
                "detail": {}}
    dists = []
    for item in asset_colors:
        nearest = min(delta_e(item["rgb"], ref) for ref in ref_palette)
        dists.append((item["rgb"], item["share"], nearest))
    mean = sum(d for _, _, d in dists) / len(dists)
    worst = sorted(dists, key=lambda x: -x[2])[:3]
    detail = {
        "mean_delta_e": round(mean, 1),
        "max_delta_e": round(max(d for _, _, d in dists), 1),
        "threshold": max_mean,
        "worst_colors": [{"rgb": list(rgb), "share": share, "delta_e": round(d, 1)}
                         for rgb, share, d in worst],
    }
    if mean <= max_mean * 0.75:
        level, msg = "pass", f"调色板一致(mean ΔE {mean:.1f})"
    elif mean <= max_mean:
        level, msg = "warn", f"调色板偏离偏高(mean ΔE {mean:.1f},阈值 {max_mean}),建议人工看一眼"
    else:
        level, msg = "fail", f"调色板不一致(mean ΔE {mean:.1f} > 阈值 {max_mean})"
    return {"check": "palette", "level": level, "message": msg, "detail": detail}
