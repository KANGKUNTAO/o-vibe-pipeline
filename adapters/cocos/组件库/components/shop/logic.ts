/**
 * shop 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 商品表驱动的购买/兑换:货币余额与道具库存都不归组件管 —— 钱包由组装层注入
 * (组件不私建第二份库存状态),购买产出"发放指令"(grants),入包由组装层执行。
 * 限购三种:none / daily(按本地自然日,跨天自动重置)/ total(终身)。
 * 见 manuals/代码生成.md。
 */

export interface ShopGrant {
  itemId: string;
  count: number;
}

export interface ShopGoods {
  id: string;
  /** 买到什么(发放指令,组装层解释并入包) */
  grants: ShopGrant[];
  price: { currency: string; amount: number };
  /** none=不限购;daily=每日 limitCount 件;total=终身 limitCount 件 */
  limitKind: "none" | "daily" | "total";
  limitCount: number;
}

export interface ShopConfig {
  goods: ShopGoods[];
}

export const SHOP_DEFAULTS: ShopConfig = {
  goods: [
    { id: "coin_s", grants: [{ itemId: "coin", count: 1000 }], price: { currency: "diamond", amount: 10 }, limitKind: "none", limitCount: 0 },
    { id: "coin_l", grants: [{ itemId: "coin", count: 6000 }], price: { currency: "diamond", amount: 50 }, limitKind: "none", limitCount: 0 },
    { id: "energy_daily", grants: [{ itemId: "energy", count: 5 }], price: { currency: "diamond", amount: 0 }, limitKind: "daily", limitCount: 1 },
  ],
};

/** 货币钱包:购买扣款的唯一通道,由游戏组装层注入(与 signin 的钱包同构,按 itemId 泛化) */
export interface ShopWallet {
  getCount(itemId: string): number;
  consume(itemId: string, count: number): boolean;
}

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export type ShopFailReason = "noGoods" | "limit" | "noMoney";

export interface ShopPurchase {
  goodsId: string;
  grants: ShopGrant[];
  /** 本单之后今天/终身还剩几件(null = 不限) */
  remainingToday: number | null;
  remainingTotal: number | null;
}

export type ShopResult =
  | { ok: true; purchase: ShopPurchase }
  | { ok: false; reason: ShopFailReason };

export type ShopEvent = { type: "purchased"; goodsId: string };

export interface ShopEntryStatus {
  goods: ShopGoods;
  boughtToday: number;
  boughtTotal: number;
  /** 限购维度上是否还能买(不含余额判断) */
  buyable: boolean;
  remainingToday: number | null;
  remainingTotal: number | null;
}

interface ShopSaveData {
  /** 日计数锚点(本地自然日序号);-1 = 尚未同步过 */
  dayOrdinal: number;
  dailyCounts: Record<string, number>;
  totalCounts: Record<string, number>;
}

const SAVE_KEY = "shop";
const VERSION = 1;

export class ShopLogic {
  private store: SaveLike;
  private cfg: ShopConfig;
  private wallet: ShopWallet | null;
  private data: ShopSaveData;
  private events: ShopEvent[] = [];

  constructor(store: SaveLike, config?: Partial<ShopConfig>, wallet?: ShopWallet) {
    this.store = store;
    this.cfg = { ...SHOP_DEFAULTS, ...config };
    this.wallet = wallet ?? null;
    this.validateConfig();
    this.data = this.load();
  }

  buy(goodsId: string, now: number): ShopResult {
    this.syncDay(now);
    const goods = this.cfg.goods.find((g) => g.id === goodsId);
    if (!goods) {
      return { ok: false, reason: "noGoods" };
    }
    if (!this.withinLimit(goods)) {
      return { ok: false, reason: "limit" };
    }
    if (goods.price.amount > 0) {
      if (!this.wallet || this.wallet.getCount(goods.price.currency) < goods.price.amount) {
        return { ok: false, reason: "noMoney" };
      }
      if (!this.wallet.consume(goods.price.currency, goods.price.amount)) {
        return { ok: false, reason: "noMoney" };
      }
    }
    this.data.dailyCounts[goodsId] = (this.data.dailyCounts[goodsId] ?? 0) + 1;
    this.data.totalCounts[goodsId] = (this.data.totalCounts[goodsId] ?? 0) + 1;
    this.persist();
    this.events.push({ type: "purchased", goodsId });
    return {
      ok: true,
      purchase: {
        goodsId,
        grants: goods.grants.map((g) => ({ ...g })),
        remainingToday: this.remaining(goods, "daily"),
        remainingTotal: this.remaining(goods, "total"),
      },
    };
  }

