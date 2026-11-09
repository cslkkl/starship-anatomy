/* ============================================================
   vfx.js — 引擎尾焰、等离子尾迹、激光齐射
   全部为 GPU 着色器 + 加法混合，配合 Bloom 出图
   ============================================================ */
import * as THREE from "three";
import { turbulenceTexture, softCircle } from "./textures.js";
import { damp, clamp } from "./util.js";

/* ------------------------------------------------------------
   尾焰材质
   ------------------------------------------------------------ */
function makeFlameMaterial({ hot, cool, intensity = 1, length = 3, speed = 1, seed = 0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNoise: { value: turbulenceTexture(9) },
      uHot: { value: new THREE.Color(hot) },
      uCool: { value: new THREE.Color(cool) },
      uIntensity: { value: intensity },
      uLen: { value: length },
      uSpeed: { value: speed },
      uSeed: { value: seed },
      uPower: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      varying vec2 vUv;
      varying float vEdge;
      void main() {
        vUv = uv;
        vec3 p = position;
        // 沿喷流的轻微横向抖动，让火焰边缘活起来
        float t = uTime;
        float sway = sin(t * 9.0 + p.z * 5.0 + uSeed) * 0.5
                   + sin(t * 13.7 + p.z * 9.0 + uSeed * 2.1) * 0.3;
        p.x += sway * 0.035 * (1.0 - uv.y);
        p.y += sway * 0.028 * (1.0 - uv.y);
        vEdge = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLen;
      uniform float uSpeed;
      uniform float uSeed;
      uniform float uPower;
      uniform float uIntensity;
      uniform sampler2D uNoise;
      uniform vec3 uHot;
      uniform vec3 uCool;
      varying vec2 vUv;
      varying float vEdge;

      void main() {
        float v = clamp(vUv.y, 0.0, 1.0);
        float u = vUv.x;

        // 两层滚动噪声模拟湍流
        float n1 = texture2D(uNoise, vec2(u * 1.6 + uSeed, v * 1.2 - uTime * uSpeed * 1.4)).r;
        float n2 = texture2D(uNoise, vec2(u * 3.4 + uSeed * 0.5, v * 2.7 - uTime * uSpeed * 2.6)).r;
        float turb = n1 * 0.62 + n2 * 0.38;

        // 沿轴的衰减
        float fall = pow(1.0 - v, 1.55);

        // 激波菱形（马赫盘）
        float diamonds = 0.86 + 0.2 * sin(v * uLen * 14.0 - uTime * uSpeed * 4.0) * exp(-v * 9.0);

        // 边缘柔化
        float edge = smoothstep(0.0, 0.16, u) * smoothstep(1.0, 0.84, u);

        float a = fall * (0.5 + turb * 0.7) * diamonds * edge * uPower;
        a = clamp(a * uIntensity, 0.0, 1.6);

        vec3 col = mix(uHot, uCool, smoothstep(0.02, 0.82, v));
        col += uHot * pow(1.0 - v, 7.0) * 0.9;
        // 噪声带来的局部色偏
        col *= 0.75 + turb * 0.65;

        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function coneGeom(radius, len, radial = 28, height = 16) {
  const geo = new THREE.ConeGeometry(radius, len, radial, height, true);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -len / 2);
  return geo;
}

/* ------------------------------------------------------------
   引擎尾焰
   ------------------------------------------------------------ */
const ENGINES = [
  {
    id: "engineC",
    radius: 0.56,
    len: 5.4,
    hot: 0xffe9c0,
    cool: 0xff4a12,
    intensity: 0.78,
    speed: 1.5,
    light: 16,
    lightColor: 0xff8a3a,
  },
  {
    id: "engineL",
    radius: 0.42,
    len: 3.6,
    hot: 0xffe6bb,
    cool: 0xff5216,
    intensity: 0.66,
    speed: 1.35,
    light: 9,
    lightColor: 0xff7a30,
  },
  {
    id: "engineR",
    radius: 0.42,
    len: 3.6,
    hot: 0xffe6bb,
    cool: 0xff5216,
    intensity: 0.66,
    speed: 1.35,
    light: 9,
    lightColor: 0xff7a30,
  },
];

export function createEngineFX(parts) {
  const flames = [];
  const lights = [];
  const glowTex = softCircle("rgba(255,214,150,1)", "rgba(255,120,30,0)");

  for (const cfg of ENGINES) {
    const part = parts.find((p) => p.id === cfg.id);
    if (!part || !part.group.userData.nozzle) continue;
    const nozzle = part.group.userData.nozzle;

    const holder = new THREE.Group();
    holder.position.copy(nozzle.pos);
    holder.position.z -= 0.02;
    part.group.add(holder);

    // 外焰
    const outerMat = makeFlameMaterial({
      hot: cfg.hot,
      cool: cfg.cool,
      intensity: cfg.intensity,
      length: cfg.len,
      speed: cfg.speed,
      seed: Math.random() * 10,
    });
    const outer = new THREE.Mesh(coneGeom(cfg.radius, cfg.len, 26, 18), outerMat);
    outer.frustumCulled = false;
    outer.renderOrder = 6;
    holder.add(outer);

    // 内焰（短、白热）
    const innerMat = makeFlameMaterial({
      hot: 0xffffff,
      cool: 0xffd08a,
      intensity: 0.95,
      length: cfg.len * 0.42,
      speed: cfg.speed * 1.5,
      seed: Math.random() * 10,
    });
    const inner = new THREE.Mesh(coneGeom(cfg.radius * 0.62, cfg.len * 0.45, 20, 12), innerMat);
    inner.frustumCulled = false;
    inner.renderOrder = 7;
    holder.add(inner);

    // 远距离稀薄尾迹
    const trailMat = makeFlameMaterial({
      hot: 0xffc98a,
      cool: 0x5a2a88,
      intensity: 0.2,
      length: cfg.len * 3.2,
      speed: cfg.speed * 0.55,
      seed: Math.random() * 10,
    });
    const trail = new THREE.Mesh(coneGeom(cfg.radius * 0.9, cfg.len * 3.2, 18, 14), trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 5;
    holder.add(trail);

    // 喷口光斑
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffb066,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      })
    );
    glow.scale.setScalar(cfg.radius * 4.2);
    glow.position.z = 0.05;
    glow.renderOrder = 8;
    holder.add(glow);

    const light = new THREE.PointLight(cfg.lightColor, cfg.light, 22, 2);
    light.position.set(0, 0, -0.6);
    holder.add(light);
    lights.push({ light, base: cfg.light });

    flames.push({ holder, outer, inner, trail, glow, cfg, outerMat, innerMat, trailMat });
  }

  let power = 1;
  let targetPower = 1;
  let laserMode = 0;

  function update(t, dt) {
    power = damp(power, targetPower, 5, dt);
    const flick = 0.9 + Math.sin(t * 21.3) * 0.045 + Math.sin(t * 8.7) * 0.035;

    for (const f of flames) {
      const p = power * flick;
      f.outerMat.uniforms.uTime.value = t;
      f.innerMat.uniforms.uTime.value = t;
      f.trailMat.uniforms.uTime.value = t;
      f.outerMat.uniforms.uPower.value = p;
      f.innerMat.uniforms.uPower.value = p;
      f.trailMat.uniforms.uPower.value = p * (0.6 + laserMode * 0.2);

      // 高温时焰体变长
      const stretch = 0.78 + p * 0.34;
      f.outer.scale.set(1, 1, stretch);
      f.inner.scale.set(1, 1, stretch * 1.05);
      f.trail.scale.set(1 + laserMode * 0.35, 1 + laserMode * 0.35, 1.1 + p * 0.25);

      f.glow.material.opacity = 0.42 + p * 0.3;
      f.glow.scale.setScalar(f.cfg.radius * (2.2 + p * 0.9));

      // 激光模式下尾焰偏蓝紫（离子态）
      const cool = new THREE.Color(f.cfg.cool);
      const hot = new THREE.Color(f.cfg.hot);
      if (laserMode > 0.01) {
        cool.lerp(new THREE.Color(0x2f5bff), laserMode * 0.85);
        hot.lerp(new THREE.Color(0xcfe2ff), laserMode * 0.65);
        f.outerMat.uniforms.uCool.value.copy(cool);
        f.outerMat.uniforms.uHot.value.copy(hot);
        f.innerMat.uniforms.uHot.value.copy(hot);
        f.trailMat.uniforms.uCool.value.copy(cool).lerp(new THREE.Color(0x1a1050), 0.45);
        f.trailMat.uniforms.uHot.value.copy(hot);
      } else {
        f.outerMat.uniforms.uCool.value.setHex(f.cfg.cool);
        f.outerMat.uniforms.uHot.value.setHex(f.cfg.hot);
        f.innerMat.uniforms.uHot.value.setHex(0xffffff);
        f.trailMat.uniforms.uCool.value.setHex(0x5a2a88);
        f.trailMat.uniforms.uHot.value.setHex(0xffc98a);
      }
    }

    for (const l of lights) {
      l.light.intensity = l.base * power * (0.92 + Math.sin(t * 17.4) * 0.08);
    }
  }

  function setPower(p) {
    targetPower = clamp(p, 0, 1.6);
  }
  function setLaser(v) {
    laserMode = v ? 1 : 0;
  }

  return {
    update,
    setPower,
    setLaser,
    flames,
    get power() {
      return power;
    },
  };
}

/* ------------------------------------------------------------
   激光
   ------------------------------------------------------------ */
function makeBeamMaterial(color = 0x8fe8ff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float pulse = 0.72 + 0.28 * sin(vUv.y * 240.0 - uTime * 90.0);
        float travel = smoothstep(0.0, 0.05, vUv.y);
        float fade = pow(1.0 - vUv.y, 0.55);
        float a = uOpacity * (0.6 + 0.4 * pulse) * travel * fade;
        vec3 col = uColor;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createLaserFX(parts) {
  const cannonPart = parts.find((p) => p.id === "cannons");
  const beams = [];
  const flashes = [];
  const muzzleFlashTex = softCircle("rgba(220,250,255,1)", "rgba(90,190,255,0)");

  if (cannonPart && cannonPart.group.userData.muzzles) {
    cannonPart.group.userData.muzzles.forEach((m, i) => {
      const mat = makeBeamMaterial(0x9beeff);
      const len = 44;
      const geo = new THREE.CylinderGeometry(0.075, 0.055, len, 14, 1, true);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, len / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(m);
      mesh.rotation.set(-0.015, i === 0 ? 0.055 : -0.055, 0);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      cannonPart.group.add(mesh);

      // 外层辉光，让光束在 Bloom 下成形
      const haloMat = makeBeamMaterial(0x59c8ff);
      const haloGeo = new THREE.CylinderGeometry(0.24, 0.18, len, 14, 1, true);
      haloGeo.rotateX(Math.PI / 2);
      haloGeo.translate(0, 0, len / 2);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(m);
      halo.rotation.copy(mesh.rotation);
      halo.visible = false;
      halo.frustumCulled = false;
      halo.renderOrder = 8;
      cannonPart.group.add(halo);

      const flash = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: muzzleFlashTex,
          color: 0xbfefff,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        })
      );
      flash.position.copy(m);
      flash.scale.setScalar(0.001);
      flash.renderOrder = 10;
      cannonPart.group.add(flash);

      const light = new THREE.PointLight(0x9bd8ff, 0, 10, 2);
      light.position.copy(m);
      cannonPart.group.add(light);

      beams.push({ mesh, mat, halo, haloMat, flash, light, t: -1, index: i });
    });
  }

  let active = false;
  let timer = 0;
  let nextIndex = 0;

  function fire(i) {
    const b = beams[i];
    if (!b) return;
    b.t = 0;
    b.mesh.visible = true;
    b.halo.visible = true;
    b.light.intensity = 22;
  }

  function update(t, dt) {
    if (!active) {
      // 收束
      for (const b of beams) {
        b.mat.uniforms.uOpacity.value = damp(b.mat.uniforms.uOpacity.value, 0, 12, dt);
        b.haloMat.uniforms.uOpacity.value = damp(b.haloMat.uniforms.uOpacity.value, 0, 12, dt);
        b.flash.material.opacity = damp(b.flash.material.opacity, 0, 14, dt);
        b.light.intensity = damp(b.light.intensity, 0, 14, dt);
        if (b.mat.uniforms.uOpacity.value < 0.002) {
          b.mesh.visible = false;
          b.halo.visible = false;
        }
      }
      return;
    }

    timer -= dt;
    if (timer <= 0) {
      // 双管齐射
      fire(0);
      fire(1);
      nextIndex++;
      timer = 1.15 + Math.random() * 0.35;
    }

    for (const b of beams) {
      b.mat.uniforms.uTime.value = t;
      b.haloMat.uniforms.uTime.value = t;
      if (b.t < 0) continue;
      b.t += dt;
      const age = b.t;
      // 0.0-0.06 充能，0.06-0.16 满功率，0.16-0.3 衰减
      let op = 0;
      if (age < 0.09) op = age / 0.09;
      else if (age < 0.42) op = 1.0;
      else op = Math.max(0, 1 - (age - 0.42) / 0.18);
      b.mat.uniforms.uOpacity.value = op * 1.0;
      b.haloMat.uniforms.uOpacity.value = op * 0.22;

      const fs = age < 0.16 ? 1 - age / 0.16 : 0;
      b.flash.material.opacity = fs * 0.5;
      b.flash.scale.setScalar(0.25 + (1 - fs) * 1.1);
      b.light.intensity = fs * 22;

      b.mesh.scale.x = b.mesh.scale.y = 1 - Math.min(age, 0.5) * 0.25;
      if (op <= 0) {
        b.mesh.visible = false;
        b.halo.visible = false;
        b.t = -1;
      }
    }
  }

  function setActive(v) {
    active = v;
    if (!v) {
      for (const b of beams) {
        b.t = -1;
        b.mesh.visible = false;
        b.halo.visible = false;
        b.mat.uniforms.uOpacity.value = 0;
        b.haloMat.uniforms.uOpacity.value = 0;
        b.flash.material.opacity = 0;
        b.light.intensity = 0;
      }
    } else {
      timer = 0;
    }
  }

  return { update, setActive, get active() { return active; } };
}

/* ------------------------------------------------------------
   冲击波 / 剖析时的扫描环（选件时使用）
   ------------------------------------------------------------ */
export function createScanRingTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.clearRect(0, 0, S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
  grd.addColorStop(0, "rgba(255,190,90,0)");
  grd.addColorStop(0.75, "rgba(255,196,110,0.9)");
  grd.addColorStop(1, "rgba(255,150,60,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  // 刻度
  g.strokeStyle = "rgba(255,214,150,0.75)";
  g.lineWidth = 2;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r1 = S * 0.455;
    const r2 = S * 0.485;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    g.lineTo(S / 2 + Math.cos(a) * r2, S / 2 + Math.sin(a) * r2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
