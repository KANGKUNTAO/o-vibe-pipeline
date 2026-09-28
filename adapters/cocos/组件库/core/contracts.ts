/**
 * 组件库核心契约 — 所有组件与平台适配层的唯一接口定义。
 *
 * 纪律(manuals/代码生成.md):
 *  - 组件只依赖本文件声明的接口,禁止直接调用任何平台 SDK;
 *  - 平台差异全部收敛在 <platform>-adapter/ 实现;
 *  - 本文件是"写下来的契约",改接口 = 设计变更(触发任务台账重开)。
 *
 * 说明:接口刻意自包含,不跨文件 import,保证复制进游戏工程后零构建依赖。
 */

/** 登录结果(平台无关) */
export interface LoginResult {
  userId: string;
  nickname: string;
  avatar: string;
}

/** 激励视频结果:completed=false 时必有 error 说明(降级提示用) */
export interface RewardedResult {
  completed: boolean;
  error?: string;
}

/** 分享载荷 */
export interface SharePayload {
  title: string;
  imageUrl?: string;
  query?: string;
}

/** 好友/群排行榜:微信走开放数据域,见 wechat-adapter/开放数据域.md */
export interface ILeaderboard {
  /** 提交自己的分数(主域安全 API) */
  submitScore(score: number): void;
  /** 该平台是否支持好友榜渲染(微信=true,经开放数据域) */
  supportsFriendList(): boolean;
}

/** 平台适配层:组件唯一允许的平台能力入口 */
export interface IPlatformAdapter {
  readonly name: string;
  login(): Promise<LoginResult>;
  share(payload: SharePayload): Promise<boolean>;
  showRewardedVideo(placement: string): Promise<RewardedResult>;
  showBanner(placement: string, show: boolean): void;
  showInterstitial(placement: string): Promise<boolean>;
  readonly leaderboard: ILeaderboard;
  vibrate(short: boolean): void;
}

/** 存档接口:组件持久化的唯一通道,实现方负责落盘时机与键名前缀 */
export interface ISaveStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}
