/* ============================================================
   ship.js — ARGUS-IX 巡洋舰程序化建模
   所有几何均为代码生成：无外部模型文件
   ============================================================ */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32, TAU, lerp } from "./util.js";
import { hullTextures, glowSprite, softCircle, decalTexture } from "./textures.js";

export const SHIP = {
  name: "ARGUS-IX",
  className: "重型深空战术巡洋舰",
  length: 19.0,
};

/* ------------------------------------------------------------
   材质工厂：每个部件独立一套，便于单独高亮
   ------------------------------------------------------------ */
export function createMaterialSet(accentColor = 0xffa63c) {
  const tex = hullTextures();
  const hull = new THREE.MeshStandardMaterial({
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    color: 0x8d98a6,
    metalness: 0.55,
    roughness: 0.62,
    envMapIntensity: 0.8,
  });

  const plate = new THREE.MeshStandardMaterial({
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    color: 0x99a5b3,
    metalness: 0.72,
    roughness: 0.44,
    envMapIntensity: 0.85,
  });

  const dark = new THREE.MeshStandardMaterial({
    color: 0x252c36,
    metalness: 0.82,
    roughness: 0.38,
    envMapIntensity: 1.0,
  });

  const carbon = new THREE.MeshStandardMaterial({
    color: 0x14181e,
    metalness: 0.55,
    roughness: 0.7,
    envMapIntensity: 0.7,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: 0x2a1c0d,
    emissive: accentColor,
    emissiveIntensity: 1.5,
    metalness: 0.4,
    roughness: 0.45,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1420,
    metalness: 0.2,
    roughness: 0.06,
    transmission: 0.6,
    thickness: 0.6,
    ior: 1.5,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 2.2,
    emissive: 0x0d3346,
    emissiveIntensity: 0.25,
  });

  const glowCyan = new THREE.MeshStandardMaterial({
    color: 0x06202b,
    emissive: 0x36d8ff,
    emissiveIntensity: 1.3,
    metalness: 0.3,
    roughness: 0.4,
  });

  return { hull, plate, dark, carbon, accent, glass, glowCyan };
}

/* ------------------------------------------------------------
   几何工具
   ------------------------------------------------------------ */
/** 圆角矩形截面采样点（逆时针）*/
function roundedRectSamples(halfW, topY, botY, r, perCorner = 3) {
  const cr = Math.min(r, halfW * 0.92, Math.max(topY, botY) * 0.92);
  const pts = [];
  const corners = [
    { cx: halfW - cr, cy: topY - cr, a0: 0, a1: Math.PI / 2 },
    { cx: -halfW + cr, cy: topY - cr, a0: Math.PI / 2, a1: Math.PI },
    { cx: -halfW + cr, cy: -botY + cr, a0: Math.PI, a1: (Math.PI * 3) / 2 },
    { cx: halfW - cr, cy: -botY + cr, a0: (Math.PI * 3) / 2, a1: TAU },
  ];
  for (const c of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = c.a0 + ((c.a1 - c.a0) * i) / perCorner;
      pts.push([c.cx + Math.cos(a) * cr, c.cy + Math.sin(a) * cr]);
    }
  }
  return pts;
}

/**
 * 沿 Z 轴放样。sections: [{z, w, top, bot, r, yOff}]
 */
