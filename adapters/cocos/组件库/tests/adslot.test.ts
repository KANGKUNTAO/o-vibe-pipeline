import test from "node:test";
import assert from "node:assert/strict";
import { AdSlotLogic } from "../components/adslot/logic.ts";
import type { AdAdapterLike, RewardedLike } from "../components/adslot/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

/** 可编程假适配层:script 字段随时改剧本;calls 记录每次触碰 */
function fakeAdapter() {
  const calls: string[] = [];
  const script = {
    rewarded: { completed: true } as RewardedLike | "reject",
    interstitial: true as boolean | "reject",
  };
  const adapter: AdAdapterLike & { calls: string[]; script: typeof script } = {
    calls,
    script,
    showRewardedVideo(placement: string): Promise<RewardedLike> {
      calls.push(`rewarded:${placement}`);
      return script.rewarded === "reject"
        ? Promise.reject(new Error("sdk boom"))
        : Promise.resolve(script.rewarded);
    },
    showInterstitial(placement: string): Promise<boolean> {
      calls.push(`interstitial:${placement}`);
      return script.interstitial === "reject"
        ? Promise.reject(new Error("sdk boom"))
        : Promise.resolve(script.interstitial);
    },
    showBanner(placement: string, show: boolean): void {
      calls.push(`banner:${placement}:${show}`);
    },
  };
  return adapter;
}

const NOW = 1760000000000;

test("激励视频看完:granted=true,发 shown+reward 事件,失败计数清零", async () => {
  const store = memStore();
  const ad = fakeAdapter();
  ad.script.rewarded = { completed: false };
  const logic = new AdSlotLogic(store, ad);
  await logic.showRewarded(NOW); // 先失败一次,为验证成功会清零计数
  ad.script.rewarded = { completed: true };
  logic.takeEvents();
  const r = await logic.showRewarded(NOW + 1);
  assert.deepEqual(r, { ok: true, granted: true });
  assert.deepEqual(logic.takeEvents(), [
    { type: "shown", kind: "rewarded", placement: "main" },
    { type: "reward", placement: "main", source: "completed" },
  ]);
  assert.deepEqual(ad.calls, ["rewarded:main", "rewarded:main"]);
  assert.ok(store.get("adslot:main"));
});

test("未完成(无填充/中途关闭):默认不发奖,failed 事件带适配层说明", async () => {
  const ad = fakeAdapter();
  ad.script.rewarded = { completed: false, error: "no fill" };
  const logic = new AdSlotLogic(memStore(), ad);
  const r = await logic.showRewarded(NOW);
  assert.deepEqual(r, { ok: false, granted: false, reason: "uncompleted", detail: "no fill" });
  assert.deepEqual(logic.takeEvents(), [
    { type: "failed", kind: "rewarded", placement: "main", reason: "uncompleted", detail: "no fill" },
  ]);
});

test("降级发奖:grantOnFail=true 时失败也发 reward(degraded)", async () => {
  const ad = fakeAdapter();
  ad.script.rewarded = { completed: false, error: "no fill" };
  const logic = new AdSlotLogic(memStore(), ad, { grantOnFail: true });
  const r = await logic.showRewarded(NOW);
  assert.deepEqual(r, { ok: false, granted: true, reason: "uncompleted", detail: "no fill" });
  const types = logic.takeEvents().map((e) => `${e.type}:${"source" in e ? e.source : ""}`);
  assert.deepEqual(types, ["failed:", "reward:degraded"]);
});

test("适配层抛异常:reason=error,detail 带错误消息", async () => {
  const ad = fakeAdapter();
  ad.script.rewarded = "reject";
  const logic = new AdSlotLogic(memStore(), ad);
  const r = await logic.showRewarded(NOW);
  assert.deepEqual(r, { ok: false, granted: false, reason: "error", detail: "sdk boom" });
});

test("展示期间防连点:第二次调用返回 pending,适配层只被调一次", async () => {
  const ad = fakeAdapter();
  const logic = new AdSlotLogic(memStore(), ad);
  const p1 = logic.showRewarded(NOW);
  const r2 = await logic.showRewarded(NOW + 1); // 未等 p1 完成就再点
  assert.deepEqual(r2, { ok: false, granted: false, reason: "pending" });
  assert.ok((await p1).ok);
  assert.equal(ad.calls.length, 1);
});

