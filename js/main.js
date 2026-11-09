/* ============================================================
   main.js — 装配、渲染、后处理、交互
   ============================================================ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { buildShip } from "./ship.js";
import { createEnvironment } from "./env.js";
import { createEngineFX, createLaserFX } from "./vfx.js";
import { createExploder } from "./exploder.js";
import { createLabels } from "./labels.js";
import { createCameraRig, VIEW_DIRS } from "./camera-rig.js";
import { createGestureController } from "./gesture.js";
import { clamp, damp, lerp } from "./util.js";

/* ------------------------------------------------------------
   基础环境
   ------------------------------------------------------------ */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  alpha: false,
  preserveDrawingBuffer: true, // 供「导出截图」使用
});

/**
 * 像素比：绝不低于 1（否则画布被浏览器放大，一定糊），上限 2。
 * 高 DPI 屏幕上按 2 倍渲染，边缘才锐利。
 */
function targetPixelRatio() {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}
renderer.setPixelRatio(targetPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04060a, 0.0035);

const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.1, 900);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.62;
controls.zoomSpeed = 0.85;
controls.panSpeed = 0.6;
controls.minDistance = 7;
controls.maxDistance = 140;
controls.maxPolarAngle = Math.PI * 0.92;
controls.target.set(0, 0.5, 0);

/* ------------------------------------------------------------
   程序化环境贴图（金属反射）
   ------------------------------------------------------------ */
function buildEnvironmentMap() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x02040a);

  const panel = (color, intensity, pos, size, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0], size[1]),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      })
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    envScene.add(m);
  };

  panel(0xdce8ff, 1.35, [0, 15, 0], [44, 44], [Math.PI / 2, 0, 0]);
  panel(0x9aa8bc, 0.3, [0, -15, 0], [44, 44], [-Math.PI / 2, 0, 0]);
  panel(0xffe0c0, 1.5, [-9, 7, 6], [16, 10], [0, -0.6, 0]);
  panel(0x9fc0ff, 0.7, [11, 3, -7], [14, 9], [0, 2.2, 0]);
  panel(0xa8dcff, 0.5, [3, -9, 2], [18, 12], [Math.PI / 2, 0, 0]);
  panel(0xffb27a, 0.6, [0, 2, -13], [10, 6], [0, Math.PI, 0]);

  const rt = pmrem.fromScene(envScene, 0.03);
  pmrem.dispose();
  envScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return rt.texture;
}
scene.environment = buildEnvironmentMap();
scene.environmentIntensity = 0.95;

/* ------------------------------------------------------------
   灯光
   ------------------------------------------------------------ */
const hemi = new THREE.HemisphereLight(0x33465e, 0x05070c, 0.5);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2e2, 4.4);
key.position.set(-14, 16, 13);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.near = 1;
key.shadow.camera.far = 70;
key.shadow.camera.left = -18;
key.shadow.camera.right = 18;
key.shadow.camera.top = 18;
key.shadow.camera.bottom = -18;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.035;
key.shadow.radius = 3;
scene.add(key);

const rim = new THREE.DirectionalLight(0x9cc4ff, 2.5);
rim.position.set(13, 6, -16);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xdfe9ff, 0.4);
fill.position.set(2, -10, 6);
scene.add(fill);

/* ------------------------------------------------------------
   世界
   ------------------------------------------------------------ */
const env = createEnvironment(scene);
const ship = buildShip();
scene.add(ship.root);

const engineFX = createEngineFX(ship.parts);
const laserFX = createLaserFX(ship.parts);

/* ------------------------------------------------------------
   状态
   ------------------------------------------------------------ */
const state = {
  explode: 0,
  explodeTarget: 0,
  explodeDuration: 1.5,
  inspecting: null,
  hovered: null,
  solo: null,
  inspected: new Set(),
  opts: {
    glow: true,
    laser: false,
    labels: true,
    grid: false,
    autoRotate: false,
    xray: false,
    ao: true,
  },
};

const exploder = createExploder(ship.parts, state);

/* ------------------------------------------------------------
   后处理
   ------------------------------------------------------------ */
