"""资产清单(manifest)解析 — 工具层共享库,唯一实现。

清单格式(manuals/玩法切片.md 定义),markdown 表格:

    | ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |
    |---|---|---|---|---|---|---|
    | g001-spr-gem-red-000 | spr | 红色宝石 | 128x128 alpha | 已入库 | 生成:… | 无 |

规格 cell 支持机器可读 token(其余文字随意,解析器忽略不认识的):
    128x128      尺寸
    frames=6     帧数
    alpha        需要透明底
    nonalpha     不需要透明底
"""
from __future__ import annotations

import re

COLUMNS = ("ID", "类别", "用途", "规格", "状态", "出处", "许可证")
IMAGE_CATEGORIES = {"spr", "ui", "eff", "tileset"}
STATUSES = {"占位", "生成中", "已入库", "需授权", "缺口"}

_SIZE_RE = re.compile(r"(\d+)\s*[xX\u00d7]\s*(\d+)")
_FRAMES_RE = re.compile(r"frames\s*=\s*(\d+)")


def parse_manifest(text: str) -> list[dict]:
    """解析清单 markdown,返回行字典列表;找不到表头返回空列表。"""
    rows: list[dict] = []
    header_cols: list[str] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            if header_cols is not None and rows:
                break  # 清单表格保持连续,遇到表格外的正文即结束
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and all(c and set(c) <= set("-: ") for c in cells):
            continue  # 对齐行 |---|---|
        if header_cols is None:
            if "ID" in cells and "类别" in cells:
                header_cols = cells
            continue
        if not any(cells):
            continue
        row = {col: (cells[i] if i < len(cells) else "") for i, col in enumerate(header_cols)}
        rows.append(row)
    return rows


def parse_spec(text: str | None) -> dict:
    """解析规格 cell 里的机器可读 token。"""
    t = text or ""
    spec: dict = {"size": None, "frames": None, "alpha": None}
    m = _SIZE_RE.search(t)
    if m:
        spec["size"] = (int(m.group(1)), int(m.group(2)))
    m = _FRAMES_RE.search(t)
    if m:
        spec["frames"] = int(m.group(1))
    tl = t.lower()
    if "nonalpha" in tl:
        spec["alpha"] = False
    elif "alpha" in tl:
        spec["alpha"] = True
    return spec


def has_alpha_channel(image) -> bool:
    """Pillow 图像是否带可用 alpha(模式判断 + P 模式 transparency)。"""
    if image.mode in ("RGBA", "LA"):
        return True
    if image.mode == "P":
        return "transparency" in image.info
    return False
