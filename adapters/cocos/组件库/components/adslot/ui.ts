/**
 * adslot 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到广告按钮节点,@property 拖入 Button;logic(适配器 + 广告位配置在
 * 游戏组装层装配)由组装层注入。点击 → showRewarded;按钮在 pending/冷却期
 * 自动禁用(cooldownLeft 可做倒计时文案)。
 * 结果处理:组装层轮询 takeEvents() 广播 ad:shown / ad:reward / ad:failed;
 * granted=true(看完或降级发奖)时由组装层执行入包 —— 组件不直接发奖。
 */
import { _decorator, Component, Button } from "cc";
import { AdSlotLogic } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("AdSlotButton")
export class AdSlotButton extends Component {
  @property(Button)
  button: Button = null!;

  /** 由游戏组装层注入(不可在面板里配,避免组件私建适配层/存档) */
  public logic: AdSlotLogic = null!;

  start() {
    if (!this.logic || !this.button) {
      console.error("[adslot] 未注入 AdSlotLogic/Button(游戏组装层负责)");
      return;
    }
    this.button.node.on(Button.EventType.CLICK, () => this.onClick());
  }

  onEnable() {
    // 回前台时同步冷却状态
    this.refresh(Date.now());
  }

  private async onClick() {
    if (!this.logic) {
      return;
    }
    await this.logic.showRewarded(Date.now());
    this.refresh(Date.now());
  }

  private refresh(now: number) {
    if (!this.logic || !this.button) {
      return;
    }
    this.button.interactable = this.logic.canShow(now);
  }
}