// 合成器默认的渲染目标是「无 MSAA」的，所有边缘都会锯齿/发虚；
// 这里给渲染目标开 MSAA，几何边缘才干净。高 DPI 大屏上降到 2x，控制显存与带宽。
const _dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const _msaaSamples = _dbSize.x * _dbSize.y > 3.4e6 ? 2 : 4;
const msaaTarget = new THREE.WebGLRenderTarget(_dbSize.x, _dbSize.y, {
  type: THREE.HalfFloatType,
  samples: _msaaSamples,
});
const composer = new EffectComposer(renderer, msaaTarget);
composer.setPixelRatio(targetPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// 环境光遮蔽：把零件细节“焊”到船体上
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.output = GTAOPass.OUTPUT.Default;
gtao.blendIntensity = 0.85;
gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
composer.addPass(gtao);

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.7, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------
   相机装置
   ------------------------------------------------------------ */
const rig = createCameraRig({ camera, controls, ship, state });

/* ------------------------------------------------------------
   UI 元素
   ------------------------------------------------------------ */
const el = {
  btnExplode: document.getElementById("btnExplode"),
  explodeRange: document.getElementById("explodeRange"),
  explodeVal: document.getElementById("explodeVal"),
  btnStepOut: document.getElementById("btnStepOut"),
  btnReset: document.getElementById("btnReset"),
  partList: document.getElementById("partList"),
  panelLeft: document.getElementById("panel-left"),
  panelRight: document.getElementById("panel-right"),
  inspectCode: document.getElementById("inspectCode"),
  inspectName: document.getElementById("inspectName"),
  inspectDesc: document.getElementById("inspectDesc"),
  inspectSpecs: document.getElementById("inspectSpecs"),
  inspectClose: document.getElementById("inspectClose"),
  btnIsolate: document.getElementById("btnIsolate"),
  btnFocus: document.getElementById("btnFocus"),
  statParts: document.getElementById("statParts"),
  statInspected: document.getElementById("statInspected"),
  statFps: document.getElementById("statFps"),
  boot: document.getElementById("boot"),
  labelLayer: document.getElementById("labelLayer"),
  btnShot: document.getElementById("btnShot"),
  drawerToggle: document.getElementById("drawerToggle"),
};

el.statParts.textContent = String(ship.parts.length).padStart(2, "0");
el.statInspected.textContent = "00";

/* ------------------------------------------------------------
   选中高亮
   ------------------------------------------------------------ */
const HL = new THREE.Color(0xff9a3c);

function applyHighlight(part, w) {
  if (!part) return;
  for (const rec of part.materials) {
    if (!rec.mat.emissive) continue;
    // 只加极轻微的自发光，真正的“选中”由角标 + 面板承担
    rec.mat.emissive.copy(rec.base).lerp(HL, w * 0.012);
    rec.mat.emissiveIntensity = lerp(rec.baseIntensity, rec.baseIntensity + 0.02, w);
  }
}

function updateHighlights(dt) {
  for (const p of ship.parts) {
    const target = state.inspecting === p.id ? 1 : state.hovered === p.id ? 0.45 : 0;
    if (Math.abs((p.hl || 0) - target) > 0.003) {
      p.hl = damp(p.hl || 0, target, 12, dt);
      applyHighlight(p, p.hl);
    }
  }
}

/* ------------------------------------------------------------
   选中角标
   ------------------------------------------------------------ */
function createBracket() {
  const verts = [];
  const L = 0.22;
  const s = 1;
  for (const sx of [-s, s])
    for (const sy of [-s, s])
      for (const sz of [-s, s]) {
        verts.push(sx * s, sy * s, sz * s, sx * (s - L), sy * s, sz * s);
        verts.push(sx * s, sy * s, sz * s, sx * s, sy * (s - L), sz * s);
        verts.push(sx * s, sy * s, sz * s, sx * s, sy * s, sz * (s - L));
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffb055,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  scene.add(lines);
  return lines;
}

const bracket = createBracket();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function updateBracket(dt) {
  const part = ship.parts.find((p) => p.id === state.inspecting);
  bracket.material.opacity = damp(bracket.material.opacity, part ? 0.95 : 0, 9, dt);
  bracket.visible = bracket.material.opacity > 0.01;
  if (!part) return;

  _box.copy(part.bbox).applyMatrix4(part.group.matrixWorld);
  _box.getSize(_size);
  _box.getCenter(_center);
  const pad = 0.06;
  bracket.position.copy(_center);
  bracket.scale.set(
    Math.max(_size.x * 0.5 + pad, 0.05),
    Math.max(_size.y * 0.5 + pad, 0.05),
    Math.max(_size.z * 0.5 + pad, 0.05)
  );
  bracket.scale.multiplyScalar(1 + Math.sin(performance.now() * 0.003) * 0.008);
}

/* ------------------------------------------------------------
   标签
   ------------------------------------------------------------ */
const labels = createLabels({ ship, camera, state, el });

/* ------------------------------------------------------------
   拾取
   ------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownPos = null;
let dragging = false;
let hoverDirty = false;

function setPointerFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(ship.pickables, false);
  for (const h of hits) {
    if (!h.object.visible) continue;
    let o = h.object;
    while (o && !o.userData.partId) o = o.parent;
    if (o) return o.userData.partId;
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
  dragging = false;
  canvas.classList.add("dragging");
});

canvas.addEventListener("pointermove", (e) => {
  setPointerFromEvent(e);
  if (pointerDownPos) {
    const d = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    if (d > 5) dragging = true;
  }
  if (e.pointerType === "mouse") hoverDirty = true;
});

canvas.addEventListener("pointerup", (e) => {
  canvas.classList.remove("dragging");
  if (pointerDownPos && !dragging) {
    setPointerFromEvent(e);
    const id = pick();
    if (id) inspect(id, true);
    else clearInspect();
  }
  pointerDownPos = null;
});

canvas.addEventListener("pointerleave", () => {
  pointerDownPos = null;
  if (state.hovered) {
    state.hovered = null;
    canvas.classList.remove("hot");
  }
});

function updateHover() {
  if (!hoverDirty) return;
  hoverDirty = false;
  const id = pick();
  if (id !== state.hovered) {
    state.hovered = id;
    canvas.classList.toggle("hot", !!id);
  }
}

/* ------------------------------------------------------------
   零件列表
   ------------------------------------------------------------ */
const listItems = new Map();
ship.parts.forEach((p) => {
  const li = document.createElement("li");
  li.innerHTML = `<span class="dot"></span><span class="nm">${p.name}</span><span class="code">${p.code.replace(
    "SYS-",
    ""
  )}</span>`;
  li.addEventListener("click", () => inspect(p.id, true));
  li.addEventListener("mouseenter", () => (state.hovered = p.id));
  li.addEventListener("mouseleave", () => (state.hovered = null));
  el.partList.appendChild(li);
  listItems.set(p.id, li);
});

function syncList() {
  for (const [id, li] of listItems) {
    li.classList.toggle("active", state.inspecting === id);
    li.classList.toggle("done", state.inspected.has(id));
  }
}

/* ------------------------------------------------------------
   剖析控制
   ------------------------------------------------------------ */
function syncExplodeUI() {
  const on = state.explodeTarget > 0.5;
  el.btnExplode.classList.toggle("active", on);
  el.btnExplode.querySelector(".label").textContent = on ? "收拢结构" : "一键剖析";
  el.btnExplode.querySelector(".hint").textContent = on ? "收拢全部部件" : "结构展开与零件检视";
}

function toggleExplode() {
  const next = state.explodeTarget > 0.5 ? 0 : 1;
  exploder.setTarget(next);
  rig.reframeForExplode(next);
  syncExplodeUI();
}

el.btnExplode.addEventListener("click", toggleExplode);

el.btnStepOut.addEventListener("click", () => {
  const steps = [0, 0.34, 0.68, 1];
  const cur = state.explodeTarget;
  const next = steps.find((s) => s > cur + 0.02) ?? 0;
  exploder.setTarget(next);
  rig.reframeForExplode(next);
  syncExplodeUI();
});

el.btnReset.addEventListener("click", () => {
  exploder.setTarget(0);
  rig.reframeForExplode(0);
  clearSolo();
  syncExplodeUI();
});

el.explodeRange.addEventListener("input", () => {
  const v = Number(el.explodeRange.value) / 100;
  exploder.setTarget(v, true);
  syncExplodeUI();
});

/* ------------------------------------------------------------
   开关
   ------------------------------------------------------------ */
document.querySelectorAll(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const opt = btn.dataset.opt;
    const next = !state.opts[opt];
    state.opts[opt] = next;
    btn.setAttribute("aria-pressed", String(next));
    applyOption(opt, next);
  });
});

