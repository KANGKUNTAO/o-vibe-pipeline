/**
 * signin 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 周期签到日历:周期按"自然日网格"对齐 —— 自 epoch 起每 cycleDays 个本地自然日
 * 为一个周期,所有玩家在同一天开新周期(周签场景的标准做法)。漏签的日子可补签:
 * 每周期限 maxCatchUp 次,每次可配置消耗补签卡(钱包由组装层注入,组件不自建库存);
 * 签满整周期发全勤奖。奖励只产出"发放指令"(claim 结果),道具入包由组装层执行,
 * 组件不私建第二份库存状态(见 manuals/代码生成.md)。
 *
 * 时间处理:所有读写入口内部先做幂等周期同步(advance),跨天/跨周期自动滚动,
 * UI 无需自管时钟;自然日序号取本地日历日,不受时区/夏令时影响。
 * 设备时钟回拨:已签记录按天数判定,回拨只会得到"already",不会重复发奖。
 */

export interface SigninRewardDef {
  /** 道具 ID(由组装层解释并入包,组件不关心具体是什么) */
  itemId: string;
  count: number;
}

export interface SigninConfig {
  /** 周期长度(本地自然日数) */
  cycleDays: number;
  /** 奖励表:第 N 天(1-based)签发第 N 组奖励;长度必须等于 cycleDays */
  rewards: SigninRewardDef[][];
  /** 每周期最多补签次数 */
  maxCatchUp: number;
  /** 每次补签消耗的补签卡数量(0 = 免费补签) */
  catchUpCost: number;
  /** 签满整周期的全勤奖(null = 无) */
  fullBonus: SigninRewardDef[] | null;
}

export const SIGNIN_DEFAULTS: SigninConfig = {
  cycleDays: 7,
  rewards: [
    [{ itemId: "coin", count: 100 }],
    [{ itemId: "coin", count: 200 }],
    [{ itemId: "coin", count: 300 }],
    [{ itemId: "coin", count: 500 }],
    [{ itemId: "coin", count: 800 }],
    [{ itemId: "coin", count: 1200 }],
    [{ itemId: "coin", count: 2000 }],
  ],
  maxCatchUp: 3,
  catchUpCost: 1,
  fullBonus: [{ itemId: "diamond", count: 10 }],
};

/** 补签卡钱包:补签消耗的唯一通道,由游戏组装层注入(组件不自建库存) */
export interface SigninWallet {
  getCount(): number;
  consume(count: number): boolean;
}

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export interface SigninClaim {
  /** 本周期内第几天(1-based) */
  day: number;
  rewards: SigninRewardDef[];
  isCatchUp: boolean;
  /** 本次签到恰好签满整周期时附带的全勤奖 */
  fullBonus?: SigninRewardDef[];
}

export type SigninFailReason =
  | "already" // 该天已签
  | "future" // 补签目标在未来(还没到的那天不能补)
  | "none" // 没有可补的天(或目标不在本周期范围内)
  | "limit" // 本周期补签次数已用完
  | "noTicket"; // 补签卡不足

export type SigninResult =
  | { ok: true; claim: SigninClaim }
  | { ok: false; reason: SigninFailReason };

export type SigninEvent =
  | { type: "claimed"; day: number; isCatchUp: boolean }
  | { type: "cycleComplete"; cycleIndex: number }
  | { type: "cycleReset"; cycleIndex: number };

export interface SigninStatus {
  cycleIndex: number;
  /** 今天是本周期第几天(1-based) */
  today: number;
  /** 本周期已签的天(升序) */
  signedDays: number[];
  /** 今天之前漏签的天(可补签候选,升序) */
  missedDays: number[];
  catchUpsLeft: number;
  /** 今天是否还能首次签到 */
  canSignToday: boolean;
}

interface SigninSaveData {
  /** 从 epoch 起的第 N 个周期;-1 = 尚未同步过任何时间 */
  cycleIndex: number;
  /** 本周期已签的天(升序,1-based) */
  signedDays: number[];
  /** 本周期已用补签次数 */
  catchUpsUsed: number;
}

const SAVE_KEY = "signin";
const VERSION = 1;

export class SigninLogic {
  private store: SaveLike;
  private cfg: SigninConfig;
  private wallet: SigninWallet | null;
  private data: SigninSaveData;
  private events: SigninEvent[] = [];

  constructor(store: SaveLike, config?: Partial<SigninConfig>, wallet?: SigninWallet) {
    this.store = store;
    this.cfg = { ...SIGNIN_DEFAULTS, ...config };
    this.wallet = wallet ?? null;
    this.validateConfig();
    this.data = this.load();
  }

  /** 签到今天;已签则返回 already(不重复发奖) */
  sign(now: number): SigninResult {
    this.advance(now);
    const today = dayInCycleOf(now, this.cfg.cycleDays);
    if (this.data.signedDays.includes(today)) {
      return { ok: false, reason: "already" };
    }
    return this.claim(today, false);
  }

  /**
   * 补签:day 缺省补最早漏签天;指定 day===今天等价于首次签到(不耗补签卡);
   * 只能补本周期内今天之前的日子,受 maxCatchUp 与补签卡约束。
   */
  catchUp(now: number, day?: number): SigninResult {
    this.advance(now);
    const today = dayInCycleOf(now, this.cfg.cycleDays);
    let target = day;
    if (target === undefined) {
      target = this.firstMissed(today);
      if (target === null) {
        return { ok: false, reason: "none" };
      }
    }
    if (target === today) {
      return this.sign(now);
    }
    if (!Number.isInteger(target) || target < 1 || target > this.cfg.cycleDays || target > today) {
      return { ok: false, reason: target >= 1 && target <= this.cfg.cycleDays ? "future" : "none" };
    }
    if (this.data.signedDays.includes(target)) {
      return { ok: false, reason: "already" };
    }
    if (this.data.catchUpsUsed >= this.cfg.maxCatchUp) {
      return { ok: false, reason: "limit" };
    }
    if (this.cfg.catchUpCost > 0) {
      if (!this.wallet || this.wallet.getCount() < this.cfg.catchUpCost) {
        return { ok: false, reason: "noTicket" };
      }
      if (!this.wallet.consume(this.cfg.catchUpCost)) {
        return { ok: false, reason: "noTicket" };
      }
    }
    return this.claim(target, true);
  }

