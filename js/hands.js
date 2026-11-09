/* ============================================================
   hands.js — MediaPipe 手部关键点追踪（本地 vendor，无 CDN 依赖）
   输出：归一化掌心指针（已镜像）、捏合/握拳/张掌状态
   ============================================================ */
import { FilesetResolver, HandLandmarker } from "../vendor/vision/vision_bundle.mjs";

const WASM_BASE = new URL("../vendor/vision/wasm", import.meta.url).href;
const MODEL_URL = new URL("../models/hand_landmarker.task", import.meta.url).href;

const IDX = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyTip: 20,
};

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.rafId = 0;
    this.lastVideoTime = -1;

    this.status = "idle"; // idle | loading | ready | error | stopped
    this.error = "";

    this.px = 0.5;
    this.py = 0.5;
    this.present = false;
    this.lostFrames = 0;

    this.pinch = false;
    this.pinchRatio = 1;
    this.fist = false;
    this.open = false;
    this.openness = 0;
    this.pinchPulse = 0;
    this.pinchRelease = 0;

    this.landmarks = null;
    this.handConfidence = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsT = 0;

    this._pinchArmed = true;
    this._lastTs = 0;
    this._errStreak = 0;
    this.onStatus = null;
  }

  _setStatus(s, err = "") {
    this.status = s;
    this.error = err;
    if (this.onStatus) this.onStatus(s, err);
  }

  async init() {
    if (this.landmarker) return this.landmarker;
    this._setStatus("loading");
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch (e) {
        console.warn("[hands] GPU 不可用，回退 CPU", e);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, opts("CPU"));
      }
      this._setStatus("ready");
      return this.landmarker;
    } catch (e) {
      console.error("[hands] 初始化失败", e);
      this._setStatus("error", String(e && e.message ? e.message : e));
      throw e;
    }
  }

  async start(video, stream) {
    this.video = video;
    this.stream = stream;
    if (!this.landmarker) await this.init();
    this.running = true;
    this.lastVideoTime = -1;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.present = false;
    this.landmarks = null;
    this.pinch = this.fist = this.open = false;
    this._setStatus("stopped");
    if (this.landmarker && this.landmarker.close) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
    }
  }

  _loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._loop);
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;

    let ts = performance.now();
    if (ts <= this._lastTs) ts = this._lastTs + 1;
    this._lastTs = ts;

    let res;
    try {
      res = this.landmarker.detectForVideo(v, ts);
      this._errStreak = 0;
    } catch (e) {
      this._errStreak++;
      console.warn("[hands] detect 异常", this._errStreak, e);
      if (this._errStreak >= 5) this._recover();
      return;
    }
    this._consume(res, ts);
  };

  async _recover() {
    if (!this.running) return;
    this._errStreak = 0;
    const old = this.landmarker;
    this.landmarker = null;
    if (old && old.close) {
      try {
        old.close();
      } catch {
        /* ignore */
      }
    }
    this._setStatus("loading");
    try {
      await this.init();
      this.lastVideoTime = -1;
      this._lastTs = 0;
      this._setStatus("ready");
    } catch {
      this.running = false;
    }
  }

  _consume(res, now) {
    this.pinchPulse = 0;
    this.pinchRelease = 0;

    const has = res && res.landmarks && res.landmarks.length > 0;
    if (!has) {
      this.lostFrames++;
      if (this.lostFrames > 6) {
        this.present = false;
        this.landmarks = null;
        this.pinch = false;
        this.fist = false;
        this.open = false;
        this.openness = 0;
      }
      return;
    }

    this.lostFrames = 0;
    this.present = true;

    const raw = res.landmarks[0];
    const lm = raw.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));
    this.landmarks = lm;

    const wrist = lm[IDX.wrist];
    const mMcp = lm[IDX.middleMcp];
    const palm = Math.max(1e-4, d2(wrist, mMcp));

    const it = lm[IDX.indexTip];
    const im = lm[IDX.indexMcp];
    const rawX = clamp01(it.x * 0.68 + im.x * 0.32);
    const rawY = clamp01(it.y * 0.68 + im.y * 0.32);

    const jump = Math.hypot(rawX - this.px, rawY - this.py);
    const alpha = jump > 0.28 ? 0.55 : jump > 0.12 ? 0.34 : 0.2;
    this.px += (rawX - this.px) * alpha;
    this.py += (rawY - this.py) * alpha;

    const ratio = d2(lm[IDX.thumbTip], it) / palm;
    this.pinchRatio = ratio;

    const ext = (tip, pip) => d2(wrist, lm[tip]) > d2(wrist, lm[pip]) * 1.1;
    const indexExt = ext(IDX.indexTip, IDX.indexPip);
    const middleExt = ext(IDX.middleTip, IDX.middlePip);
    const ringExt = ext(IDX.ringTip, IDX.ringPip);
    const pinkyExt = ext(IDX.pinkyTip, IDX.pinkyPip);
    const count = (indexExt ? 1 : 0) + (middleExt ? 1 : 0) + (ringExt ? 1 : 0) + (pinkyExt ? 1 : 0);
    this.openness = count / 4;

    const wasPinch = this.pinch;
    if (this._pinchArmed && indexExt && ratio < 0.34) {
      this.pinch = true;
      this._pinchArmed = false;
    } else if (ratio > 0.5 || !indexExt) {
      this.pinch = false;
      this._pinchArmed = true;
    }
    if (this.pinch && !wasPinch) this.pinchPulse = 1;
    if (!this.pinch && wasPinch) this.pinchRelease = 1;

    this.fist = count <= 1 && !indexExt;
    this.open = count >= 4;

    const scores = res.handedness || res.handednesses;
    this.handConfidence = scores && scores[0] && scores[0][0] ? scores[0][0].score || 0 : 0.9;

    if (this._fpsT === 0) this._fpsT = now;
    this._fpsAcc++;
    if (now - this._fpsT > 700) {
      this.fps = Math.round((this._fpsAcc * 1000) / (now - this._fpsT));
      this._fpsAcc = 0;
      this._fpsT = now;
    }
  }
}

/** 在预览画布上画骨架 */
export function drawHandOverlay(ctx, lm, w, h, state = {}) {
  if (!lm) return;
  const P = (p) => ({ x: p.x * w, y: p.y * h });
  const bones = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ];
  const accent = state.pinch ? "#7ef7ff" : state.fist ? "#ffd479" : state.open ? "#b07bff" : "#5ad1ff";
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1.4, w * 0.008);
  for (const [a, b] of bones) {
    const p1 = P(lm[a]);
    const p2 = P(lm[b]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < lm.length; i++) {
    const p = P(lm[i]);
    const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
    ctx.beginPath();
    ctx.arc(p.x, p.y, tip ? w * 0.011 : w * 0.006, 0, Math.PI * 2);
    ctx.fillStyle = tip ? "#ffffff" : accent;
    ctx.fill();
  }
  ctx.restore();
}