function applyOption(opt, on) {
  switch (opt) {
    case "glow":
      engineFX.setPower(on ? 1 : 0);
      break;
    case "laser":
      laserFX.setActive(on);
      engineFX.setLaser(on);
      break;
    case "grid":
      env.setGrid(on);
      break;
    case "autoRotate":
      controls.autoRotate = on;
      controls.autoRotateSpeed = 0.55;
      break;
    case "labels":
      if (!on) el.labelLayer.querySelectorAll(".lbl").forEach((d) => d.classList.remove("on"));
      break;
    case "xray":
      applyXray(on);
      break;
    case "ao":
      gtao.enabled = on;
      break;
  }
}

/** X 光透视：外壳半透明，内部结构显形 */
function applyXray(on) {
  const shellIds = ["nose", "hull", "wingL", "wingR", "spine", "hangar", "cannons"];
  for (const p of ship.parts) {
    const isShell = shellIds.includes(p.id);
    p.group.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.isShaderMaterial) return;
      if (o.userData.decal) return;
      const m = o.material;
      if (m.userData._orig === undefined) {
        m.userData._orig = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      }
      if (on && isShell) {
        m.transparent = true;
        m.opacity = 0.22;
        m.depthWrite = false;
      } else if (on) {
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
      } else {
        const o0 = m.userData._orig;
        m.transparent = o0.transparent;
        m.opacity = o0.opacity;
        m.depthWrite = o0.depthWrite;
      }
      m.needsUpdate = true;
    });
  }
  if (ship.interior) ship.interior.visible = on;
  if (ship.decals) ship.decals.visible = !on;
}

