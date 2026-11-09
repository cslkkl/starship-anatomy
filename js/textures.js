/* ============================================================
   textures.js — 全程序化生成贴图（无外部资源依赖）
   船体面板 / 粗糙度 / 法线 / 尾焰 / 光晕 / 星空
   ============================================================ */
import * as THREE from "three";
import { mulberry32, TAU, clamp } from "./util.js";

const cache = new Map();

function canvas2d(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d", { willReadFrequently: true }) };
}

function toTexture(c, { repeat = 1, srgb = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------
   低频值噪声（用于脏迹 / 色差 / 磨损）
   ------------------------------------------------------------ */
function valueNoiseCanvas(size, gridSize, seed, gain = 1) {
  const { c, g } = canvas2d(size);
  const rnd = mulberry32(seed);
  const gs = gridSize;
  const grid = new Float32Array((gs + 1) * (gs + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const img = g.createImageData(size, size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * gs;
      const fy = (y / size) * gs;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const i00 = grid[y0 * (gs + 1) + x0];
      const i10 = grid[y0 * (gs + 1) + x0 + 1];
      const i01 = grid[(y0 + 1) * (gs + 1) + x0];
      const i11 = grid[(y0 + 1) * (gs + 1) + x0 + 1];
      const v = (i00 * (1 - tx) + i10 * tx) * (1 - ty) + (i01 * (1 - tx) + i11 * tx) * ty;
      const o = (y * size + x) * 4;
      const val = clamp(v * gain, 0, 1) * 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = val;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function fbmCanvas(size, seed) {
  const layers = [
    { g: 4, a: 0.5 },
    { g: 12, a: 0.28 },
    { g: 32, a: 0.14 },
    { g: 72, a: 0.08 },
  ];
  const out = canvas2d(size);
  out.g.fillStyle = "#000";
  out.g.fillRect(0, 0, size, size);
  out.g.globalCompositeOperation = "lighter";
  layers.forEach((L, i) => {
    const n = valueNoiseCanvas(size, L.g, seed + i * 977);
    out.g.globalAlpha = L.a;
    out.g.drawImage(n, 0, 0);
  });
  out.g.globalAlpha = 1;
  out.g.globalCompositeOperation = "source-over";
  return out.c;
}

/* ------------------------------------------------------------
   船体：颜色 + 粗糙度 + 法线
   ------------------------------------------------------------ */
export function hullTextures() {
  if (cache.has("hull")) return cache.get("hull");

  const SIZE = 2048;
  const color = canvas2d(SIZE);
  const rough = canvas2d(SIZE);
  const height = canvas2d(SIZE);
  const rnd = mulberry32(20260709);

  const g = color.g;
  const r = rough.g;
  const hgt = height.g;

  // 底色：冷灰钢（偏中性，避免发蓝发塑料）
  g.fillStyle = "#8a929c";
  g.fillRect(0, 0, SIZE, SIZE);
  r.fillStyle = "#9a9a9a"; // ~0.6 粗糙度基准
  r.fillRect(0, 0, SIZE, SIZE);
  hgt.fillStyle = "#b8b8b8";
  hgt.fillRect(0, 0, SIZE, SIZE);

  // 低频脏迹
  const dirt = fbmCanvas(1024, 4411);
  g.globalAlpha = 0.32;
  g.globalCompositeOperation = "multiply";
  g.drawImage(dirt, 0, 0, SIZE, SIZE);
  g.globalAlpha = 0.26;
  g.globalCompositeOperation = "overlay";
  g.drawImage(dirt, 0, 0, SIZE, SIZE);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";

  // ---- 面板分块 ----
  const seamsX = [0, 0.13, 0.28, 0.29, 0.51, 0.52, 0.7, 0.71, 0.88, 0.89, 1];
  const seamsY = [0, 0.09, 0.22, 0.23, 0.41, 0.42, 0.6, 0.61, 0.78, 0.79, 0.93, 0.94, 1];
  const px = (v) => v * SIZE;

  for (let i = 0; i < seamsX.length - 1; i++) {
    for (let j = 0; j < seamsY.length - 1; j++) {
      if (rnd() < 0.14) continue;
      const x = px(seamsX[i]) + 2;
      const y = px(seamsY[j]) + 2;
      const w = px(seamsX[i + 1] - seamsX[i]) - 4;
      const h = px(seamsY[j + 1] - seamsY[j]) - 4;

      // 每块板明暗不同（真实装甲板换件后的色差）
      const tone = 0.8 + rnd() * 0.36;
      const base = [150, 158, 170];
      g.fillStyle = `rgba(${Math.round(base[0] * tone)},${Math.round(base[1] * tone)},${Math.round(
        base[2] * tone
      )},0.55)`;
      g.fillRect(x, y, w, h);

      // 粗糙度：打磨过 / 未打磨差异明显
      const rg = 96 + Math.round(rnd() * 96);
      r.fillStyle = `rgba(${rg},${rg},${rg},0.72)`;
      r.fillRect(x, y, w, h);

      // 高度：板面整体略高，接缝凹陷
      const hv = 200 + Math.round(rnd() * 30);
      hgt.fillStyle = `rgb(${hv},${hv},${hv})`;
      hgt.fillRect(x, y, w, h);

      // 接缝：深色凹槽 + 上沿高光
      g.strokeStyle = "rgba(26,31,38,0.62)";
      g.lineWidth = 4;
      g.strokeRect(x, y, w, h);
      g.strokeStyle = "rgba(226,236,248,0.22)";
      g.lineWidth = 1.5;
      g.strokeRect(x + 3, y + 3, w - 6, h - 6);

      hgt.strokeStyle = "#3c3c3c";
      hgt.lineWidth = 7;
      hgt.strokeRect(x, y, w, h);

      r.strokeStyle = "rgba(240,240,240,0.8)";
      r.lineWidth = 5;
      r.strokeRect(x, y, w, h);

      // 铆钉 / 紧固件
      if (w > 120 && h > 120 && rnd() < 0.7) {
        const step = 46 + rnd() * 30;
        g.fillStyle = "rgba(58,66,78,0.55)";
        hgt.fillStyle = "#e6e6e6";
        for (let rx = x + 14; rx < x + w - 14; rx += step) {
          for (const ry of [y + 12, y + h - 12]) {
            g.beginPath();
            g.arc(rx, ry, 2.6, 0, TAU);
            g.fill();
            hgt.beginPath();
            hgt.arc(rx, ry, 3.2, 0, TAU);
            hgt.fill();
          }
        }
      }

      // 板面刻线
      if (rnd() < 0.42) {
        g.strokeStyle = "rgba(52,60,72,0.4)";
        g.lineWidth = 1.6;
        const ly = y + h * (0.25 + rnd() * 0.5);
        g.beginPath();
        g.moveTo(x + 10, ly);
        g.lineTo(x + w - 10, ly);
        g.stroke();
        hgt.strokeStyle = "#8e8e8e";
        hgt.lineWidth = 3;
        hgt.beginPath();
        hgt.moveTo(x + 10, ly);
        hgt.lineTo(x + w - 10, ly);
        hgt.stroke();
      }

      // 掉漆（沿接缝边缘的浅色碎点）
      if (rnd() < 0.5) {
        const chips = 10 + Math.floor(rnd() * 26);
        for (let c = 0; c < chips; c++) {
          const cx = x + rnd() * w;
          const cy = rnd() < 0.5 ? y + rnd() * 8 : y + h - rnd() * 8;
          const s = 1 + rnd() * 3.4;
          g.fillStyle = `rgba(${190 + Math.round(rnd() * 40)},${196 + Math.round(rnd() * 40)},${205},${0.2 + rnd() * 0.35})`;
          g.fillRect(cx, cy, s, s * (0.5 + rnd()));
        }
      }
    }
  }

  // ---- 大面积污渍 / 排气痕 ----
  for (let i = 0; i < 40; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const rad = 40 + rnd() * 220;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = rnd() < 0.62;
    grad.addColorStop(0, dark ? "rgba(18,20,24,0.26)" : "rgba(214,224,236,0.14)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();

    const rg2 = r.createRadialGradient(x, y, 0, x, y, rad);
    rg2.addColorStop(0, dark ? "rgba(225,225,225,0.42)" : "rgba(110,110,110,0.3)");
    rg2.addColorStop(1, "rgba(0,0,0,0)");
    r.fillStyle = rg2;
    r.beginPath();
    r.arc(x, y, rad, 0, TAU);
    r.fill();
  }

  // ---- 纵向流痕 ----
  for (let i = 0; i < 70; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const len = 60 + rnd() * 340;
    const w = 2 + rnd() * 16;
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, `rgba(24,27,33,${0.1 + rnd() * 0.14})`);
    grad.addColorStop(0.6, `rgba(24,27,33,${0.04 + rnd() * 0.06})`);
    grad.addColorStop(1, "rgba(24,27,33,0)");
    g.fillStyle = grad;
    g.fillRect(x, y, w, len);
  }

  // ---- 划痕 ----
  for (let i = 0; i < 260; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const len = 16 + rnd() * 150;
    const ang = (rnd() - 0.5) * 0.5 + (rnd() < 0.5 ? 0 : Math.PI / 2);
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const bright = rnd() < 0.5;
    g.strokeStyle = `rgba(${bright ? "236,244,252" : "40,46,54"},${0.07 + rnd() * 0.2})`;
    g.lineWidth = 0.8 + rnd() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y + dy);
    g.stroke();

    r.strokeStyle = "rgba(245,245,245,0.45)";
    r.lineWidth = 1.6;
    r.beginPath();
    r.moveTo(x, y);
    r.lineTo(x + dx, y + dy);
    r.stroke();
  }

  // ---- 涂装标识 ----
  const paint = (x, y, w, h, style) => {
    g.fillStyle = style;
    g.fillRect(x, y, w, h);
  };
  paint(150, 1760, 420, 52, "rgba(255,150,40,0.6)");
  paint(150, 1826, 264, 16, "rgba(230,238,248,0.32)");
  paint(1520, 120, 52, 340, "rgba(255,150,40,0.46)");
  paint(1590, 120, 16, 340, "rgba(220,232,245,0.3)");
  for (let i = 0; i < 9; i++) paint(150 + i * 48, 1760, 24, 52, "rgba(16,18,22,0.55)");

  const rnd2 = mulberry32(77);
  for (let k = 0; k < 7; k++) {
    const bx = 240 + k * 236 + rnd2() * 60;
    const by = 1400 + rnd2() * 120;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(28,34,42,${0.3 + rnd2() * 0.22})`;
      g.fillRect(bx + i * 10, by, 2 + rnd2() * 7, 32);
    }
  }

  // 暗角
  const vig = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.2, SIZE / 2, SIZE / 2, SIZE * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.2)");
  g.fillStyle = vig;
  g.fillRect(0, 0, SIZE, SIZE);

  // ---- 法线（Sobel from height） ----
  const hData = hgt.getImageData(0, 0, SIZE, SIZE).data;
  const nrm = canvas2d(SIZE);
  const nImg = nrm.g.createImageData(SIZE, SIZE);
  const strength = 3.4;
  const at = (x, y) => hData[((y & (SIZE - 1)) * SIZE + (x & (SIZE - 1))) * 4] / 255;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), rr = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = tr + 2 * rr + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * SIZE + x) * 4;
      nImg.data[o] = (nx * 0.5 + 0.5) * 255;
      nImg.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      nImg.data[o + 3] = 255;
    }
  }
  nrm.g.putImageData(nImg, 0, 0);

  const out = {
    map: toTexture(color.c, { srgb: true }),
    roughnessMap: toTexture(rough.c),
    normalMap: toTexture(nrm.c),
  };
  cache.set("hull", out);
  return out;
}

/* ------------------------------------------------------------
   灯带 / 尾焰 / 光晕
   ------------------------------------------------------------ */
export function flameTexture() {
  if (cache.has("flame")) return cache.get("flame");
  const S = 256;
  const { c, g } = canvas2d(S);

  // 纵向火焰渐变：底部白热 → 橙 → 红 → 透明
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0.0, "rgba(255,255,255,1)");
  grd.addColorStop(0.12, "rgba(255,246,214,0.98)");
  grd.addColorStop(0.32, "rgba(255,196,92,0.9)");
  grd.addColorStop(0.58, "rgba(255,116,36,0.62)");
  grd.addColorStop(0.8, "rgba(190,44,14,0.24)");
  grd.addColorStop(1.0, "rgba(90,10,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  // 核心亮柱
  const core = g.createRadialGradient(S / 2, S * 0.16, 0, S / 2, S * 0.16, S * 0.5);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(0.35, "rgba(255,235,190,0.5)");
  core.addColorStop(1, "rgba(255,180,80,0)");
  g.globalCompositeOperation = "lighter";
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);

  // 横向衰减（让羽流收敛成锥形）
  const side = g.createLinearGradient(0, 0, S, 0);
  side.addColorStop(0, "rgba(0,0,0,0)");
  side.addColorStop(0.18, "rgba(0,0,0,0.35)");
  side.addColorStop(0.5, "rgba(0,0,0,1)");
  side.addColorStop(0.82, "rgba(0,0,0,0.35)");
  side.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = side;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "source-over";

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  cache.set("flame", t);
  return t;
}

export function glowSprite(color = "#ffb04a") {
  const key = "glow" + color;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const { c, g } = canvas2d(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.16, color);
  grd.addColorStop(0.42, color.replace(")", ",0.35)").replace("rgb", "rgba"));
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function softCircle(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const key = "soft" + inner + outer;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const { c, g } = canvas2d(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, inner.replace(/[\d.]+\)$/, "0.35)"));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** 引擎尾焰用的湍流噪声贴图（给 shader 做扰动） */
export function turbulenceTexture(seed = 9) {
  if (cache.has("turb" + seed)) return cache.get("turb" + seed);
  const S = 256;
  const c = fbmCanvas(S, seed);
  const g = c.getContext("2d");
  // 拉成纵向条纹，模拟喷流
  g.globalCompositeOperation = "multiply";
  const streaks = canvas2d(S);
  const rnd = mulberry32(seed * 3 + 1);
  streaks.g.fillStyle = "#8c8c8c";
  streaks.g.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * S;
    const w = 1 + rnd() * 6;
    const v = 120 + Math.round(rnd() * 135);
    streaks.g.fillStyle = `rgba(${v},${v},${v},${0.3 + rnd() * 0.5})`;
    streaks.g.fillRect(x, 0, w, S);
  }
  g.drawImage(streaks.c, 0, 0);
  g.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set("turb" + seed, t);
  return t;
}

/** 舷号 / 警示贴花（透明底） */
export function decalTexture(kind = "id") {
  const key = "decal-" + kind;
  if (cache.has(key)) return cache.get(key);
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);

  const ink = "rgba(232,238,246,0.92)";
  const warn = "rgba(255,158,42,0.95)";

  if (kind === "id") {
    g.fillStyle = ink;
    g.font = "bold 118px 'Bahnschrift','DIN Alternate',Consolas,sans-serif";
    g.textBaseline = "middle";
    g.fillText("AX-09", 18, 96);
    g.font = "bold 30px Consolas,monospace";
    g.fillStyle = "rgba(200,212,228,0.8)";
    g.fillText("ARGUS · IX", 22, 172);
    // 小条码
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(226,234,244,${0.35 + (i % 3) * 0.2})`;
      g.fillRect(22 + i * 9, 196, 3 + (i % 4), 24);
    }
    // 破折线
    g.strokeStyle = "rgba(255,158,42,0.8)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(20, 240);
    g.lineTo(150, 240);
    g.stroke();
  } else if (kind === "warn") {
    g.strokeStyle = warn;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(88, 30);
    g.lineTo(160, 152);
    g.lineTo(16, 152);
    g.closePath();
    g.stroke();
    g.fillStyle = warn;
    g.font = "bold 62px Consolas,monospace";
    g.textAlign = "center";
    g.fillText("!", 88, 132);
    g.textAlign = "left";
    g.font = "bold 30px Consolas,monospace";
    g.fillStyle = "rgba(232,238,246,0.9)";
    g.fillText("DANGER", 190, 90);
    g.fillText("PLASMA", 190, 128);
    g.font = "24px Consolas,monospace";
    g.fillStyle = "rgba(190,204,222,0.75)";
    g.fillText("KEEP CLEAR", 190, 162);
  } else {
    // 机翼徽标
    g.strokeStyle = "rgba(226,236,248,0.85)";
    g.lineWidth = 8;
    g.beginPath();
    g.arc(128, 128, 74, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(255,158,42,0.9)";
    g.beginPath();
    g.moveTo(128, 62);
    g.lineTo(170, 186);
    g.lineTo(128, 156);
    g.lineTo(86, 186);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(232,238,246,0.9)";
    g.font = "bold 26px Consolas,monospace";
    g.fillText("IX", 226, 140);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** 星空背景用的星点贴图 */
export function starTexture() {
  if (cache.has("star")) return cache.get("star");
  const S = 512;
  const { c, g } = canvas2d(S);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(31337);
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rr = Math.pow(rnd(), 3) * 1.7 + 0.2;
    const a = 0.25 + rnd() * 0.75;
    const hue = rnd();
    const col =
      hue < 0.2 ? `rgba(190,215,255,${a})` : hue < 0.85 ? `rgba(255,255,255,${a})` : `rgba(255,222,190,${a})`;
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set("star", t);
  return t;
}
