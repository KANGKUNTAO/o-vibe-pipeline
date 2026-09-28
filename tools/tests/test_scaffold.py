from scaffold.new_game import main as scaffold_main
from scaffold.templates import render


def _ctx():
    return {"name": "g001", "title": "测试游戏", "platform": "wechat", "engine": "cocos",
            "pipeline_root": "E:/AiProject/vibe-pipeline",
            "creator_path": "D:/CocosEditor/Creator/3.8.8/CocosCreator.exe", "date": "2026-09-29"}


def test_render_all_files():
    files = render(_ctx())
    expected = {"AGENTS.md", ".zcode/config.json", ".gitignore", "docs/立项卡.md",
                "docs/设计说明书.md", "docs/资产清单.md", "docs/任务台账.md",
                "docs/机制契约.md", "evidence/.gitkeep", "assets/art/.gitkeep"}
    assert expected == set(files)
    assert "manuals" in files["AGENTS.md"].replace("\\", "/")
    assert "g001" in files["docs/资产清单.md"]
    assert "cocos_creator_local" in files[".zcode/config.json"]


def test_scaffold_into_and_no_overwrite(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    (target / "AGENTS.md").write_text("既有内容", encoding="utf-8")
    code = scaffold_main(["--name", "g002", "--into", str(target)])
    assert code == 0
    # AGENTS.md 已存在 → 保留;其余生成
    assert (target / "AGENTS.md").read_text(encoding="utf-8") == "既有内容"
    assert (target / "docs" / "立项卡.md").is_file()
    assert (target / ".zcode" / "config.json").is_file()
    # --force 才覆盖
    scaffold_main(["--name", "g002", "--into", str(target), "--force"])
    assert "g002" in (target / "AGENTS.md").read_text(encoding="utf-8")


def test_scaffold_new_git_init(tmp_path):
    target = tmp_path / "g003"
    code = scaffold_main(["--name", "g003", "--new", str(target)])
    assert code == 0
    assert (target / ".git").is_dir()
    assert (target / "docs" / "机制契约.md").is_file()
