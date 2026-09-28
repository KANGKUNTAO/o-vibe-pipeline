"""帧间一致性算子 — 纯函数:给帧序列图像列表,给一致性结论。

针对 2D 动画帧序列的三大失效模式:
  尺寸漂移(帧之间尺寸不一致 → 引擎里抖动)
  跳变(dHash 相邻帧距离过大 → 缺帧/闪帧/结构突变)
  停滞(相邻帧距离为 0 → 重复帧,浪费帧数)

算法边界:dHash 感知的是**结构/梯度**变化,对纯色帧之间的整体明暗切换不敏感——
全局色调突变由调色板检查兜底;两道检查配合使用。
"""
from __future__ import annotations

from scorer import imaging


def _result(check: str, level: str, message: str, **detail) -> dict:
    return {"check": check, "level": level, "message": message, "detail": detail}


def check_frames(images: list, max_jump: float = 24.0) -> list[dict]:
    """images:按帧序排列的 Pillow 图像(来自运行层)。"""
    results: list[dict] = []
    sizes = {img.size for img in images}
    if len(sizes) > 1:
        return [_result("frame_consistency/尺寸", "fail",
                        f"帧间尺寸不一致:{sorted(sizes)}")]

    hashes = [imaging.dhash(img) for img in images]
    distances = [imaging.hamming_distance(hashes[i], hashes[i + 1])
                 for i in range(len(hashes) - 1)]
    if not distances:
        return [_result("frame_consistency/尺寸", "pass",
                        f"单帧,尺寸 {images[0].size}" if images else "无帧")]

    sizes_msg = f"共 {len(images)} 帧,尺寸 {images[0].size}"
    results.append(_result("frame_consistency/尺寸", "pass", sizes_msg))

    mean = sum(distances) / len(distances)
    jumps = [(i + 1, d) for i, d in enumerate(distances) if d > max_jump]
    stalls = [i + 1 for i, d in enumerate(distances) if d == 0]
    detail = {"mean_jump": round(mean, 1), "max_jump": max(distances),
              "threshold": max_jump,
              "jumps_over_threshold": [f"f{n}->f{n+1}({d})" for n, d in jumps],
              "stalled_frames": stalls}
    if mean > max_jump:
        results.append(_result("frame_consistency/跳变", "fail",
                               f"平均跳变 {mean:.1f} 超阈 {max_jump}(帧序列可能乱序/风格突变)",
                               **detail))
    elif jumps:
        results.append(_result("frame_consistency/跳变", "warn",
                               f"{len(jumps)} 处相邻帧跳变超阈(疑似缺帧/闪帧),建议人工看序列",
                               **detail))
    else:
        results.append(_result("frame_consistency/跳变", "pass",
                               f"平均跳变 {mean:.1f},无超阈跳变", **detail))
    if stalls:
        results.append(_result("frame_consistency/停滞", "warn",
                               f"存在完全相同的相邻帧(浪费帧数):{stalls}", **detail))
    return results