function loftHull(sections, perCorner = 4, capFront = true, capBack = true) {
  const rings = sections.map((s) =>
    roundedRectSamples(s.w, s.top, s.bot, s.r, perCorner).map(([x, y]) => ({
      x: x + (s.xOff || 0),
      y: y + (s.yOff || 0),
    }))
  );
  const N = rings[0].length;
  const zs = sections.map((s) => s.z);
  const pos = [];
  const uv = [];
  const idx = [];

  // 以世界尺度生成 UV，保证贴图密度一致
  const TEX = 0.34;
  const ringArc = rings.map((ring) => {
    const acc = [0];
    for (let j = 1; j <= N; j++) {
      const a = ring[j - 1];
      const b = ring[j % N];
      acc.push(acc[j - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return acc;
  });

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const v0 = zs[i] * TEX;
    const v1 = zs[i + 1] * TEX;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const base = pos.length / 3;
      pos.push(a[j].x, a[j].y, zs[i]);
      pos.push(a[j2].x, a[j2].y, zs[i]);
      pos.push(b[j].x, b[j].y, zs[i + 1]);
      pos.push(b[j2].x, b[j2].y, zs[i + 1]);
      const u0 = ringArc[i][j] * TEX;
      const u1 = ringArc[i][j + 1] * TEX;
      uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const capAt = (ringIndex, z, flip) => {
    const ring = rings[ringIndex];
    const cx = ring.reduce((s, p) => s + p.x, 0) / N;
    const cy = ring.reduce((s, p) => s + p.y, 0) / N;
    const centerIndex = pos.length / 3;
    pos.push(cx, cy, z);
    uv.push(cx * TEX, cy * TEX);
    const start = pos.length / 3;
    for (let j = 0; j < N; j++) {
      pos.push(ring[j].x, ring[j].y, z);
      uv.push(ring[j].x * TEX, ring[j].y * TEX);
    }
    for (let j = 0; j < N; j++) {
      const a = start + j;
      const b = start + ((j + 1) % N);
      if (flip) idx.push(centerIndex, b, a);
      else idx.push(centerIndex, a, b);
    }
  };
  if (capFront) capAt(rings.length - 1, zs[zs.length - 1], true);
  if (capBack) capAt(0, zs[0], false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** XZ 平面形状挤出（厚度沿 Y），保留平面坐标 */
function extrudePlanform(points, thickness, bevel = 0.06) {  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, (thickness + bevel) * 0.5, 0);

  // 平面 UV（世界尺度），避免大面上出现细碎噪点
  const p = geo.attributes.position;
  const uvArr = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uvArr[i * 2] = p.getX(i) * 0.34;
    uvArr[i * 2 + 1] = -p.getZ(i) * 0.34;
  }
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
  geo.computeVertexNormals();
  return geo;
}

/** 翼面：沿展向放样（有厚度渐变与上反角），比平面挤出真实得多 */
function loftSpan(side, sections, perCorner = 3) {
  const secs = sections.map((s) => ({
    z: s.x,
    w: s.chord * 0.5,
    top: s.thick * 0.5,
    bot: s.thick * 0.5,
    r: Math.min(s.thick * 0.5, s.chord * 0.16),
    yOff: s.y,
    xOff: -s.zc * side,
  }));
  const g = loftHull(secs, perCorner, true, true);
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return g;
}

/** 批量合并工具 */
class Batch {
  constructor() {
    this.buckets = new Map();
  }
  add(key, geo, matrix) {
    let g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.clearGroups();
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(g);
  }
  flush(group, materials, partId) {
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) {
        console.warn("[batch] merge failed for", key);
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = partId;
      group.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.buckets.clear();
  }
}

const M = {
  trs(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    return new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
  },
};

function box(batch, key, w, h, d, p, r = 0, rot = [0, 0, 0]) {
  const geo =
    r > 0
      ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45))
      : new THREE.BoxGeometry(w, h, d);
  batch.add(key, geo, M.trs(p, rot));
}

function greeble(batch, key, opts) {
  const {
    count = 40,
    seed = 1,
    area = [-1, 1, -1, 1],
    y = 0,
    size = [0.1, 0.05, 0.1],
    spread = 0.5,
    axis = "y",
    side = 1,
  } = opts;
  const rnd = mulberry32(seed);
  const [x0, x1, z0, z1] = area;
  for (let i = 0; i < count; i++) {
    const w = size[0] * (0.4 + rnd() * spread * 2);
    const h = size[1] * (0.4 + rnd() * spread * 2);
    const d = size[2] * (0.4 + rnd() * spread * 2);
    const a = lerp(x0, x1, rnd());
    const c = lerp(z0, z1, rnd());
    if (axis === "y") {
      box(batch, key, w, h, d, [a, y + side * (h * 0.5), c], Math.min(w, h, d) * 0.18);
    } else if (axis === "x") {
      box(batch, key, h, w, d, [y + side * (h * 0.5), c, a], Math.min(w, h, d) * 0.18);
    } else {
      box(batch, key, w, h, d, [a, c, y + side * (h * 0.5)], Math.min(w, h, d) * 0.18);
    }
  }
}

function strip(batch, key, w, h, d, p, rot = [0, 0, 0]) {
  box(batch, key, w, h, d, p, Math.min(w, h, d) * 0.3, rot);
}

/* ------------------------------------------------------------
   舰体截面表
   ------------------------------------------------------------ */
const HULL = [
  { z: 9.8, w: 0.24, top: 0.2, bot: 0.16, r: 0.06 },
  { z: 9.0, w: 0.52, top: 0.4, bot: 0.32, r: 0.12 },
  { z: 8.0, w: 0.8, top: 0.62, bot: 0.5, r: 0.2 },
  { z: 6.8, w: 1.06, top: 0.8, bot: 0.64, r: 0.27 },
  { z: 5.4, w: 1.28, top: 0.96, bot: 0.76, r: 0.33 },
  { z: 3.8, w: 1.42, top: 1.06, bot: 0.84, r: 0.38 },
  { z: 2.0, w: 1.5, top: 1.12, bot: 0.9, r: 0.42 },
  { z: 0.0, w: 1.52, top: 1.14, bot: 0.92, r: 0.43 },
  { z: -2.2, w: 1.46, top: 1.1, bot: 0.88, r: 0.4 },
  { z: -4.2, w: 1.32, top: 1.0, bot: 0.8, r: 0.34 },
  { z: -5.8, w: 1.16, top: 0.88, bot: 0.72, r: 0.29 },
  { z: -7.0, w: 1.04, top: 0.8, bot: 0.66, r: 0.25 },
];

/* ------------------------------------------------------------
   1. 舰首穿甲装甲段
   ------------------------------------------------------------ */
function buildNose() {
  const g = new THREE.Group();
  const b = new Batch();
  const sections = HULL.slice(0, 5); // z >= 5.4
  b.add("hull", loftHull(sections, 4, true, true));

  // 背部棱线
  box(b, "plate", 0.5, 0.12, 2.8, [0, 0.9, 6.6], 0.04, [0.14, 0, 0]);
  box(b, "plate", 0.3, 0.09, 1.6, [0, 0.62, 8.4], 0.03, [0.24, 0, 0]);

  // 首部撞角（与舰体融合）
  const spike = new THREE.ConeGeometry(0.13, 1.1, 6);
  spike.rotateX(Math.PI / 2);
  b.add("plate", spike, M.trs([0, 0.1, 9.95]));

  // 首部识别灯
  strip(b, "accent", 0.55, 0.04, 0.07, [0, 0.4, 9.7]);
  strip(b, "glowCyan", 0.3, 0.03, 0.05, [0, 0.6, 9.55]);

  // 侧舷姿态推进器组
  for (const s of [-1, 1]) {
    box(b, "dark", 0.18, 0.3, 0.62, [s * 0.98, 0.02, 6.5], 0.05);
    box(b, "carbon", 0.1, 0.16, 0.24, [s * 1.07, 0.02, 6.5], 0.02);
    strip(b, "glowCyan", 0.03, 0.05, 0.42, [s * 1.06, 0.02, 6.5]);
  }

  // 装甲分缝（贴合截面的横向条）
  for (let i = 0; i < 3; i++) {
    const z = 6.0 + i * 0.9;
    const w = 1.5 - i * 0.3;
    box(b, "carbon", w * 1.3, 0.02, 0.03, [0, 0.6 - i * 0.07, z], 0);
  }

  greeble(b, "dark", {
    count: 18,
    seed: 12,
    area: [-0.6, 0.6, 5.6, 8.4],
    y: 0.74,
    size: [0.13, 0.045, 0.1],
    spread: 0.6,
  });

  b.flush(g, createMaterialSet(), "nose");
  return g;
}

/* ------------------------------------------------------------
   2. 指挥舰桥
   ------------------------------------------------------------ */
function buildBridge() {
  const g = new THREE.Group();
  const b = new Batch();

  // 底座（坐在背脊甲板上）
  box(b, "dark", 1.0, 0.26, 2.2, [0, 1.3, 3.2], 0.07);
  // 主体
  box(b, "plate", 0.86, 0.4, 1.75, [0, 1.56, 3.2], 0.09, [-0.05, 0, 0]);
  // 顶盖
  box(b, "hull", 0.68, 0.12, 1.15, [0, 1.82, 3.22], 0.04);
  // 前部斜切装甲
  box(b, "plate", 0.8, 0.26, 0.5, [0, 1.74, 4.0], 0.05, [0.42, 0, 0]);

  // 环幕舷窗
  const glassGeo = new THREE.CylinderGeometry(0.42, 0.44, 0.3, 16, 1, true, -1.2, 2.4);
  glassGeo.rotateX(Math.PI / 2);
  b.add("glass", glassGeo, M.trs([0, 1.6, 4.04]));

  // 舷窗分隔框
  for (let i = 0; i < 6; i++) {
    const a = -0.98 + i * 0.39;
    box(b, "dark", 0.03, 0.28, 0.1, [Math.sin(a) * 0.44, 1.6, 4.06 - Math.cos(a) * 0.02], 0, [0, a, 0]);
  }

  // 舰桥侧翼传感板
  for (const s of [-1, 1]) {
    box(b, "dark", 0.26, 0.1, 0.8, [s * 0.56, 1.54, 2.85], 0.03);
    box(b, "carbon", 0.16, 0.06, 0.5, [s * 0.6, 1.62, 2.8], 0.02);
  }

  // 舰桥灯
  strip(b, "accent", 0.44, 0.04, 0.04, [0, 1.75, 4.22]);
  strip(b, "glowCyan", 0.14, 0.025, 0.4, [0, 1.18, 2.4]);

  greeble(b, "dark", { count: 10, seed: 3, area: [-0.32, 0.32, 2.5, 3.7], y: 1.37, size: [0.1, 0.035, 0.09], spread: 0.5 });

  b.flush(g, createMaterialSet(0xffc266), "bridge");
  return g;
}

/* ------------------------------------------------------------
   3. 主装甲舱段
   ------------------------------------------------------------ */
function buildHull() {
  const g = new THREE.Group();
  const b = new Batch();
  const sections = HULL.slice(4); // 5.4 .. -7.0
  b.add("hull", loftHull(sections, 5, true, true));

  for (const s of [-1, 1]) {
    // 肩部装甲带
    box(b, "plate", 0.3, 0.36, 7.2, [s * 0.92, 0.56, 0.6], 0.07, [0, 0, s * 0.1]);
    // 中段侧板
    box(b, "plate", 0.2, 0.26, 5.0, [s * 1.12, 0.1, 0.4], 0.05, [0, 0, s * 0.04]);
    // 侧面散热百叶
    for (let i = 0; i < 6; i++) {
      box(b, "carbon", 0.025, 0.22, 0.44, [s * 1.2, 0.06, -1.6 + i * 0.5], 0, [0, 0, s * 0.05]);
    }
    // 侧舷灯带
    strip(b, "accent", 0.014, 0.032, 3.0, [s * 1.21, 0.34, 0.8]);
    // 侧面设备舱
    for (let i = 0; i < 4; i++) {
      box(b, "dark", 0.1, 0.17, 0.36, [s * 1.17, -0.14, -2.4 + i * 1.15], 0.03);
    }
  }

  // 背部甲板（与脊背件衔接）
  box(b, "plate", 0.96, 0.08, 6.6, [0, 1.16, 0.6], 0.03);
  // 腹部装甲
  box(b, "plate", 1.02, 0.1, 7.0, [0, -0.98, 0.5], 0.04);
  box(b, "dark", 0.46, 0.12, 3.6, [0, -1.04, 0.3], 0.04);

  // 腹部舱门
  box(b, "carbon", 0.82, 0.03, 1.7, [0, -1.04, -0.8], 0);
  strip(b, "glowCyan", 0.78, 0.015, 0.04, [0, -1.025, 0.05]);
  strip(b, "glowCyan", 0.78, 0.015, 0.04, [0, -1.025, -1.65]);

  // 环形结构线
  for (let i = 0; i < 3; i++) {
    const z = 3.6 - i * 2.4;
    box(b, "carbon", 3.0, 0.02, 0.04, [0, 0, z], 0);
  }

  // 甲板设备
  greeble(b, "dark", { count: 34, seed: 21, area: [-0.66, 0.66, -2.4, 3.9], y: 1.23, size: [0.15, 0.05, 0.12], spread: 0.7 });
  greeble(b, "carbon", { count: 22, seed: 33, area: [-0.55, 0.55, -2.8, 3.2], y: 1.18, size: [0.1, 0.025, 0.16], spread: 0.6 });
  // 侧面细节
  greeble(b, "dark", { count: 18, seed: 44, axis: "x", side: 1, area: [-2.4, 3.4, -0.6, 0.4], y: 1.2, size: [0.09, 0.12, 0.1], spread: 0.5 });
  greeble(b, "dark", { count: 18, seed: 45, axis: "x", side: -1, area: [-2.4, 3.4, -0.6, 0.4], y: 1.2, size: [0.09, 0.12, 0.1], spread: 0.5 });

  b.flush(g, createMaterialSet(), "hull");
  return g;
}

/* ------------------------------------------------------------
   4. 龙骨脊背 + 散热鳍
   ------------------------------------------------------------ */
function buildSpine() {
  const g = new THREE.Group();
  const b = new Batch();

  // 背脊主体（放样）
  const deck = [
    { z: 4.6, w: 0.28, top: 0.06, bot: 0.0 },
    { z: 3.0, w: 0.6, top: 0.2, bot: 0.0 },
    { z: 1.2, w: 0.8, top: 0.3, bot: 0.0 },
    { z: -1.0, w: 0.84, top: 0.32, bot: 0.0 },
    { z: -3.2, w: 0.76, top: 0.26, bot: 0.0 },
    { z: -5.2, w: 0.52, top: 0.14, bot: 0.0 },
  ].map((s) => ({ ...s, r: 0.12, yOff: 1.02 }));
  b.add("hull", loftHull(deck, 3, true, true));

  // 脊背上的设备舱
  box(b, "hull", 0.44, 0.14, 2.6, [0, 1.42, 0.4], 0.03);
  for (let i = 0; i < 4; i++) {
    box(b, "carbon", 0.26, 0.02, 0.1, [0, 1.5, -0.6 + i * 0.55], 0);
  }
  strip(b, "glowCyan", 0.02, 0.012, 0.9, [0, 1.5, 0.9]);

  // 散热鳍：每侧 3 片，规整排列在后段
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -1.6 - i * 1.3;
      const h = 0.52 - i * 0.05;
      const len = 1.2;
      const fin = new THREE.BoxGeometry(0.04, h, len);
      fin.translate(0, h * 0.5, 0);
      b.add("dark", fin, M.trs([s * 0.42, 1.3, z], [0.12, 0, s * 0.38]));
      // 鳍片上的辐射条（每片一条）
      strip(b, "accent", 0.012, 0.012, len * 0.62, [s * 0.47, 1.62, z], [0.12, 0, s * 0.38]);
      // 鳍根整流
      box(b, "plate", 0.12, 0.1, len * 0.9, [s * 0.4, 1.3, z], 0.03, [0, 0, s * 0.3]);
    }
  }

  b.flush(g, createMaterialSet(0xff9a2e), "spine");
  return g;
}