  /** 当前状态快照(渲染用);内部先同步周期,跨周期清档在这里发生 */
  getStatus(now: number): SigninStatus {
    this.advance(now);
    const today = dayInCycleOf(now, this.cfg.cycleDays);
    const signedDays = [...this.data.signedDays];
    const missedDays: number[] = [];
    for (let d = 1; d < today; d++) {
      if (!signedDays.includes(d)) {
        missedDays.push(d);
      }
    }
    return {
      cycleIndex: this.data.cycleIndex,
      today,
      signedDays,
      missedDays,
      catchUpsLeft: Math.max(0, this.cfg.maxCatchUp - this.data.catchUpsUsed),
      canSignToday: !signedDays.includes(today),
    };
  }

  /** 取走自上次以来的事件(UI 层据此广播 signin:claimed / signin:cycleComplete 等) */
  takeEvents(): SigninEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private validateConfig(): void {
    const c = this.cfg;
    const fail = (msg: string): never => {
      throw new Error(`[signin] 配置错误:${msg}`);
    };
    if (!Number.isInteger(c.cycleDays) || c.cycleDays < 1) fail("cycleDays 必须是 >=1 的整数");
    if (!Array.isArray(c.rewards) || c.rewards.length !== c.cycleDays) {
      fail(`rewards 长度必须等于 cycleDays(${c.cycleDays})`);
    }
    for (let i = 0; i < c.rewards.length; i++) {
      const row = c.rewards[i];
      if (!Array.isArray(row)) fail(`rewards[${i}] 必须是数组`);
    }
    if (!Number.isInteger(c.maxCatchUp) || c.maxCatchUp < 0) fail("maxCatchUp 必须 >=0");
    if (!Number.isInteger(c.catchUpCost) || c.catchUpCost < 0) fail("catchUpCost 必须 >=0");
    if (c.catchUpCost > 0 && !this.wallet) fail("catchUpCost>0 时必须注入补签卡钱包 wallet");
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值,未知字段丢弃 */
  private load(): SigninSaveData {
    const raw = this.store.get(SAVE_KEY) as
      | { version?: number; data?: Partial<SigninSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { cycleIndex: -1, signedDays: [], catchUpsUsed: 0 };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<SigninSaveData>);
    const cycleIndex =
      typeof d.cycleIndex === "number" && Number.isFinite(d.cycleIndex)
        ? Math.floor(d.cycleIndex)
        : -1;
    const signedDays = Array.isArray(d.signedDays)
      ? [
          ...new Set(
            d.signedDays.filter(
              (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= this.cfg.cycleDays,
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    const catchUpsUsed =
      typeof d.catchUpsUsed === "number" && Number.isFinite(d.catchUpsUsed) && d.catchUpsUsed >= 0
        ? Math.floor(d.catchUpsUsed)
        : 0;
    return { cycleIndex, signedDays, catchUpsUsed };
  }

  private persist(): void {
    this.store.set(SAVE_KEY, {
      version: VERSION,
      data: { ...this.data, signedDays: [...this.data.signedDays] },
    });
    this.store.flush();
  }

  /** 同步到 now 所在周期(幂等):进入新周期则清空签到与补签计数 */
  private advance(now: number): void {
    const cur = cycleIndexOf(now, this.cfg.cycleDays);
    if (cur <= this.data.cycleIndex) {
      return;
    }
    const had = this.data.cycleIndex >= 0;
    this.data.cycleIndex = cur;
    this.data.signedDays = [];
    this.data.catchUpsUsed = 0;
    if (had) {
      this.events.push({ type: "cycleReset", cycleIndex: cur });
    }
    this.persist();
  }

  private firstMissed(today: number): number | null {
    for (let d = 1; d < today; d++) {
      if (!this.data.signedDays.includes(d)) {
        return d;
      }
    }
    return null;
  }

  private claim(day: number, isCatchUp: boolean): SigninResult {
    const rewards = this.cfg.rewards[day - 1].map((r) => ({ ...r }));
    const claim: SigninClaim = { day, rewards, isCatchUp };
    this.data.signedDays = [...this.data.signedDays, day].sort((a, b) => a - b);
    if (isCatchUp) {
      this.data.catchUpsUsed += 1;
    }
    this.events.push({ type: "claimed", day, isCatchUp });
    if (this.data.signedDays.length === this.cfg.cycleDays) {
      if (this.cfg.fullBonus) {
        claim.fullBonus = this.cfg.fullBonus.map((r) => ({ ...r }));
      }
      this.events.push({ type: "cycleComplete", cycleIndex: this.data.cycleIndex });
    }
    this.persist();
    return { ok: true, claim };
  }
}

/** 本地自然日序号(自 1970-01-01 本地日起):取本地日历日,不受时区/夏令时影响 */
export function dayOrdinalOf(ts: number): number {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** ts 所在周期序号(自然日网格对齐,全局一致) */
export function cycleIndexOf(ts: number, cycleDays: number): number {
  return Math.floor(dayOrdinalOf(ts) / cycleDays);
}

/** ts 是本周期第几天(1-based) */
export function dayInCycleOf(ts: number, cycleDays: number): number {
  return (dayOrdinalOf(ts) % cycleDays) + 1;
}
