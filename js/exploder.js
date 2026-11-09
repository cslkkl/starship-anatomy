/* ============================================================
   exploder.js — 剖析状态机（按绝对时间推进，低帧率也准时）
   ============================================================ */
import { clamp, lerp, easeInOutCubic } from "./util.js";

export function createExploder(parts, state) {
  const maxStagger = parts.length * 0.035;
  parts.forEach((p, i) => {
    p.stagger = i * 0.035;
    p.weight = 0;
  });

  let tweenStart = 0;
  let tweenFrom = 0;

  function setTarget(v, instant = false) {
    state.explodeTarget = clamp(v, 0, 1);
    tweenFrom = state.explode;
    tweenStart = performance.now();
    if (instant) {
      state.explode = state.explodeTarget;
      apply();
    }
  }

  function update() {
    if (state.explode === state.explodeTarget) return false;
    const elapsed = (performance.now() - tweenStart) / 1000;
    const t = clamp(elapsed / state.explodeDuration, 0, 1);
    state.explode = lerp(tweenFrom, state.explodeTarget, easeInOutCubic(t));
    if (t >= 1) state.explode = state.explodeTarget;
    apply();
    return true;
  }

  function apply() {
    const g = state.explode;
    const span = 1 + maxStagger;
    for (const p of parts) {
      const local = clamp((g * span - p.stagger) / 1, 0, 1);
      let w = easeInOutCubic(local);
      if (state.solo) w = p.id === state.solo ? Math.min(1.35, w * 1.35) : 0;
      p.weight = w;
      p.group.position.copy(p.explode).multiplyScalar(w);
    }
  }

  return { setTarget, update, apply };
}
