/* ============================================================
   env.js — 深空环境：星云背景、星场、全息技术网格
   ============================================================ */
import * as THREE from "three";
import { starTexture } from "./textures.js";
import { mulberry32, damp } from "./util.js";

/* ------------------------------------------------------------
   星云背景（全屏球体着色器）
   ------------------------------------------------------------ */
function createBackground() {
  const geo = new THREE.SphereGeometry(400, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x060a14) },
      uBottom: { value: new THREE.Color(0x010205) },
      uNebA: { value: new THREE.Color(0x15284d) },
      uNebB: { value: new THREE.Color(0x2a1440) },
      uNebC: { value: new THREE.Color(0x0d3340) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uNebA;
      uniform vec3 uNebB;
      uniform vec3 uNebC;

      // 便宜的 3D 值噪声
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.02;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y * 0.5 + 0.5;
        vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, h));

        // 星云团块
        vec3 p = d * 1.7;
        float n1 = fbm(p * 1.3 + vec3(3.1, 1.7, 0.0));
        float n2 = fbm(p * 2.7 + vec3(9.4, 2.2, 5.5));
        float band = smoothstep(0.28, 0.9, n1) * 0.85;
        float band2 = smoothstep(0.4, 0.95, n2) * 0.5;

        col += uNebA * pow(band, 2.4) * 0.52;
        col += uNebB * pow(band2, 2.6) * 0.34;
        col += uNebC * pow(band * band2, 1.8) * 0.3;

        // 银河带
        float milky = exp(-pow((d.y * 3.4), 2.0)) * 0.07;
        col += vec3(0.16, 0.21, 0.32) * milky * (0.5 + fbm(p * 5.0) * 0.8);

        // 微弱粒尘
        float dust = pow(fbm(p * 12.0), 4.0) * 0.05;
        col += vec3(0.42, 0.52, 0.72) * dust;

        // 底部压暗
        col *= mix(0.55, 1.0, smoothstep(-0.35, 0.45, d.y));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/* ------------------------------------------------------------
   星场
   ------------------------------------------------------------ */
function createStars() {
  const COUNT = 5200;
  const positions = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  const colorArr = new Float32Array(COUNT * 3);
  const rnd = mulberry32(2026);

  for (let i = 0; i < COUNT; i++) {
    // 球壳分布
    const u = rnd() * 2 - 1;
    const theta = rnd() * Math.PI * 2;
    const r = 130 + rnd() * 170;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = Math.cos(theta) * s * r;
    positions[i * 3 + 1] = u * r;
    positions[i * 3 + 2] = Math.sin(theta) * s * r;

    sizes[i] = 0.55 + Math.pow(rnd(), 2.6) * 3.4;
    phases[i] = rnd() * Math.PI * 2;

    const t = rnd();
    // 冷白 → 淡蓝 → 暖黄
    const c =
      t < 0.55
        ? [0.82, 0.9, 1.0]
        : t < 0.85
        ? [1.0, 0.98, 0.94]
        : [1.0, 0.86, 0.68];
    colorArr[i * 3] = c[0];
    colorArr[i * 3 + 1] = c[1];
    colorArr[i * 3 + 2] = c[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colorArr, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: starTexture() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float twinkle = 0.65 + 0.35 * sin(uTime * 1.6 + aPhase * 7.0);
        vAlpha = twinkle;
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.r * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.7 + a * 0.9), a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return points;
}

/* ------------------------------------------------------------
   全息技术网格（剖析台面）
   ------------------------------------------------------------ */
function createGrid() {
  const geo = new THREE.PlaneGeometry(90, 90, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0x2fb8d8) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec3 vWorld;

      float line(vec2 p, float spacing, float w) {
        vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
        float d = min(g.x, g.y);
        return 1.0 - smoothstep(0.0, w, d);
      }

      void main() {
        vec2 p = vWorld.xz;
        float minor = line(p, 1.5, 0.035) * 0.35;
        float major = line(p, 7.5, 0.06) * 0.9;

        float dist = length(p);
        float fade = smoothstep(46.0, 6.0, dist);
        // 扫描脉冲
        float scan = 0.5 + 0.5 * sin(dist * 0.35 - uTime * 2.0);

        float a = (minor + major) * fade * uOpacity * (0.55 + scan * 0.45);
        vec3 col = uColor * (0.5 + major * 0.9);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const grid = new THREE.Mesh(geo, mat);
  grid.position.y = -6.5;
  return { grid, mat };
}

/* ------------------------------------------------------------
   工厂
   ------------------------------------------------------------ */
export function createEnvironment(scene) {
  const bg = createBackground();
  scene.add(bg);

  const stars = createStars();
  scene.add(stars);

  const { grid, mat: gridMat } = createGrid();
  scene.add(grid);

  let gridTarget = 0;
  let gridValue = 0;
  grid.visible = false;

  function update(t, dt) {
    stars.material.uniforms.uTime.value = t;
    gridMat.uniforms.uTime.value = t;

    gridValue = damp(gridValue, gridTarget, 4, dt);
    gridMat.uniforms.uOpacity.value = gridValue;
    grid.visible = gridValue > 0.01;

    // 背景随相机缓慢转动（视差）
    bg.rotation.y = t * 0.004;
  }

  function setGrid(on) {
    gridTarget = on ? 0.9 : 0;
  }

  return { update, setGrid, get gridOn() { return gridTarget > 0; } };
}