/* ------------------------------------------------------------
   检视
   ------------------------------------------------------------ */
function clearSolo() {
  state.solo = null;
  el.btnIsolate.classList.remove("on");
  el.btnIsolate.textContent = "单独剖析该件";
}

function inspect(id, explicit) {
  const part = ship.parts.find((p) => p.id === id);
  if (!part) return;
  state.inspecting = id;
  state.inspected.add(id);
  el.statInspected.textContent = String(state.inspected.size).padStart(2, "0");

  el.inspectCode.textContent = part.code + " / " + part.id.toUpperCase();
  el.inspectName.textContent = part.name;
  el.inspectDesc.textContent = part.desc;
  el.inspectSpecs.innerHTML = part.specs
    .map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
  el.panelRight.classList.remove("collapsed");
  syncList();

  if (explicit && state.explodeTarget < 0.3) {
    exploder.setTarget(0.62);
    rig.reframeForExplode(0.62);
    syncExplodeUI();
  }
}

function clearInspect() {
  state.inspecting = null;
  if (state.solo) {
    state.solo = null;
    el.btnIsolate.classList.remove("on");
    el.btnIsolate.textContent = "单独剖析该件";
    exploder.apply();
  }
  el.panelRight.classList.add("collapsed");
  syncList();
}

el.inspectClose.addEventListener("click", clearInspect);

el.btnIsolate.addEventListener("click", () => {
  const id = state.inspecting;
  if (!id) return;
  if (state.solo === id) {
    clearSolo();
  } else {
    state.solo = id;
    el.btnIsolate.classList.add("on");
    el.btnIsolate.textContent = "退出单件剖析";
    if (state.explodeTarget < 0.5) {
      exploder.setTarget(1);
      rig.reframeForExplode(1);
      syncExplodeUI();
    }
  }
  exploder.apply();
});

el.btnFocus.addEventListener("click", () => {
  const part = ship.parts.find((p) => p.id === state.inspecting);
  if (!part) return;
  _box.copy(part.bbox).applyMatrix4(part.group.matrixWorld);
  _box.getSize(_size);
  _box.getCenter(_center);
  const radius = Math.max(_size.length() * 0.5, 1.2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  rig.flyTo(_center.clone().add(dir.multiplyScalar(radius * 2.6 + 2.5)), _center.clone(), 0.9);
});

/* ------------------------------------------------------------
   机位
   ------------------------------------------------------------ */
document.querySelectorAll(".cam").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cam").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    rig.applyView(btn.dataset.view, 1.15);
  });
});
document.querySelector('.cam[data-view="hero"]').classList.add("active");

