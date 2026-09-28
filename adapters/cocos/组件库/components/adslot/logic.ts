/**
 * adslot 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 广告位治理:包装平台适配层的激励视频/插屏/Banner,统一做三件事:
 *  1. 防连点:展示期间(pending)再点直接静默拒绝,适配层只被调一次;
 *  2. 降级:连续失败 cooldownAfterFails 次进入冷却 cooldownMs,冷却期内
 *     canShow=false 且不再触碰适配层;激励视频失败可配置是否仍发奖
 *     (grantOnFail,无填充高频平台保体验的常见选择,默认不发);
 *  3. 事件流:shown / reward / failed 走 takeEvents 交组装层广播
 *     (README 契约事件 ad:shown / ad:reward / ad:failed)。
 *
 * 冷却状态进存档(version 协议,跨会话生效);存档键 adslot:<placement>,
 * 每个广告位一个实例。奖励只产出指令(granted),道具入包由组装层执行,
 * 组件不私建第二份库存状态(见 manuals/代码生成.md)。
 */

export type AdSlotKind = "rewarded" | "interstitial" | "banner";

export interface AdSlotConfig {
  /** 广告位 ID(透传给平台适配层,同时是存档键的一部分) */
  placement: string;
  /** 连续失败达到该次数后进入冷却 */
  cooldownAfterFails: number;
  /** 冷却时长 ms */
  cooldownMs: number;
  /** 激励视频失败(未看完/无填充/异常)时是否仍发奖 */
  grantOnFail: boolean;
}

export const ADSLOT_DEFAULTS: AdSlotConfig = {
  placement: "main",
  cooldownAfterFails: 2,
  cooldownMs: 5 * 60 * 1000,
  grantOnFail: false,
};

/** 激励视频结果(与 core/contracts.ts 的 RewardedResult 结构兼容,刻意自包含) */
export interface RewardedLike {
  completed: boolean;
  error?: string;
}

/** 广告面适配(与 core/contracts.ts 的 IPlatformAdapter 广告方法结构兼容,刻意自包含) */
export interface AdAdapterLike {
  showRewardedVideo(placement: string): Promise<RewardedLike>;
  showInterstitial(placement: string): Promise<boolean>;
  showBanner(placement: string, show: boolean): void;
}

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export type AdFailReason = "cooldown" | "pending" | "uncompleted" | "error";

export interface AdSlotResult {
  ok: boolean;
  /** 是否应发奖(仅激励视频;true = 看完,或降级发奖) */
  granted: boolean;
  /** ok=false 时必有 */
  reason?: AdFailReason;
  /** 适配层透传的失败说明(降级提示文案用,ok=false 且有说明时才有) */
  detail?: string;
}

export type AdSlotEvent =
  | { type: "shown"; kind: AdSlotKind; placement: string }
  | { type: "reward"; placement: string; source: "completed" | "degraded" }
  | {
      type: "failed";
      kind: AdSlotKind;
      placement: string;
      reason: AdFailReason;
      detail?: string;
    };

interface AdSlotSaveData {
  failStreak: number;
  cooldownUntil: number;
}

const VERSION = 1;

export class AdSlotLogic {
  private store: SaveLike;
  private adapter: AdAdapterLike;
  private cfg: AdSlotConfig;
  private saveKey: string;
  private data: AdSlotSaveData;
  private pending = false;
  private events: AdSlotEvent[] = [];

  constructor(store: SaveLike, adapter: AdAdapterLike, config?: Partial<AdSlotConfig>) {
    this.store = store;
    this.adapter = adapter;
    this.cfg = { ...ADSLOT_DEFAULTS, ...config };
    if (typeof this.cfg.placement !== "string" || this.cfg.placement.length === 0) {
      throw new Error("[adslot] 配置错误:placement 不能为空");
    }
    if (!Number.isInteger(this.cfg.cooldownAfterFails) || this.cfg.cooldownAfterFails < 1) {
      throw new Error("[adslot] 配置错误:cooldownAfterFails 必须 >=1");
    }
    if (!Number.isInteger(this.cfg.cooldownMs) || this.cfg.cooldownMs < 0) {
      throw new Error("[adslot] 配置错误:cooldownMs 必须 >=0");
    }
    this.saveKey = `adslot:${this.cfg.placement}`;
    this.data = this.load();
  }

  /** 现在是否允许发起展示(pending 与冷却期都算不允许) */
  canShow(now: number): boolean {
    return !this.pending && !this.inCooldown(now);
  }

  /** 冷却剩余 ms(UI 倒计时展示用,0 = 不在冷却) */
  cooldownLeft(now: number): number {
    return Math.max(0, this.data.cooldownUntil - now);
  }

