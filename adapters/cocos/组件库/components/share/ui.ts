/**
 * share 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到分享按钮节点,@property 拖入 Button;logic(适配器 + 场景配置在
 * 游戏组装层装配)由组装层注入;@property 配本次按钮对应的场景键。
 * 点击 → share;pending/平台拒绝期间按钮禁用; rewarded=true 时组装层入包并
 * 广播 share:done(组装层轮询 takeEvents(),见 manuals/代码生成.md)。
 */
import { _decorator, Component, Button } from "cc";
import { ShareLogic } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("ShareButton")
export class ShareButton extends Component {
  @property(Button)
  button: Button = null!;

  @property({ tooltip: "对应 ShareConfig.scenes 里的场景键" })
  scene: string = "generic";

  /** 由游戏组装层注入(不可在面板里配,避免组件私建适配层/存档) */
  public logic: ShareLogic = null!;

  start() {
    if (!this.logic || !this.button) {
      console.error("[share] 未注入 ShareLogic/Button(游戏组装层负责)");
      return;
    }
    this.button.node.on(Button.EventType.CLICK, () => this.onClick());
  }

  onEnable() {
    this.refresh();
  }

  private async onClick() {
    if (!this.logic) {
      return;
    }
    await this.logic.share(this.scene, Date.now());
    // 组装层订阅 takeEvents() 广播 share:done;rewarded 时执行入包
    this.refresh();
  }

  private refresh() {
    if (!this.logic || !this.button) {
      return;
    }
    this.button.interactable = !this.logic.isPending();
  }
}