/* ------------------------------------------------------------
   5/6. 侧翼
   ------------------------------------------------------------ */
function buildWing(side) {
  const g = new THREE.Group();
  const b = new Batch();
  const s = side;

  // 沿展向放样的翼面：翼根厚、翼尖薄，带后掠与下反
  const wingSections = [
    { x: 0.72, chord: 6.6, thick: 0.46, zc: -0.55, y: 0.02 },
    { x: 1.35, chord: 5.85, thick: 0.4, zc: -0.68, y: -0.02 },
    { x: 2.1, chord: 4.85, thick: 0.32, zc: -0.88, y: -0.07 },
    { x: 2.9, chord: 4.0, thick: 0.25, zc: -1.1, y: -0.12 },
    { x: 3.7, chord: 3.2, thick: 0.19, zc: -1.35, y: -0.17 },
    { x: 4.4, chord: 2.45, thick: 0.14, zc: -1.6, y: -0.21 },
    { x: 4.95, chord: 1.6, thick: 0.1, zc: -1.85, y: -0.25 },
  ];
  b.add("hull", loftSpan(s, wingSections, 3));

  // 前缘襟翼（一条沿前缘的窄条，带缝）
  const leSlope = -3.3 / 4.23; // 前缘后掠斜率
  for (let i = 0; i < 3; i++) {
    const t0 = 1.0 + i * 1.25;
    const segLen = 1.25;
    const zAt = 2.75 - (t0 - 0.72) * 0.9;
    const ang = Math.atan2(-0.9, 1);
    box(b, "plate", segLen * 1.02, 0.07, 0.28, [s * (t0 + segLen * 0.5), 0.19 - i * 0.03, zAt - 0.1], 0.02, [0, s * ang, s * -0.02]);
    strip(b, "accent", segLen * 0.9, 0.012, 0.012, [s * (t0 + segLen * 0.5), 0.235 - i * 0.03, zAt - 0.22], [0, s * ang, 0]);
  }
  void leSlope;

  // 前缘襟翼 / 鸭翼
  const canardPlan = [
    [s * 0.85, 6.35],
    [s * 2.05, 5.55],
    [s * 2.15, 4.85],
    [s * 0.85, 5.15],
  ];
  if (s < 0) canardPlan.reverse();
  const canard = extrudePlanform(canardPlan, 0.1, 0.02);
  canard.rotateZ(-s * 0.02);
  b.add("hull", canard, M.trs([0, 0.18, 0]));
  box(b, "plate", 0.06, 0.05, 1.5, [s * 1.5, 0.26, 5.6], 0.015, [0, s * -0.62, 0]);

  // 翼面结构肋（贴合放样后的厚度）
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const bx = s * (1.2 + t * 2.6);
    const bz = 1.1 - t * 2.1;
    const by = 0.2 - t * 0.16;
    const w = 0.34 - t * 0.09;
    box(b, "plate", w, 0.055, 2.2 - t * 0.8, [bx, by, bz], 0.015, [0, s * 0.5, s * 0.05]);
  }

  // 翼梢小翼 + 航行灯
  box(b, "dark", 0.07, 0.5, 1.05, [s * 4.86, 0.02, -2.3], 0.02, [0.1, 0, s * -0.14]);
  strip(b, "accent", 0.028, 0.14, 0.46, [s * 4.9, 0.16, -2.32]);
  strip(b, "glowCyan", 0.028, 0.04, 0.28, [s * 4.88, -0.16, -1.7], [0, 0, s * -0.1]);

  // 翼下挂架 + 导弹（挂在放样翼面的下表面）
  for (let i = 0; i < 2; i++) {
    const x = s * (1.9 + i * 1.25);
    const z = 0.1 - i * 0.5;
    const yy = -0.16 - i * 0.05;
    box(b, "plate", 0.13, 0.2, 0.7, [x, yy + 0.08, z], 0.03);
    const missile = new THREE.CylinderGeometry(0.075, 0.075, 1.3, 10);
    missile.rotateX(Math.PI / 2);
    b.add("carbon", missile, M.trs([x, yy, z - 0.1]));
    const mNose = new THREE.ConeGeometry(0.075, 0.28, 10);
    mNose.rotateX(Math.PI / 2);
    b.add("plate", mNose, M.trs([x, yy, z + 0.69]));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      box(b, "dark", 0.018, 0.09, 0.18, [x + Math.cos(a) * 0.085, yy + Math.sin(a) * 0.085, z - 0.68], 0, [0, 0, a]);
    }
  }

  // 翼根整流（把翼面与船体过渡掉）
  box(b, "plate", 0.34, 0.26, 2.6, [s * 0.98, 0.04, -0.5], 0.07, [0, 0, s * 0.1]);

  // 翼面设备舱
  box(b, "dark", 0.28, 0.08, 0.9, [s * 2.05, 0.12, -2.0], 0.02, [0, 0, s * 0.06]);
  strip(b, "glowCyan", 0.2, 0.015, 0.03, [s * 2.05, 0.17, -2.38]);

  greeble(b, "dark", {
    count: 18,
    seed: 55 + (s > 0 ? 1 : 0),
    area: [s > 0 ? 1.3 : -4.3, s > 0 ? 4.3 : -1.3, -2.3, 1.2],
    y: 0.16,
    size: [0.11, 0.028, 0.08],
    spread: 0.5,
  });

  b.flush(g, createMaterialSet(), s > 0 ? "wingL" : "wingR");
  return g;
}

