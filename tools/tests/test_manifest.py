from lib import manifest

SAMPLE = """
# 资产清单

| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |
|---|---|---|---|---|---|---|
| g001-spr-gem-red-000 | spr | 红色宝石 | 128x128 alpha | 已入库 | 生成:xx 2026-09-29 | 无 |
| g001-eff-spark-000 | eff | 火花动画 | 64x64 frames=6 | 占位 | | |
| g001-audio-bgm-000 | audio | 背景音乐 | 循环无缝 | 缺口 | | |
| g001-spr-icon-000 | spr | 图标 | 64x64 nonalpha | 占位 | | |
"""


def test_parse_manifest_rows():
    rows = manifest.parse_manifest(SAMPLE)
    assert len(rows) == 4
    assert rows[0]["ID"] == "g001-spr-gem-red-000"
    assert rows[0]["类别"] == "spr"
    assert rows[1]["状态"] == "占位"


def test_parse_spec_tokens():
    spec = manifest.parse_spec("128x128 alpha")
    assert spec["size"] == (128, 128)
    assert spec["alpha"] is True
    spec = manifest.parse_spec("64x64 frames=6")
    assert spec["size"] == (64, 64)
    assert spec["frames"] == 6
    spec = manifest.parse_spec("nonalpha")
    assert spec["alpha"] is False
    assert manifest.parse_spec("循环无缝")["size"] is None


def test_no_header_returns_empty():
    assert manifest.parse_manifest("随便写点什么,没有表格") == []
