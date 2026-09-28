/**
 * reddot 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:游戏组装层建一棵 ReddotTree 注入;各界面节点挂 ReddotBadge,
 * 把 dotPath 填成台账/机制契约里登记的路径;脏路径由组装层轮询 takeDirty()
 * 广播机制契约事件 reddot:changed,徽章节点自行刷新显隐与数字。
 */
import { _decorator, Component, Label, Node } from "cc";
import { ReddotTree } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("ReddotBadge")
export class ReddotBadge extends Component {
  @property
  /** 红点路径,如 main/shop;必须与机制契约登记一致 */
  dotPath = "";

  @property(Label)
  /** 数字角标(可空:只显隐不打数字) */
  countLabel: Label = null!;

  /** 由游戏组装层注入,禁止组件自建(单一事实源) */
  public tree: ReddotTree = null!;

  refresh() {
    if (!this.tree || !this.dotPath) {
      return;
    }
    const lit = this.tree.isLit(this.dotPath);
    this.node.active = lit;
    if (lit && this.countLabel) {
      this.countLabel.string = String(this.tree.litCount(this.dotPath));
    }
  }
}