/* ------------------------------------------------------------
   7/8/9. 引擎
   ------------------------------------------------------------ */
function buildEngine(kind, side = 0) {
  const g = new THREE.Group();
  const b = new Batch();
  const nozzleZ = kind === "center" ? -9.0 : -8.4;
  const radius = kind === "center" ? 0.58 : 0.44;
  const bodyLen = kind === "center" ? 3.4 : 2.9;
  const bodyZ = nozzleZ + bodyLen * 0.5 + 0.1;
  const x = side * (kind === "center" ? 0 : 1.78);
  const y = kind === "center" ? 0.0 : -0.08;

  // 舱体
  const body = new THREE.CylinderGeometry(radius, radius * 1.08, bodyLen, 20, 1, false);
  body.rotateX(Math.PI / 2);
  b.add("hull", body, M.trs([x, y, bodyZ]));

  // 环箍
  for (const dz of [bodyLen * 0.42, 0, -bodyLen * 0.42]) {
    const ring = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.1, 20, 1, true);
    ring.rotateX(Math.PI / 2);
    b.add("dark", ring, M.trs([x, y, bodyZ + dz]));
  }

  // 顶部管线
  for (let i = 0; i < 5; i++) {
    const a = -1.2 + i * 0.6;
    const px = x + Math.cos(a) * radius * 0.99;
    const py = y + Math.sin(a) * radius * 0.99;
    const pipe = new THREE.CylinderGeometry(0.038, 0.038, bodyLen * 0.82, 6);
    pipe.rotateX(Math.PI / 2);
    b.add("carbon", pipe, M.trs([px, py, bodyZ]));
  }

  // 拉伐尔喷管
  const nozzleProfile = [
    [radius * 0.9, 0],
    [radius * 0.78, -0.18],
    [radius * 0.6, -0.32],
    [radius * 0.64, -0.5],
    [radius * 0.9, -0.68],
    [radius * 1.0, -0.8],
  ].map(([r, yy]) => new THREE.Vector2(r, yy));
  const nozzle = new THREE.LatheGeometry(nozzleProfile, 24);
  nozzle.rotateX(-Math.PI / 2);
  b.add("dark", nozzle, M.trs([x, y, nozzleZ]));

  // 喷口内壁（发光）
  const inner = new THREE.CylinderGeometry(radius * 0.6, radius * 0.64, 0.85, 20, 1, true);
  inner.rotateX(Math.PI / 2);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x140a06,
    emissive: 0xff6a1e,
    emissiveIntensity: 1.2,
    metalness: 0.7,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const innerMesh = new THREE.Mesh(inner, innerMat);
  innerMesh.position.set(x, y, nozzleZ - 0.4);
  g.add(innerMesh);

  // 喷口外圈散热片
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    box(b, "dark", 0.045, 0.1, 0.55, [x + Math.cos(a) * radius * 0.99, y + Math.sin(a) * radius * 0.99, nozzleZ + 0.06], 0.01, [a, 0, 0]);
  }

  if (kind !== "center") {
    // 引擎挂架（连回舰体）
    const pylon = new THREE.BoxGeometry(0.9, 0.16, 1.5);
    b.add("plate", pylon, M.trs([x - side * 0.72, y + 0.06, bodyZ + 0.35]));
    box(b, "dark", 0.3, 0.22, 0.9, [x - side * 0.2, y - 0.02, bodyZ + 0.6], 0.05);
    // 散热格栅
    for (let i = 0; i < 3; i++) {
      box(b, "carbon", 0.04, 0.26, 0.6, [x + side * radius * 1.01, y + 0.1, bodyZ + 0.5 - i * 0.7], 0, [0, 0, 0.1]);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      box(b, "carbon", 0.06, 0.26, 0.8, [x + Math.cos(a) * radius * 1.01, y + Math.sin(a) * radius * 1.01, bodyZ], 0, [a, 0, 0]);
    }
  }

  strip(b, "glowCyan", 0.035, 0.035, 0.45, [x + radius * 0.85 * side || x, y + 0.38, bodyZ + 0.6]);

  const id = kind === "center" ? "engineC" : side > 0 ? "engineL" : "engineR";
  const mats = createMaterialSet(0xff7a2a);
  mats.accent.emissiveIntensity = 2.4;
  b.flush(g, mats, id);

  g.userData.nozzle = {
    pos: new THREE.Vector3(x, y, nozzleZ - 0.66),
    radius: radius * 0.84,
    id,
  };
  g.userData.innerMat = innerMat;
  return g;
}

