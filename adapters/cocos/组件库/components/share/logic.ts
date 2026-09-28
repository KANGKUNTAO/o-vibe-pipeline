/**
 * share 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 分享治理:按场景取分享卡片配置,调平台适配层;奖励侧做确定性限流 ——
 * 每日分享奖励限次(dailyRewardLimit)+ 两次获奖励分享的最小间隔(rewardCooldownMs),
 * 防"刷分享"。微信生态合规红线:不强制分享、不诱导分享,奖励策略由游戏把握,
 * 组件只提供限流与事件。奖励产出"发放指令"(rewards),入包由组装层执行。
 * 见 manuals/代码生成.md 与 adapters/platform/wechat/交付.md。
 */

export interface ShareSceneDef {
  /** 场景键,如 "generic" / "resurrect",由游戏组装层按入口传 */
  scene: string;
  title: string;
  imageUrl?: string;
  query?: string;
}

export interface ShareRewardDef {
  itemId: string;
  count: number;
}

export interface ShareConfig {
  scenes: ShareSceneDef[];
  /** 每日最多几次"获奖励的分享"(0 = 永不发奖) */
  dailyRewardLimit: number;
  /** 两次获奖励分享的最小间隔 ms */
  rewardCooldownMs: number;
  /** 分享奖励(发放指令;null = 永不发奖) */
  reward: ShareRewardDef[] | null;
}

export const SHARE_DEFAULTS: ShareConfig = {
  scenes: [{ scene: "generic", title: "一起来玩!" }],
  dailyRewardLimit: 1,
  rewardCooldownMs: 5 * 60 * 1000,
  reward: [{ itemId: "coin", count: 50 }],
};

/** 分享面适配(与 core/contracts.ts 的 IPlatformAdapter.share 结构兼容,刻意自包含) */
export interface ShareAdapterLike {
  share(payload: { title: string; imageUrl?: string; query?: string }): Promise<boolean>;
}

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export type ShareFailReason = "noScene" | "refused" | "error";

export interface ShareOutcome {
  ok: boolean;
  /** 本次分享是否发放了奖励(ok=false 时恒 false) */
  rewarded: boolean;
  /** 发奖时的发放指令 */
  rewards?: ShareRewardDef[];
  /** ok=false 时必有 */
  reason?: ShareFailReason;
  /** 适配层透传的失败说明 */
  detail?: string;
}

export type ShareEvent =
  | { type: "shared"; scene: string; rewarded: boolean }
  | { type: "failed"; scene: string; reason: ShareFailReason; detail?: string };

interface ShareSaveData {
  /** 日计数锚点(本地自然日序号);-1 = 尚未同步 */
  dayOrdinal: number;
  /** 今日已获奖励的分享次数 */
  rewardedToday: number;
  /** 上次获奖励分享的时间戳;0 = 从未 */
  lastRewardedTs: number;
}

const SAVE_KEY = "share";
const VERSION = 1;

export class ShareLogic {
  private store: SaveLike;
  private adapter: ShareAdapterLike;
  private cfg: ShareConfig;
  private data: ShareSaveData;
  private events: ShareEvent[] = [];
  private pending = false;

  constructor(store: SaveLike, adapter: ShareAdapterLike, config?: Partial<ShareConfig>) {
    this.store = store;
    this.adapter = adapter;
    this.cfg = { ...SHARE_DEFAULTS, ...config };
    this.validateConfig();
    this.data = this.load();
  }

