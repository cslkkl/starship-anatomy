/* ============================================================
   camera-rig.js — 取景适配、机位预设、飞行动画
   ============================================================ */
import * as THREE from "three";
import { clamp, easeInOutCubic } from "./util.js";

export const VIEW_DIRS = {
  hero: [0.8, 0.46, 0.5],
  side: [1, 0.1, 0.03],
  front: [0.02, 0.12, 1],
  rear: [0.02, 0.16, -1],
  top: [0.001, 1, 0.015],
};

export function createCameraRig({ camera, controls, ship, state }) {
  const _aabb = new THREE.Box3();
  const _corner = new THREE.Vector3();
  const _center = new THREE.Vector3();
  let flight = null;

  /** 当前展开度下整舰的包围盒（含各部件位移） */
  function explodedBox(v) {
    _aabb.makeEmpty();
    for (const p of ship.parts) {
      if (!p.bbox) continue;
      let w = v;
      if (state.solo) w = p.id === state.solo ? Math.min(1.35, v * 1.35) : 0;
      const off = p.explode.clone().multiplyScalar(w);
      _aabb.union(p.bbox.clone().translate(off));
    }
    if (_aabb.isEmpty()) _aabb.setFromObject(ship.root);
    return _aabb;
  }

  /** 精确适配：逐个包围盒角点计算所需相机距离 */
  function fitDistanceExact(box, dir, pad = 1.0) {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const vT = Math.tan(vFov / 2);
    const hT = Math.tan(hFov / 2);
    const forward = dir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    box.getCenter(_center);
    let d = 0;
    for (let i = 0; i < 8; i++) {
      _corner
        .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .sub(_center);
      const zf = _corner.dot(forward);
      d = Math.max(d, zf + Math.abs(_corner.dot(right)) / hT, zf + Math.abs(_corner.dot(up)) / vT);
    }
    return Math.max(d, 6) * pad;
  }

  /** HUD 占位（像素）：把主体摆到面板之间的可见区域中央 */
  function hudInsets() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = 0;
    let right = 0;
    let bottom = 0;
    let top = 0;
    const pl = document.getElementById("panel-left");
    const pr = document.getElementById("panel-right");
    if (pl) {
      const r = pl.getBoundingClientRect();
      // 移动端是底部抽屉（几乎占满宽度），不占左右
      if (r.width > 0 && r.width < 420 && r.left < 40) left = r.right;
    }
    if (pr && !pr.classList.contains("collapsed")) {
      const r = pr.getBoundingClientRect();
      if (r.width > 0) right = w - r.left;
    }
    const fb = document.getElementById("hud-bottom");
    if (fb) {
      const r = fb.getBoundingClientRect();
      if (r.height > 0) bottom = h - r.top;
    }
    const ft = document.getElementById("hud-top");
    if (ft) top = ft.getBoundingClientRect().height;
    return { left, right, bottom, top, w, h };
  }

  /** 把 pos/target 整体平移，使主体落在 HUD 之外的区域中央 */
  function applyHudShift(pos, target, dist) {
    const ins = hudInsets();
    const freeCx = (ins.left + (ins.w - ins.right)) / 2;
    const freeCy = (ins.top + (ins.h - ins.bottom)) / 2;
    const dxPx = freeCx - ins.w / 2;
    const dyPx = freeCy - ins.h / 2;
    if (Math.abs(dxPx) < 1 && Math.abs(dyPx) < 1) return 1;

    const vFov = (camera.fov * Math.PI) / 180;
    const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / ins.h;
    const forward = target.clone().sub(pos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const shift = new THREE.Vector3()
      .addScaledVector(right, -dxPx * worldPerPx)
      .addScaledVector(up, dyPx * worldPerPx);
    pos.add(shift);
    target.add(shift);

    // 可用宽度变窄了，距离要按比例补回来，否则会顶到画面边缘
    const usableW = Math.max(200, ins.w - ins.left - ins.right);
    const usableH = Math.max(200, ins.h - ins.top - ins.bottom);
    return Math.max(1, ins.w / usableW, ins.h / usableH);
  }

  function viewPosition(name, explode = 0) {
    const dir = new THREE.Vector3(...(VIEW_DIRS[name] || VIEW_DIRS.hero)).normalize();
    const box = explodedBox(explode).clone();
    const target = box.getCenter(new THREE.Vector3());
    const base = fitDistanceExact(box, dir, 1.02);
    // 先用基准距离估一次安全区补偿，再精算
    const probe = target.clone().add(dir.clone().multiplyScalar(base));
    const comp = applyHudShift(probe, target.clone(), base);
    const dist = base * comp;
    const pos = target.clone().add(dir.clone().multiplyScalar(dist));
    applyHudShift(pos, target, dist);
    return { pos, target };
  }

  function flyTo(pos, target, duration = 1.1) {
    flight = {
      start: performance.now(),
      duration: duration * 1000,
      fromPos: camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
    };
    controls.enabled = false;
  }

  function update() {
    if (!flight) return;
    const t = clamp((performance.now() - flight.start) / flight.duration, 0, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
    camera.lookAt(controls.target);
    if (t >= 1) {
      flight = null;
      controls.enabled = true;
    }
  }

  /** 展开时保持观察方向、重新适配距离 */
  function reframeForExplode(v, duration = 1.3) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.62, 0.34, 0.71);
    dir.normalize();
    const box = explodedBox(v).clone();
    const target = box.getCenter(new THREE.Vector3());
    const base = fitDistanceExact(box, dir, 1.04);
    const probe = target.clone().add(dir.clone().multiplyScalar(base));
    const comp = applyHudShift(probe, target.clone(), base);
    const dist = base * comp;
    const pos = target.clone().add(dir.clone().multiplyScalar(dist));
    applyHudShift(pos, target, dist);
    if (camera.position.distanceTo(pos) < 0.8) return;
    flyTo(pos, target, duration);
  }

  function applyView(name, duration = 1.15) {
    if (!VIEW_DIRS[name]) return;
    const { pos, target } = viewPosition(name, state.explodeTarget);
    flyTo(pos, target, duration);
  }

  /** 窗口尺寸变化后重新适配 */
  function refit() {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.62, 0.34, 0.71);
    dir.normalize();
    const need = fitDistanceExact(explodedBox(state.explodeTarget), dir, 1.0);
    camera.position.copy(controls.target).add(dir.multiplyScalar(need));
    controls.update();
  }

  return {
    explodedBox,
    fitDistanceExact,
    viewPosition,
    flyTo,
    update,
    reframeForExplode,
    applyView,
    refit,
    get flying() {
      return !!flight;
    },
  };
}
