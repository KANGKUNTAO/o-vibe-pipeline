"""图像服务对接层 — 只管把文件变成 Pillow 图像与主色,不懂任务与路径。

评分器算子(pure functions)只消费本层产出的对象;
路径解析在运行层(scorer/run.py),本层不出现任何业务路径。
"""
from __future__ import annotations

from PIL import Image


def load_full(path: str) -> Image.Image:
    """加载原图(保留 mode,用于尺寸/alpha 检查)。"""
    img = Image.open(path)
    img.load()
    return img


def load_rgb_small(path: str, max_side: int = 64) -> Image.Image:
    """加载缩小的 RGB 图(用于调色板统计,毫秒级)。"""
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    return img


def dominant_colors(img_rgb: Image.Image, n: int = 6, min_share: float = 0.05) -> list[dict]:
    """提取主色列表:[{rgb:(r,g,b), share:0~1}],按占比降序。"""
    quantized = img_rgb.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = quantized.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    out: list[dict] = []
    for count, index in sorted(counts, reverse=True):
        share = count / total
        if share < min_share:
            continue
        rgb = tuple(palette[index * 3: index * 3 + 3])
        out.append({"rgb": (rgb[0], rgb[1], rgb[2]), "share": round(share, 3)})
    return out


def dhash(image: Image.Image, size: int = 8) -> int:
    """差异感知哈希(64 位):缩灰到 (size+1) x size,按行比较水平相邻像素。"""
    gray = image.convert("L").resize((size + 1, size))
    bits = 0
    for y in range(size):
        row = [gray.getpixel((x, y)) for x in range(size + 1)]
        for x in range(size):
            bits = (bits << 1) | (1 if row[x] > row[x + 1] else 0)
    return bits


def hamming_distance(hash_a: int, hash_b: int) -> int:
    return bin(hash_a ^ hash_b).count("1")
