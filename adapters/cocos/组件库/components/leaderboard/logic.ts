/**
 * leaderboard 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 分数上报治理:best 模式只上报刷新纪录的分数(省平台调用与开放数据域刷新);
 * last 模式每次都报。历史最高分本地留档供主域 UI 展示。
 *
 * 边界(重要):好友榜的**读取与渲染**在微信上必须走开放数据域(独立 JS 上下文
 * + sharedCanvas),不在本组件职责内 —— 见 wechat-adapter/开放数据域.md 与
 * core/contracts.ts 的 ILeaderboard 注释。本组件只管"上报"这一侧。
 */

export type LeaderboardMode = "best" | "last";

export interface LeaderboardConfig {
  /** best = 只报破纪录的分数;last = 每次都报 */
  mode: LeaderboardMode;
}

export const LEADERBOARD_DEFAULTS: LeaderboardConfig = { mode: "best" };

/** 上报面适配(与 core/contracts.ts 的 ILeaderboard.submitScore 结构兼容,刻意自包含) */
export interface LeaderboardAdapterLike {
  submitScore(score: number): void;
}

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export type SubmitResult = {
  /** 是否真的调用了平台上报 */
  submitted: boolean;
  /** 本次分数是否为个人历史新高 */
  isRecord: boolean;
};

export type LeaderboardEvent = { type: "submitted"; score: number; isRecord: boolean };

interface LeaderboardSaveData {
  best: number;
}

const SAVE_KEY = "leaderboard";
const VERSION = 1;

export class LeaderboardLogic {
  private store: SaveLike;
  private adapter: LeaderboardAdapterLike;
  private cfg: LeaderboardConfig;
  private data: LeaderboardSaveData;
  private events: LeaderboardEvent[] = [];

  constructor(store: SaveLike, adapter: LeaderboardAdapterLike, config?: Partial<LeaderboardConfig>) {
    this.store = store;
    this.adapter = adapter;
    this.cfg = { ...LEADERBOARD_DEFAULTS, ...config };
    if (this.cfg.mode !== "best" && this.cfg.mode !== "last") {
      throw new Error("[leaderboard] 配置错误:mode 必须是 best 或 last");
    }
    this.data = this.load();
  }

  /**
   * 上报一局分数。best 模式下分数不破纪录则不上报(返回 submitted=false)。
   * score 必须为非负有限数(内部取整);非法值直接抛错(上报是游戏逻辑 bug)。
   */
  submit(score: number): SubmitResult {
    if (!Number.isFinite(score) || score < 0) {
      throw new Error(`[leaderboard] 分数必须为非负有限数,收到 ${score}`);
    }
    const s = Math.floor(score);
    const isRecord = s > this.data.best;
    const shouldSubmit = this.cfg.mode === "last" || isRecord;
    if (!shouldSubmit) {
      return { submitted: false, isRecord: false };
    }
    this.adapter.submitScore(s);
    if (isRecord) {
      this.data.best = s;
      this.persist();
    }
    this.events.push({ type: "submitted", score: s, isRecord });
    return { submitted: true, isRecord };
  }

  /** 个人历史最高分(主域 UI 展示用;好友榜渲染走开放数据域,见文件头) */
  getBest(): number {
    return this.data.best;
  }

  /** 取走自上次以来的事件(UI 层据此广播 leaderboard:updated) */
  takeEvents(): LeaderboardEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值 */
  private load(): LeaderboardSaveData {
    const raw = this.store.get(SAVE_KEY) as
      | { version?: number; data?: Partial<LeaderboardSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { best: 0 };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<LeaderboardSaveData>);
    return {
      best:
        typeof d.best === "number" && Number.isFinite(d.best) && d.best > 0 ? Math.floor(d.best) : 0,
    };
  }

  private persist(): void {
    this.store.set(SAVE_KEY, { version: VERSION, data: { ...this.data } });
    this.store.flush();
  }
}
