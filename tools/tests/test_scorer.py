import json

from PIL import Image

from scorer import imaging
from scorer.operators import palette, size_spec
from scorer.run import main as run_main


def _png(path, size, color, mode="RGB"):
    img = Image.new(mode, size, color)
    if mode == "RGBA":
        img.putalpha(255)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def test_size_spec_all_levels(tmp_path):
    good = tmp_path / "g001-spr-ok-000.png"
    _png(good, (128, 128), (80, 160, 80), mode="RGBA")
    image = imaging.load_full(str(good))
    entry = {"ID": "g001-spr-ok-000", "类别": "spr"}
    results = size_spec.check_entry(entry, str(good), image,
                                    {"size": (128, 128), "alpha": True})
    assert all(r["level"] == "pass" for r in results)

    # 尺寸不符 → fail;spr 无 alpha 通道 → 默认期望 warn
    bad = tmp_path / "g001-spr-bad-000.png"
    _png(bad, (100, 90), (200, 60, 60), mode="RGB")
    image_bad = imaging.load_full(str(bad))
    results = size_spec.check_entry({"ID": "g001-spr-bad-000", "类别": "spr"},
                                    str(bad), image_bad, {"size": (128, 128)})
    levels = {r["check"]: r["level"] for r in results}
    assert levels["size_spec/尺寸"] == "fail"
    assert levels["size_spec/透明底"] == "warn"

    # 显式要求 alpha 而图像没有 → fail
    results = size_spec.check_entry({"ID": "g001-spr-bad-000", "类别": "spr"},
                                    str(bad), image_bad, {"size": (128, 128), "alpha": True})
    levels = {r["check"]: r["level"] for r in results}
    assert levels["size_spec/透明底"] == "fail"

    # 命名不符 → fail
    results = size_spec.check_entry({"ID": "g001-spr-other-000", "类别": "spr"},
                                    str(bad), image_bad, {})
    assert results[0]["level"] == "fail"


def test_palette_pass_and_fail(tmp_path):
    anchor = tmp_path / "anchor.png"
    _png(anchor, (64, 64), (90, 170, 90))  # 绿色锚点
    ref = [c["rgb"] for c in imaging.dominant_colors(imaging.load_rgb_small(str(anchor)))]

    near = tmp_path / "near.png"
    _png(near, (64, 64), (110, 180, 100))  # 近绿 → pass
    near_colors = imaging.dominant_colors(imaging.load_rgb_small(str(near)))
    assert palette.check(near_colors, ref)["level"] == "pass"

    far = tmp_path / "far.png"
    _png(far, (64, 64), (200, 60, 60))  # 红 → fail
    far_colors = imaging.dominant_colors(imaging.load_rgb_small(str(far)))
    result = palette.check(far_colors, ref)
    assert result["level"] == "fail"
    assert result["detail"]["mean_delta_e"] > 16.0


def test_palette_lab_known_values():
    # 同色 ΔE=0;黑白 ΔE≈100
    gray = (128, 128, 128)
    assert palette.delta_e(gray, gray) == 0.0
    assert palette.delta_e((255, 255, 255), (0, 0, 0)) > 90


def _make_project(tmp_path):
    """搭一个迷你游戏工程:清单 + 已入库资产 + 占位资产。"""
    docs = tmp_path / "docs"
    art = tmp_path / "assets" / "art" / "spr"
    docs.mkdir(parents=True)
    anchor = art / "g001-spr-anchor-000.png"
    _png(anchor, (64, 64), (90, 170, 90), mode="RGBA")
    good = art / "g001-spr-good-000.png"
    _png(good, (64, 64), (100, 175, 95), mode="RGBA")
    bad = art / "g001-spr-bad-000.png"
    _png(bad, (100, 90), (200, 60, 60), mode="RGB")
    (docs / "资产清单.md").write_text(
        "| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |\n"
        "|---|---|---|---|---|---|---|\n"
        "| g001-spr-anchor-000 | spr | 风格锚点 | 64x64 alpha | 已入库 | a | b |\n"
        "| g001-spr-good-000 | spr | 近色资产 | 64x64 alpha | 已入库 | a | b |\n"
        "| g001-spr-bad-000 | spr | 错误资产 | 64x64 alpha | 已入库 | a | b |\n"
        "| g001-spr-miss-000 | spr | 缺文件 | 64x64 | 已入库 | | |\n"
        "| g001-audio-bgm-000 | audio | 音乐 | | 缺口 | | |\n",
        encoding="utf-8")
    return anchor, docs


def test_frame_sequence_recognized(tmp_path):
    """帧序列资产:主文件缺失时认第一帧,命名检查容忍 -fNN 后缀。"""
    art = tmp_path / "eff"
    art.mkdir(parents=True)
    manifest_file = tmp_path / "清单.md"
    manifest_file.write_text(
        "| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |\n"
        "|---|---|---|---|---|---|---|\n"
        "| g001-eff-hit-000 | eff | 特效 | 32x32 frames=3 | 已入库 | a | b |\n",
        encoding="utf-8")
    _png(art / "g001-eff-hit-000-f01.png", (32, 32), (10, 10, 10), mode="RGBA")
    from scorer.run import find_asset_file
    entry = {"ID": "g001-eff-hit-000", "类别": "eff", "规格": "32x32 frames=3"}
    found = find_asset_file(tmp_path, entry)
    assert found is not None and found.stem == "g001-eff-hit-000-f01"
    image = imaging.load_full(str(found))
    results = size_spec.check_entry(entry, str(found), image, {"size": (32, 32)})
    assert results[0]["level"] == "pass"  # 命名检查容忍帧后缀


def test_scorer_end_to_end(tmp_path):
    anchor, docs = _make_project(tmp_path)
    code = run_main(["--manifest", str(docs / "资产清单.md"),
                     "--assets-root", str(tmp_path / "assets" / "art"),
                     "--ref", str(anchor)])
    report_path = tmp_path / "evidence" / "资产质检" / "report.json"
    assert report_path.is_file()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in report["entries"]}
    assert by_id["g001-spr-good-000"]["level"] == "pass"
    assert by_id["g001-spr-bad-000"]["level"] == "fail"   # 尺寸+调色板双杀
    assert by_id["g001-spr-miss-000"]["level"] == "missing"
    assert by_id["g001-audio-bgm-000"]["level"] == "skip"
    assert code == 1  # 有 fail → 退出码 1
