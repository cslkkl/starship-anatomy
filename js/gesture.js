/* ============================================================
   gesture.js — 手势控制层
   把 MediaPipe 的手部信号翻译成这个页面的操作：
     食指指哪打哪  → 准星 + 悬停高亮
     捏合          → 点选部件 / 按住拖拽旋转
     握拳（保持）  → 一键剖析 / 收拢
     张掌（保持）  → 推近；张掌上下移动 → 推拉镜头
   ============================================================ */
import * as THREE from "three";
import { HandTracker, drawHandOverlay } from "./hands.js";
import { clamp, damp } from "./util.js";

export function createGestureController({ camera, controls, canvas, hooks }) {
  const tracker = new HandTracker();

  const videoEl = document.createElement("video");
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.style.display = "none";
  document.body.appendChild(videoEl);

  const state = {
    on: false,
    mode: "mouse", // mouse | gesture
    pointer: { x: 0.5, y: 0.5 },
    hoverId: null,
    dragging: false,
    dragMoved: 0,
    fistHold: 0,
    openHold: 0,
    lastAction: "",
    lastActionT: 0,
  };

  const cursor = {
    x: 0.5,
    y: 0.5,
    smx: 0.5,
    smy: 0.5,
    visible: false,
  };

  const dragStart = { x: 0, y: 0, theta: 0, phi: 0 };
  const _sph = new THREE.Spherical();
  const _offset = new THREE.Vector3();

  function say(text) {
    state.lastAction = text;
    state.lastActionT = performance.now();
    hooks.onAction && hooks.onAction(text);
  }

  /* ---------------- 开启 / 关闭 ---------------- */
  /** 权限弹窗可能永远不返回，加超时兜底，避免界面卡在“请求权限…” */
  function requestCamera(timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("摄像头没有响应，可能被浏览器拦截或没有可用设备"));
      }, timeoutMs);
      navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false })
        .then((s) => {
          if (settled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(s);
        })
        .catch((e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  async function enable() {
    if (state.on) return;
    hooks.onStatus && hooks.onStatus("requesting", "请求摄像头权限…");
    let stream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("当前浏览器不支持摄像头（需要 https 或 localhost）");
      }
      stream = await requestCamera();
    } catch (e) {
      const msg = e && e.name === "NotAllowedError"
        ? "摄像头权限被拒绝，请在地址栏右侧允许后重试"
        : "无法访问摄像头：" + (e && e.message ? e.message : e);
      hooks.onStatus && hooks.onStatus("denied", msg);
      return;
    }

    state.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
    hooks.onStatus && hooks.onStatus("loading", "正在加载手部模型…");

    try {
      tracker.onStatus = (s, err) => {
        if (s === "loading") hooks.onStatus && hooks.onStatus("loading", "正在加载手部模型…");
        else if (s === "ready") hooks.onStatus && hooks.onStatus("ready", "手势已就绪");
        else if (s === "error") hooks.onStatus && hooks.onStatus("error", "模型加载失败：" + err);
      };
      await tracker.start(videoEl, stream);
      state.on = true;
      state.mode = "gesture";
      hooks.onMode && hooks.onMode("gesture");
      hooks.onStatus && hooks.onStatus("ready", "手势已就绪");
    } catch (e) {
      hooks.onStatus && hooks.onStatus("error", "手势初始化失败：" + (e && e.message ? e.message : e));
      disable();
    }
  }

  function disable() {
    state.on = false;
    state.mode = "mouse";
    state.dragging = false;
    state.fistHold = 0;
    state.openHold = 0;
    state.hoverId = null;
    if (tracker.running) tracker.stop();
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    videoEl.srcObject = null;
    // 立刻收回准星与高亮，不等下一帧
    hooks.onCursor && hooks.onCursor(null);
    hooks.onHover && hooks.onHover(null);
    hooks.onMode && hooks.onMode("mouse");
    hooks.onStatus && hooks.onStatus("idle", "手势已关闭");
  }

  function toggle() {
    if (state.on) disable();
    else enable();
  }

  /* ---------------- 相机旋转（直接改 position，OrbitControls 会据此重算） ---------------- */
  function orbitBy(dTheta, dPhi) {
    _offset.copy(camera.position).sub(controls.target);
    _sph.setFromVector3(_offset);
    _sph.theta += dTheta;
    _sph.phi = clamp(_sph.phi + dPhi, 0.12, Math.PI - 0.12);
    _sph.makeSafe();
    _offset.setFromSpherical(_sph);
    camera.position.copy(controls.target).add(_offset);
    camera.lookAt(controls.target);
  }

  function zoomBy(factor) {
    _offset.copy(camera.position).sub(controls.target);
    const d = clamp(_offset.length() * factor, controls.minDistance, controls.maxDistance);
    _offset.setLength(d);
    camera.position.copy(controls.target).add(_offset);
    camera.lookAt(controls.target);
  }

  /* ---------------- 每帧更新 ---------------- */
  // 手势边沿与“保持”时长全部用绝对时间判断：
  // tracker 自己跑一个 rAF，主循环跑另一个，靠 tracker 的一次性脉冲会被漏掉。
  let prevPinch = false;
  let prevFist = false;
  let prevOpen = false;
  let fistSince = 0;
  let openSince = 0;

  function update(dt) {
    if (!state.on) {
      cursor.visible = false;
      hooks.onCursor && hooks.onCursor(null);
      return;
    }

    const t = tracker;
    const present = t.present;

    // 指针平滑 → 屏幕像素
    cursor.x = t.px;
    cursor.y = t.py;
    cursor.smx = damp(cursor.smx, cursor.x, 22, dt);
    cursor.smy = damp(cursor.smy, cursor.y, 22, dt);
    cursor.visible = present;

    const px = cursor.smx * window.innerWidth;
    const py = cursor.smy * window.innerHeight;
    hooks.onCursor && hooks.onCursor(present ? { x: px, y: py, pinch: t.pinch, fist: t.fist, open: t.open } : null);

    if (!present) {
      state.dragging = false;
      state.hoverId = null;
      prevPinch = prevFist = prevOpen = false;
      fistSince = openSince = 0;
      hooks.onHover && hooks.onHover(null);
      return;
    }

    // ---- 悬停高亮（准星下的部件） ----
    const id = hooks.pickAt(px, py);
    if (id !== state.hoverId) {
      state.hoverId = id;
      hooks.onHover && hooks.onHover(id);
    }

    const now = performance.now();
    const pinchRising = t.pinch && !prevPinch;
    const pinchFalling = !t.pinch && prevPinch;

    // ---- 捏合：按下记起点，抬起判定「点击 or 拖拽」 ----
    if (pinchRising) {
      state.dragging = true;
      state.dragMoved = 0;
      dragStart.x = t.px;
      dragStart.y = t.py;
      _offset.copy(camera.position).sub(controls.target);
      _sph.setFromVector3(_offset);
      dragStart.theta = _sph.theta;
      dragStart.phi = _sph.phi;
    }

    if (t.pinch && state.dragging) {
      const dx = t.px - dragStart.x;
      const dy = t.py - dragStart.y;
      state.dragMoved = Math.max(state.dragMoved, Math.hypot(dx, dy));
      const base = new THREE.Spherical();
      base.radius = camera.position.distanceTo(controls.target);
      base.theta = dragStart.theta - dx * 4.2;
      base.phi = clamp(dragStart.phi - dy * 2.6, 0.12, Math.PI - 0.12);
      base.makeSafe();
      _offset.setFromSpherical(base);
      camera.position.copy(controls.target).add(_offset);
      camera.lookAt(controls.target);
    }

    if (pinchFalling && state.dragging) {
      state.dragging = false;
      if (state.dragMoved < 0.035) {
        if (state.hoverId) {
          hooks.onSelect && hooks.onSelect(state.hoverId);
          say("选中 " + state.hoverId);
        } else {
          hooks.onSelect && hooks.onSelect(null);
          say("取消选择");
        }
      }
      state.dragMoved = 0;
    }

    // ---- 握拳保持 0.55s：一键剖析 ----
    if (t.fist && !t.pinch) {
      if (!prevFist) fistSince = now;
      if (fistSince && now - fistSince > 550) {
        hooks.onExplodeToggle && hooks.onExplodeToggle();
        say("一键剖析");
        fistSince = 0;
      }
    } else {
      fistSince = 0;
    }

    // ---- 张掌：持续推近 ----
    if (t.open && !t.pinch) {
      if (!prevOpen) openSince = now;
      if (openSince && now - openSince > 200) {
        zoomBy(1 - 0.85 * dt);
        if (now - openSince > 420 && now - openSince < 460) say("推近");
      }
    } else {
      openSince = 0;
    }

    prevPinch = t.pinch;
    prevFist = t.fist;
    prevOpen = t.open;
  }

  /* ---------------- 摄像头预览 ---------------- */
  let previewCanvas = null;
  let previewCtx = null;

  function bindPreview(canvasEl) {
    previewCanvas = canvasEl;
    previewCtx = canvasEl ? canvasEl.getContext("2d") : null;
  }

  function drawPreview() {
    if (!previewCtx || !state.on) return;
    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const ctx = previewCtx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // 视频画面（镜像）
    if (videoEl.readyState >= 2) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, 0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.fillStyle = "rgba(4,8,14,0.45)";
    ctx.fillRect(0, 0, w, h);
    drawHandOverlay(ctx, tracker.landmarks, w, h, {
      pinch: tracker.pinch,
      fist: tracker.fist,
      open: tracker.open,
    });
    if (!tracker.present) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "11px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("举起一只手", w / 2, h / 2 + 4);
    }
    ctx.restore();
  }

  return {
    enable,
    disable,
    toggle,
    update,
    bindPreview,
    drawPreview,
    state,
    tracker,
    get isOn() {
      return state.on;
    },
  };
}
