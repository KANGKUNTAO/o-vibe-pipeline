# HANDOFF — vibe-pipeline 项目交接文档

> 本文档由上一个会话（2026-09-29）整理，供新会话无缝接续。
> 新会话第一件事：通读本文档，然后按"下一步行动"开工。
> **⚠ 2026-09-29 后续更正**：用户澄清目标是 **2D 游戏管线（不限微信小游戏）**，微信只是首个平台适配实例；仓库文件夹已英文化（manuals/tools）。本文档作历史记录保留，最新定位见 README 与 `docs/架构决策.md` 决策 2。

---

## 一、用户画像与目标（已锁定，勿再确认）

- 用户是 **2D 游戏开发者，使用 Cocos Creator（3.8.8）**，目标平台是**微信小游戏**
- 核心目标：**打造一条"2D 微信小游戏从需求直达成品"的 AI 生产管线**（不是做某一款游戏，是做管线本身）
- 明确不要：3A/重度游戏方向；"只做到可玩切片就停"的方向
- 量级定位：微信小游戏（如消除、合成、放置、跑酷这类休闲品类）
- 沟通偏好：**先说结论，通俗易懂，避免黑话堆砌**；重大架构决策先讲清楚再动手

## 二、项目背景（我们研究了什么）

1. **GameFactory-3A**（北大开源）已克隆到 `E:\AiProject\GameFactory-3A`（只读参考）
   - GitHub: https://github.com/OpenDCAI/GameFactory-3A （Apache 2.0）
   - 它是"给 Coding Agent 用的 3A 游戏生产框架"：agent_skills（Markdown 手册）+ pipeline/operators/models（可执行工具）+ engine_adapters（5 引擎参考工程）
   - 核心结论：**它的 3D 代码我们用不上，但它验证了"给 AI 写手册+工具，AI 就能承担生产线"这条路，且它的架构与工作纪律可直接平移**
   - 值得精读的文件：`agent_skills/setting_overview.md`（总入口路由 + 五步工作流 + 验收标准）
2. **Cocos MCP 生态**（引擎适配层现成，无需自研）：
   - https://github.com/DaxianLee/cocos-mcp-server （158+ 工具）
   - https://github.com/lightblink/cocos-creator-local-mcp （支持构建微信小游戏）
   - https://github.com/FunplayAI/funplay-cocos-mcp （MIT）、https://github.com/RomaRogov/cocos-mcp 、cocos-code-mode
3. **2D 资产生成现状**：PixelLab、Rosebud PixelVibe 等工具可用；行业未解难题 = **帧间一致性 + 风格全局一致性**；应对 = 图生图精修 + 后处理 + **把质检做成确定性评分器**（这是管线差异化重点）

## 三、已定架构决策（不要推翻，除非用户主动重议）

1. **分层**：agent_skills（手册）为核心 / operators+metrics（工具）为双手 / eval harness（质检关卡）为卡尺。**不自研 Agent 运行时（harness）**——用现成编程智能体（Claude Code / ZCode 等）当运行时
2. **引擎无关核心 + 薄适配器**：管线核心（manuals/tools/契约）不依赖任何引擎；Cocos 只是 `adapters/cocos/` 下的第一个适配器 + 验收锚点
3. **两仓分离**（用户明确纠正过，务必遵守）：
   - 本仓库 `E:\AiProject\vibe-pipeline` = 管线（可复用资产，manuals/tools/组件库正本）
   - 游戏工程独立建仓，每个游戏只放该游戏自己的东西，通过工程根目录一个 `AGENTS.md` 指针（"先读 ../vibe-pipeline/manuals/总入口.md"）接入管线
   - 商业化组件库的**正本**在 `adapters/cocos/`，游戏工程里放副本
4. **不做 UI**：界面 = 聊天窗口 + Cocos 编辑器（经 MCP 实时可视）+ 生成的素材 + 游戏本体；仪表盘等以后再说
5. **产品化暂缓**：先用 001 项目跑出"快多少/省多少"的数据再决定商业化路径（内部成本优势 > 组件 API > 开源 > SaaS）

