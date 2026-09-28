/**
 * reddot 组件 — 逻辑核(纯 TS,零引擎依赖,Node 可测)。
 *
 * 树形红点:叶子/节点可计数未读;节点点亮 = 自身或任一后代未读 > 0;
 * 状态变化沿祖先链传播(takeDirty 取走脏路径,UI 层广播 reddot:changed)。
 * 路径约定:斜杠分层,如 "main/shop"、"main/signin/day3"。
 */

export class ReddotTree {
  /** path → 自身未读计数(后代聚合不存这里,现算) */
  private counts = new Map<string, number>();
  private dirty = new Set<string>();

  constructor(rootId = "root") {
    this.counts.set(normalize(rootId), 0);
  }

  /** 登记路径(含祖先链),重复登记无害 */
  register(path: string): void {
    for (const p of chain(path)) {
      if (!this.counts.has(p)) {
        this.counts.set(p, 0);
      }
    }
  }

  /** 累加未读计数,返回该节点新计数;祖先链脏检查 */
  mark(path: string, count = 1): number {
    const p = normalize(path);
    this.register(p);
    const next = (this.counts.get(p) ?? 0) + count;
    this.counts.set(p, next);
    this.touchChain(p);
    return next;
  }

  /** 清零该节点自身未读(玩家查看了它);后代不动 */
  clear(path: string): void {
    const p = normalize(path);
    if (this.counts.has(p)) {
      this.counts.set(p, 0);
      this.touchChain(p);
    }
  }

  /** 清零该节点及全部后代(整块查看) */
  clearSubtree(path: string): void {
    const p = normalize(path);
    const prefix = p + "/";
    for (const key of [...this.counts.keys()]) {
      if (key === p || key.startsWith(prefix)) {
        this.counts.set(key, 0);
        this.touchChain(key);
      }
    }
  }

  /** 节点是否点亮 = 自身或任一后代计数 > 0 */
  isLit(path: string): boolean {
    const p = normalize(path);
    const prefix = p + "/";
    for (const [key, count] of this.counts) {
      if (count > 0 && (key === p || key.startsWith(prefix))) {
        return true;
      }
    }
    return false;
  }

  /** 子树未读总数(展示用数字角标) */
  litCount(path: string): number {
    const p = normalize(path);
    const prefix = p + "/";
    let sum = 0;
    for (const [key, count] of this.counts) {
      if (key === p || key.startsWith(prefix)) {
        sum += count;
      }
    }
    return sum;
  }

  /** 取走自上次以来的点亮状态变化路径(UI 层据此广播 reddot:changed) */
  takeDirty(): string[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  private touchChain(path: string): void {
    const parts = normalize(path).split("/");
    for (let i = 1; i <= parts.length; i++) {
      this.dirty.add(parts.slice(0, i).join("/"));
    }
  }
}

function normalize(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function chain(path: string): string[] {
  const p = normalize(path);
  const parts = p.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}
