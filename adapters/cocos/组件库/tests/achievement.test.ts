import test from "node:test";
import assert from "node:assert/strict";
import { AchievementLogic, ACHIEVEMENT_DEFAULTS } from "../components/achievement/logic.ts";
import type { AchievementConfig } from "../components/achievement/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

const CFG: Partial<AchievementConfig> = {
  tasks: [
    { id: "play_3", counter: "play", mode: "sum", target: 3, rewards: [{ itemId: "coin", count: 100 }] },
    { id: "play_10", counter: "play", mode: "sum", target: 10, rewards: [{ itemId: "diamond", count: 5 }] },
    { id: "score_1000", counter: "max_score", mode: "max", target: 1000, rewards: [{ itemId: "coin", count: 200 }] },
  ],
};

test("sum 累计达标:done 事件恰好一次,重复上报不重发", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  logic.progress("play", 2);
  assert.deepEqual(logic.takeEvents(), []);
  logic.progress("play", 1); // 恰好到 3,首次达标
  assert.deepEqual(logic.takeEvents(), [{ type: "done", taskId: "play_3" }]);
  logic.progress("play", 1); // 4,已达标状态不变,不重发 play_3
  assert.deepEqual(logic.takeEvents(), []);
});

test("max 峰值模式:低分→高分→低分,保留峰值并按峰值判定", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  logic.progress("max_score", 500);
  assert.deepEqual(logic.takeEvents(), []);
  logic.progress("max_score", 1000);
  assert.deepEqual(logic.takeEvents(), [{ type: "done", taskId: "score_1000" }]);
  logic.progress("max_score", 10); // 更低分不回退
  assert.deepEqual(logic.takeEvents(), []);
  const st = logic.list().find((t) => t.id === "score_1000")!;
  assert.equal(st.current, 1000);
  assert.equal(st.done, true);
});

test("领奖:产出发放指令、标记已领、记事件;入包不在组件内", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  logic.progress("play", 3);
  logic.takeEvents();
  const r = logic.claim("play_3");
  assert.ok(r.ok);
  assert.deepEqual(r.rewards, [{ itemId: "coin", count: 100 }]);
  assert.deepEqual(logic.takeEvents(), [
    { type: "claimed", taskId: "play_3", rewards: [{ itemId: "coin", count: 100 }] },
  ]);
  const st = logic.list().find((t) => t.id === "play_3")!;
  assert.equal(st.claimed, true);
  assert.equal(st.canClaim, false);
});

test("未达标/重复/未知任务领奖分别返回 notDone / claimed / noTask", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  assert.deepEqual(logic.claim("play_3"), { ok: false, reason: "notDone" });
  logic.progress("play", 3);
  logic.takeEvents();
  assert.ok(logic.claim("play_3").ok);
  assert.deepEqual(logic.claim("play_3"), { ok: false, reason: "claimed" });
  assert.deepEqual(logic.claim("ghost"), { ok: false, reason: "noTask" });
});

test("同计数器多任务:各自独立判定、各自领奖", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  logic.progress("play", 10); // play_3 与 play_10 同时首次达标
  const events = logic.takeEvents();
  assert.deepEqual(
    events.map((e) => (e as { taskId: string }).taskId).sort(),
    ["play_10", "play_3"],
  );
  assert.ok(logic.claim("play_3").ok);
  assert.ok(logic.claim("play_10").ok);
});

test("list 按配置顺序返回,canClaim 只在 done 且未领时为真", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  logic.progress("play", 3);
  const st = logic.list();
  assert.deepEqual(st.map((t) => t.id), ["play_3", "play_10", "score_1000"]);
  assert.equal(st[0].canClaim, true);
  assert.equal(st[1].canClaim, false);
  assert.equal(st[2].canClaim, false);
});

test("同版本存档续玩:计数与已领保留", () => {
  const store = memStore();
  const logic = new AchievementLogic(store, CFG);
  logic.progress("play", 3);
  logic.takeEvents();
  assert.ok(logic.claim("play_3").ok);
  const logic2 = new AchievementLogic(store, CFG);
  const st = logic2.list().find((t) => t.id === "play_3")!;
  assert.equal(st.current, 3);
  assert.equal(st.claimed, true);
  assert.deepEqual(logic2.claim("play_3"), { ok: false, reason: "claimed" });
});

test("损坏/未知版本存档:按字段兜底为安全默认,不崩溃", () => {
  const logic = new AchievementLogic(memStore({ achievement: { garbage: true } }), CFG);
  assert.equal(logic.list().find((t) => t.id === "play_3")!.current, 0);
  logic.progress("play", 3);
  assert.deepEqual(logic.takeEvents(), [{ type: "done", taskId: "play_3" }]);
});

test("progress 非法值(负数/非有限)直接抛错", () => {
  const logic = new AchievementLogic(memStore(), CFG);
  assert.throws(() => logic.progress("play", -1), /非负/);
  assert.throws(() => logic.progress("play", Number.NaN), /非负/);
});

test("配置校验:重复 id、空 rewards、同计数器混用 sum/max,直接抛错", () => {
  assert.throws(
    () =>
      new AchievementLogic(memStore(), {
        tasks: [
          { id: "a", counter: "play", mode: "sum", target: 1, rewards: [{ itemId: "coin", count: 1 }] },
          { id: "a", counter: "play", mode: "sum", target: 2, rewards: [{ itemId: "coin", count: 1 }] },
        ],
      }),
    /重复/,
  );
  assert.throws(
    () =>
      new AchievementLogic(memStore(), {
        tasks: [{ id: "a", counter: "play", mode: "sum", target: 1, rewards: [] }],
      }),
    /rewards/,
  );
  assert.throws(
    () =>
      new AchievementLogic(memStore(), {
        tasks: [
          { id: "a", counter: "play", mode: "sum", target: 1, rewards: [{ itemId: "coin", count: 1 }] },
          { id: "b", counter: "play", mode: "max", target: 2, rewards: [{ itemId: "coin", count: 1 }] },
        ],
      }),
    /歧义/,
  );
});

test("默认配置可用:三件套任务首次上报即可跑通", () => {
  const logic = new AchievementLogic(memStore());
  logic.progress("play", 1);
  assert.deepEqual(logic.takeEvents(), [{ type: "done", taskId: ACHIEVEMENT_DEFAULTS.tasks[0].id }]);
  assert.ok(logic.claim(ACHIEVEMENT_DEFAULTS.tasks[0].id).ok);
});
