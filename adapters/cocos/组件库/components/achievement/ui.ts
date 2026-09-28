/**
 * achievement 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到任务/成就面板节点,@property 依序拖入任务条目节点(taskNodes[i]
 * 对应任务表第 i 条);条目子节点按名字约定:"Claim"=领奖按钮(Button)、
 * "Done"=已完成标记、"Claimed"=已领奖标记(缺失则跳过)。
 * logic 由游戏组装层注入;点击领奖 → claim,ok 时组装层按 rewards 入包并广播
 * achievement:claimed;done 事件(进度达标)由组装层轮询 takeEvents() 广播,
 * 用于红点(mark 到 reddot 组件的 "main/achievement/<taskId>")与角标刷新。
 */
import { _decorator, Component, Node, Button } from "cc";
import { AchievementLogic } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("AchievementPanel")
export class AchievementPanel extends Component {
  @property({ type: [Node], tooltip: "任务条目,顺序必须与任务表一致" })
  taskNodes: Node[] = [];

  /** 由游戏组装层注入(不可在面板里配,避免组件私建存档) */
  public logic: AchievementLogic = null!;

  start() {
    if (!this.logic) {
      console.error("[achievement] 未注入 AchievementLogic(游戏组装层负责)");
      return;
    }
    this.taskNodes.forEach((node, i) => {
      const claim = node.getChildByName("Claim");
      const btn = claim ? claim.getComponent(Button) : null;
      if (btn) {
        btn.node.on(Button.EventType.CLICK, () => this.onClaim(i));
      }
    });
  }

  onEnable() {
    this.refresh();
  }

  private onClaim(index: number) {
    if (!this.logic) {
      return;
    }
    const st = this.logic.list();
    const entry = st[index];
    if (!entry) {
      return;
    }
    this.logic.claim(entry.id);
    // 组装层订阅 takeEvents() 广播 achievement:claimed 并执行入包
    this.refresh();
  }

  private refresh() {
    if (!this.logic) {
      return;
    }
    const st = this.logic.list();
    this.taskNodes.forEach((node, i) => {
      const entry = st[i];
      if (!entry) {
        return;
      }
      const claim = node.getChildByName("Claim");
      const btn = claim ? claim.getComponent(Button) : null;
      if (btn) {
        btn.interactable = entry.canClaim;
      }
      const done = node.getChildByName("Done");
      if (done) {
        done.active = entry.done && !entry.claimed;
      }
      const claimed = node.getChildByName("Claimed");
      if (claimed) {
        claimed.active = entry.claimed;
      }
    });
  }
}