  /** 激励视频:看完 → granted=true;失败按 grantOnFail 决定是否降级发奖 */
  async showRewarded(now: number): Promise<AdSlotResult> {
    const gate = this.gate(now, "rewarded");
    if (gate) {
      return gate;
    }
    this.pending = true;
    try {
      const r = await this.adapter.showRewardedVideo(this.cfg.placement);
      if (r && r.completed) {
        return this.succeed("rewarded");
      }
      return this.fail("rewarded", "uncompleted", r?.error, now);
    } catch (exc) {
      return this.fail("rewarded", "error", describe(exc), now);
    } finally {
      this.pending = false;
    }
  }

  /** 插屏:无奖励语义,granted 恒 false */
  async showInterstitial(now: number): Promise<AdSlotResult> {
    const gate = this.gate(now, "interstitial");
    if (gate) {
      return gate;
    }
    this.pending = true;
    try {
      const shown = await this.adapter.showInterstitial(this.cfg.placement);
      if (shown) {
        return this.succeed("interstitial");
      }
      return this.fail("interstitial", "uncompleted", undefined, now);
    } catch (exc) {
      return this.fail("interstitial", "error", describe(exc), now);
    } finally {
      this.pending = false;
    }
  }

  /** Banner 开关:同步透传,展示时发 shown 事件(收起不发事件) */
  setBanner(show: boolean): void {
    this.adapter.showBanner(this.cfg.placement, show);
    if (show) {
      this.events.push({ type: "shown", kind: "banner", placement: this.cfg.placement });
    }
  }

  /** 取走自上次以来的事件(UI 层据此广播 ad:shown / ad:reward / ad:failed) */
  takeEvents(): AdSlotEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 门槛:pending 静默拒绝(防连点,不是广告结果,不发事件);冷却期发 failed 事件 */
  private gate(now: number, kind: AdSlotKind): AdSlotResult | null {
    if (this.pending) {
      return { ok: false, granted: false, reason: "pending" };
    }
    if (this.inCooldown(now)) {
      this.events.push({
        type: "failed",
        kind,
        placement: this.cfg.placement,
        reason: "cooldown",
      });
      return { ok: false, granted: false, reason: "cooldown" };
    }
    return null;
  }

  private succeed(kind: AdSlotKind): AdSlotResult {
    this.data.failStreak = 0;
    this.data.cooldownUntil = 0;
    this.persist();
    this.events.push({ type: "shown", kind, placement: this.cfg.placement });
    if (kind === "rewarded") {
      this.events.push({ type: "reward", placement: this.cfg.placement, source: "completed" });
      return { ok: true, granted: true };
    }
    return { ok: true, granted: false };
  }

  private fail(
    kind: AdSlotKind,
    reason: AdFailReason,
    detail: string | undefined,
    now: number,
  ): AdSlotResult {
    this.data.failStreak += 1;
    if (this.data.failStreak >= this.cfg.cooldownAfterFails) {
      this.data.cooldownUntil = now + this.cfg.cooldownMs;
    }
    this.persist();
    const ev: AdSlotEvent = {
      type: "failed",
      kind,
      placement: this.cfg.placement,
      reason,
    };
    if (detail !== undefined) {
      ev.detail = detail;
    }
    this.events.push(ev);
    const granted = kind === "rewarded" && this.cfg.grantOnFail;
    if (granted) {
      this.events.push({ type: "reward", placement: this.cfg.placement, source: "degraded" });
    }
    const result: AdSlotResult = { ok: false, reason, granted };
    if (detail !== undefined) {
      result.detail = detail;
    }
    return result;
  }

  private inCooldown(now: number): boolean {
    return now < this.data.cooldownUntil;
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值 */
  private load(): AdSlotSaveData {
    const raw = this.store.get(this.saveKey) as
      | { version?: number; data?: Partial<AdSlotSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { failStreak: 0, cooldownUntil: 0 };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<AdSlotSaveData>);
    return {
      failStreak:
        typeof d.failStreak === "number" && Number.isFinite(d.failStreak) && d.failStreak > 0
          ? Math.floor(d.failStreak)
          : 0,
      cooldownUntil:
        typeof d.cooldownUntil === "number" && Number.isFinite(d.cooldownUntil) && d.cooldownUntil > 0
          ? Math.floor(d.cooldownUntil)
          : 0,
    };
  }

  private persist(): void {
    this.store.set(this.saveKey, { version: VERSION, data: { ...this.data } });
    this.store.flush();
  }
}

function describe(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}
