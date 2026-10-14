// Render pipeline: world -> (ambient occlusion) -> first-person weapon -> bloom -> tone map
// -> final "lens" pass (blood, damage, low-health, grain, vignette, chromatic aberration).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { bloodCanvas } from './textures.js';

class LayerPass extends Pass {
  constructor(scene, camera, clearAll) { super(); this.scene = scene; this.camera = camera; this.clearAll = clearAll; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const old = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clearAll) renderer.clear(); else renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = old;
  }
}

const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, tBlood: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uHealth: { value: 1 }, uDamage: { value: 0 }, uDead: { value: 0 }, uAds: { value: 0 }, uFade: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tBlood; uniform float uTime, uHealth, uDamage, uDead, uAds, uFade; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec2 uv = vUv, px = 1.0 / uRes;
      // blood on the lens: refract the scene through the droplets
      vec4 b = texture2D(tBlood, uv);
      vec2 grad = vec2(texture2D(tBlood, uv + vec2(px.x * 3.0, 0.0)).a - texture2D(tBlood, uv - vec2(px.x * 3.0, 0.0)).a,
                       texture2D(tBlood, uv + vec2(0.0, px.y * 3.0)).a - texture2D(tBlood, uv - vec2(0.0, px.y * 3.0)).a);
      uv -= grad * 0.035;
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      float hurt = smoothstep(0.55, 0.12, uHealth);
      // chromatic aberration grows towards the edge and spikes when hit
      float ca = (0.0018 + uDamage * 0.012 + hurt * 0.004) * (0.25 + r2 * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      // light unsharp mask keeps brick and snow crisp after tone mapping
      vec3 blur = (texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb) * 0.25;
      col += (col - blur) * 0.32;
      // grade: cold shadows, a touch of contrast
      float l = luma(col);
      col = mix(col, col * vec3(0.93, 1.0, 1.09), smoothstep(0.5, 0.0, l) * 0.6);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      // tunnel vision + colour draining away as health drops
      float pulse = 0.5 + 0.5 * sin(uTime * (5.0 + 5.0 * hurt));
      col = mix(col, vec3(luma(col)) * vec3(1.05, 0.96, 0.94), hurt * 0.72 + uDead * 0.28);
      float vig = smoothstep(0.08, 0.62, r2);
      col *= 1.0 - vig * (0.42 + uAds * 0.18 + hurt * 0.3);
      col = mix(col, vec3(0.42, 0.0, 0.0) * (0.35 + luma(col) * 1.4), vig * clamp(hurt * (0.55 + 0.3 * pulse) + uDamage * 0.9, 0.0, 0.95));
      col += vec3(0.5, 0.02, 0.0) * uDamage * 0.14;
      // composite the blood itself: dark, wet, catching a highlight
      float ba = b.a;
      vec3 blood = b.rgb * (0.5 + 0.9 * luma(col));
      float spec = pow(clamp(dot(normalize(vec3(-grad * 26.0, 1.0)), normalize(vec3(-0.35, 0.55, 0.75))), 0.0, 1.0), 26.0);
      col = mix(col, blood, ba * 0.82) + vec3(1.0, 0.8, 0.75) * spec * ba * 0.3;
      // death: sink to dark red
      col = mix(col, vec3(0.12, 0.0, 0.0) * luma(col) * 3.0, uDead * 0.55);
      col *= 1.0 - uFade;
      col += (hash(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.034;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.vmScene = vmScene; this.vmCamera = vmCamera;
    this.splats = []; this.damage = 0; this.dirty = false; this.redrawT = 0; this.fade = 0;
    this.sprites = [1, 2, 3, 4, 5].map((s) => bloodCanvas(900 + s * 13, 384, true));
    this.bloodCv = document.createElement('canvas'); this.bloodCv.width = 960; this.bloodCv.height = 540;
    this.bloodCtx = this.bloodCv.getContext('2d');
    this.bloodTex = new THREE.CanvasTexture(this.bloodCv);
    this.showWeapon = true;
    this.build(quality);
  }

  build(quality) {
    this.quality = quality;
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    const c = this.composer = new EffectComposer(r, rt);
    c.addPass(new LayerPass(this.scene, this.camera, true));
    this.gtao = null;
    if (quality === 'ultra') {
      const g = this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      g.blendIntensity = 0.9;
      g.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1.15, samples: 12 });
      // keep particles, sprites, decals, light shafts and chain-link out of the AO depth pass
      g._overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse((o) => {
          if (!o.visible) return;
          const m = o.material;
          if (o.isPoints || o.isLine || o.isSprite || (m && !Array.isArray(m) && (m.transparent || m.depthWrite === false || m.alphaTest > 0))) { o.visible = false; cache.push(o); }
        });
      };
      c.addPass(g);
    }
    this.vmPass = new LayerPass(this.vmScene, this.vmCamera, false);
    c.addPass(this.vmPass);
    if (quality !== 'low') { this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.24, 0.5, 1.2); c.addPass(this.bloom); }
    c.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    this.lens.uniforms.tBlood.value = this.bloodTex;
    c.addPass(this.lens);
    this.resize();
  }

  resize() {
    const r = this.renderer, w = innerWidth, h = innerHeight;
    const cap = { low: 1, medium: 1.25, high: 1.6, ultra: 2 }[this.quality];
    r.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
    r.setSize(w, h, false);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(w, h);
    const s = r.getDrawingBufferSize(new THREE.Vector2());
    this.lens.uniforms.uRes.value.copy(s);
  }

  // angle: screen-space direction the hit came from (0 = ahead, +right), or null for anywhere
  hit(dmg, angle) {
    this.damage = Math.min(1, this.damage + 0.3 + dmg * 0.02);
    const n = dmg > 18 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = (angle === null ? Math.random() * 6.283 : angle + (Math.random() - 0.5) * 1.3);
      const rad = 0.36 + Math.random() * 0.16;
      this.splats.push({
        img: this.sprites[(Math.random() * this.sprites.length) | 0],
        x: 0.5 + Math.sin(a) * rad * 0.9, y: 0.5 - Math.cos(a) * rad * 0.8,
        s: 0.3 + Math.random() * 0.26 + dmg * 0.005, rot: Math.random() * 6.283, life: 5 + Math.random() * 2.5, max: 7.5,
      });
    }
    if (this.splats.length > 9) this.splats.splice(0, this.splats.length - 9);
    this.dirty = true;
  }

  clearBlood() { this.splats.length = 0; this.dirty = true; this.damage = 0; }

  render(dt, s) {
    this.damage = Math.max(0, this.damage - dt * 1.7);
    // blood canvas: only redrawn while something is fading
    this.redrawT -= dt;
    if (this.splats.length || this.dirty) {
      for (let i = this.splats.length - 1; i >= 0; i--) { this.splats[i].life -= dt; if (this.splats[i].life <= 0) this.splats.splice(i, 1); }
      if (this.dirty || this.redrawT <= 0) {
        const ctx = this.bloodCtx, W = this.bloodCv.width, H = this.bloodCv.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
        for (const p of this.splats) {
          ctx.globalAlpha = Math.min(1, p.life / 3.2);
          const size = p.s * H;
          ctx.setTransform(1, 0, 0, 1, p.x * W, p.y * H + (p.max - p.life) * 3.5);   // slow slide down the lens
          ctx.rotate(p.rot * 0.15); ctx.drawImage(p.img, -size / 2, -size / 2, size, size);
        }
        this.bloodTex.needsUpdate = true; this.dirty = false; this.redrawT = 1 / 24;
      }
    }
    const u = this.lens.uniforms;
    u.uTime.value = s.time; u.uHealth.value = s.health; u.uDamage.value = this.damage; u.uDead.value = s.dead; u.uAds.value = s.ads; u.uFade.value = this.fade;
    this.vmPass.enabled = this.showWeapon;
    this.composer.render(dt);
  }
}
