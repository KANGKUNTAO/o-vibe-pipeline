import test from "node:test";
import assert from "node:assert/strict";
import {
  SigninLogic,
  SIGNIN_DEFAULTS,
  cycleIndexOf,
  dayInCycleOf,
} from "../components/signin/logic.ts";
import type { SigninWallet } from "../components/signin/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

/** 本地日历日正午的时间戳(避开午夜/DST 边界,跨时区稳定) */
function noon(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12).getTime();
}

function plusDays(ts: number, n: number): number {
  return ts + n * 86400000;
}

function wallet(n: number): SigninWallet {
  let count = n;
  return {
    getCount: () => count,
    consume: (c: number) => {
      if (count < c) return false;
      count -= c;
      return true;
    },
  };
}

const BASE = noon(2026, 3, 10);
const CYCLE_START = plusDays(BASE, 1 - dayInCycleOf(BASE, 7)); // 某周期第 1 天正午

test("首签:发当日奖励、记 claimed 事件、写存档", () => {
  const store = memStore();
  const logic = new SigninLogic(store, undefined, wallet(3)); // 默认配置(补签要扣卡)需注入钱包
  assert.deepEqual(logic.sign(CYCLE_START), {
    ok: true,
    claim: { day: 1, rewards: SIGNIN_DEFAULTS.rewards[0], isCatchUp: false },
  });
  assert.deepEqual(logic.takeEvents(), [{ type: "claimed", day: 1, isCatchUp: false }]);
  assert.ok(store.get("signin"));
});

test("同日重复签返回 already,不重复发奖、不重复记事件", () => {
  const logic = new SigninLogic(memStore(), undefined, wallet(3));
  logic.sign(CYCLE_START);
  logic.takeEvents();
  assert.deepEqual(logic.sign(CYCLE_START), { ok: false, reason: "already" });
  assert.deepEqual(logic.takeEvents(), []);
  const st = logic.getStatus(CYCLE_START);
  assert.deepEqual(st.signedDays, [1]);
});

test("次日再签进入第 2 天", () => {
  const logic = new SigninLogic(memStore(), undefined, wallet(3));
  logic.sign(CYCLE_START);
  logic.takeEvents();
  assert.deepEqual(logic.sign(plusDays(CYCLE_START, 1)), {
    ok: true,
    claim: { day: 2, rewards: SIGNIN_DEFAULTS.rewards[1], isCatchUp: false },
  });
});

test("缺省补签补最早漏签天,状态同步为已补(免费补签配置)", () => {
  const logic = new SigninLogic(memStore(), { catchUpCost: 0, maxCatchUp: 3 });
  logic.sign(CYCLE_START); // 第 1 天
  logic.takeEvents();
  const now3 = plusDays(CYCLE_START, 2); // 第 3 天,漏第 2 天
  const r = logic.catchUp(now3);
  assert.ok(r.ok);
  assert.equal(r.claim.day, 2);
  assert.equal(r.claim.isCatchUp, true);
  const st = logic.getStatus(now3);
  assert.deepEqual(st.signedDays, [1, 2]);
  assert.deepEqual(st.missedDays, []);
  assert.equal(st.catchUpsLeft, 2);
  assert.equal(st.canSignToday, true);
});

test("未来天不能补(future),周期范围外的目标返回 none", () => {
  const logic = new SigninLogic(memStore(), { catchUpCost: 0 });
  logic.sign(CYCLE_START); // 今天 = 第 1 天
  logic.takeEvents();
  assert.deepEqual(logic.catchUp(CYCLE_START, 3), { ok: false, reason: "future" });
  assert.deepEqual(logic.catchUp(CYCLE_START, 9), { ok: false, reason: "none" });
  assert.deepEqual(logic.catchUp(CYCLE_START, 0), { ok: false, reason: "none" });
});

test("补签限次:超过 maxCatchUp 返回 limit,但不影响当天首签", () => {
  const logic = new SigninLogic(memStore(), { catchUpCost: 0, maxCatchUp: 1 });
  logic.sign(CYCLE_START); // 第 1 天
  logic.takeEvents();
  const now4 = plusDays(CYCLE_START, 3); // 第 4 天,漏 2、3
  assert.ok(logic.catchUp(now4).ok); // 补第 2 天(第 1 次)
  assert.deepEqual(logic.catchUp(now4), { ok: false, reason: "limit" }); // 补第 3 天被限
  const r = logic.sign(now4);
  assert.ok(r.ok); // 首签不受补签限次影响
  assert.equal(r.claim.day, 4);
});

