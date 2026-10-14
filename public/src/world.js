// Builds the alley: brick buildings, windows, fire escapes, props, snow, lights, sky.
// Everything visual is derived from /shared/map.js so it lines up with the collision boxes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, PROPS, LAMPS, FIRE, NEON, STEAM, BAYS, FLOOR_H } from '../shared/map.js';
import * as T from './textures.js';

const FOG_COLOR = 0x39343f;
const LAMP_CD = 210, HALO = 0.24;
const SNOW_COLOR = new THREE.Color(0.9, 0.93, 0.98);

// ------------------------------------------------------------------ small helpers
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function n2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z); let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const n1 = (x) => n2(x, 7.31);

function boxUV(w, h, d, tu, tv) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tu, uv.getY(k) * dims[f][1] / tv); }
  return g;
}

function taperBox(w, h, d, topW, topD, shiftZ = 0) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * topW / w); p.setZ(i, p.getZ(i) * topD / d + shiftZ); }
  g.computeVertexNormals();
  return g;
}

// A slab of settled snow: rounded shoulders, lumpy top.
function snowCap(w, d, thick, seed = 0) {
  const sx = Math.max(2, Math.min(24, Math.round(w / 0.22))), sz = Math.max(2, Math.min(24, Math.round(d / 0.22)));
  const g = new THREE.BoxGeometry(w, thick, d, sx, 1, sz), p = g.attributes.position;
  const edge = Math.min(0.16, Math.min(w, d) * 0.3);
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) <= 0) continue;
    const x = p.getX(i), z = p.getZ(i);
    let k = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)) / edge;
    k = Math.min(1, Math.max(0, k)); const s = k * k * (3 - 2 * k);
    p.setY(i, -thick / 2 + thick * (0.16 + 0.84 * s) + s * (n2(x * 3 + seed, z * 3 - seed) - 0.5) * thick * 0.5);
  }
  g.computeVertexNormals();
  return g;
}

function addVarying(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;');
}

// View-dependent ice-crystal glints, scaled by how much light is actually landing there.
const GLINT = `
  {
    vec3 gv = normalize(vViewPosition);
    vec3 gp = floor(vWp * 70.0) + floor(gv * 9.0);
    float gh = fract(sin(dot(gp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float glint = smoothstep(0.9968, 1.0, gh) * GLINT_MASK;
    gl_FragColor.rgb += gl_FragColor.rgb * glint * 14.0;
  }
`;

function snowMaterial(set, repeat) {
  const map = set.map.clone(), nm = set.normalMap.clone();
  map.repeat.set(repeat, repeat); nm.repeat.set(repeat, repeat); map.needsUpdate = nm.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color: SNOW_COLOR, map, normalMap: nm, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    addVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', GLINT.replace('GLINT_MASK', '1.0') + '\n#include <tonemapping_fragment>');
  };
  return m;
}

