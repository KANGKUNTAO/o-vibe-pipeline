/**
 * signin 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到签到面板节点,@property 依序拖入周期内每天的格子节点(dayNodes[i]
 * 即第 i+1 天);格子子节点按名字约定:"Signed"=已签标记、"Today"=今日标记、
 * "CatchUp"=补签角标(缺失则跳过)。logic 由游戏组装层注入。
 * 交互:点今天且未签 → sign;点漏签日 → catchUp。
 * 事件广播:组装层轮询 takeEvents() 向机制契约总线发 signin:claimed /
 * signin:cycleComplete / signin:cycleReset(表现措辞→机制信号,见 manuals/代码生成.md)。
 */
import { _decorator, Component, Node } from "cc";
import { SigninLogic } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("SigninPanel")
export class SigninPanel extends Component {
  @property({ type: [Node], tooltip: "周期内第 1..N 天的格子,顺序必须与天数一致" })
  dayNodes: Node[] = [];

  /** 由游戏组装层注入(不可在面板里配,避免组件私建第二份存档/时钟) */
  public logic: SigninLogic = null!;

  start() {
    if (!this.logic) {
      console.error("[signin] 未注入 SigninLogic(游戏组装层负责)");
      return;
    }
    this.dayNodes.forEach((node, i) => {
      node.on(Node.EventType.TOUCH_END, () => this.onDay(i + 1));
    });
  }

  onEnable() {
    // 回前台/重开面板时同步跨天(advance 幂等,漏签与周期滚动在这里生效)
    this.refresh(Date.now());
  }

  private onDay(day: number) {
    if (!this.logic) {
      return;
    }
    const now = Date.now();
    const st = this.logic.getStatus(now);
    if (day === st.today && st.canSignToday) {
      this.logic.sign(now);
    } else {
      this.logic.catchUp(now, day);
    }
    // 组装层订阅 takeEvents() 广播 signin:claimed 等契约事件
    this.refresh(now);
  }

  private refresh(now: number) {
    if (!this.logic) {
      return;
    }
    const st = this.logic.getStatus(now);
    this.dayNodes.forEach((node, i) => {
      const day = i + 1;
      const signed = node.getChildByName("Signed");
      if (signed) {
        signed.active = st.signedDays.includes(day);
      }
      const todayMark = node.getChildByName("Today");
      if (todayMark) {
        todayMark.active = day === st.today;
      }
      const badge = node.getChildByName("CatchUp");
      if (badge) {
        badge.active = st.missedDays.includes(day) && st.catchUpsLeft > 0;
      }
    });
  }
}