/* ------------------------------------------------------------
   10. 双联炮塔
   ------------------------------------------------------------ */
function buildTurrets() {
  const g = new THREE.Group();
  const b = new Batch();
  const positions = [
    { p: [0, 1.7, 1.9], s: 1 }, // 背部（坐在甲板上）
    { p: [0, -1.1, 1.2], s: -1 }, // 腹部
  ];

  for (const { p, s } of positions) {
    const [x, y, z] = p;
    // 炮座
    const base = new THREE.CylinderGeometry(0.32, 0.36, 0.12, 16);
    b.add("dark", base, M.trs([x, y + s * 0.02, z]));
    // 转塔
    const turret = new THREE.CylinderGeometry(0.26, 0.3, 0.22, 14);
    b.add("plate", turret, M.trs([x, y + s * 0.15, z]));
    // 双联炮管
    for (const off of [-0.1, 0.1]) {
      const bar = new THREE.CylinderGeometry(0.04, 0.05, 1.35, 8);
      bar.rotateX(Math.PI / 2);
      b.add("dark", bar, M.trs([x + off, y + s * 0.16, z + 0.75]));
      const muzzle = new THREE.CylinderGeometry(0.06, 0.05, 0.14, 8, 1, true);
      muzzle.rotateX(Math.PI / 2);
      b.add("carbon", muzzle, M.trs([x + off, y + s * 0.16, z + 1.4]));
    }
    strip(b, "accent", 0.1, 0.025, 0.03, [x, y + s * 0.26, z + 0.16]);
    strip(b, "glowCyan", 0.16, 0.02, 0.02, [x, y + s * 0.2, z - 0.24]);
  }

  b.flush(g, createMaterialSet(0xff3d3d), "turrets");
  return g;
}

/* ------------------------------------------------------------
   11. 舰首激光炮（下巴炮组）
   ------------------------------------------------------------ */
