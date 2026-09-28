# tools/ — 管线工具层

> 「规范写成代码」的兑现处。手册定义规范,这里把规范变成能跑、能判分、能挂 CI 的脚本。
> 工程契约(平移自 GameFactory develop_harness):**服务对接层 → 算子层 → 运行层,依赖只向下;输出路径只在运行层单点注册;每个算子配毫秒级 stub 测试。**

## 工具索引

| 工具 | 状态 | 用途 | 用法 |
|---|---|---|---|
| `scorer/` | ✅ 已实现(尺寸规格+调色板+帧间一致性) | 资产质检评分器 | 见下 |
| `placeholder/` | ✅ 已实现 | 占位资产生成器(占位也挂正式 ID) | 见下 |
| `scaffold/` | ✅ 已实现 | 新游戏脚手架(一条命令接入管线) | 见下 |
| `pkgstats/` | ✅ 已实现 | 构建产物包体统计与大文件审计 | 见下 |
| `关卡校验/` | ⬜ 待建 | 关卡 DSL 结构/可解性/难度曲线 | 等品类 DSL 定稿 |

## 环境要求

- Python 3.10+,`pip install -r tools/requirements.txt`(仅 pillow + pytest)
- 全部本地运行,无 GPU、无网络、毫秒级

## 快速上手(在游戏工程根目录执行)

```bash
# 1. 新游戏接入管线(--into 已有 Cocos 工程 / --new 全新仓库)
python E:/AiProject/vibe-pipeline/tools/scaffold/new_game.py \
    --name g001 --title 我的游戏 --into E:/AiProject/Vibe-OFrame \
    --creator-path D:/CocosEditor/Creator/3.8.8/CocosCreator.exe

# 2. 按清单批量生成占位资产(白盒阶段)
python E:/AiProject/vibe-pipeline/tools/placeholder/gen.py --manifest docs/资产清单.md

# 3. 资产质检(尺寸规格+调色板+帧间一致性;--ref 给风格锚点图)
python E:/AiProject/vibe-pipeline/tools/scorer/run.py \
    --manifest docs/资产清单.md --assets-root assets/art \
    --ref assets/art/spr/g001-spr-anchor-000.png

# 4. 构建产物包体审计(微信交付检查链)
python E:/AiProject/vibe-pipeline/tools/pkgstats/run.py \
    --build-dir build/wechatgame --budget-mb 4
```

评分器退出码:有 fail/missing → 1,否则 0(可挂 CI 卡关)。报告写 `evidence/资产质检/report.json`。

## 资产清单的机器可读约定

清单是 markdown 表(`manuals/玩法切片.md` 定义),规格 cell 里解析器认识这些 token:

| token | 含义 | 例 |
|---|---|---|
| `128x128` | 尺寸要求(不写则 spr/eff/tileset 检查 2 的幂,仅警告) | `64x64` |
| `frames=N` | 帧数(占位生成器出 N 帧;帧间一致性检查器输入) | `frames=6` |
| `alpha` / `nonalpha` | 透明底要求(spr 默认期望 alpha,标 nonalpha 关闭) | `alpha` |

## 工程契约(给将来写新工具的人)

1. **三层,依赖只向下**:服务对接层(调一个服务/读一类文件,不懂任务)→ 算子层(任务→产物+结论,纯函数)→ 运行层(CLI+批量+路径注册)。
2. **路径单点注册**:输出路径只在运行层出现;算子里出现字面输出路径 = bug。
3. **算子纯函数**:输入产出对象,不读盘、不打印;测试毫秒级,无 GPU 无网。
4. **反模式**:算子里写 argparse、算子自建服务客户端、`except: pass` 吞错、测试只构造不验证。
5. 共享解析器放 `lib/`(目前:资产清单);禁止各工具私抄一份。

## 开发

```bash
python -m pytest tools/tests -q   # 全部测试,毫秒级
```
