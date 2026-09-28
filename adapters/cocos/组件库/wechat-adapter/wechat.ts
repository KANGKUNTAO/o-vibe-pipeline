/**
 * 微信平台适配层骨架 — IPlatformAdapter 的微信实现。
 *
 * 现状(2026-09-29):登录/分享/广告/震动为可工作骨架(直接映射 wx.* API);
 * 好友排行榜的"读"必须走开放数据域(见 开放数据域.md),提交分数走主域 wx.setUserCloudStorage。
 * 首次接入真实 appid 前,按 manuals/玩法切片.md 立项卡核实当期平台规则。
 */
import type { IPlatformAdapter, ILeaderboard, LoginResult, RewardedResult, SharePayload } from "../core/contracts.ts";

/** 微信全局对象(运行时注入;类型用 any 以免在管线仓库引入微信声明文件) */
declare const wx: any;

export class WechatLeaderboard implements ILeaderboard {
  submitScore(score: number): void {
    wx.setUserCloudStorage({
      KVDataList: [{ key: "score", value: String(score) }],
    });
  }
  supportsFriendList(): boolean {
    return true; // 经开放数据域渲染,见 开放数据域.md
  }
}

export class WechatPlatformAdapter implements IPlatformAdapter {
  readonly name = "wechat";
  readonly leaderboard = new WechatLeaderboard();

  private bannerId = "";
  private bannerVisible = false;

  constructor(bannerPlacementId = "", interstitialPlacementId = "", rewardedPlacementId = "") {
    this.bannerId = bannerPlacementId;
    this._interstitialId = interstitialPlacementId;
    this._rewardedId = rewardedPlacementId;
  }

  private _interstitialId: string;
  private _rewardedId: string;

  login(): Promise<LoginResult> {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res: any) => resolve({ userId: res.code, nickname: "", avatar: "" }),
        fail: (err: any) => reject(new Error(`wx.login 失败:${JSON.stringify(err)}`)),
      });
    });
    // 注:拿昵称头像需另走 wx.getUserProfile(用户主动点击触发,一次性授权),接入时补
  }

  share(payload: SharePayload): Promise<boolean> {
    wx.shareAppMessage({ title: payload.title, imageUrl: payload.imageUrl, query: payload.query });
    return Promise.resolve(true);
  }

  showRewardedVideo(placement: string): Promise<RewardedResult> {
    return new Promise((resolve) => {
      const unitId = placement || this._rewardedId;
      const ad = wx.createRewardedVideoAd({ adUnitId: unitId });
      const onClose = (res: any) => {
        ad.offClose(onClose);
        // (res && res.isEnded) 为 false = 中途退出,不发奖励
        resolve({ completed: !!(res && res.isEnded), error: res && res.isEnded ? undefined : "未完播" });
      };
      ad.onClose(onClose);
      ad.show().catch(() => {
        // 加载失败:重拉一次,再失败按降级返回(组件层负责提示,不许卡死)
        ad.load().then(() => ad.show()).catch((err: any) => {
          ad.offClose(onClose);
          resolve({ completed: false, error: `拉取失败:${JSON.stringify(err)}` });
        });
      });
    });
  }

  showBanner(placement: string, show: boolean): void {
    const unitId = placement || this.bannerId;
    if (show && !this.bannerVisible) {
      this._banner = wx.createBannerAd({ adUnitId: unitId });
      this._banner.show().catch(() => {});
      this.bannerVisible = true;
    } else if (!show && this.bannerVisible && this._banner) {
      this._banner.hide();
      this.bannerVisible = false;
    }
  }

  private _banner: any;

  showInterstitial(placement: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ad = wx.createInterstitialAd({ adUnitId: placement || this._interstitialId });
      ad.onClose(() => resolve(true));
      ad.show().catch(() => resolve(false)); // 插屏加载失败静默降级
    });
  }

  vibrate(short: boolean): void {
    if (short) wx.vibrateShort({ type: "light" });
    else wx.vibrateLong();
  }
}
