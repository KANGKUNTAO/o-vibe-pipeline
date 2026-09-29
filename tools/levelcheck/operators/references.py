"""资产引用检查算子 — 关卡引用的宝石/障碍/特殊件必须存在于资产清单(纯函数)。

ID 约定(品类手册 §3):gem → <prefix>-spr-<type>-000;障碍 → <prefix>-spr-blk-<type>-000;
特殊件 → <prefix>-spr-sp-<type>-000。道具/特效/界面不进关卡引用,不在此查。
"""
from __future__ import annotations


def check_references(level: dict, manifest_ids: set[str], prefix: str = "g001") -> list[dict]:
    issues: list[dict] = []
    ref = level.get("id") if isinstance(level.get("id"), str) else "?"

    def issue(message: str) -> None:
        issues.append({"check": "reference", "ref": ref, "message": message})

    for g in level.get("gemTypes") or []:
        if isinstance(g, str):
            need = f"{prefix}-spr-{g}-000"
            if need not in manifest_ids:
                issue(f"宝石 {g} 缺资产 {need}")
    for b in level.get("blockers") or []:
        t = b.get("type") if isinstance(b, dict) else None
        if isinstance(t, str):
            need = f"{prefix}-spr-blk-{t}-000"
            if need not in manifest_ids:
                issue(f"障碍 {t} 缺资产 {need}")
    for m in level.get("mechanics") or []:
        if isinstance(m, str):
            need = f"{prefix}-spr-sp-{m}-000"
            if need not in manifest_ids:
                issue(f"特殊件 {m} 缺资产 {need}")
    return issues
