/**
 * shop 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到商店面板节点,@property 依序拖入商品格子节点(goodsNodes[i] 对应
 * 商品表第 i 件);格子子节点按名字约定:"Buy"=购买按钮(Button)、"SoldOut"=
 * 售罄标记(缺失则跳过)。logic(含钱包与商品表配置)由游戏组装层注入。
 * 点击 → buy;ok 时组装层按 purchase.grants 入包并广播 shop:purchase;
 * noMoney/limit 的提示文案由组装层给。存档/跨天刷新在 onEnable 同步。
 */
import { _decorator, Component, Node, Button } from "cc";
import { ShopLogic } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("ShopPanel")
export class ShopPanel extends Component {
  @property({ type: [Node], tooltip: "商品格子,顺序必须与商品表一致" })
  goodsNodes: Node[] = [];

  /** 由游戏组装层注入(不可在面板里配,避免组件私建钱包/存档) */
  public logic: ShopLogic = null!;

  start() {
    if (!this.logic) {
      console.error("[shop] 未注入 ShopLogic(游戏组装层负责)");
      return;
    }
    this.goodsNodes.forEach((node, i) => {
      const buy = node.getChildByName("Buy");
      const btn = buy ? buy.getComponent(Button) : null;
      if (btn) {
        btn.node.on(Button.EventType.CLICK, () => this.onBuy(i));
      }
    });
  }

  onEnable() {
    // 回前台/重开面板时同步跨天(每日限购重置在这里生效)
    this.refresh(Date.now());
  }

  private onBuy(index: number) {
    if (!this.logic) {
      return;
    }
    const st = this.logic.getStatus(Date.now());
    const entry = st[index];
    if (!entry) {
      return;
    }
    this.logic.buy(entry.goods.id, Date.now());
    // 组装层订阅 takeEvents() 广播 shop:purchase 并执行入包
    this.refresh(Date.now());
  }

  private refresh(now: number) {
    if (!this.logic) {
      return;
    }
    const st = this.logic.getStatus(now);
    this.goodsNodes.forEach((node, i) => {
      const entry = st[i];
      if (!entry) {
        return;
      }
      const buy = node.getChildByName("Buy");
      const btn = buy ? buy.getComponent(Button) : null;
      if (btn) {
        btn.interactable = entry.buyable;
      }
      const soldOut = node.getChildByName("SoldOut");
      if (soldOut) {
        soldOut.active = !entry.buyable;
      }
    });
  }
}
