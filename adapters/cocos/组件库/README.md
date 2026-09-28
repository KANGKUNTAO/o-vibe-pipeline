# 商业化组件库(M4)— 休闲游戏「标配八件套」

> 休闲小游戏的系统层高度同质:签到、商店、分享、排行榜、红点、广告位、设置、成就/任务。把它们做成可复用 Cocos 组件,新游戏拷副本、填配置、接回调即可上线系统层。  
> 状态:settings/reddot/signin/adslot/shop/achievement/share 已实现(logic 核 66 测试全绿);其余为接口约定,随 001 的 M4 阶段落地。

## 架构分层(2026-09-29 定稿,遵守 manuals/代码生成.md)

```
组件/<组件名>/
├── logic.ts   逻辑核:纯 TS、零引擎依赖、零跨文件 import(self-contained),
│              Node 原生类型剥离直接测试 —— 与游戏机制层同等纪律
└── ui.ts      UI 绑定:在 Cocos Creator 工程内编译;@property 拖绑定;
               禁止组件自建存档/平台调用,logic 与 adapter 由游戏组装层注入
core/contracts.ts     平台能力与存档的唯一接口定义(改它 = 设计变更)
wechat-adapter/       微信实现:mock.ts(本地开发)+ wechat.ts(真机骨架)
                      + 开放数据域.md(好友排行榜的正确姿势,必读)
tests/                逻辑核测试:cd 本目录 && npm test(node --test,零 npm 依赖)
```

- logic 核刻意自包含(最小本地接口),避免"Node 要扩展名/引擎忌扩展名"的冲突;跨文件契约只在 core 与 adapter 层。
- ui.ts 里 `import { xxx } from "./logic"` 用无扩展名(Cocos 惯例);测试只 import logic(带 .ts)。
- 平台能力(登录/广告/分享/排行榜/震动)一律走 `IPlatformAdapter`;**好友榜的读+渲染在微信上必须走开放数据域**(见 wechat-adapter/开放数据域.md)。

## 分发规则(两仓分离)

- **正本在此目录**:`adapters/cocos/组件库/<组件名>/`(Prefab + 脚本 + README)
- 游戏工程放**副本**:立项时整目录拷入 `<工程>/assets/components/`,游戏内修改不影响正本
- 正本升级 → 手动同步副本,同步记录写进本文件末尾的"版本记录"

## 八件套组件清单与接口约定

每个组件统一遵守:**配置进 Component 属性(可编辑器配置)、数据走存档接口、事件用 Cocos EventTarget 对外广播、文案/美术资源可整体替换、无平台网络逻辑(平台 SDK 一律走平台适配层)**。

| 组件                  | 职责                      | 关键配置(props)    | 对外事件                               |
| ------------------- | ----------------------- | -------------- | ---------------------------------- |
| `signin` 连续签到       | 签到日历、补签、奖励发放            | 奖励表、连签天数、补签消耗  | `signin:claimed`                   |
| `shop` 商店/兑换        | 商品列表、货币兑换、购买确认          | 货币类型、商品表       | `shop:purchase`                    |
| `share` 分享          | 分享卡片构造、分享回流奖励           | 分享文案/图配置、奖励表   | `share:done`                       |
| `leaderboard` 排行榜   | 好友榜/全球榜渲染、上报分数          | 榜单类型、刷新间隔      | `leaderboard:updated`              |
| `reddot` 红点         | 树形红点状态管理与显示             | 节点路径注册表        | `reddot:changed`                   |
| `adslot` 广告位        | Banner/激励视频/插屏封装、加载失败降级 | 广告位 ID、类型、降级策略 | `ad:shown` `ad:failed` `ad:reward` |
| `settings` 设置       | 音效/音乐/震动开关、隐私协议入口、重新授权  | 开关项列表          | `settings:changed`                 |
| `achievement` 成就/任务 | 任务列表、进度、领奖              | 任务表、成就表        | `achievement:done`                 |

## 平台适配层(随组件库提供)

`组件库/wechat-adapter/`:微信 SDK 封装——平台适配层的第一个实例。组件只依赖适配层的统一接口(`core/contracts.ts`),**接入新平台 = 新增 `<platform>-adapter/` 目录,组件代码零改动**。

| 文件 | 用途 |
| --- | --- |
| `mock.ts` | 本地开发期 mock:一切立即成功、调用可断言(纯本地玩法用占位 appid) |
| `wechat.ts` | 微信实现骨架:登录/分享/激励视频(含无填充降级)/Banner/插屏/震动 |
| `开放数据域.md` | **好友排行榜必读**:主域拿不到好友关系链,必须走开放数据域(独立上下文 + sharedCanvas) |

真实 appid/密钥只进环境变量与平台后台,绝不入库。

## 组件状态

| 组件 | 状态 |
| --- | --- |
| `settings` | ✅ logic+ui,5 测试(含存档版本迁移协议参考实现) |
| `reddot` | ✅ logic+ui,5 测试(树形聚合/脏链传播) |
| `signin` | ✅ logic+ui,13 测试(自然日周期网格/补签限次+补签卡钱包/全勤奖/跨周期滚动/时钟回拨安全) |
| `adslot` | ✅ logic+ui,11 测试(防连点/连续失败冷却且跨会话持久/降级发奖开关/插屏+Banner 事件流) |
| `shop` | ✅ logic+ui,10 测试(商品表/每日+终身限购/钱包扣款/发放指令不入包/损坏档兜底) |
| `achievement` | ✅ logic+ui,11 测试(sum/max 双模式计数器/done 恰好一次/领奖发放指令/同计数器歧义校验) |
| `share` | ✅ logic+ui,11 测试(场景卡片/每日限次+冷却防刷/防连点/适配层异常降级) |
| `leaderboard` | ⬜ 接口已约定,随 001 M4 落地 |

## 实现纪律

- 每个组件交付时必须带:使用 README、最小示例场景、mock 数据下的操作录屏证据
- 组件内的美术资源默认占位(状态=占位,进游戏 manifest),由 M2 流程精修
- 版本记录(正本变更 → 哪些游戏副本同步过):见下

## 版本记录

| 日期 | 变更   | 同步到 |
| -- | ---- | --- |
| 2026-09-29 | signin 组件落地(logic+ui+13 测试;周期按自然日网格对齐,补签走钱包接口) | 尚无游戏副本 |
| 2026-09-29 | adslot 组件落地(logic+ui+11 测试;冷却/防连点状态按 placement 进存档,跨会话生效) | 尚无游戏副本 |
