from PIL import Image

from placeholder.gen import main as gen_main

MANIFEST = """| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |
|---|---|---|---|---|---|---|
| g001-spr-gem-red-000 | spr | 红宝石 | 64x64 alpha | 占位 | | |
| g001-eff-spark-000 | eff | 火花 | 32x32 frames=3 | 占位 | | |
| g001-spr-done-000 | spr | 已有文件 | 64x64 | 占位 | | |
| g001-audio-bgm-000 | audio | 音乐 | | 缺口 | | |
"""


def test_placeholder_generation(tmp_path):
    manifest = tmp_path / "docs" / "资产清单.md"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(MANIFEST, encoding="utf-8")
    art = tmp_path / "assets" / "art"
    done = art / "spr" / "g001-spr-done-000.png"
    done.parent.mkdir(parents=True)
    Image.new("RGB", (64, 64), (10, 10, 10)).save(done)  # 已存在的占位

    code = gen_main(["--manifest", str(manifest),
                     "--legend", _write_legend(tmp_path)])
    assert code == 0
    gem = art / "spr" / "g001-spr-gem-red-000.png"
    assert gem.is_file()
    img = Image.open(gem)
    assert img.size == (64, 64)
    assert img.mode == "RGBA"  # 清单标 alpha → 占位图带透明通道
    # 语义色板:ID 含 "red" → 红系(R 明显高于 G/B)
    r, g, b = img.convert("RGB").getpixel((30, 30))
    assert r > g and r > b
    # 帧序列 3 帧
    for i in range(1, 4):
        assert (art / "eff" / f"g001-eff-spark-000-f{i:02d}.png").is_file()
    # 已存在未 --force → 跳过(内容不变)
    before = done.read_bytes()
    gen_main(["--manifest", str(manifest), "--force"])
    assert done.read_bytes() != before  # force 后覆盖
    # 音频类不生成
    assert not (art / "audio").exists()


def _write_legend(tmp_path):
    legend = tmp_path / "legend.json"
    legend.write_text('{"red": "#e74c3c"}', encoding="utf-8")
    return str(legend)