test("连续失败进冷却:冷却内 canShow=false、不再触碰适配层,失败计数成功后清零", async () => {
  const ad = fakeAdapter();
  ad.script.rewarded = { completed: false };
  const logic = new AdSlotLogic(memStore(), ad, { cooldownAfterFails: 2, cooldownMs: 60000 });
  await logic.showRewarded(NOW); // 失败 1
  await logic.showRewarded(NOW + 1); // 失败 2 → 冷却到 NOW+1+60000
  logic.takeEvents();
  assert.equal(logic.canShow(NOW + 2), false);
  assert.deepEqual(await logic.showRewarded(NOW + 2), { ok: false, granted: false, reason: "cooldown" });
  assert.deepEqual(logic.takeEvents(), [
    { type: "failed", kind: "rewarded", placement: "main", reason: "cooldown" },
  ]);
  assert.equal(ad.calls.length, 2); // 冷却期内未触碰适配层
  assert.equal(logic.canShow(NOW + 60001), true); // 冷却到点恢复
  // 冷却后成功 → 计数清零:单次失败不再进冷却
  ad.script.rewarded = { completed: true };
  assert.ok((await logic.showRewarded(NOW + 60001)).ok);
  ad.script.rewarded = { completed: false };
  await logic.showRewarded(NOW + 60002);
  assert.equal(logic.canShow(NOW + 60003), true);
});

test("冷却状态持久化:重开游戏(新实例)继承冷却,存档走 version 协议", async () => {
  const store = memStore();
  const ad = fakeAdapter();
  ad.script.rewarded = { completed: false };
  const logic = new AdSlotLogic(store, ad, { cooldownAfterFails: 1, cooldownMs: 60000 });
  await logic.showRewarded(NOW); // 阈值 1:失败一次即进冷却
  const raw = store.get("adslot:main") as {
    version: number;
    data: { failStreak: number; cooldownUntil: number };
  };
  assert.equal(raw.version, 1);
  assert.ok(raw.data.cooldownUntil > NOW);
  const logic2 = new AdSlotLogic(store, fakeAdapter(), { cooldownAfterFails: 1 });
  assert.equal(logic2.canShow(NOW + 1), false);
  assert.equal(logic2.cooldownLeft(NOW + 1), 59999); // 冷却在 NOW 触发,NOW+1 时剩 59999
  assert.deepEqual(await logic2.showRewarded(NOW + 1), { ok: false, granted: false, reason: "cooldown" });
});

test("插屏:成功发 shown,失败发 failed,granted 恒为 false", async () => {
  const ad = fakeAdapter();
  const logic = new AdSlotLogic(memStore(), ad);
  assert.deepEqual(await logic.showInterstitial(NOW), { ok: true, granted: false });
  ad.script.interstitial = false;
  assert.deepEqual(await logic.showInterstitial(NOW + 1), {
    ok: false,
    granted: false,
    reason: "uncompleted",
  });
  assert.deepEqual(logic.takeEvents(), [
    { type: "shown", kind: "interstitial", placement: "main" },
    { type: "failed", kind: "interstitial", placement: "main", reason: "uncompleted" },
  ]);
});

test("Banner:开关透传适配层,展示时发 shown,收起不发事件", () => {
  const ad = fakeAdapter();
  const logic = new AdSlotLogic(memStore(), ad);
  logic.setBanner(true);
  assert.deepEqual(ad.calls, ["banner:main:true"]);
  assert.deepEqual(logic.takeEvents(), [{ type: "shown", kind: "banner", placement: "main" }]);
  logic.setBanner(false);
  assert.deepEqual(ad.calls, ["banner:main:true", "banner:main:false"]);
  assert.deepEqual(logic.takeEvents(), []);
});

test("损坏存档:按字段兜底为安全默认,不崩溃", () => {
  const logic = new AdSlotLogic(
    memStore({ "adslot:main": { garbage: true } }),
    fakeAdapter(),
  );
  assert.equal(logic.canShow(NOW), true);
  assert.equal(logic.cooldownLeft(NOW), 0);
});

test("配置校验:placement 为空、冷却阈值为 0,直接抛错", () => {
  assert.throws(() => new AdSlotLogic(memStore(), fakeAdapter(), { placement: "" }), /placement/);
  assert.throws(
    () => new AdSlotLogic(memStore(), fakeAdapter(), { cooldownAfterFails: 0 }),
    /cooldownAfterFails/,
  );
});