## 四、管线路线图（五大模块）

| 模块 | 内容 | 来源 |
|---|---|---|
| M1 玩法切片链路 | 需求 → 白盒 → 可玩循环 | GameFactory 方法论平移 |
| M2 资产生成+质检 | 立绘/动画帧/tileset/UI 生成 + 评分器（调色板 diff、帧间一致性） | GameFactory 架构 + 2D 重写 |
| M3 内容量产线 | 关卡 DSL → 批量生成 → 数值表校验 | 全新（成品与切片的分水岭） |
| M4 商业化组件库 | 休闲游戏"标配八件套"做成可复用 Cocos 组件 | 全新 |
| M5 微信交付链路 | SDK 接入、分包预算检查、性能质检、提审材料 | 全新 |

**贯穿性工作纪律**（从 GameFactory 平移）：白盒先行、资产 ID 稳定（manifest 契约）、资产决策策略（先生成→不达标用有授权来源→再不行如实上报，全程记录出处许可证）、验收即录屏（"能编译"不算完成）、**规范尽量写成代码而不是文字**（可执行的规范才有约束力）。

## 五、"成品"验收清单（北极星，将写成 manuals/验收清单.md）

微信小游戏"成品" = 以下 8 条全部打勾：

1. 玩法闭环完整（核心玩法 + 引导 + 胜负重来循环）
2. 内容量达品类及格线（如消除类 40+ 关）
3. 系统完整（八件套：签到、商店/兑换、分享、排行榜、红点、广告位、设置、成就/任务）
4. 微信接入（登录、Banner/激励视频/插屏广告、分享、侧边栏/收藏位）
5. 包体合规（主包 ≤4MB；整包上限**开工时核实当期规则**）
6. 性能达标（中端机稳定帧率、内存、发热）
7. 提审合规（隐私协议、健康系统；**内购需版号——纯广告变现是规避路径，此决策要早做**）
8. 埋点齐全（留存、广告 eCPM 相关关键事件）

## 六、现有环境与素材

- `E:\AiProject\vibe-pipeline\`：本仓库（目前只有本文件，git 尚未 init——初始化和搭骨架就是第一个任务）
- `E:\AiProject\Vibe-OFrame\`：空 Cocos Creator 3.8.8 工程（git 已 init 无提交，assets 为空）→ 拟作为 **001 号试验游戏**
- `E:\AiProject\GameFactory-3A\`：参考仓库（只读）
- 预算约束：起步阶段零成本方案（云端 API 免费额度：Meshy 注册送 100 点/月、Tripo 送 2000 点；不需要 GPU；three.js/Godot 零安装，本项目用 Cocos 需本机已装 Creator 3.8.8——已确认存在）

## 七、下一步行动（按序执行）

1. **搭管线仓库骨架**：git init；建 `manuals/`、`tools/`、`adapters/cocos/`、`docs/`；写 `manuals/总入口.md`（AI 工作流路由：五步流程 = 明确需求→规划设计→白盒→资产精修→实机验收，参考 GameFactory 的 setting_overview.md 改写成 2D+Cocos 版）和 `manuals/验收清单.md`（上面 8 条的正式版）
2. **接通引擎**：调研并安装 cocos-mcp-server（优先 DaxianLee 版或 lightblink 版，看微信构建支持），在 Vibe-OFrame 里写 AGENTS.md 指针，验证"AI 操作 Cocos 编辑器"链路
3. **001 项目立项**：游戏类型建议消除类或合成类（体量最小但能五模块全开火；**用户尚未最终确认类型，开工前问一句**），跑 M1 出白盒

## 八、待用户决策的事项

- [ ] 001 号游戏的具体类型/题材（建议：消除或合成）
- [ ] Vibe-OFrame 这个名字留给游戏工程还是改名（用户起名原意待确认）
- [ ] 变现模式早决策：纯广告（免版号）vs 内购（需版号）
