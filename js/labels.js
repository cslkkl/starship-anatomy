/* ============================================================
   labels.js — 引线标签：包围盒取边点、面板安全区、防重叠、同组合并
   ============================================================ */
import * as THREE from "three";
import { clamp } from "./util.js";

const GROUP_OF = {
  engineL: "propulsion",
  engineR: "propulsion",
  engineC: "propulsion",
  wingL: "aerofoil",
  wingR: "aerofoil",
};

const GROUP_NAME = {
  propulsion: "动力组 · 3 件",
  aerofoil: "翼面组 · 2 件",
};

export function createLabels({ ship, camera, state, el }) {
  const layer = el.labelLayer;
  const items = ship.parts.map((p) => {
    const div = document.createElement("div");
    div.className = "lbl";
    div.innerHTML = `<span class="anchor"></span><span class="lead"></span><span class="tag"><i class="code">${p.code.replace(
      "SYS-",
      ""
    )}</i>${p.name}</span>`;
    layer.appendChild(div);
    return {
      part: p,
      el: div,
      lead: div.querySelector(".lead"),
      tag: div.querySelector(".tag"),
      anchorEl: div.querySelector(".anchor"),
      baseText: `<i class="code">${p.code.replace("SYS-", "")}</i>${p.name}`,
      group: GROUP_OF[p.id] || null,
    };
  });

  const _v = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _proj = new THREE.Vector3();

  function project(x, y, z, w, h) {
    _proj.set(x, y, z).project(camera);
    if (_proj.z > 1 || _proj.z < -1) return null;
    return { x: (_proj.x * 0.5 + 0.5) * w, y: (-_proj.y * 0.5 + 0.5) * h };
  }

  function update() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const showAll = state.opts.labels && state.explode > 0.28;
    const cx = w * 0.5;
    const cy = h * 0.5;

    const plRect = el.panelLeft.getBoundingClientRect();
    const prRect = el.panelRight.getBoundingClientRect();
    const safeLeft = plRect.right + 14;
    const safeRight =
      prRect.width > 0 && !el.panelRight.classList.contains("collapsed") ? prRect.left - 14 : w - 24;
    const safeTop = 78;
    const safeBottom = h - 92;

    // ---- 1. 计算每个标签的锚点与目标落点 ----
    const cands = [];
    for (const it of items) {
      const p = it.part;
      let visible = showAll;
      if (state.hovered === p.id || state.inspecting === p.id) visible = true;
      if (state.solo && state.solo !== p.id) visible = false;
      if (!visible) {
        it.el.classList.remove("on");
        it.visible = false;
        continue;
      }

      _c.copy(p.bboxCenter);
      p.group.localToWorld(_c);
      const pc = project(_c.x, _c.y, _c.z, w, h);
      if (!pc) {
        it.el.classList.remove("on");
        it.visible = false;
        continue;
      }

      let dx = pc.x - cx;
      let dy = pc.y - cy;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;

      let best = null;
      let bestScore = -Infinity;
      for (const corner of p.bboxCorners) {
        _v.copy(corner);
        p.group.localToWorld(_v);
        const q = project(_v.x, _v.y, _v.z, w, h);
        if (!q) continue;
        const score = (q.x - pc.x) * dx + (q.y - pc.y) * dy;
        if (score > bestScore) {
          bestScore = score;
          best = q;
        }
      }
      const anchor = best || pc;
      anchor.x = clamp(anchor.x, 26, w - 26);
      anchor.y = clamp(anchor.y, 62, h - 62);

      const dist = camera.position.distanceTo(_c);
      const reach = clamp(64 + 460 / Math.max(dist, 1), 52, 132);
      cands.push({
        it,
        anchor,
        rawX: anchor.x + dx * reach,
        rawY: anchor.y + dy * reach,
        dist,
      });
    }

    // ---- 2. 同组聚簇：先算出被合并掉的成员，再统一隐藏 ----
    const hiddenByGroup = new Set();
    const clusterTags = [];
    {
      const groups = new Map();
      for (const c of cands) {
        if (!c.it.group) continue;
        if (!groups.has(c.it.group)) groups.set(c.it.group, []);
        groups.get(c.it.group).push(c);
      }
      for (const [gname, list] of groups) {
        if (list.length < 3) continue;
        // 只有真的挤在一起才合并
        let spread = 0;
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++)
            spread = Math.max(spread, Math.hypot(list[i].rawX - list[j].rawX, list[i].rawY - list[j].rawY));
        if (spread > 200) continue;

        const ax = list.reduce((s, c) => s + c.rawX, 0) / list.length;
        const ay = list.reduce((s, c) => s + c.rawY, 0) / list.length;
        const anchor = {
          x: list.reduce((s, c) => s + c.anchor.x, 0) / list.length,
          y: list.reduce((s, c) => s + c.anchor.y, 0) / list.length,
        };
        const host = list[0].it;
        host.tag.innerHTML = GROUP_NAME[gname] || `${list.length} 件`;
        clusterTags.push({ host, anchor, tx: ax, ty: ay });
        for (let i = 1; i < list.length; i++) hiddenByGroup.add(list[i].it);
      }
    }
    for (const it of hiddenByGroup) {
      it.el.classList.remove("on");
      it.visible = false;
    }

    // ---- 3. 落点裁剪 + 防重叠 ----
    const placed = [];
    const draw = (host, anchor, tx, ty) => {
      const ddx = tx - anchor.x;
      const ddy = ty - anchor.y;
      const len = Math.hypot(ddx, ddy);
      if (len < 22) {
        host.el.classList.remove("on");
        host.visible = false;
        return;
      }
      const ang = (Math.atan2(ddy, ddx) * 180) / Math.PI;
      host.el.style.left = anchor.x + "px";
      host.el.style.top = anchor.y + "px";
      host.el.style.transform = "none";
      host.lead.style.width = len + "px";
      host.lead.style.transform = `rotate(${ang}deg)`;
      host.tag.style.transform = `translate(${ddx >= 0 ? len + 2 : len - 2}px, 0) translate(${
        ddx >= 0 ? "0" : "-100%"
      }, -50%)`;
      host.el.classList.add("on");
      host.visible = true;
    };

    for (const ct of clusterTags) {
      const TAGW = 200;
      const minX = ct.tx < ct.anchor.x ? safeLeft + TAGW : safeLeft;
      const tx = clamp(ct.tx, minX, Math.max(minX + 40, safeRight));
      const ty = clamp(ct.ty, safeTop, safeBottom);
      placed.push({ x: tx, y: ty });
      draw(ct.host, ct.anchor, tx, ty);
    }

    for (const c of cands) {
      if (hiddenByGroup.has(c.it)) continue;
      const TAGW = 200;
      const goingLeft = c.rawX < c.anchor.x;
      const minX = goingLeft ? safeLeft + TAGW : safeLeft;
      let tx = clamp(c.rawX, minX, Math.max(minX + 40, safeRight));
      let ty = clamp(c.rawY, safeTop, safeBottom);

      for (let pass = 0; pass < 8; pass++) {
        let hit = false;
        for (const q of placed) {
          if (Math.abs(q.x - tx) < 175 && Math.abs(q.y - ty) < 24) {
            ty = q.y + 25;
            hit = true;
            break;
          }
        }
        if (!hit) break;
        ty = clamp(ty, safeTop, safeBottom);
      }
      placed.push({ x: tx, y: ty });
      draw(c.it, c.anchor, tx, ty);
    }

    // 恢复被合并/隐藏的标签文案（组标签本身要保留合并后的文字）
    const hostSet = new Set(clusterTags.map((c) => c.host));
    for (const it of items) {
      if (!hostSet.has(it) && it.tag.innerHTML !== it.baseText) it.tag.innerHTML = it.baseText;
    }
  }

  return { update, items };
}
