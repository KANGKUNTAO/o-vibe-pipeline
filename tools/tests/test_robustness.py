"""健壮性测试:坏文件/缺失文件必须降级为可读结论,不允许栈回溯崩溃。"""
import json

from placeholder.gen import main as gen_main
from scorer.run import main as run_main


def _write_manifest(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |\n"
        "|---|---|---|---|---|---|---|\n" + rows, encoding="utf-8")


def test_corrupt_png_fails_gracefully(tmp_path, capsys):
    """损坏 PNG:该条 fail、继续评完、退出码 1、无栈回溯、报告有记录。"""
    docs = tmp_path / "docs"
    art = tmp_path / "assets" / "art" / "spr"
    art.mkdir(parents=True)
    (art / "g001-spr-corrupt-000.png").write_bytes(b"\xde\xad\xbe\xef" * 25)  # 非图片
    manifest = docs / "资产清单.md"
    _write_manifest(manifest,
                    "| g001-spr-corrupt-000 | spr | 坏图 | 64x64 alpha | 已入库 | a | b |\n")

    code = run_main(["--manifest", str(manifest), "--assets-root", str(tmp_path / "assets" / "art")])
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert "[FAIL" in captured.out  # 终端有可读 fail 行

    report = json.loads((tmp_path / "evidence" / "资产质检" / "report.json")
                        .read_text(encoding="utf-8"))
    entry = report["entries"][0]
    assert entry["level"] == "fail"
    assert entry["checks"][0]["check"] == "load"
    assert "损坏" in entry["checks"][0]["message"]


def test_corrupt_png_does_not_block_other_entries(tmp_path):
    """坏文件只影响自己那一条,后续条目照常评分。"""
    docs = tmp_path / "docs"
    art = tmp_path / "assets" / "art" / "spr"
    art.mkdir(parents=True)
    (art / "g001-spr-broken-000.png").write_bytes(b"\x00" * 100)
    from PIL import Image
    good = Image.new("RGBA", (64, 64), (100, 100, 100, 255))
    good.save(art / "g001-spr-good-000.png")
    manifest = docs / "资产清单.md"
    _write_manifest(manifest,
                    "| g001-spr-broken-000 | spr | 坏图 | | 已入库 | a | b |\n"
                    "| g001-spr-good-000 | spr | 好图 | 64x64 alpha | 已入库 | a | b |\n")

    code = run_main(["--manifest", str(manifest), "--assets-root", str(tmp_path / "assets" / "art")])
    report = json.loads((tmp_path / "evidence" / "资产质检" / "report.json")
                        .read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in report["entries"]}
    assert by_id["g001-spr-broken-000"]["level"] == "fail"
    assert by_id["g001-spr-good-000"]["level"] == "pass"
    assert code == 1


def test_missing_manifest_friendly_error(tmp_path, capsys):
    code = run_main(["--manifest", str(tmp_path / "docs" / "不存在.md"),
                     "--assets-root", str(tmp_path)])
    captured = capsys.readouterr()
    assert code == 1
    assert "清单文件不存在" in captured.out
    assert "Traceback" not in captured.err


def test_placeholder_missing_manifest_friendly_error(tmp_path, capsys):
    code = gen_main(["--manifest", str(tmp_path / "没有.md")])
    captured = capsys.readouterr()
    assert code == 1
    assert "清单文件不存在" in captured.out
    assert "Traceback" not in captured.err


def test_scorer_missing_ref_friendly_error(tmp_path, capsys):
    manifest = tmp_path / "docs" / "资产清单.md"
    _write_manifest(manifest, "")
    code = run_main(["--manifest", str(manifest), "--assets-root", str(tmp_path),
                     "--ref", str(tmp_path / "没有锚点.png")])
    captured = capsys.readouterr()
    assert code == 1
    assert "文件不存在" in captured.out
    assert "Traceback" not in captured.err
