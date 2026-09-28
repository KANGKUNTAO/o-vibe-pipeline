import json

from pkgstats.run import main as pkgstats_main
from pkgstats import run as pkgstats_mod


def _make_build(tmp_path):
    build = tmp_path / "build" / "wechatgame"
    (build / "assets" / "textures").mkdir(parents=True)
    (build / "js").mkdir(parents=True)
    (build / "game.js").write_bytes(b"\0" * (1024 * 512))            # 512KB
    (build / "assets" / "textures" / "bg.png").write_bytes(b"\0" * (300 * 1024))   # 300KB 大文件
    (build / "js" / "main.js").write_bytes(b"\0" * (50 * 1024))
    return build


def test_scan_and_report(tmp_path):
    build = _make_build(tmp_path)
    code = pkgstats_main(["--build-dir", str(build)])
    assert code == 0  # 总体积 < 875KB < 4MB 预算
    report = json.loads((tmp_path / "evidence" / "交付审计" / "pkgstats.json")
                        .read_text(encoding="utf-8"))
    assert report["over_budget"] is False
    assert report["file_count"] == 3
    assert report["by_ext"][".png"] == 300 * 1024
    # 大文件按体积降序:512KB 的 game.js 在 300KB 的 bg.png 前
    assert [f["file"] for f in report["large_files"]] == ["game.js", "assets/textures/bg.png"]
    assert report["subdirs"]["assets/"] > 0


def test_over_budget_exit_code(tmp_path):
    build = _make_build(tmp_path)
    code = pkgstats_main(["--build-dir", str(build), "--budget-mb", "0.5"])
    assert code == 1


def test_human_units():
    assert pkgstats_mod.human(512) == "512B"
    assert pkgstats_mod.human(2048) == "2.0KB"
    assert pkgstats_mod.human(3 * 1024 * 1024) == "3.0MB"
