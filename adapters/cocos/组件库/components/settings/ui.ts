/**
 * settings 组件 — UI 绑定(在 Cocos Creator 工程内编译;管线仓库不做类型检查)。
 *
 * 用法:挂到设置面板节点,@property 拖入三个 Toggle;store 由游戏组装层注入
 * (存档封装的实例,见 manuals/代码生成.md 存档纪律)。
 * 变更广播:UI 层在 onToggle 里向机制契约事件总线发 "settings:changed"。
 */
import { _decorator, Component, Toggle } from "cc";
import { SettingsLogic, SettingsField } from "./logic";

const { ccclass, property } = _decorator;

@ccclass("SettingsPanel")
export class SettingsPanel extends Component {
  @property(Toggle)
  musicToggle: Toggle = null!;

  @property(Toggle)
  sfxToggle: Toggle = null!;

  @property(Toggle)
  vibrateToggle: Toggle = null!;

  /** 由游戏组装层注入(不可在面板里配,避免组件私建第二份存档) */
  public logic: SettingsLogic = null!;

  start() {
    if (!this.logic) {
      console.error("[settings] 未注入 SettingsLogic(游戏组装层负责)");
      return;
    }
    this.syncToggles();
    this.musicToggle.node.on("toggle", () => this.onToggle("music", this.musicToggle.isChecked));
    this.sfxToggle.node.on("toggle", () => this.onToggle("sfx", this.sfxToggle.isChecked));
    this.vibrateToggle.node.on("toggle", () => this.onToggle("vibrate", this.vibrateToggle.isChecked));
  }

  private onToggle(field: SettingsField, value: boolean) {
    this.logic.set(field, value);
    // 游戏组装层订阅 takeChanged() 并广播机制契约事件 settings:changed
  }

  private syncToggles() {
    const s = this.logic.get();
    this.musicToggle.isChecked = s.music;
    this.sfxToggle.isChecked = s.sfx;
    this.vibrateToggle.isChecked = s.vibrate;
  }
}