function buildCannons() {
  const g = new THREE.Group();
  const b = new Batch();
  const mats = createMaterialSet(0x66e0ff);

  // 炮组整流罩（连接舰首下部）
  const chin = [
    { z: 6.2, w: 0.74, top: 0.18, bot: 0.32, r: 0.12 },
    { z: 7.3, w: 0.68, top: 0.16, bot: 0.28, r: 0.1 },
    { z: 8.3, w: 0.54, top: 0.12, bot: 0.22, r: 0.08 },
    { z: 8.9, w: 0.44, top: 0.1, bot: 0.16, r: 0.06 },
  ].map((s) => ({ ...s, yOff: -0.9 }));
  b.add("plate", loftHull(chin, 3, true, true));

  for (const s of [-1, 1]) {
    const x = s * 0.26;
    const y = -0.98;
    // 炮座
    box(b, "dark", 0.3, 0.24, 0.9, [x, y, 8.7], 0.05);
    // 散热环
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12, 1, true);
      ring.rotateX(Math.PI / 2);
      b.add("dark", ring, M.trs([x, y, 9.2 + i * 0.18]));
    }
    // 炮管
    const barrel = new THREE.CylinderGeometry(0.075, 0.09, 1.15, 12);
    barrel.rotateX(Math.PI / 2);
    b.add("carbon", barrel, M.trs([x, y, 9.72]));
    // 聚能口
    const emitter = new THREE.CylinderGeometry(0.085, 0.05, 0.2, 12, 1, true);
    emitter.rotateX(Math.PI / 2);
    b.add("accent", emitter, M.trs([x, y, 10.3]));
    // 能量导管
    strip(b, "glowCyan", 0.022, 0.022, 0.8, [x + s * 0.14, y + 0.1, 9.5]);
  }

  b.flush(g, mats, "cannons");
  g.userData.muzzles = [
    new THREE.Vector3(-0.26, -0.98, 10.42),
    new THREE.Vector3(0.26, -0.98, 10.42),
  ];
  return g;
}

/* ------------------------------------------------------------
   12. 传感器/通讯阵列
   ------------------------------------------------------------ */
function buildSensor() {
  const g = new THREE.Group();
  const b = new Batch();

  // 底部基座（坐在脊背末端）
  box(b, "dark", 0.28, 0.2, 0.28, [0, 1.46, -4.4], 0.04);
  // 桅杆
  const mast = new THREE.CylinderGeometry(0.032, 0.045, 1.35, 8);
  b.add("plate", mast, M.trs([0, 2.2, -4.4]));
  // 碟形天线
  const dish = new THREE.SphereGeometry(0.36, 20, 10, 0, TAU, 0, Math.PI * 0.4);
  dish.rotateX(-0.55);
  b.add("plate", dish, M.trs([0, 2.92, -4.42]));
  const dishRim = new THREE.TorusGeometry(0.345, 0.016, 6, 26);
  dishRim.rotateX(-0.55 + Math.PI / 2);
  b.add("dark", dishRim, M.trs([0, 2.92, -4.42]));
  // 馈源
  const feed = new THREE.CylinderGeometry(0.018, 0.018, 0.44, 6);
  feed.rotateX(-0.55);
  b.add("accent", feed, M.trs([0, 2.96, -4.26]));

  // 鞭状天线
  for (let i = 0; i < 4; i++) {
    const len = 0.42 + (i % 3) * 0.2;
    const ant = new THREE.CylinderGeometry(0.006, 0.012, len, 4);
    b.add("dark", ant, M.trs([-0.15 + i * 0.1, 1.62 + len / 2, -4.15], [0.12, 0, (i - 1.5) * 0.1]));
  }

  strip(b, "glowCyan", 0.045, 0.02, 0.045, [0, 3.2, -4.52]);
  strip(b, "accent", 0.2, 0.025, 0.025, [0, 1.58, -4.24]);

  b.flush(g, createMaterialSet(0x8ef0ff), "sensor");
  return g;
}

/* ------------------------------------------------------------
   13. 侧舷机库
   ------------------------------------------------------------ */
function buildHangar() {
  const g = new THREE.Group();
  const b = new Batch();
  const mats = createMaterialSet(0x36d8ff);

  for (const s of [-1, 1]) {
    // 外框
    box(b, "dark", 0.1, 0.44, 1.9, [s * 1.4, -0.58, -1.4], 0.03);
    // 内舱
    box(b, "carbon", 0.46, 0.34, 1.72, [s * 1.2, -0.58, -1.4], 0.02);
    // 舱门（半开）
    box(b, "plate", 0.32, 0.3, 0.78, [s * 1.26, -0.58, -1.82], 0.02, [0, 0, s * -0.1]);
    box(b, "plate", 0.32, 0.3, 0.78, [s * 1.26, -0.58, -0.98], 0.02, [0, 0, s * 0.1]);
    // 舱内灯
    strip(b, "glowCyan", 0.035, 0.02, 1.3, [s * 1.16, -0.42, -1.4]);
    strip(b, "accent", 0.05, 0.02, 0.8, [s * 1.4, -0.36, -1.4]);
    // 引导标记
    for (let i = 0; i < 4; i++) {
      strip(b, "accent", 0.016, 0.008, 0.1, [s * 1.33, -0.76, -2.0 + i * 0.4]);
    }
  }
  b.flush(g, mats, "hangar");
  return g;
}

/* ------------------------------------------------------------
   内部结构（X 光透视时才显示）
   ------------------------------------------------------------ */