  /**
   * 发起分享:平台返回 true 时按限流策略决定是否发奖。
   * 防连点:上一次分享未返回前再次调用静默拒绝(返回 pending)。
   */
  async share(scene: string, now: number): Promise<ShareOutcome> {
    if (this.pending) {
      return { ok: false, rewarded: false, reason: "refused", detail: "pending" };
    }
    const def = this.cfg.scenes.find((s) => s.scene === scene);
    if (!def) {
      return { ok: false, rewarded: false, reason: "noScene" };
    }
    this.pending = true;
    try {
      const launched = await this.adapter.share({ title: def.title, imageUrl: def.imageUrl, query: def.query });
      if (!launched) {
        this.events.push({ type: "failed", scene, reason: "refused" });
        return { ok: false, rewarded: false, reason: "refused" };
      }
      return this.onShared(scene, now);
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc);
      this.events.push({ type: "failed", scene, reason: "error", detail });
      return { ok: false, rewarded: false, reason: "error", detail };
    } finally {
      this.pending = false;
    }
  }

  /** 取走自上次以来的事件(UI 层据此广播 share:done) */
  takeEvents(): ShareEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 是否有分享在途中(UI 禁用按钮用) */
  isPending(): boolean {
    return this.pending;
  }

  /** 今日还可获奖励的分享次数(null = 永不发奖,渲染时隐藏奖励角标) */
  rewardQuotaLeft(now: number): number | null {
    this.syncDay(now);
    if (!this.cfg.reward || this.cfg.dailyRewardLimit <= 0) {
      return null;
    }
    return Math.max(0, this.cfg.dailyRewardLimit - this.data.rewardedToday);
  }

  private onShared(scene: string, now: number): ShareOutcome {
    this.syncDay(now);
    const eligible =
      !!this.cfg.reward &&
      this.cfg.dailyRewardLimit > 0 &&
      this.data.rewardedToday < this.cfg.dailyRewardLimit &&
      now - this.data.lastRewardedTs >= this.cfg.rewardCooldownMs;
    if (eligible) {
      this.data.rewardedToday += 1;
      this.data.lastRewardedTs = now;
      this.persist();
      const rewards = this.cfg.reward.map((r) => ({ ...r }));
      this.events.push({ type: "shared", scene, rewarded: true });
      return { ok: true, rewarded: true, rewards };
    }
    this.events.push({ type: "shared", scene, rewarded: false });
    return { ok: true, rewarded: false };
  }

  private validateConfig(): void {
    const fail = (msg: string): never => {
      throw new Error(`[share] 配置错误:${msg}`);
    };
    if (!Array.isArray(this.cfg.scenes) || this.cfg.scenes.length === 0) fail("scenes 不能为空");
    const seen = new Set<string>();
    for (const s of this.cfg.scenes) {
      if (typeof s.scene !== "string" || s.scene.length === 0) fail("场景键不能为空");
      if (seen.has(s.scene)) fail(`场景键重复:${s.scene}`);
      seen.add(s.scene);
      if (typeof s.title !== "string" || s.title.length === 0) fail(`场景 ${s.scene} 的 title 不能为空`);
    }
    if (!Number.isInteger(this.cfg.dailyRewardLimit) || this.cfg.dailyRewardLimit < 0) {
      fail("dailyRewardLimit 必须 >=0");
    }
    if (!Number.isInteger(this.cfg.rewardCooldownMs) || this.cfg.rewardCooldownMs < 0) {
      fail("rewardCooldownMs 必须 >=0");
    }
  }

  /** 跨天同步(幂等):进入新自然日清空今日奖励计数 */
  private syncDay(now: number): void {
    const today = dayOrdinalOf(now);
    if (today === this.data.dayOrdinal) {
      return;
    }
    this.data.dayOrdinal = today;
    this.data.rewardedToday = 0;
    this.persist();
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值 */
  private load(): ShareSaveData {
    const raw = this.store.get(SAVE_KEY) as
      | { version?: number; data?: Partial<ShareSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { dayOrdinal: -1, rewardedToday: 0, lastRewardedTs: 0 };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<ShareSaveData>);
    return {
      dayOrdinal:
        typeof d.dayOrdinal === "number" && Number.isFinite(d.dayOrdinal) ? Math.floor(d.dayOrdinal) : -1,
      rewardedToday:
        typeof d.rewardedToday === "number" && Number.isFinite(d.rewardedToday) && d.rewardedToday > 0
          ? Math.floor(d.rewardedToday)
          : 0,
      lastRewardedTs:
        typeof d.lastRewardedTs === "number" && Number.isFinite(d.lastRewardedTs) && d.lastRewardedTs > 0
          ? Math.floor(d.lastRewardedTs)
          : 0,
    };
  }

  private persist(): void {
    this.store.set(SAVE_KEY, {
      version: VERSION,
      data: { ...this.data },
    });
    this.store.flush();
  }
}

/** 本地自然日序号(自 1970-01-01 本地日起):取本地日历日,不受时区/夏令时影响 */
export function dayOrdinalOf(ts: number): number {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
