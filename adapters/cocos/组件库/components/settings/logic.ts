/**
 * settings 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 职责:音效/音乐/震动开关的状态与持久化;存档版本迁移协议的参考实现。
 * UI 绑定见 ui.ts;对外变更通过 takeChanged() 交由 UI 层广播机制契约事件。
 */

export interface SettingsState {
  music: boolean;
  sfx: boolean;
  vibrate: boolean;
}

export const SETTINGS_DEFAULTS: SettingsState = { music: true, sfx: true, vibrate: true };

/** 存档最小接口(与 core/contracts.ts 的 ISaveStore 结构兼容,刻意自包含) */
export interface SaveLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

const SAVE_KEY = "settings";
const VERSION = 1;

export type SettingsField = keyof SettingsState;

export class SettingsLogic {
  private store: SaveLike;
  private state: SettingsState;
  private changed: SettingsField[] = [];

  constructor(store: SaveLike) {
    this.store = store;
    this.state = this.load();
  }

  /** 读档 + 版本迁移:缺版本/低版本按字段合并默认值,未知字段丢弃(向后兼容) */
  private load(): SettingsState {
    const raw = this.store.get(SAVE_KEY) as { version?: number; data?: Partial<SettingsState> } | undefined;
    if (!raw || typeof raw !== "object") {
      return { ...SETTINGS_DEFAULTS };
    }
    const data = raw.version === VERSION && raw.data ? raw.data : (raw as Partial<SettingsState>);
    return {
      music: data.music ?? SETTINGS_DEFAULTS.music,
      sfx: data.sfx ?? SETTINGS_DEFAULTS.sfx,
      vibrate: data.vibrate ?? SETTINGS_DEFAULTS.vibrate,
    };
  }

  get(): SettingsState {
    return { ...this.state };
  }

  /** 设置一项;真实变更才落盘,返回是否发生变更 */
  set(field: SettingsField, value: boolean): boolean {
    if (this.state[field] === value) {
      return false;
    }
    this.state[field] = value;
    this.changed.push(field);
    this.store.set(SAVE_KEY, { version: VERSION, data: { ...this.state } });
    this.store.flush();
    return true;
  }

  toggle(field: SettingsField): boolean {
    return this.set(field, !this.state[field]);
  }

  /** 取走自上次以来的变更字段(UI 层据此广播 settings:changed 事件) */
  takeChanged(): SettingsField[] {
    const out = this.changed;
    this.changed = [];
    return out;
  }
}