/* ------------------------------------------------------------
   导出截图
   ------------------------------------------------------------ */
function exportScreenshot() {
  composer.render();
  composer.render();
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `ARGUS-IX-${ts}.png`;
  a.href = url;
  a.click();
}
if (el.btnShot) el.btnShot.addEventListener("click", exportScreenshot);

/* ------------------------------------------------------------
   手势控制
   ------------------------------------------------------------ */
const gestureEl = {
  btn: document.getElementById("btnGesture"),
  status: document.getElementById("gestureStatus"),
  preview: document.getElementById("gesturePreview"),
  canvas: document.getElementById("gestureCanvas"),
  hud: document.getElementById("gestureHud"),
  cursor: document.getElementById("gestureCursor"),
  label: document.querySelector("#gestureCursor .gc-label"),
};

/** 屏幕坐标 → 部件 id（手势与鼠标共用同一套射线） */
function pickAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
  return pick();
}

const gesture = createGestureController({
  camera,
  controls,
  canvas,
  hooks: {
    pickAt,
    onSelect: (id) => {
      if (id) inspect(id, true);
      else clearInspect();
    },
    onHover: (id) => {
      state.hovered = id;
      canvas.classList.toggle("hot", !!id);
    },
    onExplodeToggle: () => toggleExplode(),
    onCursor: (c) => {
      if (!gestureEl.cursor) return;
      if (!c) {
        gestureEl.cursor.classList.remove("on");
        return;
      }
      gestureEl.cursor.classList.add("on");
      gestureEl.cursor.classList.toggle("pinch", c.pinch);
      const p = partById(state.hovered);
      gestureEl.cursor.classList.toggle("hot", !!p);
      gestureEl.cursor.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      gestureEl.label.textContent = p ? p.name : "";
    },
    onStatus: (kind, text) => {
      if (!gestureEl.status) return;
      gestureEl.status.textContent = text;
      gestureEl.status.classList.toggle("warn", kind === "error" || kind === "denied");
      if (kind === "ready") {
        gestureEl.preview.hidden = false;
        gestureEl.btn.classList.add("on");
        gestureEl.btn.querySelector(".glabel").textContent = "关闭手势";
      } else if (kind === "idle" || kind === "error" || kind === "denied") {
        gestureEl.btn.classList.remove("on");
        gestureEl.btn.querySelector(".glabel").textContent = "开启手势";
        if (kind !== "loading") gestureEl.preview.hidden = true;
      }
    },
    onMode: (mode) => {
      document.body.dataset.inputMode = mode;
    },
  },
});

function partById(id) {
  return id ? ship.parts.find((p) => p.id === id) : null;
}

if (gestureEl.btn) {
  gesture.bindPreview(gestureEl.canvas);
  gestureEl.btn.addEventListener("click", () => gesture.toggle());
  gestureEl.canvas.width = 240;
  gestureEl.canvas.height = 180;
}

/* ------------------------------------------------------------
   移动端抽屉
   ------------------------------------------------------------ */
if (el.drawerToggle) {
  el.drawerToggle.addEventListener("click", () => {
    const open = el.panelLeft.classList.toggle("expanded");
    el.drawerToggle.setAttribute("aria-expanded", String(open));
    el.drawerToggle.textContent = open ? "收起" : "展开";
  });
}

/* ------------------------------------------------------------
   键盘
   ------------------------------------------------------------ */
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === " ") {
    e.preventDefault();
    toggleExplode();
  } else if (k === "r") {
    el.btnReset.click();
  } else if (k === "e") {
    el.btnStepOut.click();
  } else if (k === "escape") {
    clearInspect();
  } else if (k === "f") {
    el.btnFocus.click();
  } else if (k === "p") {
    exportScreenshot();
  }
});

