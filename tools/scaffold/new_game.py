"""新游戏脚手架 — 一条命令把一款新游戏接入管线(生成指针/配置/文档骨架)。

两种模式:
    --new  <dir>   全新游戏工程:建目录 + git init + 接入文件(引擎工程本体再用
                   MCP 工具 cocos_local_create_project 创建,或放入已有工程)
    --into <dir>   已有 Cocos 工程接入:只补 AGENTS.md / .zcode/config.json / docs / evidence,
                   绝不碰引擎的 assets 与工程配置

示例:
    python tools/scaffold/new_game.py --name g001 --title 我的小游戏 \
        --into E:/AiProject/Vibe-OFrame --creator-path D:/CocosEditor/Creator/3.8.8/CocosCreator.exe

安全:目标文件已存在时默认跳过(--force 才覆盖);绝不写入 assets/ 下任何游戏内容。
"""
from __future__ import annotations

import argparse
import datetime
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scaffold import templates  # noqa: E402


def build_context(args) -> dict:
    creator_path = args.creator_path or os.environ.get("COCOS_CREATOR_PATH") or ""
    return {
        "name": args.name,
        "title": args.title or args.name,
        "platform": args.platform,
        "engine": args.engine,
        "pipeline_root": Path(args.pipeline_root).resolve().as_posix(),
        "creator_path": creator_path.replace("\\", "/") if creator_path else "",
        "date": datetime.date.today().isoformat(),
    }


def materialize(target: Path, files: dict[str, str], force: bool) -> tuple[list[str], list[str]]:
    written, skipped = [], []
    for rel, content in files.items():
        dest = target / rel
        if dest.exists() and not force:
            skipped.append(rel)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8", newline="\n")
        written.append(rel)
    return written, skipped


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="新游戏脚手架 — 接入 vibe-pipeline")
    parser.add_argument("--name", required=True, help="游戏代号,即资产 ID 前缀(如 g001)")
    parser.add_argument("--title", help="游戏标题(默认用代号)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--new", help="全新游戏工程目录")
    group.add_argument("--into", help="已有 Cocos 工程目录(只补接入文件)")
    parser.add_argument("--platform", default="wechat", help="目标平台(默认 wechat)")
    parser.add_argument("--engine", default="cocos", help="引擎(默认 cocos)")
    parser.add_argument("--pipeline-root", default=str(Path(__file__).resolve().parents[2]),
                        help="vibe-pipeline 仓库根目录")
    parser.add_argument("--creator-path", help="CocosCreator.exe 路径(默认读环境变量)")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的接入文件")
    args = parser.parse_args(argv)

    target = Path(args.new or args.into)
    if args.into and not target.is_dir():
        print(f"[scaffold] --into 目标必须是已存在的工程目录:{target}")
        return 1
    if args.new:
        target.mkdir(parents=True, exist_ok=True)

    files = templates.render(build_context(args))
    written, skipped = materialize(target, files, args.force)

    if args.new:
        git_dir = target / ".git"
        if not git_dir.exists():
            try:
                subprocess.run(["git", "init"], cwd=str(target), check=True,
                               capture_output=True, text=True)
                written.append(".git(已 init)")
            except (OSError, subprocess.CalledProcessError) as exc:
                print(f"[scaffold] git init 失败(不影响文件生成):{exc}")

    print(f"[scaffold] 游戏工程:{target}")
    for rel in written:
        print("  +", rel)
    for rel in skipped:
        print("  =(已存在,跳过)", rel)
    if args.new:
        print("[scaffold] 下一步:用 MCP 工具 cocos_local_create_project 在该目录创建 Cocos 工程,"
              "或把已有引擎工程内容放进来;然后填 docs/立项卡.md 的 8 个空。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