function buildInterior() {
  const g = new THREE.Group();
  g.name = "interior";
  g.visible = false;

  const frame = new THREE.MeshStandardMaterial({
    color: 0x2a333e,
    metalness: 0.85,
    roughness: 0.45,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x1a0a14,
    emissive: 0xff7a2a,
    emissiveIntensity: 1.5,
    metalness: 0.4,
    roughness: 0.35,
  });
  const plasmaMat = new THREE.MeshStandardMaterial({
    color: 0x061820,
    emissive: 0x36d8ff,
    emissiveIntensity: 0.95,
    metalness: 0.3,
    roughness: 0.4,
  });

  // 纵向主梁（两根）
  for (const s of [-1, 1]) {
    const beam = new THREE.BoxGeometry(0.14, 0.16, 12.4);
    const m = new THREE.Mesh(beam, frame);
    m.position.set(s * 0.62, -0.35, 0.2);
    g.add(m);
  }

  // 横向隔框（椭圆柱环）
  for (let i = 0; i < 6; i++) {
    const z = 3.9 - i * 2.05;
    const rw = 1.34 - Math.abs(i - 2.5) * 0.14;
    const ring = new THREE.TorusGeometry(rw, 0.045, 6, 28);
    const m = new THREE.Mesh(ring, frame);
    m.position.set(0, 0.02, z);
    m.scale.set(1, 0.62, 1);
    g.add(m);
  }

  // 中央聚变堆
  const reactor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), coreMat);
  reactor.position.set(0, 0.02, -1.3);
  g.add(reactor);
  const reactShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 1), frame);
  reactShell.position.copy(reactor.position);
  reactShell.material = new THREE.MeshStandardMaterial({
    color: 0x39424e,
    metalness: 0.9,
    roughness: 0.4,
    wireframe: true,
  });
  g.add(reactShell);

  // 堆体环
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(1.12 + i * 0.06, 0.035, 6, 30), frame);
    t.position.copy(reactor.position);
    t.rotation.set(Math.PI / 2, 0, i * 0.7);
    g.add(t);
  }

  // 燃料环舱（中段四组）
  for (let i = 0; i < 4; i++) {
    const z = 2.6 - i * 1.05;
    const tank = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.2, 8, 26), frame);
    tank.position.set(0, 0.0, z);
    tank.rotation.x = Math.PI / 2;
    tank.scale.set(1, 1, 0.62);
    g.add(tank);
  }

  // 等离子导管（沿脊背走向堆体）
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 8.6, 8), plasmaMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(s * 0.42, 0.32, -0.8);
    g.add(tube);
  }

  // 舰首设备舱
  const bay = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 2.6), frame);
  bay.position.set(0, 0.05, 5.4);
  g.add(bay);
  for (let i = 0; i < 3; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.16), plasmaMat);
    rack.position.set(0, 0.05, 5.0 + i * 0.42);
    rack.scale.setScalar(0.86);
    g.add(rack);
  }

  // 尾部动力舱隔板
  const aft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.12), frame);
  aft.position.set(0, 0, -4.6);
  g.add(aft);

  g.traverse((o) => {
    if (o.isMesh) {
      o.userData.partId = "hull";
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  return g;
}

/* ------------------------------------------------------------
   贴花：舷号 / 警示 / 徽标
   ------------------------------------------------------------ */
function buildDecals() {
  const g = new THREE.Group();
  g.name = "decals";

  const mk = (kind, w, h, pos, rot) => {
    const tex = decalTexture(kind);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.55,
      metalness: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      opacity: 0.92,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.userData.partId = "hull";
    g.add(m);
    return m;
  };

  // 左右舷号（朝向 ±X）
  mk("id", 2.5, 1.25, [-1.512, 0.34, 2.0], [0, -Math.PI / 2, 0]);
  mk("id", 2.5, 1.25, [1.512, 0.34, 2.0], [0, Math.PI / 2, 0]);

  // 机翼上表面徽标（朝向 +Y）
  mk("mark", 1.5, 1.5, [-3.0, 0.13, -1.35], [-Math.PI / 2, 0, 0.3]);
  mk("mark", 1.5, 1.5, [3.0, 0.13, -1.35], [-Math.PI / 2, 0, -0.3]);

  // 尾部等离子警示（贴在机库附近）
  mk("warn", 1.3, 0.65, [-1.48, -0.5, -3.1], [0, -Math.PI / 2, 0]);
  mk("warn", 1.3, 0.65, [1.48, -0.5, -3.1], [0, Math.PI / 2, 0]);

  return g;
}

/* ------------------------------------------------------------
   部件表
   ------------------------------------------------------------ */
const PART_DEFS = [
  {
    id: "nose",
    code: "SYS-01",
    name: "舰首穿甲装甲段",
    desc: "钛-陶复合楔形首部，内含主传感器与撞角结构。前倾 12° 的棱线用于偏折正面粒子流。",
    explode: [0, 0.6, 3.4],
    anchor: [0, 0.4, 8.2],
    specs: [
      ["装甲材料", "TiC / 陶瓷复合"],
      ["结构长度", "4.9 m"],
      ["防护等级", "A-Ⅲ"],
      ["校准状态", "已校准"],
    ],
    build: buildNose,
  },
  {
    id: "bridge",
    code: "SYS-02",
    name: "指挥舰桥舱",
    desc: "360° 环幕指挥位，含双冗余导航阵列。五层夹层中子吸收玻璃，可承受 0.4c 微陨石冲击。",
    explode: [0, 2.4, 2.6],
    anchor: [0, 1.66, 4.1],
    specs: [
      ["乘员", "12 人"],
      ["显示系统", "环幕 320°"],
      ["生命维持", "独立双回路"],
      ["状态", "加压 · 在线"],
    ],
    build: buildBridge,
  },
  {
    id: "hull",
    code: "SYS-03",
    name: "主装甲舱段",
    desc: "承力主结构。12 道纵向龙骨与 48 块可更换装甲板，内层为氢硼聚乙烯中子屏蔽层。",
    explode: [0, -1.6, 0],
    anchor: [1.42, 0.5, 1.0],
    specs: [
      ["舱段长度", "9.2 m"],
      ["装甲板数", "48"],
      ["密封舱室", "7"],
      ["结构完整度", "98.4%"],
    ],
    build: buildHull,
  },
  {
    id: "spine",
    code: "SYS-04",
    name: "龙骨脊背 / 散热鳍",
    desc: "主换热回路。六片石墨烯鳍片在战斗中展开，将聚变堆废热以 1400 K 辐射入真空。",
    explode: [0, 3.3, -0.4],
    anchor: [0.5, 1.62, -1.6],
    specs: [
      ["鳍片数量", "6"],
      ["散热功率", "1.2 GW"],
      ["工作温度", "1400 K"],
      ["展开时间", "3.2 s"],
    ],
    build: buildSpine,
  },
  {
    id: "wingL",
    code: "SYS-05",
    name: "左舷稳定翼",
    desc: "后掠 62° 的变几何翼，翼内埋设燃料管路与四组姿态喷口。翼下挂载两枚长矛反舰弹。",
    explode: [4.0, 0.5, -0.3],
    anchor: [-5.4, 0.25, -2.0],
    specs: [
      ["翼展", "6.2 m"],
      ["后掠角", "62°"],
      ["挂点", "2 × 长矛-Ⅳ"],
      ["液压压力", "21 MPa"],
    ],
    build: () => buildWing(-1),
  },
  {
    id: "wingR",
    code: "SYS-06",
    name: "右舷稳定翼",
    desc: "与左舷对称的承力翼面，翼根整流罩内集成电子战天线与诱饵发射器。",
    explode: [-4.0, 0.5, -0.3],
    anchor: [5.4, 0.25, -2.0],
    specs: [
      ["翼展", "6.2 m"],
      ["后掠角", "62°"],
      ["挂点", "2 × 长矛-Ⅳ"],
      ["电子战", "诱饵 ×24"],
    ],
    build: () => buildWing(1),
  },
  {
    id: "engineL",
    code: "SYS-07",
    name: "左舷离子引擎",
    desc: "磁约束离子推进单元。喷口内壁为钨-铼合金，12 秒内可从巡航推力跃迁至加力状态。",
    explode: [3.0, 0.2, -3.6],
    anchor: [2.1, 0.4, -8.6],
    specs: [
      ["推力", "480 kN"],
      ["比冲", "12,400 s"],
      ["喷口温度", "2,100 K"],
      ["点火状态", "稳定燃烧"],
    ],
    build: () => buildEngine("side", -1),
  },
  {
    id: "engineR",
    code: "SYS-08",
    name: "右舷离子引擎",
    desc: "与左舷构成差动推力矢量组，配合 RCS 可实现 0.8 rad/s 的偏航角速度。",
    explode: [-3.0, 0.2, -3.6],
    anchor: [-2.1, 0.4, -8.6],
    specs: [
      ["推力", "480 kN"],
      ["比冲", "12,400 s"],
      ["喷口温度", "2,100 K"],
      ["点火状态", "稳定燃烧"],
    ],
    build: () => buildEngine("side", 1),
  },
  {
    id: "engineC",
    code: "SYS-09",
    name: "中央聚变主引擎",
    desc: "舰体主推进。氘-氦3 聚变室经磁喷嘴直排，尾焰在真空中形成长达 300 m 的等离子羽流。",
    explode: [0, 0.1, -5.2],
    anchor: [0, -0.6, -9.2],
    specs: [
      ["推力", "2.4 MN"],
      ["比冲", "38,000 s"],
      ["聚变功率", "9.6 GW"],
      ["喷口直径", "1.2 m"],
    ],
    build: () => buildEngine("center", 0),
  },
  {
    id: "turrets",
    code: "SYS-10",
    name: "双联速射炮塔组",
    desc: "背腹各一座双联 40 mm 电磁速射炮，射速 3600 发/分，配独立供弹与冷却回路。",
    explode: [0, 3.0, 0.3],
    anchor: [0, 1.95, 1.9],
    specs: [
      ["口径", "2 × 40 mm"],
      ["射速", "3600 rpm"],
      ["弹药基数", "1,800"],
      ["回转速度", "110°/s"],
    ],
    build: buildTurrets,
  },
  {
    id: "cannons",
    code: "SYS-11",
    name: "舰首激光炮",
    desc: "双联自由电子激光器，波长 1.06 μm，连续输出 240 MW。聚能口需在发射前 0.4 s 完成充能。",
    explode: [0.4, 0.5, 4.6],
    anchor: [0.3, -0.75, 10.6],
    specs: [
      ["输出功率", "240 MW"],
      ["波长", "1.06 μm"],
      ["有效射程", "18,000 km"],
      ["充能时间", "0.4 s"],
    ],
    build: buildCannons,
  },
  {
    id: "sensor",
    code: "SYS-12",
    name: "传感 / 通讯阵列",
    desc: "主被动复合探测桅杆。碟形天线负责深空通讯，阵列负责被动电磁侦收，探测半径 0.3 光秒。",
    explode: [0, 4.6, -2.4],
    anchor: [0, 2.86, -4.42],
    specs: [
      ["探测半径", "0.3 光秒"],
      ["天线增益", "48 dB"],
      ["波段", "X / Ka / 光学"],
      ["跟踪目标", "512"],
    ],
    build: buildSensor,
  },
  {
    id: "hangar",
    code: "SYS-13",
    name: "侧舷机库舱",
    desc: "双舷机库，可容纳 2 架截击机或 4 具侦察无人机。双层气密闸，支持带压出动。",
    explode: [2.6, -2.3, -1.0],
    anchor: [-1.4, -0.5, -1.4],
    specs: [
      ["载机", "2 × 截击机"],
      ["舱门", "双层气密闸"],
      ["循环时间", "45 s"],
      ["状态", "待命"],
    ],
    build: buildHangar,
  },
];

/* ------------------------------------------------------------
   装配
   ------------------------------------------------------------ */
export function buildShip() {
  const root = new THREE.Group();
  root.name = "ARGUS-IX";
  const parts = [];
  const pickables = [];

  // 内部结构 + 贴花（不属于可剖析部件）
  const interior = buildInterior();
  root.add(interior);

  PART_DEFS.forEach((def, i) => {
    const group = def.build();
    group.name = def.id;
    group.userData.partId = def.id;
    group.userData.explode = new THREE.Vector3(...def.explode);
    group.userData.basePosition = new THREE.Vector3(0, 0, 0);
    group.userData.anchor = new THREE.Vector3(...def.anchor);
    group.userData.def = def;
    group.userData.index = i;

    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.partId = def.id;
        pickables.push(o);
      }
    });

    root.add(group);
    parts.push({
      id: def.id,
      code: def.code,
      name: def.name,
      desc: def.desc,
      specs: def.specs,
      group,
      anchor: group.userData.anchor,
      explode: group.userData.explode,
      def,
      hl: 0,
    });
  });

  // 贴花挂在船体部件上，跟随主装甲舱段一起移动
  const hullPart = parts.find((p) => p.id === "hull");
  const decals = buildDecals();
  if (hullPart) hullPart.group.add(decals);
  decals.traverse((o) => {
    if (o.isMesh) pickables.push(o);
  });

  parts.forEach((p) => {
    p.materials = [];
    p.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        p.materials.push({
          mat: o.material,
          base: o.material.emissive.clone(),
          baseIntensity: o.material.emissiveIntensity ?? 0,
          baseColor: o.material.color ? o.material.color.clone() : null,
        });
      }
    });
    // 部件本地包围盒（group 尚在原点，坐标即舰体坐标）
    const bb = new THREE.Box3().setFromObject(p.group);
    p.bbox = bb;
    p.bboxCenter = bb.getCenter(new THREE.Vector3());
    p.bboxCorners = [];
    for (const x of [bb.min.x, bb.max.x])
      for (const y of [bb.min.y, bb.max.y])
        for (const z of [bb.min.z, bb.max.z]) p.bboxCorners.push(new THREE.Vector3(x, y, z));
  });

  return { root, parts, pickables, interior, decals };
}

export function shipBounds(root) {
  return new THREE.Box3().setFromObject(root);
}

export { PART_DEFS, glowSprite, softCircle };