/* ------------------------------------------------------------
   尺寸
   ------------------------------------------------------------ */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = targetPixelRatio();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h); // 内部会把 passes 的 setSize 按 devicePixel 传下去
  gtao.setSize(w * dpr, h * dpr);
  rig.refit();
}
window.addEventListener("resize", onResize);

/* ------------------------------------------------------------
   主循环
   ------------------------------------------------------------ */
let elapsed = 0;
let lastFrameTime = performance.now();
let fpsFrames = 0;
let fpsLast = performance.now();
let lowFpsStreak = 0;

function tick() {
  const nowTs = performance.now();
  const dt = Math.min((nowTs - lastFrameTime) / 1000, 0.12);
  lastFrameTime = nowTs;
  elapsed += dt;

  rig.update();
  controls.update();

  exploder.update();
  updateHighlights(dt);
  updateBracket(dt);
  updateHover();
  labels.update();

  engineFX.update(elapsed, dt);
  laserFX.update(elapsed, dt);
  env.update(elapsed, dt);
  gesture.update(dt);
  gesture.drawPreview();

  // 手势开启时，准星高亮与鼠标悬停统一走 state.hovered
  if (gesture.isOn && gestureEl.hud) {
    const t = gesture.tracker;
    gestureEl.hud.textContent = !t.present ? "待识别" : t.pinch ? "捏合" : t.fist ? "握拳" : t.open ? "张掌" : "指向";
  }

  if (ship.root) {
    ship.root.position.y = Math.sin(elapsed * 0.7) * 0.02;
    ship.root.rotation.z = Math.sin(elapsed * 0.43) * 0.004;
  }

  composer.render();

  if (Math.abs(state.explode - Number(el.explodeRange.value) / 100) > 0.001) {
    const v = Math.round(state.explode * 100);
    el.explodeRange.value = String(v);
    el.explodeVal.textContent = v + "%";
  }

  fpsFrames++;
  if (nowTs - fpsLast > 500) {
    const fps = Math.round((fpsFrames * 1000) / (nowTs - fpsLast));
    // rAF 被限流（后台标签页 / 无头环境）时不显示误导性的低值
    if (fps < 5) {
      lowFpsStreak++;
      if (lowFpsStreak > 2) el.statFps.textContent = "—";
    } else {
      lowFpsStreak = 0;
      el.statFps.textContent = String(fps);
    }
    fpsFrames = 0;
    fpsLast = nowTs;
  }

  requestAnimationFrame(tick);
}

/* 初始取景（下一帧执行，确保拿到真实视口尺寸） */
renderer.compile(scene, camera);
requestAnimationFrame(() => {
  const v0 = rig.viewPosition("hero", 0);
  camera.position.copy(v0.pos);
  controls.target.copy(v0.target);
  controls.update();
  tick();
  setTimeout(() => el.boot.classList.add("gone"), 420);
});

/* ------------------------------------------------------------
   调试接口
   ------------------------------------------------------------ */
window.__ARGUS__ = {
  scene,
  camera,
  controls,
  renderer,
  composer,
  ship,
  state,
  exploder,
  rig,
  labels,
  laserFX,
  gesture,
  setExplode: (v) => {
    exploder.setTarget(v);
    rig.reframeForExplode(v);
    syncExplodeUI();
  },
  inspect,
  laser: (on) => {
    state.opts.laser = on;
    laserFX.setActive(on);
    engineFX.setLaser(on);
  },
  xray: (on) => {
    state.opts.xray = on;
    applyXray(on);
  },
  view: (name) => rig.applyView(name, 0.01),
  ortho: (which = "top") => {
    const w = 30;
    const aspect = window.innerWidth / window.innerHeight;
    const cam = new THREE.OrthographicCamera((-w * aspect) / 2, (w * aspect) / 2, w / 2, -w / 2, 0.1, 200);
    const t = new THREE.Vector3(0, 0, -0.5);
    if (which === "top") cam.position.set(0, 40, 0.001);
    if (which === "side") cam.position.set(40, 0, 0.001);
    if (which === "front") cam.position.set(0, 0, 40);
    cam.lookAt(t);
    cam.updateProjectionMatrix();
    renderPass.camera = cam;
    gtao.camera = cam;
    return which;
  },
  persp: () => {
    renderPass.camera = camera;
    gtao.camera = camera;
  },
};
