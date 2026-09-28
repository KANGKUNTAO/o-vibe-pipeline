import test from "node:test";
import assert from "node:assert/strict";
import { ReddotTree } from "../components/reddot/logic.ts";

test("mark 后自身与祖先链点亮,clear 沿链熄灭", () => {
  const t = new ReddotTree();
  t.register("main/shop");
  assert.equal(t.isLit("main"), false);
  t.mark("main/shop", 2);
  assert.equal(t.isLit("main/shop"), true);
  assert.equal(t.isLit("main"), true);        // 祖先自动点亮
  assert.equal(t.litCount("main"), 2);
  t.clear("main/shop");
  assert.equal(t.isLit("main"), false);       // 链上自动熄灭
});

test("兄弟分支互不影响;清一个分支另一个仍亮", () => {
  const t = new ReddotTree();
  t.mark("main/shop");
  t.mark("main/signin");
  assert.equal(t.litCount("main"), 2);
  t.clearSubtree("main/shop");
  assert.equal(t.isLit("main/shop"), false);
  assert.equal(t.isLit("main/signin"), true); // 兄弟不受影响
  assert.equal(t.isLit("main"), true);
});

test("clear 只清自身不清后代,clearSubtree 才清整块", () => {
  const t = new ReddotTree();
  t.mark("main/shop/tab1");
  t.clear("main/shop");
  assert.equal(t.isLit("main/shop"), true);   // 后代还在
  t.clearSubtree("main/shop");
  assert.equal(t.isLit("main/shop"), false);
});

test("takeDirty 只报状态变化链,且 take 后清空", () => {
  const t = new ReddotTree();
  t.mark("main/shop");
  const dirty = t.takeDirty();
  assert.ok(dirty.includes("main") && dirty.includes("main/shop"));
  assert.equal(t.takeDirty().length, 0);
  // 再 mark:状态没变(仍亮)→ 仍算 dirty(计数变化)…协议:计数变化也通知
  t.mark("main/shop");
  assert.ok(t.takeDirty().length >= 2);
});

test("路径容错:多余斜杠/首尾斜杠归一化", () => {
  const t = new ReddotTree();
  t.mark("/main//shop/");
  assert.equal(t.isLit("main/shop"), true);
  assert.equal(t.litCount("main"), 1);
});