  /** 商品列表 + 限购状态(渲染用);内部先同步跨天 */
  getStatus(now: number): ShopEntryStatus[] {
    this.syncDay(now);
    return this.cfg.goods.map((goods) => ({
      goods: this.copyGoods(goods),
      boughtToday: this.data.dailyCounts[goods.id] ?? 0,
      boughtTotal: this.data.totalCounts[goods.id] ?? 0,
      buyable: this.withinLimit(goods),
      remainingToday: this.remaining(goods, "daily"),
      remainingTotal: this.remaining(goods, "total"),
    }));
  }

  /** 取走自上次以来的事件(UI 层据此广播 shop:purchase) */
  takeEvents(): ShopEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private validateConfig(): void {
    const goods = this.cfg.goods;
    const fail = (msg: string): never => {
      throw new Error(`[shop] 配置错误:${msg}`);
    };
    if (!Array.isArray(goods)) fail("goods 必须是数组");
    const seen = new Set<string>();
    for (const g of goods) {
      if (typeof g.id !== "string" || g.id.length === 0) fail("商品 id 不能为空");
      if (seen.has(g.id)) fail(`商品 id 重复:${g.id}`);
      seen.add(g.id);
      if (!Array.isArray(g.grants) || g.grants.length === 0) fail(`商品 ${g.id} 的 grants 不能为空`);
      if (!Number.isInteger(g.price.amount) || g.price.amount < 0) fail(`商品 ${g.id} 价格非法`);
      if (g.price.amount > 0 && typeof g.price.currency !== "string") {
        fail(`商品 ${g.id} 有价格但未指定货币`);
      }
      if (!Number.isInteger(g.limitCount) || g.limitCount < 0) fail(`商品 ${g.id} 限购数非法`);
    }
    if (goods.some((g) => g.price.amount > 0) && !this.wallet) {
      fail("存在付费商品但未注入钱包 wallet");
    }
  }

  /** 限购判断(daily 用当日计数,total 用终身计数) */
  private withinLimit(goods: ShopGoods): boolean {
    if (goods.limitKind === "daily") {
      return (this.data.dailyCounts[goods.id] ?? 0) < goods.limitCount;
    }
    if (goods.limitKind === "total") {
      return (this.data.totalCounts[goods.id] ?? 0) < goods.limitCount;
    }
    return true;
  }

  private remaining(goods: ShopGoods, kind: "daily" | "total"): number | null {
    if (goods.limitKind !== kind) {
      return null;
    }
    const used =
      kind === "daily"
        ? (this.data.dailyCounts[goods.id] ?? 0)
        : (this.data.totalCounts[goods.id] ?? 0);
    return Math.max(0, goods.limitCount - used);
  }

  /** 跨天同步(幂等):进入新自然日清空日计数 */
  private syncDay(now: number): void {
    const today = dayOrdinalOf(now);
    if (today === this.data.dayOrdinal) {
      return;
    }
    this.data.dayOrdinal = today;
    this.data.dailyCounts = {};
    this.persist();
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值 */
  private load(): ShopSaveData {
    const raw = this.store.get(SAVE_KEY) as
      | { version?: number; data?: Partial<ShopSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { dayOrdinal: -1, dailyCounts: {}, totalCounts: {} };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<ShopSaveData>);
    return {
      dayOrdinal:
        typeof d.dayOrdinal === "number" && Number.isFinite(d.dayOrdinal)
          ? Math.floor(d.dayOrdinal)
          : -1,
      dailyCounts: sanitizeCounts(d.dailyCounts),
      totalCounts: sanitizeCounts(d.totalCounts),
    };
  }

  private persist(): void {
    this.store.set(SAVE_KEY, {
      version: VERSION,
      data: {
        dayOrdinal: this.data.dayOrdinal,
        dailyCounts: { ...this.data.dailyCounts },
        totalCounts: { ...this.data.totalCounts },
      },
    });
    this.store.flush();
  }

  private copyGoods(goods: ShopGoods): ShopGoods {
    return {
      ...goods,
      grants: goods.grants.map((g) => ({ ...g })),
      price: { ...goods.price },
    };
  }
}

function sanitizeCounts(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k === "string" && k.length > 0 && typeof v === "number" && Number.isInteger(v) && v > 0) {
      out[k] = v;
    }
  }
  return out;
}

/** 本地自然日序号(自 1970-01-01 本地日起):取本地日历日,不受时区/夏令时影响 */
export function dayOrdinalOf(ts: number): number {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
