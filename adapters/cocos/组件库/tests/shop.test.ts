import test from "node:test";
import assert from "node:assert/strict";
import { ShopLogic } from "../components/shop/logic.ts";
import type { ShopConfig, ShopWallet } from "../components/shop/logic.ts";

function memStore(seed?: Record<string, unknown>) {
  const m = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => void m.set(k, v),
    flush: () => {},
  };
}

function wallet(balances: Record<string, number>): ShopWallet {
  const b = { ...balances };
  return {
    getCount: (id) => b[id] ?? 0,
    consume: (id, n) => {
      if ((b[id] ?? 0) < n) return false;
      b[id] -= n;
      return true;
    },
  };
}

/** 本地日历日正午的时间戳(避开午夜/DST 边界,跨时区稳定) */
function noon(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12).getTime();
}

function plusDays(ts: number, n: number): number {
  return ts + n * 86400000;
}

const NOW = noon(2026, 5, 20);

const CFG: Partial<ShopConfig> = {
  goods: [
    { id: "box", grants: [{ itemId: "coin", count: 100 }], price: { currency: "diamond", amount: 10 }, limitKind: "none", limitCount: 0 },
    { id: "daily_pack", grants: [{ itemId: "energy", count: 3 }], price: { currency: "diamond", amount: 5 }, limitKind: "daily", limitCount: 2 },
    { id: "noads", grants: [{ itemId: "noads", count: 1 }], price: { currency: "diamond", amount: 60 }, limitKind: "total", limitCount: 1 },
    { id: "free_gift", grants: [{ itemId: "coin", count: 10 }], price: { currency: "diamond", amount: 0 }, limitKind: "none", limitCount: 0 },
  ],
};

test("首购:扣钱包、产出发放指令、记事件、写存档", () => {
  const store = memStore();
  const w = wallet({ diamond: 100 });
  const logic = new ShopLogic(store, CFG, w);
  const r = logic.buy("box", NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.purchase.grants, [{ itemId: "coin", count: 100 }]);
  assert.equal(r.purchase.remainingToday, null);
  assert.equal(w.getCount("diamond"), 90);
  assert.deepEqual(logic.takeEvents(), [{ type: "purchased", goodsId: "box" }]);
  assert.ok(store.get("shop"));
});

test("钱不够:noMoney,不扣款、不记账、不发事件", () => {
  const w = wallet({ diamond: 5 });
  const logic = new ShopLogic(memStore(), CFG, w);
  assert.deepEqual(logic.buy("box", NOW), { ok: false, reason: "noMoney" });
  assert.equal(w.getCount("diamond"), 5);
  assert.deepEqual(logic.takeEvents(), []);
});

test("每日限购:买满返回 limit,跨天自动重置", () => {
  const w = wallet({ diamond: 100 });
  const logic = new ShopLogic(memStore(), CFG, w);
  assert.ok(logic.buy("daily_pack", NOW).ok);
  assert.ok(logic.buy("daily_pack", NOW + 3600000).ok);
  assert.deepEqual(logic.buy("daily_pack", NOW + 3600000), { ok: false, reason: "limit" });
  const r = logic.buy("daily_pack", plusDays(NOW, 1)); // 第二天重置
  assert.ok(r.ok);
  assert.equal(r.purchase.remainingToday, 1); // 今天还能买 1 件
});

test("终身限购:total 买满后跨天也不重置", () => {
  const w = wallet({ diamond: 200 });
  const logic = new ShopLogic(memStore(), CFG, w);
  assert.ok(logic.buy("noads", NOW).ok);
  assert.deepEqual(logic.buy("noads", NOW + 3600000), { ok: false, reason: "limit" });
  assert.deepEqual(logic.buy("noads", plusDays(NOW, 3)), { ok: false, reason: "limit" });
});

test("免费商品:不碰钱包,零余额也能领", () => {
  const w = wallet({ diamond: 0 });
  const logic = new ShopLogic(memStore(), CFG, w);
  let walletTouched = false;
  const origGet = w.getCount;
  w.getCount = (id) => {
    walletTouched = true;
    return origGet(id);
  };
  const r = logic.buy("free_gift", NOW);
  assert.ok(r.ok);
  assert.equal(walletTouched, false);
});

test("未知商品:noGoods", () => {
  const logic = new ShopLogic(memStore(), CFG, wallet({ diamond: 100 }));
  assert.deepEqual(logic.buy("ghost", NOW), { ok: false, reason: "noGoods" });
});

test("getStatus:今日/终身计数与可买状态正确", () => {
  const w = wallet({ diamond: 100 });
  const logic = new ShopLogic(memStore(), CFG, w);
  logic.buy("daily_pack", NOW);
  logic.buy("daily_pack", NOW + 3600000);
  const st = logic.getStatus(NOW + 3600000);
  const pack = st.find((e) => e.goods.id === "daily_pack")!;
  assert.equal(pack.boughtToday, 2);
  assert.equal(pack.buyable, false);
  assert.equal(pack.remainingToday, 0);
  const box = st.find((e) => e.goods.id === "box")!;
  assert.equal(box.buyable, true);
  assert.equal(box.remainingToday, null); // 不限购
});

test("同版本存档续玩:终身计数保留,日计数跨天后清零", () => {
  const store = memStore();
  const w = wallet({ diamond: 100 });
  const logic = new ShopLogic(store, CFG, w);
  logic.buy("noads", NOW);
  logic.takeEvents();
  const logic2 = new ShopLogic(store, CFG, w);
  assert.deepEqual(logic2.buy("noads", NOW), { ok: false, reason: "limit" }); // 终身还在
  assert.ok(logic2.buy("daily_pack", plusDays(NOW, 1)).ok); // 新一天日计数从零开始
});

test("损坏/未知版本存档:按字段兜底为安全默认,不崩溃", () => {
  const garbage = new ShopLogic(memStore({ shop: { garbage: true } }), CFG, wallet({ diamond: 10 }));
  const st = garbage.getStatus(NOW);
  assert.equal(st.find((e) => e.goods.id === "box")!.boughtTotal, 0);
  assert.ok(garbage.buy("box", NOW).ok);
});

test("配置校验:重复 id、空 grants、有付费商品却没钱包,直接抛错", () => {
  assert.throws(
    () =>
      new ShopLogic(memStore(), {
        goods: [
          { id: "a", grants: [{ itemId: "coin", count: 1 }], price: { currency: "diamond", amount: 1 }, limitKind: "none", limitCount: 0 },
          { id: "a", grants: [{ itemId: "coin", count: 2 }], price: { currency: "diamond", amount: 1 }, limitKind: "none", limitCount: 0 },
        ],
      }),
    /重复/,
  );
  assert.throws(
    () => new ShopLogic(memStore(), { goods: [{ id: "a", grants: [], price: { currency: "diamond", amount: 1 }, limitKind: "none", limitCount: 0 }] }),
    /grants/,
  );
  assert.throws(
    () => new ShopLogic(memStore(), { goods: [{ id: "a", grants: [{ itemId: "coin", count: 1 }], price: { currency: "diamond", amount: 1 }, limitKind: "none", limitCount: 0 }] }),
    /wallet/,
  );
});
