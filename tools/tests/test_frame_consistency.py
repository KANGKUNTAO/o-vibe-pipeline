import json

from PIL import Image

from scorer import imaging
from scorer.operators import frame_consistency
from scorer.run import main as run_main


def _frame(path, size, color):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)


def _gradient_frame(path, size, reverse=False):
    """结构化夹具:水平渐变帧。reverse=True 时方向翻转(dHash 全位翻转)。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    w, h = size
    img = Image.new("L", size)
    img.putdata([((w - 1 - x) if reverse else x) * 255 // (w - 1)
                 for y in range(h) for x in range(w)])
    img.convert("RGB").save(path)


def test_frames_sizes_mismatch_fail():
    images = [Image.new("RGB", (32, 32), (10, 10, 10)),
              Image.new("RGB", (48, 48), (10, 10, 10))]
    results = frame_consistency.check_frames(images)
    assert results[0]["check"] == "frame_consistency/尺寸"
    assert results[0]["level"] == "fail"


def test_frames_stalled_warn():
    images = [Image.new("RGB", (32, 32), (10, 10, 10)) for _ in range(3)]
    results = frame_consistency.check_frames(images)
    levels = {r["check"]: r["level"] for r in results}
    assert levels["frame_consistency/跳变"] == "pass"   # 无跳变
    assert levels["frame_consistency/停滞"] == "warn"   # 三帧全同


def test_frames_jump_warn_and_fail(tmp_path):
    a = tmp_path / "a.png"
    b = tmp_path / "b.png"
    _gradient_frame(a, (32, 32))
    _gradient_frame(b, (32, 32), reverse=True)  # 渐变方向翻转 → dHash 64 位全翻
    fwd, rev = Image.open(a), Image.open(b)
    # 1 处跳变,均值 21.3 < 24 → warn
    images = [fwd.copy(), fwd.copy(), rev.copy(), rev.copy()]
    levels = {r["check"]: r["level"] for r in frame_consistency.check_frames(images)}
    assert levels["frame_consistency/跳变"] == "warn"
    # 正反交替,均值 64 → fail
    images = [fwd.copy(), rev.copy(), fwd.copy(), rev.copy()]
    levels = {r["check"]: r["level"] for r in frame_consistency.check_frames(images)}
    assert levels["frame_consistency/跳变"] == "fail"


def test_dhash_identical_and_gradient_flip():
    a = imaging.dhash(Image.new("RGB", (64, 64), (100, 100, 100)))
    assert imaging.hamming_distance(a, a) == 0
    g1 = imaging.dhash(_gradient_img((32, 32)))
    g2 = imaging.dhash(_gradient_img((32, 32), reverse=True))
    assert imaging.hamming_distance(g1, g2) == 64  # 结构翻转 = 全位翻转


def _gradient_img(size, reverse=False):
    from PIL import Image as _I
    w, h = size
    img = _I.new("L", size)
    img.putdata([((w - 1 - x) if reverse else x) * 255 // (w - 1)
                 for y in range(h) for x in range(w)])
    return img.convert("RGB")


def test_missing_frame_fails_end_to_end(tmp_path):
    art = tmp_path / "eff"
    docs = tmp_path / "docs"
    docs.mkdir(parents=True)
    manifest_file = docs / "清单.md"
    manifest_file.write_text(
        "| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |\n"
        "|---|---|---|---|---|---|---|\n"
        "| g001-eff-hit-000 | eff | 特效 | 32x32 frames=3 | 已入库 | a | b |\n",
        encoding="utf-8")
    _frame(art / "g001-eff-hit-000-f01.png", (32, 32), (10, 10, 10))
    _frame(art / "g001-eff-hit-000-f03.png", (32, 32), (10, 10, 10))  # 缺 f02
    code = run_main(["--manifest", str(manifest_file),
                     "--assets-root", str(tmp_path)])
    assert code == 1
    report = json.loads((tmp_path / "evidence" / "资产质检" / "report.json")
                        .read_text(encoding="utf-8"))
    assert "缺帧" in report["entries"][0]["message"]
