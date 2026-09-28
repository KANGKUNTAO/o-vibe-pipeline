"""脚手架模板 — 全部接入文件的唯一定义处,与 manuals 的规范保持一致。"""
from __future__ import annotations

AGENTS_MD = """# AGENTS.md — {title}({name})

接到任何与本工程相关的任务,按以下顺序执行:

1. **先读管线总入口**:`{pipeline_root}\\manuals\\总入口.md`,按五步工作流(需求 → 规划 → 白盒 → 资产精修 → 实机验收)干活,不过关不进下一步。
2. **成品标准**:`{pipeline_root}\\manuals\\验收清单.md` 通用 8 条 + `adapters/platform/{platform}/验收附录.md` 全部打勾才算成品;验收证据存本工程 `evidence/`。
3. **写代码前**:`{pipeline_root}\\manuals\\代码生成.md`(分层契约)+ `{pipeline_root}\\adapters\\cocos\\引擎上下文.md`(API 纪律);机制契约在 `docs/机制契约.md`。
4. **操作 Cocos 编辑器**:用 MCP 工具 `cocos_creator_local`(已在本工程 `.zcode/config.json` 配好),用法见 `{pipeline_root}\\adapters\\cocos\\引擎操作.md`。
5. **两仓分离**:本工程只放本游戏自己的东西;手册/工具/组件库的正本在 vibe-pipeline 仓库,组件库只从 `adapters/cocos/组件库/` 拷**副本**进 `assets/components/`。
6. 资产 ID 前缀 `{name}`,在 `docs/资产清单.md` 冻结;占位文件可用 `tools/placeholder/gen.py` 生成;每件成品资产记录出处与许可证。
"""

GITIGNORE = """# Cocos Creator
library/
temp/
local/
build/

# 工具与依赖
node_modules/
__pycache__/
.venv/

# 本地环境与密钥
.env
*.local
secrets/

# 系统与编辑器
.DS_Store
Thumbs.db
*.log
"""

CONFIG_JSON = """{{
  "mcp": {{
    "servers": {{
      "cocos_creator_local": {{
        "command": "node",
        "args": ["{pipeline_root}/tools/cocos-creator-local-mcp/dist/index.js"],
        "env": {{
          "COCOS_CREATOR_PATH": "{creator_path}"
        }},
        "startup_timeout_sec": 120
      }}
    }}
  }}
}}
"""

CONFIG_JSON_NO_CREATOR = """{{
  "mcp": {{
    "servers": {{
      "cocos_creator_local": {{
        "command": "node",
        "args": ["{pipeline_root}/tools/cocos-creator-local-mcp/dist/index.js"],
        "startup_timeout_sec": 120
      }}
    }}
  }}
}}
"""

KANRIBA_MD = """# 立项卡 — {title}({name})

> 八项无空缺才算立项完成(规范见 `{pipeline_root}/manuals/玩法切片.md`)。

- 游戏代号:{name}
- 目标平台:{platform}
- 引擎:{engine}
- 品类:
- 核心循环(一句话):
- 变现模式(选项随平台,如微信:纯广告 / 内购 / 混合;未定则本卡未完成):
- 内容量目标(关数/天数 + 基线依据):
- 八件套范围:做 [ ] / 裁剪 [ ](逐项列)
- 美术风格 + 参考图路径:
- 预算:默认零成本(免费额度内);超支需批准
- 附:目标平台当期规则核实结论与日期;性能口径(机型/帧率/内存)
"""

DESIGN_MD = """# 设计说明书 — {title}({name})

> 规范见 `{pipeline_root}/manuals/玩法切片.md`(必答八问 / 章节分解 / 交互规格六段式 / 语义色板)。

## 必答八问

1. 一局怎么开始、怎么结束?
2. 玩家的主要动词是什么?每 10 秒重复几次?
3. 胜负怎么判?失败重开有几种入口?
4. 进度怎么留?(关卡进度/存档结构)
5. 引导流程:第一次进游戏的 30 秒发生什么?
6. 数值骨架:货币几种、获得/消耗路径?
7. 界面清单:每个界面的元素与跳转(screen-NNN)
8. 本品类"好玩"的判定:参考标杆与爽点?

## 章节分解表

| id | 名称 | 引用需求 | 时长 | 进入条件 | 目标与节拍 | 引入机制 | 退出条件 | 重试/存档 | 资产/界面引用 | 验收 |
|---|---|---|---|---|---|---|---|---|---|---|

## 交互规格(六段式,逐特性:意图/规则/输入/状态/反馈/验收)

| 特性 | 意图 | 规则 | 输入 | 状态 | 反馈 | 验收 | 绑定命令/事件 |
|---|---|---|---|---|---|---|---|

## 白盒语义色板图例(先于白盒存在)

| semantic_id | 含义 | 颜色 | 辅助线索 | 适用资产 |
|---|---|---|---|---|
"""

ASSETS_MD = """# 资产清单 — {title}({name})

> ID 冻结即契约;规格 cell 支持机器可读 token:`128x128`、`frames=6`、`alpha`/`nonalpha`。
> 占位文件可由 `tools/placeholder/gen.py` 按 本清单 批量生成。

| ID | 类别 | 用途 | 规格 | 状态 | 出处 | 许可证 |
|---|---|---|---|---|---|---|
| {name}-spr-example-000 | spr | (示例行,改成真实资产) | 128x128 alpha | 占位 | | |
"""

LEDGER_MD = """# 任务台账 — {title}({name})

> 协议见 `{pipeline_root}/manuals/玩法切片.md`:needs_detail → ready → in_progress → review → done(+blocked)。
> ready 才许开工;review 要挂产出与证据;设计变更 → 受影响任务重开,旧证据不算数。

| id | title | 所属 | 引用(req/beat/screen/asset) | 工种 | 依赖 | 验收 | 状态 | 阻塞原因 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
"""

CONTRACT_MD = """# 机制契约 — {title}({name})

> 协议见 `{pipeline_root}/manuals/代码生成.md`:契约表面是 UI 唯一可依赖的东西;改表面 = 设计变更(触发任务台账重开)。

## 状态(State)

| 字段 | 类型 | 含义 |
|---|---|---|

## 事件(Event)

| 事件名 | 载荷 | 触发时机 |
|---|---|---|

## 命令(Command)

| 命令 | 参数 | 效果 |
|---|---|---|

## UI 绑定清单

| UI 元素(screen-NNN) | 绑定(命令 / 状态 / 事件) |
|---|---|
"""


def render(ctx: dict) -> dict[str, str]:
    """按上下文渲染全部文件:{相对路径: 内容}。"""
    creator_path = ctx.get("creator_path") or ""
    config = (CONFIG_JSON.format(**ctx) if creator_path
              else CONFIG_JSON_NO_CREATOR.format(**ctx))
    return {
        "AGENTS.md": AGENTS_MD.format(**ctx),
        ".zcode/config.json": config,
        ".gitignore": GITIGNORE,
        "docs/立项卡.md": KANRIBA_MD.format(**ctx),
        "docs/设计说明书.md": DESIGN_MD.format(**ctx),
        "docs/资产清单.md": ASSETS_MD.format(**ctx),
        "docs/任务台账.md": LEDGER_MD.format(**ctx),
        "docs/机制契约.md": CONTRACT_MD.format(**ctx),
        "evidence/.gitkeep": "",
        "assets/art/.gitkeep": "",
    }
