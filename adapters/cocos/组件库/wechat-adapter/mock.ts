/**
 * Mock 平台适配层 — 纯本地开发期使用(占位 appid 阶段)。
 * 行为可预测:一切立即成功、激励视频默认完播、动作全部记录在 calls 里供测试断言。
 */
import type { IPlatformAdapter, ILeaderboard, LoginResult, RewardedResult, SharePayload } from "../core/contracts.ts";

export class MockLeaderboard implements ILeaderboard {
  scores: number[] = [];
  submitScore(score: number): void {
    this.scores.push(score);
  }
  supportsFriendList(): boolean {
    return false;
  }
}

export class MockPlatformAdapter implements IPlatformAdapter {
  readonly name = "mock";
  readonly leaderboard = new MockLeaderboard();
  /** 调用记录(测试断言用) */
  calls: string[] = [];
  /** 测试可注入:下次激励视频返回失败 */
  failNextRewarded = false;

  login(): Promise<LoginResult> {
    this.calls.push("login");
    return Promise.resolve({ userId: "mock-user", nickname: "本地玩家", avatar: "" });
  }
  share(payload: SharePayload): Promise<boolean> {
    this.calls.push(`share:${payload.title}`);
    return Promise.resolve(true);
  }
  showRewardedVideo(placement: string): Promise<RewardedResult> {
    this.calls.push(`rewarded:${placement}`);
    if (this.failNextRewarded) {
      this.failNextRewarded = false;
      return Promise.resolve({ completed: false, error: "mock:无填充" });
    }
    return Promise.resolve({ completed: true });
  }
  showBanner(placement: string, show: boolean): void {
    this.calls.push(`banner:${placement}:${show ? "show" : "hide"}`);
  }
  showInterstitial(placement: string): Promise<boolean> {
    this.calls.push(`interstitial:${placement}`);
    return Promise.resolve(true);
  }
  vibrate(short: boolean): void {
    this.calls.push(`vibrate:${short ? "short" : "long"}`);
  }
}
