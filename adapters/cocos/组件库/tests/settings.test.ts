import test from "node:test";
import assert from "node:assert/strict";
import { SettingsLogic, SETTINGS_DEFAULTS } from "../components/settings/logic.ts";
import type { SaveLike } from "../components/settings/logic.ts";

/** 内存存档桩(断言落盘行为用) */
class MemSave implements SaveLike {
  data = new Map<string, unknown>();
  flushed = 0;
  get(key: string): unknown {
    return this.data.get(key);
  }
  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  flush(): void {
    this.flushed += 1;
  }
}

test("默认值:无存档时全开", () => {
  const s = new SettingsLogic(new MemSave());
  assert.deepEqual(s.get(), SETTINGS_DEFAULTS);
});

test("set 真实变更才落盘并记 changed", () => {
  const save = new MemSave();
  const s = new SettingsLogic(save);
  assert.equal(s.set("music", true), false);       // 无变更
  assert.equal(save.flushed, 0);
  assert.equal(s.set("music", false), true);       // 变更
  assert.equal(save.flushed, 1);
  assert.deepEqual(s.takeChanged(), ["music"]);
  assert.deepEqual(s.takeChanged(), []);           // take 后清空
  const stored = save.get("settings") as { version: number; data: { music: boolean } };
  assert.equal(stored.version, 1);
  assert.equal(stored.data.music, false);
});

test("重开:从存档恢复上次设置", () => {
  const save = new MemSave();
  const s1 = new SettingsLogic(save);
  s1.set("sfx", false);
  const s2 = new SettingsLogic(save);
  assert.equal(s2.get().sfx, false);
  assert.equal(s2.get().music, true);
});

test("迁移:旧版无 version 的存档按字段合并,不丢默认值", () => {
  const save = new MemSave();
  save.set("settings", { music: false } as unknown); // 老格式(无 version/data)
  const s = new SettingsLogic(save);
  assert.equal(s.get().music, false);   // 保留旧值
  assert.equal(s.get().sfx, true);      // 补默认值
});

test("迁移:损坏的存档回落默认值,不抛异常", () => {
  const save = new MemSave();
  save.set("settings", "garbage" as unknown);
  const s = new SettingsLogic(save);
  assert.deepEqual(s.get(), SETTINGS_DEFAULTS);
});
