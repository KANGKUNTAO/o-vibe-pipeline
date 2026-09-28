import test from "node:test";
import assert from "node:assert/strict";
import { LeaderboardLogic } from "../components/leaderboard/logic.ts";
import type { LeaderboardAdapterLike } from "../components/leaderboard/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

function fakeBoard() {
  const submitted: number[] = [];
  const adapter: LeaderboardAdapterLike & { submitted: number[] } = {
    submitted,
    submitScore(score: number) {
      submitted.push(score);
    },
  };
  return adapter;
}

test("best 模式:低分不上报,破纪录才上报并留档", () => {
  const ad = fakeBoard();
  const logic = new LeaderboardLogic(memStore(), ad);
  assert.deepEqual(logic.submit(100), { submitted: true, isRecord: true }); // 首局必破 0 纪录
  ad.submitted.length = 0;
  logic.takeEvents();
  assert.deepEqual(logic.submit(50), { submitted: false, isRecord: false }); // 低分不上报
  assert.equal(ad.submitted.length, 0);
  const r = logic.submit(500);
  assert.deepEqual(r, { submitted: true, isRecord: true });
  assert.deepEqual(ad.submitted, [500]);
  assert.equal(logic.getBest(), 500);
  assert.deepEqual(logic.takeEvents(), [{ type: "submitted", score: 500, isRecord: true }]);
});

test("best 模式:首局分数必破 0 纪录", () => {
  const ad = fakeBoard();
  const logic = new LeaderboardLogic(memStore(), ad);
  const r = logic.submit(100);
  assert.deepEqual(r, { submitted: true, isRecord: true });
  assert.deepEqual(ad.submitted, [100]);
});

test("best 模式:等于最高分不算破纪录,不上报", () => {
  const ad = fakeBoard();
  const logic = new LeaderboardLogic(memStore(), ad);
  logic.submit(300);
  ad.submitted.length = 0;
  logic.takeEvents();
  assert.deepEqual(logic.submit(300), { submitted: false, isRecord: false });
  assert.equal(ad.submitted.length, 0);
  assert.deepEqual(logic.takeEvents(), []);
});

test("last 模式:每次都上报,isRecord 仍按历史最高判定", () => {
  const ad = fakeBoard();
  const logic = new LeaderboardLogic(memStore(), ad, { mode: "last" });
  assert.deepEqual(logic.submit(100), { submitted: true, isRecord: true });
  assert.deepEqual(logic.submit(50), { submitted: true, isRecord: false });
  assert.deepEqual(logic.submit(200), { submitted: true, isRecord: true });
  assert.deepEqual(ad.submitted, [100, 50, 200]);
  assert.equal(logic.getBest(), 200);
  assert.deepEqual(logic.takeEvents(), [
    { type: "submitted", score: 100, isRecord: true },
    { type: "submitted", score: 50, isRecord: false },
    { type: "submitted", score: 200, isRecord: true },
  ]);
});

test("小数分数取整上报", () => {
  const ad = fakeBoard();
  const logic = new LeaderboardLogic(memStore(), ad);
  logic.submit(99.9);
  assert.deepEqual(ad.submitted, [99]);
  assert.equal(logic.getBest(), 99);
});

test("同版本存档续玩:最高分保留;损坏/未知版本档兜底为 0", () => {
  const store = memStore();
  const logic = new LeaderboardLogic(store, fakeBoard());
  logic.submit(777);
  const logic2 = new LeaderboardLogic(store, fakeBoard());
  assert.equal(logic2.getBest(), 777);
  assert.deepEqual(logic2.submit(700), { submitted: false, isRecord: false });

  const garbage = new LeaderboardLogic(memStore({ leaderboard: { garbage: true } }), fakeBoard());
  assert.equal(garbage.getBest(), 0);
  assert.ok(garbage.submit(1).submitted);
});

test("非法分数(负数/非有限)直接抛错;mode 非法配置抛错", () => {
  const logic = new LeaderboardLogic(memStore(), fakeBoard());
  assert.throws(() => logic.submit(-1), /非负/);
  assert.throws(() => logic.submit(Number.NaN), /非负/);
  assert.throws(
    () => new LeaderboardLogic(memStore(), fakeBoard(), { mode: "max" as never }),
    /best 或 last/,
  );
});