function brickMaterial(set, grime) {
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.3, 1.3) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime };
    addVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uGrime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float gr = texture2D(uGrime, vec2((vWp.x + vWp.z) * 0.045, vWp.y * 0.045)).r;
        diffuseColor.rgb *= mix(0.42, 1.14, gr);
        float splash = smoothstep(1.4, 0.0, vWp.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3(0.045), splash * 0.55);
        float cling = smoothstep(0.42, 0.04, vWp.y + (gr - 0.5) * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), cling * 0.88);`);
  };
  return m;
}

function groundMaterial(set, mask) {
  const map = set.map.clone(), nm = set.normalMap.clone();
  map.repeat.set(56, 64); nm.repeat.set(56, 64); map.needsUpdate = nm.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color: SNOW_COLOR, map, normalMap: nm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.84, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = { value: mask };
    addVarying(sh);
    const R = T.MASK_RECT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;\nfloat gWet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 muv = vec2((vWp.x - (${R.x0.toFixed(1)})) / ${R.w.toFixed(1)}, 1.0 - (vWp.z - (${R.z0.toFixed(1)})) / ${R.d.toFixed(1)});
        float mraw = texture2D(uMask, muv).r;
        float brk = texture2D(map, vWp.xz * 0.9).g;
        gWet = smoothstep(0.5, 0.92, mraw + (brk - 0.92) * 1.1);
        float slush = smoothstep(0.1, 0.5, mraw) * (1.0 - gWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.44, 0.45, 0.48), slush * 0.72);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.057, 0.064), gWet * 0.9);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.10, gWet);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, gWet * 0.9));')
      .replace('#include <tonemapping_fragment>', GLINT.replace('GLINT_MASK', '(1.0 - gWet)') + '\n#include <tonemapping_fragment>');
  };
  return m;
}

// ------------------------------------------------------------------ world
export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.lamps = [];
    this.fireLight = null;
    this.neonLight = null;
    this.time = 0;
    this.B = {};            // geometry buckets, merged per material at the end

    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.017);
    this.buildSky();
    this.buildMaterials();
    this.buildGround();
    this.buildBuildings();
    this.buildProps();
    this.buildDressing();
    this.buildBackdrop();
    this.flush();
    this.buildLights();
    this.setQuality(quality);
  }

  add(key, geo) { (this.B[key] || (this.B[key] = [])).push(geo); return geo; }
  box(key, w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(key, g); }
  cap(w, d, thick, x, y, z, seed = 0, ry = 0) { const g = snowCap(w, d, thick, seed); if (ry) g.rotateY(ry); g.translate(x, y + thick / 2, z); return this.add('snow', g); }

  flush() {
    for (const key of Object.keys(this.B)) {
      const mat = this.M[key];
      if (!mat) { console.warn('no material for bucket', key); continue; }
      const geo = mergeGeometries(this.B[key], false);
      if (!geo) { console.warn('merge failed for', key); continue; }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !mat.userData.noShadow; mesh.receiveShadow = true;
      mesh.name = key;
      this.scene.add(mesh);
      for (const g of this.B[key]) g.dispose();
    }
    this.B = {};
  }

  // ---------------------------------------------------------------- sky + env
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uHorizon: { value: new THREE.Color(0x5a4a4c) }, uZenith: { value: new THREE.Color(0x191b28) }, uFog: { value: new THREE.Color(FOG_COLOR) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uHorizon, uZenith, uFog; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float t = pow(clamp(d.y, 0.0, 1.0), 0.45);
          vec3 c = mix(uHorizon, uZenith, t);
          // low cloud deck lit from below by the city
          float cl = n(d.xz / (abs(d.y) + 0.25) * 2.2) * 0.6 + n(d.xz / (abs(d.y) + 0.25) * 5.0) * 0.4;
          c += vec3(0.16, 0.11, 0.09) * smoothstep(0.42, 0.85, cl) * (1.0 - t) * 0.9;
          c = mix(uFog, c, smoothstep(-0.02, 0.22, d.y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), mat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    // image-based ambient + reflections from the same sky
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, mat));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(envScene, 0, 1, 1000).texture;
    this.scene.environmentIntensity = 0.95;
    pmrem.dispose();
  }

  buildMaterials() {
    const grime = T.grimeTex(), snow = T.snowSet(), conc = T.concreteSet(), wood = T.woodSet();
    this.snowSet = snow;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = this.M = {};
    for (let i = 0; i < 3; i++) M['brick' + i] = brickMaterial(T.brickSet(i), grime);
    M.snow = snowMaterial(snow, 2.2);
    M.stone = std({ map: conc.map, normalMap: conc.normalMap, color: 0xb9b4aa, roughness: 0.92 });
    M.concrete = std({ map: conc.map, normalMap: conc.normalMap, color: 0x9a9a9c, roughness: 0.9 });
    M.iron = std({ color: 0x17181a, roughness: 0.62, metalness: 0.75 });
    M.crate = std({ map: wood.map, normalMap: wood.normalMap, roughness: 0.86 });
    M.wood = std({ map: wood.map, normalMap: wood.normalMap, color: 0xb8a58a, roughness: 0.9 });
    M.dumpster0 = std({ map: T.paintedMetal([46, 92, 60], 301), roughness: 0.6, metalness: 0.45 });
    M.dumpster1 = std({ map: T.paintedMetal([44, 72, 112], 302), roughness: 0.6, metalness: 0.45 });
    M.barrel = std({ map: T.paintedMetal([120, 44, 36], 303, false), roughness: 0.55, metalness: 0.5 });
    M.burnt = std({ map: T.paintedMetal([40, 34, 30], 304, false), roughness: 0.8, metalness: 0.4 });
    M.van = std({ map: T.paintedMetal([176, 178, 176], 305, false), roughness: 0.5, metalness: 0.35 });
    M.plastic = std({ color: 0x101113, roughness: 0.55, metalness: 0.05 });
    M.rubber = std({ color: 0x0b0b0c, roughness: 0.9 });
    M.chrome = std({ color: 0xaab0b6, roughness: 0.25, metalness: 0.95 });
    M.carglass = std({ color: 0x06080b, roughness: 0.06, metalness: 0.85, envMapIntensity: 1.6 });
    M.car0 = std({ color: 0x1b2c4a, roughness: 0.32, metalness: 0.65 });
    M.car1 = std({ color: 0x5a1a1c, roughness: 0.32, metalness: 0.65 });
    M.car2 = std({ color: 0x74787c, roughness: 0.34, metalness: 0.7 });
    M.door = std({ color: 0x2b3a34, roughness: 0.55, metalness: 0.5 });
    M.garage = std({ map: T.corrugatedTex(), roughness: 0.5, metalness: 0.7 });
    M.ac = std({ color: 0x8b9096, roughness: 0.55, metalness: 0.6 });
    M.ammo = std({ map: T.ammoTex(), roughness: 0.7, metalness: 0.2 });
    M.hazard = std({ color: 0xc79a1e, roughness: 0.7 });
    M.far = std({ color: 0x06080b, roughness: 1, emissive: 0xffffff, emissiveMap: T.farWindowsTex(), emissiveIntensity: 0.45 });
    M.far.emissiveMap.repeat.set(2.2, 1.3); M.far.userData.noShadow = true;
    M.taillight = std({ color: 0x3a0606, roughness: 0.3, emissive: 0x220000 });
    const fence = T.chainlinkTex(); fence.repeat.set(1, 1);
    M.fence = std({ map: fence, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 });
  }

  // ---------------------------------------------------------------- ground
  buildGround() {
    const g = new THREE.PlaneGeometry(168, 192, 168, 192);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (n2(p.getX(i) * 0.35, p.getZ(i) * 0.35) - 0.5) * 0.045);
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, groundMaterial(this.snowSet, T.groundMask()));
    ground.receiveShadow = true; ground.position.y = -0.012; ground.name = 'ground';
    this.scene.add(ground);
  }

  // ---------------------------------------------------------------- buildings
  insideBuilding(x, y, z) {
    for (const b of BUILDINGS) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.h) return true;
    return false;
  }

  faces(b) {
    // [ax, az, bx, bz, nx, nz]
    return [
      [b.x0, b.z0, b.x1, b.z0, 0, -1], [b.x1, b.z1, b.x0, b.z1, 0, 1],
      [b.x1, b.z0, b.x1, b.z1, 1, 0], [b.x0, b.z1, b.x0, b.z0, -1, 0],
    ];
  }

  buildBuildings() {
    const r = T.rng(2024);
    const litM = [[], [], []], darkM = [], surroundM = [], sillSnowM = [], icicleM = [], acM = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const xf = (x, y, z, ry, sx = 1, sy = 1, sz = 1) => { q.setFromAxisAngle(up, ry); return new THREE.Matrix4().compose(v.set(x, y, z), q, s1.clone().set(sx, sy, sz)); };

    for (const b of BUILDINGS) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.h - b.y0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const g = boxUV(w, h, d, T.BRICK_TILE.w, T.BRICK_TILE.h); g.translate(cx, b.y0 + h / 2, cz);
      this.add('brick' + b.style, g);

      // roof: snow field + stone parapet with its own snow
      this.box('snow', w - 0.5, 0.14, d - 0.5, cx, b.h + 0.02, cz);
      for (const [pw, pd, px, pz] of [[w + 0.12, 0.34, cx, b.z0 + 0.14], [w + 0.12, 0.34, cx, b.z1 - 0.14], [0.34, d + 0.12, b.x0 + 0.14, cz], [0.34, d + 0.12, b.x1 - 0.14, cz]]) {
        this.box('stone', pw, 0.34, pd, px, b.h + 0.17, pz);
        this.box('snow', pw - 0.06, 0.09, pd - 0.06, px, b.h + 0.385, pz);
      }
      if (b.y0 === 0 && w > 9 && d > 9) {          // rooftop clutter for the skyline
        const n = 1 + ((r() * 3) | 0);
        for (let i = 0; i < n; i++) {
          const x = b.x0 + 2 + r() * (w - 4), z = b.z0 + 2 + r() * (d - 4), kind = r();
          if (kind < 0.4) { this.box('brick' + b.style, 0.9, 1.8, 0.9, x, b.h + 0.9, z); this.box('snow', 0.96, 0.1, 0.96, x, b.h + 1.85, z); }
          else if (kind < 0.75) { this.box('ac', 1.8, 1.1, 1.3, x, b.h + 0.6, z); this.box('snow', 1.7, 0.1, 1.2, x, b.h + 1.2, z); }
          else { const tk = new THREE.CylinderGeometry(1.2, 1.2, 2.2, 14); tk.translate(x, b.h + 2.6, z); this.add('wood', tk); const cn = new THREE.ConeGeometry(1.35, 0.8, 14); cn.translate(x, b.h + 4.1, z); this.add('snow', cn); for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) this.box('iron', 0.1, 1.5, 0.1, x + ox, b.h + 0.75, z + oz); }
        }
      }

      // windows on every face that looks onto open air
      for (const [ax, az, bx, bz, nx, nz] of this.faces(b)) {
        if (Math.abs(nx ? ax : az) >= (nx ? 34 : 44) - 0.01) continue;     // outer shell, never seen
        const len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(nx, nz);
        const n = Math.floor((len - 1.4) / 2.7);
        if (n < 1) continue;
        const start = (len - (n - 1) * 2.7) / 2;
        for (let c = 0; c < n; c++) {
          const t = (start + c * 2.7) / len, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
          for (let f = 0; f < 6; f++) {
            const cy = 2.0 + FLOOR_H * f;
            if (cy + 1.5 > b.h || cy - 1.1 < b.y0) continue;
            if (this.insideBuilding(px + nx * 0.7, cy, pz + nz * 0.7)) continue;
            if (f === 0 && r() < 0.72) continue;
            if (LAMPS.some((l) => Math.hypot(l.x - px, l.z - pz) < 1.7 && Math.abs(l.y - cy) < 1.8)) continue;
            if (Math.hypot(NEON.x - px, NEON.z - pz) < 2.2 && f <= 1) continue;
            const lit = f > 0 && r() < 0.23;
            const gm = xf(px + nx * 0.035, cy, pz + nz * 0.035, ry);
            if (lit) litM[(r() * 3) | 0].push(gm); else darkM.push(gm);
            surroundM.push(xf(px, cy, pz, ry));
            sillSnowM.push(xf(px + nx * 0.12, cy - 0.86, pz + nz * 0.12, ry, 1, 0.7 + r() * 0.7, 1));
            if (r() < 0.3) for (let k = 0; k < 4; k++) { const o = (r() - 0.5) * 1.1, sc = 0.5 + r() * 1.3; icicleM.push(xf(px + nx * 0.2 + (bx - ax) / len * o, cy - 1.0 - 0.15 * sc, pz + nz * 0.2 + (bz - az) / len * o, 0, 1, sc, 1)); }
            if (f > 0 && !lit && r() < 0.09) acM.push(xf(px + nx * 0.3, cy - 0.55, pz + nz * 0.3, ry));
          }
        }
        // drainpipe near one end
        const ex = ax + (bx - ax) * (0.7 / len), ez = az + (bz - az) * (0.7 / len);
        if (b.y0 === 0 && len > 6 && !this.insideBuilding(ex + nx * 0.5, 1.2, ez + nz * 0.5) && !this.insideBuilding(ex + nx * 0.5, b.h - 1, ez + nz * 0.5)) {
          const pipe = new THREE.CylinderGeometry(0.065, 0.065, b.h - 0.5, 8); pipe.translate(ex + nx * 0.11, (b.h - 0.5) / 2 + 0.25, ez + nz * 0.11); this.add('iron', pipe);
          for (let y = 1.2; y < b.h - 1; y += 2.6) this.box('iron', 0.2, 0.05, 0.2, ex + nx * 0.1, y, ez + nz * 0.1);
        }
        if (b.y0 === 0) this.buildDrifts(ax, az, bx, bz, nx, nz);
      }
    }

    const inst = (geo, mat, mats, shadow = false) => {
      if (!mats.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere(); this.scene.add(im); return im;
    };
    const pane = new THREE.PlaneGeometry(1.06, 1.72);
    this.litWindows = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: T.windowTex(i), color: new THREE.Color(1.7, 1.55, 1.4) });
      const im = inst(pane, mat, litM[i]); if (im) this.litWindows.push(im);
    }
    inst(pane, new THREE.MeshStandardMaterial({ map: T.windowTex(3), roughness: 0.07, metalness: 0.7, envMapIntensity: 1.8 }), darkM);
    const surround = mergeGeometries([
      new THREE.BoxGeometry(1.36, 0.1, 0.24).translate(0, -0.91, 0.06),      // sill
      new THREE.BoxGeometry(1.36, 0.24, 0.09).translate(0, 0.98, 0.02),      // lintel
      new THREE.BoxGeometry(0.08, 1.74, 0.1).translate(-0.57, 0, 0.02),
      new THREE.BoxGeometry(0.08, 1.74, 0.1).translate(0.57, 0, 0.02),
    ]);
    inst(surround, this.M.stone, surroundM, true);
    inst(snowCap(1.3, 0.2, 0.09, 3).translate(0, 0.045, 0), this.M.snow, sillSnowM);
    inst(new THREE.ConeGeometry(0.028, 0.3, 5).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xd4e6ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72, envMapIntensity: 2.2 }), icicleM);
    const acGeo = mergeGeometries([new THREE.BoxGeometry(0.85, 0.55, 0.55), new THREE.BoxGeometry(0.7, 0.4, 0.03).translate(0, 0, 0.29)]);
    inst(acGeo, this.M.ac, acM, true);
    inst(snowCap(0.83, 0.53, 0.1, 9).translate(0, 0.33, 0), this.M.snow, acM);
  }

  // Wind-packed snow slumped against the foot of a wall.
  buildDrifts(ax, az, bx, bz, nx, nz) {
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const free = (t) => {
      const x = ax + dx * t + nx * 0.35, z = az + dz * t + nz * 0.35;
      if (Math.abs(x) > 33.5 || Math.abs(z) > 43.5) return false;
      for (const b of BUILDINGS) if (b.y0 === 0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return false;
      return true;
    };
    let run = -1;
    for (let t = 0; t <= len + 0.5; t += 0.5) {
      const ok = t <= len && free(Math.min(t, len - 0.01));
      if (ok && run < 0) run = t;
      if (!ok && run >= 0) { if (t - 0.5 - run > 1) this.add('snow', this.drift(ax + dx * run, az + dz * run, ax + dx * (t - 0.5), az + dz * (t - 0.5), nx, nz)); run = -1; }
    }
  }

  drift(ax, az, bx, bz, nx, nz) {
    const len = Math.hypot(bx - ax, bz - az), N = Math.max(2, Math.ceil(len / 0.45)), K = 5, seed = ax * 3.1 + az * 1.7;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const end = Math.min(1, Math.min(t, 1 - t) * len / 0.9);
      const h = (0.12 + 0.36 * n1(seed + t * len * 0.33)) * (0.3 + 0.7 * end);
      const w = (0.38 + 0.75 * n1(seed + 50 + t * len * 0.21)) * (0.5 + 0.5 * end);
      for (let k = 0; k <= K; k++) {
        const u = k / K;
        pos.push(px + nx * w * u, k === K ? -0.02 : h * Math.pow(1 - u, 1.6), pz + nz * w * u);
        uv.push(t * len / 2, u);
      }
    }
    const flip = ((bx - ax) * nz - (bz - az) * nx) < 0;
    for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) {
      const a = i * (K + 1) + k, b = a + 1, c = a + K + 1, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // ---------------------------------------------------------------- props
  buildProps() {
    let seed = 1;
    for (const p of PROPS) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, y0 = p.y0, h = p.h;
      seed += 1.37;
      switch (p.t) {
        case 'crate': {
          const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, y0 + h / 2, cz); this.add('crate', g);
          this.cap(w - 0.03, d - 0.03, 0.09, cx, y0 + h - 0.01, cz, seed);
          break;
        }
        case 'pallets': {
          const n = Math.round(h / 0.15);
          for (let i = 0; i < n; i++) {
            const y = i * 0.15;
            this.box('wood', w, 0.03, d, cx, y + 0.135, cz);
            for (const o of [-0.45, 0, 0.45]) this.box('wood', 0.1, 0.1, d, cx + o * w, y + 0.07, cz);
            this.box('wood', w, 0.02, d * 0.9, cx, y + 0.01, cz);
          }
          this.cap(w - 0.02, d - 0.02, 0.1, cx, h - 0.01, cz, seed);
          break;
        }
        case 'barrier': {
          const along = p.axis === 'x';
          const g = along ? taperBox(w, h, d, w, d * 0.42) : taperBox(w, h, d, w * 0.42, d);
          const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (along ? w : d) / 1.5, uv.getY(i));
          g.translate(cx, h / 2, cz); this.add('concrete', g);
          this.cap(along ? w - 0.04 : w * 0.4, along ? d * 0.4 : d - 0.04, 0.07, cx, h - 0.01, cz, seed);
          this.box('hazard', along ? w * 0.9 : 0.02, 0.1, along ? 0.02 : d * 0.9, cx + (along ? 0 : w * 0.36), 0.42, cz + (along ? d * 0.36 : 0));
          break;
        }
        case 'lowwall': {
          const g = boxUV(w, h - 0.1, d, T.BRICK_TILE.w, T.BRICK_TILE.h); g.translate(cx, (h - 0.1) / 2, cz); this.add('brick1', g);
          this.box('stone', w + 0.08, 0.1, d + 0.08, cx, h - 0.05, cz);
          this.cap(w + 0.04, d + 0.04, 0.1, cx, h - 0.01, cz, seed);
          break;
        }
        case 'dumpster': {
          const key = 'dumpster' + (p.color || 0), along = p.axis === 'x';
          const body = taperBox(w - 0.06, h - 0.2, d - 0.06, w - 0.06, d - 0.06); body.translate(cx, 0.12 + (h - 0.2) / 2, cz); this.add(key, body);
          this.box(key, w, 0.07, d, cx, h - 0.115, cz);                                     // rim
          this.box('plastic', along ? w / 2 - 0.02 : w - 0.03, 0.05, along ? d - 0.03 : d / 2 - 0.02, cx - (along ? w / 4 : 0), h - 0.05, cz - (along ? 0 : d / 4));
          this.box('plastic', along ? w / 2 - 0.02 : w - 0.03, 0.05, along ? d - 0.03 : d / 2 - 0.02, cx + (along ? w / 4 : 0), h - 0.045, cz + (along ? 0 : d / 4));
          for (const s of [-1, 1]) {                                                         // fork pockets + casters
            this.box(key, along ? 0.5 : 0.09, 0.2, along ? 0.09 : 0.5, cx + (along ? 0 : s * (w / 2 + 0.03)), 0.85, cz + (along ? s * (d / 2 + 0.03) : 0));
            for (const e of [-1, 1]) { const wh = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10); wh.rotateZ(Math.PI / 2); if (along) wh.rotateY(Math.PI / 2); wh.translate(cx + (along ? e * (w / 2 - 0.2) : s * (w / 2 - 0.12)), 0.07, cz + (along ? s * (d / 2 - 0.12) : e * (d / 2 - 0.2))); this.add('rubber', wh); }
          }
          this.cap(w - 0.05, d - 0.05, 0.13, cx, h - 0.03, cz, seed);
          break;
        }
        case 'barrel':
        case 'firebarrel': {
          const fire = p.t === 'firebarrel', key = fire ? 'burnt' : 'barrel';
          const g = new THREE.CylinderGeometry(0.29, 0.29, h, 18, 1, fire); g.translate(cx, h / 2, cz); this.add(key, g);
          for (const y of [0.02, h * 0.34, h * 0.67, h - 0.02]) { const ring = new THREE.CylinderGeometry(0.305, 0.305, 0.035, 18, 1, true); ring.translate(cx, y, cz); this.add(key, ring); }
          if (!fire) { const sc = snowCap(0.5, 0.5, 0.1, seed); sc.translate(cx, h + 0.04, cz); this.add('snow', sc); }
          break;
        }
        case 'car': this.buildCar(p, cx, cz, w, d, seed); break;
        case 'van': this.buildVan(p, cx, cz, w, d, seed); break;
        case 'dock': {
          const g = boxUV(w, h, d, 2, 2); g.translate(cx, h / 2, cz); this.add('concrete', g);
          this.box('hazard', 0.03, 0.14, d, p.x0 - 0.01, h - 0.07, cz);
          this.box('hazard', w, 0.14, 0.03, cx, h - 0.07, p.z1 + 0.01);
          for (let z = p.z0 + 0.8; z < p.z1; z += 1.4) this.box('rubber', 0.1, 0.5, 0.3, p.x0 - 0.05, h - 0.4, z);
          this.cap(w - 0.1, d - 0.1, 0.035, cx, h - 0.005, cz, seed);
          break;
        }
        case 'step': {
          const g = boxUV(w, h, d, 2, 2); g.translate(cx, h / 2, cz); this.add('concrete', g);
          this.box('snow', w - 0.04, 0.02, d - 0.04, cx, h + 0.005, cz);
          break;
        }
        case 'ammo': {
          const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, y0 + h / 2, cz); this.add('ammo', g);
          this.box('iron', w + 0.02, 0.04, 0.05, cx, y0 + h * 0.72, p.z1 + 0.01);
          for (const s of [-1, 1]) this.box('iron', 0.05, 0.12, 0.03, cx + s * w * 0.3, y0 + h * 0.72, p.z1 + 0.025);
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex(), color: 0x5dff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
          glow.scale.setScalar(0.7); glow.position.set(cx, y0 + h + 0.18, cz); this.scene.add(glow);
          const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 6, 2.5) }));
          led.position.set(cx, y0 + h + 0.03, cz); this.scene.add(led);
          break;
        }
        case 'fence': {
          const along = p.axis === 'x', len = along ? w : d;
          const g = new THREE.PlaneGeometry(len, h); const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.11, uv.getY(i) * h / 0.11);
          if (!along) g.rotateY(Math.PI / 2);
          g.translate(cx, h / 2, cz); this.add('fence', g);
          for (let t = 0; t <= len + 0.01; t += len / 4) { const post = new THREE.CylinderGeometry(0.045, 0.045, h + 0.15, 8); post.translate(along ? p.x0 + t : cx, (h + 0.15) / 2, along ? cz : p.z0 + t); this.add('chrome', post); }
          const rail = new THREE.CylinderGeometry(0.035, 0.035, len, 8); rail.rotateZ(Math.PI / 2); if (!along) rail.rotateY(Math.PI / 2); rail.translate(cx, h, cz); this.add('chrome', rail);
          this.cap(along ? len : 0.1, along ? 0.1 : len, 0.06, cx, h + 0.03, cz, seed);
          break;
        }
      }
    }
  }

  buildCar(p, cx, cz, w, d, seed) {
    const along = p.axis === 'z', L = along ? d : w, W = along ? w : d, paint = 'car' + (p.color || 0);
    const ry = along ? 0 : Math.PI / 2;
    const put = (key, g, x, y, z) => { g.translate(x, y, z); if (ry) g.rotateY(ry); g.translate(cx, 0, cz); this.add(key, g); };
    // local frame: length along z, front at -z
    put(paint, taperBox(W, 0.36, L, W * 0.97, L * 0.985), 0, 0.46, 0);
    put(paint, taperBox(W * 0.97, 0.28, L * 0.985, W * 0.9, L * 0.95), 0, 0.78, 0);
    const c0 = -L / 2 + 0.30 * L, c1 = -L / 2 + 0.74 * L, cl = c1 - c0;
    put('carglass', taperBox(W - 0.16, 0.5, cl, W - 0.42, cl * 0.72, 0.04), 0, 0.92 + 0.25, (c0 + c1) / 2);
    put(paint, new THREE.BoxGeometry(W - 0.4, 0.05, cl * 0.74), 0, 1.44, (c0 + c1) / 2 + 0.04);
    for (const sx of [-1, 1]) for (const sz of [-0.32, 0.31]) {
      const wh = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18); wh.rotateZ(Math.PI / 2); put('rubber', wh, sx * (W / 2 - 0.1), 0.33, sz * L);
      const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 12); hub.rotateZ(Math.PI / 2); put('chrome', hub, sx * (W / 2 + 0.005), 0.33, sz * L);
    }
    put('plastic', new THREE.BoxGeometry(W + 0.04, 0.16, 0.14), 0, 0.36, -L / 2 + 0.03);
    put('plastic', new THREE.BoxGeometry(W + 0.04, 0.16, 0.14), 0, 0.36, L / 2 - 0.03);
    for (const sx of [-1, 1]) {
      put('chrome', new THREE.BoxGeometry(0.34, 0.11, 0.04), sx * (W / 2 - 0.3), 0.66, -L / 2 + 0.005);
      put('taillight', new THREE.BoxGeometry(0.36, 0.11, 0.04), sx * (W / 2 - 0.3), 0.72, L / 2 - 0.005);
    }
    // a night's worth of snow on every horizontal panel
    const capAt = (cw, cd, th, y, z, s) => { const g = snowCap(cw, cd, th, s); g.translate(0, y + th / 2, z); if (ry) g.rotateY(ry); g.translate(cx, 0, cz); this.add('snow', g); };
    capAt(W - 0.14, 0.30 * L - 0.1, 0.12, 0.91, -L / 2 + 0.15 * L, seed);
    capAt(W - 0.14, 0.26 * L - 0.1, 0.12, 0.91, L / 2 - 0.13 * L, seed + 2);
    capAt(W - 0.42, cl * 0.72, 0.15, 1.455, (c0 + c1) / 2 + 0.04, seed + 4);
  }

  buildVan(p, cx, cz, w, d, seed) {
    const L = d, W = w, H = p.h;
    const put = (key, g, x, y, z) => { g.translate(cx + x, y, cz + z); this.add(key, g); };
    // cargo box to the south, cab facing north (-z)
    put('van', boxUV(W, H - 0.4, L * 0.7, 2, 2), 0, 0.4 + (H - 0.4) / 2, L * 0.15);
    put('van', new THREE.BoxGeometry(W - 0.04, 0.85, L * 0.3), 0, 0.4 + 0.425, -L * 0.35);
    put('carglass', taperBox(W - 0.1, H - 1.3, L * 0.3, W - 0.2, L * 0.16, L * 0.07), 0, 1.25 + (H - 1.3) / 2, -L * 0.35);
    put('van', new THREE.BoxGeometry(W - 0.18, 0.06, L * 0.2), 0, H - 0.04, -L * 0.28);
    for (const sx of [-1, 1]) for (const sz of [-0.33, 0.3]) {
      const wh = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 18); wh.rotateZ(Math.PI / 2); put('rubber', wh, sx * (W / 2 - 0.12), 0.38, sz * L);
    }
    put('plastic', new THREE.BoxGeometry(W + 0.04, 0.2, 0.16), 0, 0.42, -L / 2 + 0.04);
    put('plastic', new THREE.BoxGeometry(W + 0.04, 0.2, 0.16), 0, 0.42, L / 2 - 0.04);
    put('plastic', new THREE.BoxGeometry(0.03, H - 0.7, 0.03), 0, 0.5 + (H - 0.7) / 2, L / 2 + 0.001);
    const cap = snowCap(W - 0.1, L * 0.7 - 0.1, 0.16, seed); cap.translate(cx, H + 0.07, cz + L * 0.15); this.add('snow', cap);
    const cap2 = snowCap(W - 0.2, L * 0.26, 0.1, seed + 1); cap2.translate(cx, 1.27, cz - L * 0.4); this.add('snow', cap2);
  }

  // ---------------------------------------------------------------- set dressing
  wallItem(x, z, nx, nz, build) {
    // build(put) where put(key, geo, along, y, out) places geometry in wall-local space
    const ry = Math.atan2(nx, nz);
    build((key, g, along, y, out) => { g.translate(along, y, out); g.rotateY(ry); g.translate(x, 0, z); this.add(key, g); });
  }

  buildDressing() {
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // --- back doors
    const doors = [[-4, -15, 1, 0], [4, 24.6, -1, 0], [-6.5, 22, 0, -1], [-13.5, 3, 0, -1], [20, -15.5, -1, 0], [-8, -32, 1, 0], [8, 32, -1, 0], [-22, -7, 0, 1], [22, 7, 0, -1]];
    this.doorLights = [];
    for (const [x, z, nx, nz] of doors) {
      this.wallItem(x, z, nx, nz, (put) => {
        put('door', B(1.0, 2.1, 0.07), 0, 1.05, 0.03);
        put('stone', B(1.24, 0.14, 0.14), 0, 2.2, 0.05);
        put('stone', B(0.12, 2.14, 0.14), -0.56, 1.07, 0.05); put('stone', B(0.12, 2.14, 0.14), 0.56, 1.07, 0.05);
        put('chrome', B(0.04, 0.16, 0.05), 0.38, 1.05, 0.08);
        put('concrete', B(1.5, 0.12, 0.6), 0, 0.06, 0.3);
        put('snow', snowCap(1.3, 0.2, 0.08, x), 0, 2.31, 0.06);
        put('iron', B(0.16, 0.2, 0.18), 0, 2.52, 0.09);
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 0.3) }));
      bulb.position.set(x + nx * 0.14, 2.42, z + nz * 0.14); this.scene.add(bulb);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex(), color: 0xff4a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
      halo.scale.setScalar(1.1); halo.position.copy(bulb.position); this.scene.add(halo);
    }
    // garage shutter at the back of bay G
    this.wallItem(10.5, -28, 0, 1, (put) => { const g = boxUV(4.2, 2.9, 0.08, 1, 1); put('garage', g, 0, 1.45, 0.04); put('iron', B(4.5, 0.25, 0.2), 0, 3.0, 0.08); });

    // --- fire escapes
    const escapes = [[-4, -9, 1, 0, 2], [4, 25, -1, 0, 4], [23, -3, 0, 1, 3], [-20, 3, 0, -1, 3], [4, -33, -1, 0, 3]];
    for (const [x, z, nx, nz, floors] of escapes) {
      this.wallItem(x, z, nx, nz, (put) => {
        for (let f = 1; f <= floors; f++) {
          const y = 0.3 + FLOOR_H * f;
          put('iron', B(2.7, 0.05, 0.95), 0, y, 0.5);
          put('snow', snowCap(2.6, 0.85, 0.07, x + f), 0, y + 0.06, 0.5);
          for (const ry of [0.55, 1.05]) { put('iron', B(2.7, 0.04, 0.04), 0, y + ry, 0.96); put('iron', B(0.04, 0.04, 0.95), -1.33, y + ry, 0.5); put('iron', B(0.04, 0.04, 0.95), 1.33, y + ry, 0.5); }
          for (const ax of [-1.33, -0.44, 0.44, 1.33]) put('iron', B(0.04, 1.05, 0.04), ax, y + 0.52, 0.96);
          for (const ax of [-1.2, 1.2]) put('iron', B(0.06, 0.06, 0.9), ax, y - 0.06, 0.48);
          // ladder up to the next landing (or the drop ladder at the bottom)
          const top = f < floors ? y + FLOOR_H : y, bot = f < floors ? y : 2.45, lx = f % 2 ? 0.95 : -0.95;
          if (f < floors || f === 1) {
            const b0 = f === 1 && floors === 1 ? 2.45 : bot;
            put('iron', B(0.04, top - b0, 0.04), lx - 0.2, (top + b0) / 2, 0.82); put('iron', B(0.04, top - b0, 0.04), lx + 0.2, (top + b0) / 2, 0.82);
            for (let ry = b0 + 0.2; ry < top; ry += 0.3) put('iron', B(0.4, 0.03, 0.03), lx, ry, 0.82);
          }
          if (f === 1) { put('iron', B(0.04, y - 2.45, 0.04), -1.15, (y + 2.45) / 2, 0.9); put('iron', B(0.04, y - 2.45, 0.04), -0.75, (y + 2.45) / 2, 0.9); for (let ry = 2.6; ry < y; ry += 0.3) put('iron', B(0.4, 0.03, 0.03), -0.95, ry, 0.9); }
        }
      });
    }

    // --- neon sign
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshBasicMaterial({ map: T.neonTex(), transparent: true, color: new THREE.Color(2.6, 2.6, 2.6), depthWrite: false }));
    neon.position.set(NEON.x, NEON.y, NEON.z); neon.rotation.y = Math.PI; this.scene.add(neon); this.neon = neon;
    this.box('iron', 2.5, 1.3, 0.08, NEON.x, NEON.y, NEON.z + 0.09);
    this.box('snow', 2.5, 0.08, 0.16, NEON.x, NEON.y + 0.69, NEON.z + 0.06);

    // --- graffiti + posters
    const tags = [[-4, 1.5, 6.5, 1, 0, 2.6, 1.3, 11], [4, 1.4, -6.5, -1, 0, 2.2, 1.1, 23], [-17, 1.5, -3, 0, 1, 2.8, 1.4, 37], [12, 1.6, -10, 0, -1, 2.4, 1.2, 51], [-13, 1.5, 18, 1, 0, 2.2, 1.1, 64], [16.5, 1.4, 3, 0, -1, 2.4, 1.2, 78], [-4, 1.5, 29, 1, 0, 2.2, 1.1, 91]];
    for (const [x, y, z, nx, nz, w, h, sd] of tags) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: T.graffitiTex(sd), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(x + nx * 0.012, y, z + nz * 0.012); m.rotation.y = Math.atan2(nx, nz); m.receiveShadow = true; this.scene.add(m);
    }

    // --- string lights across the south alley
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-4, 6.3, 5.5), new THREE.Vector3(-1.3, 5.5, 6.4), new THREE.Vector3(1.4, 5.45, 7.3), new THREE.Vector3(4, 6.2, 8.2)]);
    this.add('iron', new THREE.TubeGeometry(curve, 24, 0.012, 4));
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.0, 0.9) }), 13);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 13; i++) { const pt = curve.getPoint((i + 0.5) / 13); bulbs.setMatrixAt(i, m4.makeTranslation(pt.x, pt.y - 0.07, pt.z)); }
    this.scene.add(bulbs);
    this.stringLight = new THREE.PointLight(0xffb060, 9, 11, 2); this.stringLight.position.set(0, 5.2, 6.9); this.scene.add(this.stringLight);

    // --- manhole + wall vents (the steam itself is in fx.js)
    const mh = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20); mh.translate(STEAM[0].x, 0.006, STEAM[0].z); this.add('iron', mh);
    this.box('iron', 0.06, 0.4, 0.6, 3.97, 0.7, -8.4);
    this.box('iron', 0.6, 0.4, 0.06, -14.2, 2.6, 2.97);

    // --- bay ceilings get a strip light housing; bin bags by the dumpsters
    for (const b of BAYS) this.box('iron', 1.2, 0.08, 0.18, (b.x0 + b.x1) / 2, 3.14, (b.z0 + b.z1) / 2);
    const bag = (x, z, s) => { const g = new THREE.SphereGeometry(0.3 * s, 9, 7); g.scale(1, 0.75, 1.1); g.translate(x, 0.2 * s, z); this.add('plastic', g); const c = snowCap(0.4 * s, 0.4 * s, 0.07, x); c.translate(x, 0.42 * s, z); this.add('snow', c); };
    for (const [x, z, s] of [[-3.5, -10.4, 1], [-3.2, -9.9, 0.8], [-3.5, 27.0, 1], [-9.9, -2.5, 0.9], [-9.4, -2.2, 1.1], [7.6, -10.5, 1], [17.5, -2.4, 0.9], [-12.4, 17.3, 1], [-11.9, 17.6, 0.8]]) bag(x, z, s);
  }

  buildBackdrop() {
    // the city beyond the fences: silhouettes with scattered lit windows, softened by fog
    const far = [[0, -64, 130, 14, 26], [0, 64, 130, 14, 30], [-58, 0, 14, 130, 24], [58, 0, 14, 130, 28], [-30, -74, 30, 10, 44], [36, 76, 26, 10, 50], [-70, 30, 10, 30, 40], [70, -24, 10, 34, 46]];
    for (const [x, z, w, d, h] of far) { const g = boxUV(w, h, d, 30, 30); g.translate(x, h / 2, z); this.add('far', g); }
    // street lamps on the outer roads (glow only - too far to light anything that matters)
    const glow = T.glowTex();
    for (const [x, z] of [[-9, -51], [10, -51], [-9, 51], [10, 51], [-41, -9], [-41, 10], [41, -9], [41, 10], [-24, -51], [26, 51]]) {
      this.box('iron', 0.14, 7, 0.14, x, 3.5, z);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      s.scale.setScalar(5); s.position.set(x, 7, z); this.scene.add(s);
    }
  }

  // ---------------------------------------------------------------- lights
  buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight(0x9aa8d2, 0x70768c, 0.6);
    scene.add(this.hemi);

    // overcast sky-glow key: cool, soft, gives everything a readable shadow side
    const sun = this.sun = new THREE.DirectionalLight(0x9fb6ff, 0.55);
    sun.position.set(-26, 44, 20); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 56; sc.bottom = -56; sc.near = 1; sc.far = 130;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.5;
    scene.add(sun, sun.target);

    const glow = T.glowTex();
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.62, 0.3) }, uK: { value: 0.05 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vH; void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV; varying float vH; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))) + 1e-4, 1.8); float a = e * pow(clamp(vH, 0.0, 1.0) + 1e-4, 1.4) * uK; gl_FragColor = vec4(uColor * a, 1.0); }',
    });
    const wallDir = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] };
    for (const L of LAMPS) {
      const [ox, oz] = wallDir[L.wall];
      const light = new THREE.SpotLight(0xffae62, LAMP_CD, 28, 1.02, 0.8, 2);
      light.position.set(L.x, L.y - 0.1, L.z);
      light.target.position.set(L.x + ox * 0.9, 0, L.z + oz * 0.9);
      light.shadow.camera.near = 0.4; light.shadow.camera.far = 28; light.shadow.bias = -0.0006; light.shadow.normalBias = 0.03; light.shadow.radius = 3;
      scene.add(light, light.target);
      // fixture: wall arm, shade, bulb, halo, light shaft
      const g = new THREE.Group(); g.position.set(L.x, L.y, L.z);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), this.M.iron); arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(-oz, ox); arm.position.set(-ox * 0.4, 0.22, -oz * 0.4); g.add(arm);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.26, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x1b2420, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide })); shade.position.y = 0.1; g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.6) })); bulb.position.y = -0.02; g.add(bulb);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa24e, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: HALO })); halo.scale.setScalar(2.4); g.add(halo);
      const H = L.y - 0.1, cone = new THREE.Mesh(new THREE.ConeGeometry(H * 0.95, H, 28, 1, true), coneMat); cone.position.set(ox * 0.4, -H / 2, oz * 0.4); cone.renderOrder = 5; g.add(cone);
      const snow = new THREE.Mesh(snowCap(0.5, 0.5, 0.08, L.x), this.M.snow); snow.position.y = 0.27; g.add(snow);
      scene.add(g);
      this.lamps.push({ def: L, light, bulb, halo, cone, base: LAMP_CD, pos: new THREE.Vector3(L.x, L.y, L.z), k: 1 });
    }

    this.fireLight = new THREE.PointLight(0xff7a2a, 46, 13, 2); this.fireLight.position.set(FIRE.x, FIRE.y + 0.35, FIRE.z); scene.add(this.fireLight);
    this.neonLight = new THREE.PointLight(0xff3585, 20, 12, 2); this.neonLight.position.set(NEON.x, NEON.y - 0.2, NEON.z - 0.7); scene.add(this.neonLight);
  }

  setQuality(q) {
    this.quality = q;
    const lampShadows = { low: 0, medium: 2, high: 5, ultra: 5 }[q];
    const sunSize = { low: 1024, medium: 2048, high: 2048, ultra: 4096 }[q], lampSize = q === 'ultra' ? 2048 : 1024;
    const set = (light, on, size) => {
      light.castShadow = on;
      if (light.shadow.mapSize.x !== size) { light.shadow.mapSize.set(size, size); if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; } }
    };
    set(this.sun, true, sunSize);
    let n = 0;
    for (const L of this.lamps) set(L.light, L.def.shadow && n++ < lampShadows, lampSize);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }

  // Cheap analytic estimate of the light arriving at a point: drives how bright the
  // first-person weapon looks as you walk in and out of lamp pools.
  sampleLight(p, out) {
    out.setRGB(0.20, 0.24, 0.34);
    for (const L of this.lamps) {
      const dx = p.x - L.pos.x, dy = p.y - L.pos.y, dz = p.z - L.pos.z, d2 = dx * dx + dy * dy + dz * dz;
      if (dy > 0 || d2 > 500) continue;
      const cos = -dy / Math.sqrt(d2), cone = Math.min(1, Math.max(0, (cos - 0.5) / 0.3));
      const k = cone * L.k * 34 / (d2 + 4);
      out.r += 1.0 * k; out.g += 0.68 * k; out.b += 0.38 * k;
    }
    const f = this.fireLight, fd = p.distanceToSquared(f.position), fk = f.intensity / 46 * 5 / (fd + 2);
    out.r += fk; out.g += fk * 0.45; out.b += fk * 0.15;
    const nd = p.distanceToSquared(this.neonLight.position), nk = 2.4 / (nd + 3);
    out.r += nk; out.g += nk * 0.2; out.b += nk * 0.5;
    return out;
  }

  update(dt, t) {
    this.time = t;
    // fire: layered flicker
    const fl = 0.72 + 0.16 * Math.sin(t * 11.3) + 0.1 * Math.sin(t * 23.7 + 1.3) + 0.08 * Math.sin(t * 5.1);
    this.fireLight.intensity = 46 * fl;
    this.fireLight.position.x = FIRE.x + Math.sin(t * 9) * 0.04; this.fireLight.position.z = FIRE.z + Math.cos(t * 7.3) * 0.04;
    // one failing sodium lamp, one neon tube with a bad ballast
    for (const L of this.lamps) {
      let k = 1;
      if (L.def.flicker) { const s = Math.sin(t * 2.1) + Math.sin(t * 7.7) * 0.6; k = s > 1.25 ? (Math.sin(t * 61) > 0 ? 0.15 : 0.9) : 1; }
      if (k !== L.k) { L.k = k; L.light.intensity = L.base * k; L.halo.material.opacity = HALO * k; L.bulb.material.color.setRGB(6 * k, 3.6 * k, 1.6 * k); L.cone.visible = k > 0.5; }
    }
    const nf = Math.sin(t * 0.9) > 0.93 && Math.sin(t * 47) > 0 ? 0.35 : 1;
    this.neonLight.intensity = 20 * nf; this.neon.material.color.setScalar(2.6 * nf);
  }
}