test("补签卡:显式指定补哪天、消耗钱包、卡不足拒绝且不记账", () => {
  const w = wallet(1);
  const logic = new SigninLogic(memStore(), { maxCatchUp: 5, catchUpCost: 1 }, w);
  logic.sign(CYCLE_START);
  logic.takeEvents();
  const now4 = plusDays(CYCLE_START, 3); // 漏 2、3
  const r = logic.catchUp(now4, 3); // 显式补第 3 天
  assert.ok(r.ok);
  assert.equal(r.claim.day, 3);
  assert.equal(w.getCount(), 0);
  assert.deepEqual(logic.catchUp(now4, 2), { ok: false, reason: "noTicket" });
  assert.deepEqual(logic.getStatus(now4).signedDays, [1, 3]); // 失败的补签不记账
});

test("点今天的补签入口等价于首次签到,不耗补签卡", () => {
  const w = wallet(2);
  const logic = new SigninLogic(memStore(), { catchUpCost: 1 }, w);
  const r = logic.catchUp(CYCLE_START, 1); // 今天 = 第 1 天且未签
  assert.ok(r.ok);
  assert.equal(r.claim.isCatchUp, false);
  assert.equal(w.getCount(), 2);
});

test("周期滚动:进新周期清档、发 cycleReset,旧周期漏签不跨周期", () => {
  const logic = new SigninLogic(memStore(), { catchUpCost: 0 });
  logic.sign(CYCLE_START); // 第 1 周期第 1 天
  logic.takeEvents();
  const next = plusDays(CYCLE_START, 8); // 下一周期第 2 天
  const st = logic.getStatus(next); // 同步在这里触发滚动
  assert.equal(st.cycleIndex, cycleIndexOf(next, 7));
  assert.deepEqual(st.signedDays, []);
  assert.equal(st.today, 2);
  assert.deepEqual(st.missedDays, [1]); // 只算本周期内的漏签
  assert.deepEqual(logic.takeEvents(), [{ type: "cycleReset", cycleIndex: cycleIndexOf(next, 7) }]);
  const r = logic.sign(next);
  assert.ok(r.ok);
  assert.equal(r.claim.day, 2);
});

test("全勤奖:签满整周期时该次 claim 附带 fullBonus,cycleComplete 恰好一次", () => {
  const logic = new SigninLogic(memStore(), { catchUpCost: 0, fullBonus: [{ itemId: "diamond", count: 5 }] });
  for (let d = 0; d < 7; d++) {
    const r = logic.sign(plusDays(CYCLE_START, d));
    assert.ok(r.ok);
    if (d === 6) {
      assert.deepEqual(r.claim.fullBonus, [{ itemId: "diamond", count: 5 }]);
    } else {
      assert.equal(r.claim.fullBonus, undefined);
    }
  }
  const completes = logic.takeEvents().filter((e) => e.type === "cycleComplete");
  assert.equal(completes.length, 1);
});

test("同版本存档续玩:已签/已补字段原样保留", () => {
  const now6 = plusDays(CYCLE_START, 5); // 第 6 天
  const store = memStore({
    signin: {
      version: 1,
      data: { cycleIndex: cycleIndexOf(now6, 7), signedDays: [3, 5], catchUpsUsed: 1 },
    },
  });
  const logic = new SigninLogic(store, { maxCatchUp: 3, catchUpCost: 0 });
  const st = logic.getStatus(now6);
  assert.equal(st.cycleIndex, cycleIndexOf(now6, 7));
  assert.deepEqual(st.signedDays, [3, 5]);
  assert.deepEqual(st.missedDays, [1, 2, 4]);
  assert.equal(st.catchUpsLeft, 2);
  assert.deepEqual(logic.takeEvents(), []); // 同周期同步不发事件
});

test("损坏/未知版本存档:按字段兜底为安全默认,不崩溃", () => {
  const garbage = new SigninLogic(memStore({ signin: { garbage: true } }), { catchUpCost: 0 });
  assert.deepEqual(garbage.getStatus(CYCLE_START).signedDays, []);
  const legacy = new SigninLogic(
    memStore({ signin: { version: 99, data: { cycleIndex: 5, signedDays: [1] } } }),
    { catchUpCost: 0 },
  );
  const st = legacy.getStatus(CYCLE_START);
  assert.deepEqual(st.signedDays, []);
  assert.equal(st.today, 1);
});

test("配置校验:奖励表长度不匹配、要扣卡却没注入钱包,直接抛错", () => {
  assert.throws(() => new SigninLogic(memStore(), { cycleDays: 5 }), /rewards/);
  assert.throws(() => new SigninLogic(memStore(), { catchUpCost: 1 }), /wallet/);
});
