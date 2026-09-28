/**
 * achievement 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 任务/成就统一模型:游戏在行为发生时上报计数器(progress),达标发 done 事件
 * (恰好一次),玩家领奖(claim)产出"发放指令",入包由组装层执行 —— 组件不私建
 * 第二份库存状态。计数器两种模式:sum(累计型,如总消除数)、max(峰值型,如
 * 最高分/最远关卡)。计数器单调不减,sum/max 均不回退,达标状态不会反复横跳。
 * 见 manuals/代码生成.md。
 */

export interface AchievementGrant {
  itemId: string;
  count: number;
}

export interface AchievementTask {
  id: string;
  /** 计数器键(游戏行为上报用),如 "play"、"max_score" */
  counter: string;
  /** sum=累计型;max=峰值型(取历史最大) */
  mode: "sum" | "max";
  target: number;
  rewards: AchievementGrant[];
}

export interface AchievementConfig {
  tasks: AchievementTask[];
}

export const ACHIEVEMENT_DEFAULTS: AchievementConfig = {
  tasks: [
    { id: "first_play", counter: "play", mode: "sum", target: 1, rewards: [{ itemId: "coin", count: 100 }] },
    { id: "play_10", counter: "play", mode: "sum", target: 10, rewards: [{ itemId: "coin", count: 500 }] },
    { id: "score_1000", counter: "max_score", mode: "max", target: 1000, rewards: [{ itemId: "diamond", count: 5 }] },
  ],
};

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export type AchievementEvent =
  | { type: "done"; taskId: string }
  | { type: "claimed"; taskId: string; rewards: AchievementGrant[] };

export interface AchievementStatus {
  id: string;
  counter: string;
  target: number;
  current: number;
  done: boolean;
  claimed: boolean;
  canClaim: boolean;
}

export type ClaimResult =
  | { ok: true; rewards: AchievementGrant[] }
  | { ok: false; reason: "noTask" | "notDone" | "claimed" };

interface AchievementSaveData {
  counters: Record<string, number>;
  claimed: string[];
}

const SAVE_KEY = "achievement";
const VERSION = 1;

export class AchievementLogic {
  private store: SaveLike;
  private cfg: AchievementConfig;
  private data: AchievementSaveData;
  private events: AchievementEvent[] = [];
  /** 计数器键 → 模式(validateConfig 填充) */
  private counterModes: Map<string, "sum" | "max"> = new Map();

  constructor(store: SaveLike, config?: Partial<AchievementConfig>) {
    this.store = store;
    this.cfg = { ...ACHIEVEMENT_DEFAULTS, ...config };
    this.validateConfig();
    this.data = this.load();
  }

  /**
   * 上报行为计数:sum 模式累加,max 模式取历史最大。
   * 恰好有任务因此首次达标时发 done 事件(靠单调性判定,不额外存状态)。
   */
  progress(counter: string, value = 1): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`[achievement] progress 值必须为非负有限数,收到 ${value}`);
    }
    const before = this.data.counters[counter] ?? 0;
    const isMax = this.counterModes.get(counter) === "max";
    const after = isMax ? Math.max(before, value) : before + value;
    this.data.counters[counter] = after;
    this.persist();
    for (const task of this.cfg.tasks) {
      if (task.counter !== counter) {
        continue;
      }
      const wasDone = before >= task.target;
      const nowDone = after >= task.target;
      if (!wasDone && nowDone) {
        this.events.push({ type: "done", taskId: task.id });
      }
    }
  }

  /** 领奖:产出"发放指令"(rewards),入包由组装层执行 */
  claim(taskId: string): ClaimResult {
    const task = this.cfg.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { ok: false, reason: "noTask" };
    }
    if ((this.data.counters[task.counter] ?? 0) < task.target) {
      return { ok: false, reason: "notDone" };
    }
    if (this.data.claimed.includes(taskId)) {
      return { ok: false, reason: "claimed" };
    }
    this.data.claimed = [...this.data.claimed, taskId];
    this.persist();
    const rewards = task.rewards.map((r) => ({ ...r }));
    this.events.push({ type: "claimed", taskId, rewards });
    return { ok: true, rewards };
  }

  /** 任务状态列表(渲染用,按配置顺序) */
  list(): AchievementStatus[] {
    return this.cfg.tasks.map((task) => {
      const current = this.data.counters[task.counter] ?? 0;
      const done = current >= task.target;
      const claimed = this.data.claimed.includes(task.id);
      return {
        id: task.id,
        counter: task.counter,
        target: task.target,
        current,
        done,
        claimed,
        canClaim: done && !claimed,
      };
    });
  }

  /** 取走自上次以来的事件(UI 层据此广播 achievement:done / achievement:claimed) */
  takeEvents(): AchievementEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private validateConfig(): void {
    const fail = (msg: string): never => {
      throw new Error(`[achievement] 配置错误:${msg}`);
    };
    if (!Array.isArray(this.cfg.tasks)) fail("tasks 必须是数组");
    const seen = new Set<string>();
    this.counterModes = new Map();
    for (const t of this.cfg.tasks) {
      if (typeof t.id !== "string" || t.id.length === 0) fail("任务 id 不能为空");
      if (seen.has(t.id)) fail(`任务 id 重复:${t.id}`);
      seen.add(t.id);
      if (typeof t.counter !== "string" || t.counter.length === 0) fail(`任务 ${t.id} 计数器键不能为空`);
      if (!Number.isInteger(t.target) || t.target < 1) fail(`任务 ${t.id} target 必须 >=1`);
      if (!Array.isArray(t.rewards) || t.rewards.length === 0) fail(`任务 ${t.id} rewards 不能为空`);
      if (t.mode !== "sum" && t.mode !== "max") fail(`任务 ${t.id} mode 必须是 sum 或 max`);
      const known = this.counterModes.get(t.counter);
      if (known === undefined) {
        this.counterModes.set(t.counter, t.mode);
      } else if (known !== t.mode) {
        fail(`计数器 ${t.counter} 混用了 sum 与 max 模式,上报语义有歧义`);
      }
    }
  }

  /** 读档 + 版本迁移:低版本/损坏数据按字段兜底为安全默认值 */
  private load(): AchievementSaveData {
    const raw = this.store.get(SAVE_KEY) as
      | { version?: number; data?: Partial<AchievementSaveData> }
      | undefined;
    if (!raw || typeof raw !== "object") {
      return { counters: {}, claimed: [] };
    }
    const d = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<AchievementSaveData>);
    return {
      counters: sanitizeCounters(d.counters),
      claimed: Array.isArray(d.claimed)
        ? [...new Set(d.claimed.filter((s): s is string => typeof s === "string" && s.length > 0))]
        : [],
    };
  }

  private persist(): void {
    this.store.set(SAVE_KEY, {
      version: VERSION,
      data: { counters: { ...this.data.counters }, claimed: [...this.data.claimed] },
    });
    this.store.flush();
  }
}

function sanitizeCounters(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k === "string" && k.length > 0 && typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[k] = v;
    }
  }
  return out;
}
