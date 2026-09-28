import test from "node:test";
import assert from "node:assert/strict";
import { ShareLogic } from "../components/share/logic.ts";
import type { ShareAdapterLike, ShareConfig } from "../components/share/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

function fakeShare() {
  const calls: string[] = [];
  const script = { ok: true, reject: false };
  const adapter: ShareAdapterLike & { calls: string[]; script: typeof script } = {
    calls,
    script,
    share(payload) {
      calls.push(payload.title);
      if (script.reject) return Promise.reject(new Error("sdk boom"));
      return Promise.resolve(script.ok);
    },
  };
  return adapter;
}

function plusDays(ts: number, n: number): number {
  return ts + n * 86400000;
}

const NOW = new Date(2026, 5, 20, 12).getTime();

const CFG: Partial<ShareConfig> = {
  scenes: [
    { scene: "generic", title: "一起来玩!" },
    { scene: "resurrect", title: "救救我", query: "from=resurrect" },
  ],
  dailyRewardLimit: 1,
  rewardCooldownMs: 60000,
  reward: [{ itemId: "coin", count: 50 }],
};

test("分享成功:首次发奖,产出发放指令、记事件、写存档", async () => {
  const store = memStore();
  const ad = fakeShare();
  const logic = new ShareLogic(store, ad, CFG);
  const r = await logic.share("generic", NOW);
  assert.deepEqual(r, { ok: true, rewarded: true, rewards: [{ itemId: "coin", count: 50 }] });
  assert.deepEqual(logic.takeEvents(), [{ type: "shared", scene: "generic", rewarded: true }]);
  assert.deepEqual(ad.calls, ["一起来玩!"]);
  assert.ok(store.get("share"));
});

test("同日第二次分享:成功但不发奖(每日限次)", async () => {
  const logic = new ShareLogic(memStore(), fakeShare(), CFG);
  await logic.share("generic", NOW);
  logic.takeEvents();
  const r = await logic.share("resurrect", NOW + 61000); // 已过冷却,但今日限次用完
  assert.deepEqual(r, { ok: true, rewarded: false });
  assert.deepEqual(logic.takeEvents(), [{ type: "shared", scene: "resurrect", rewarded: false }]);
});

test("冷却间隔内:即使每日限次没用完也不发奖,到点恢复", async () => {
  const logic = new ShareLogic(memStore(), fakeShare(), {
    ...CFG,
    dailyRewardLimit: 2,
  });
  await logic.share("generic", NOW);
  logic.takeEvents();
  const r = await logic.share("resurrect", NOW + 1000); // 冷却中
  assert.deepEqual(r, { ok: true, rewarded: false });
  const r2 = await logic.share("resurrect", NOW + 60001); // 冷却已过
  assert.ok(r2.ok && r2.rewarded);
  assert.equal(logic.rewardQuotaLeft(NOW + 60001), 0);
});

test("跨天重置:每日限次清零,冷却仍按上次奖励时间算", async () => {
  const logic = new ShareLogic(memStore(), fakeShare(), CFG);
  await logic.share("generic", NOW);
  logic.takeEvents();
  const r = await logic.share("generic", plusDays(NOW, 1)); // 新的一天,冷却也早过了
  assert.ok(r.ok && r.rewarded);
});

test("平台返回 false:refused,不发奖", async () => {
  const ad = fakeShare();
  ad.script.ok = false;
  const logic = new ShareLogic(memStore(), ad, CFG);
  const r = await logic.share("generic", NOW);
  assert.deepEqual(r, { ok: false, rewarded: false, reason: "refused" });
  assert.deepEqual(logic.takeEvents(), [{ type: "failed", scene: "generic", reason: "refused" }]);
});

test("适配层异常:error + detail,不发奖", async () => {
  const ad = fakeShare();
  ad.script.reject = true;
  const logic = new ShareLogic(memStore(), ad, CFG);
  const r = await logic.share("generic", NOW);
  assert.deepEqual(r, { ok: false, rewarded: false, reason: "error", detail: "sdk boom" });
});

test("未知场景:noScene,不触碰适配层", async () => {
  const ad = fakeShare();
  const logic = new ShareLogic(memStore(), ad, CFG);
  const r = await logic.share("ghost", NOW);
  assert.deepEqual(r, { ok: false, rewarded: false, reason: "noScene" });
  assert.equal(ad.calls.length, 0);
});

test("防连点:分享在途中再次调用直接拒绝,适配层只被调一次", async () => {
  const ad = fakeShare();
  const logic = new ShareLogic(memStore(), ad, CFG);
  const p1 = logic.share("generic", NOW);
  const r2 = await logic.share("resurrect", NOW + 1); // p1 未返回
  assert.equal(r2.ok, false);
  assert.ok((await p1).ok);
  assert.equal(ad.calls.length, 1);
  assert.equal(logic.isPending(), false);
});

test("reward=null 配置:分享成功但永不发奖", async () => {
  const logic = new ShareLogic(memStore(), fakeShare(), { ...CFG, reward: null });
  const r = await logic.share("generic", NOW);
  assert.deepEqual(r, { ok: true, rewarded: false });
  assert.equal(logic.rewardQuotaLeft(NOW), null);
});

test("损坏/未知版本存档:按字段兜底为安全默认,不崩溃", async () => {
  const logic = new ShareLogic(memStore({ share: { garbage: true } }), fakeShare(), CFG);
  assert.equal(logic.rewardQuotaLeft(NOW), 1);
  const r = await logic.share("generic", NOW);
  assert.ok(r.ok && r.rewarded);
});

test("配置校验:场景重复、空 title、负限次,直接抛错", () => {
  assert.throws(
    () =>
      new ShareLogic(memStore(), fakeShare(), {
        scenes: [
          { scene: "a", title: "x" },
          { scene: "a", title: "y" },
        ],
      }),
    /重复/,
  );
  assert.throws(
    () => new ShareLogic(memStore(), fakeShare(), { scenes: [{ scene: "a", title: "" }] }),
    /title/,
  );
  assert.throws(() => new ShareLogic(memStore(), fakeShare(), { dailyRewardLimit: -1 }), /dailyRewardLimit/);
});
