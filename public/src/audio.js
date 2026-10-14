// All sound is synthesised with WebAudio - no samples on disk.

export class Sound {
  constructor() { this.ctx = null; this.vol = 0.8; this.hb = 0; this.hbT = 0; }

  // must be called from a user gesture
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.16;
    this.bus = ctx.createGain();
    this.bus.connect(this.muffle); this.muffle.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);

    // white noise source material
    const len = ctx.sampleRate * 2, buf = this.noise = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // alley reverb: slap-back off the brick, then a short dense tail
    const il = Math.floor(ctx.sampleRate * 1.5), ir = ctx.createBuffer(2, il, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < il; i++) { const t = i / ctx.sampleRate; ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / il, 2.6) * (t < 0.012 ? 0.2 : 1); }
      for (const [t, g] of [[0.031, 0.7], [0.047, -0.55], [0.083, 0.45], [0.121, -0.3], [0.19, 0.22]]) { const k = Math.floor((t + c * 0.004) * ctx.sampleRate); for (let j = 0; j < 60; j++) ch[k + j] += g * (1 - j / 60) * (Math.random() * 2 - 1); }
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.5; this.reverb.connect(rg); rg.connect(this.bus);
    this.ambient();
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  listener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, e = cam.matrixWorld.elements;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = -e[8]; L.forwardY.value = -e[9]; L.forwardZ.value = -e[10];
      L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }
  }

  // output node for a sound: positional if `pos` given
  out(pos, wet = 0, ref = 3) {
    const ctx = this.ctx, g = ctx.createGain();
    let tail = g;
    if (pos) {
      const pn = ctx.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = ref; pn.rolloffFactor = 1.1; pn.maxDistance = 120;
      pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z;
      g.connect(pn); tail = pn;
    }
    tail.connect(this.bus);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; tail.connect(w); w.connect(this.reverb); }
    return g;
  }

  // filtered noise burst with an exponential envelope
  burst(dst, { t = 0, dur = 0.1, gain = 1, type = 'bandpass', f = 1000, f2 = 0, q = 0.7, attack = 0.001, rate = 1 }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t, src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl); fl.connect(g); g.connect(dst);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02);
  }

  tone(dst, { t = 0, dur = 0.1, gain = 1, f = 440, f2 = 0, type = 'sine', attack = 0.001 }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dst); o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------------ weapons
  shot() {
    if (!this.ctx) return;
    const o = this.out(null, 0.42), r = 0.94 + Math.random() * 0.12;
    o.gain.value = 0.62;
    this.burst(o, { dur: 0.075, gain: 1.0, type: 'highpass', f: 2100 * r, q: 0.4 });                 // crack
    this.burst(o, { dur: 0.19, gain: 0.95, type: 'bandpass', f: 640 * r, f2: 260, q: 0.6 });          // body
    this.burst(o, { dur: 0.32, gain: 0.5, type: 'lowpass', f: 900, f2: 140, q: 0.3 });               // boom
    this.tone(o, { dur: 0.13, gain: 1.0, f: 165 * r, f2: 44, type: 'sine' });                        // thump
    this.tone(o, { dur: 0.05, gain: 0.3, f: 1250 * r, f2: 500, type: 'square' });                    // gas ring
    this.burst(o, { t: 0.052, dur: 0.022, gain: 0.26, type: 'highpass', f: 4800, q: 1 });            // bolt carrier
  }

  shotFar(pos, big = false) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.5, 5), r = 0.9 + Math.random() * 0.2;
    o.gain.value = big ? 1.0 : 0.8;
    this.burst(o, { dur: 0.06, gain: 0.8, type: 'highpass', f: 1500 * r, q: 0.4 });
    this.burst(o, { dur: big ? 0.26 : 0.17, gain: 1.0, type: 'bandpass', f: (big ? 420 : 760) * r, f2: 220, q: 0.6 });
    this.tone(o, { dur: 0.11, gain: 0.8, f: (big ? 120 : 190) * r, f2: 50 });
  }

  dry() { if (!this.ctx) return; const o = this.out(); o.gain.value = 0.35; this.burst(o, { dur: 0.03, gain: 1, type: 'highpass', f: 3200 }); this.tone(o, { dur: 0.03, gain: 0.4, f: 1800, f2: 900, type: 'square' }); }

  reload(stage) {
    if (!this.ctx) return;
    const o = this.out(null, 0.08); o.gain.value = 0.5;
    if (stage === 'magout') { this.burst(o, { dur: 0.05, gain: 0.9, type: 'bandpass', f: 2400, q: 1.5 }); this.tone(o, { dur: 0.06, gain: 0.3, f: 520, f2: 260, type: 'triangle' }); this.burst(o, { t: 0.09, dur: 0.12, gain: 0.3, type: 'bandpass', f: 900, q: 0.8 }); }
    else if (stage === 'magin') { this.burst(o, { dur: 0.04, gain: 0.7, type: 'bandpass', f: 1500, q: 1.2 }); this.burst(o, { t: 0.07, dur: 0.06, gain: 1, type: 'bandpass', f: 2900, q: 1.6 }); this.tone(o, { t: 0.07, dur: 0.08, gain: 0.5, f: 300, f2: 150, type: 'triangle' }); }
    else { this.burst(o, { dur: 0.035, gain: 1, type: 'highpass', f: 3000 }); this.burst(o, { t: 0.075, dur: 0.06, gain: 1, type: 'bandpass', f: 2200, q: 1.3 }); this.tone(o, { t: 0.075, dur: 0.07, gain: 0.5, f: 420, f2: 180, type: 'triangle' }); }
  }

  casing(pos, surface, power, n) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.12, 1.2);
    if (surface === 'snow') { o.gain.value = 0.16 * power; this.burst(o, { dur: 0.08, gain: 1, type: 'bandpass', f: 1800, q: 0.6 }); return; }
    o.gain.value = (0.3 + power * 0.5) * Math.pow(0.6, n);
    const f = 4300 + Math.random() * 2200;
    this.tone(o, { dur: 0.16, gain: 0.5, f, type: 'sine' }); this.tone(o, { dur: 0.1, gain: 0.3, f: f * 1.51, type: 'sine' }); this.tone(o, { dur: 0.07, gain: 0.2, f: f * 2.27, type: 'sine' });
    this.burst(o, { dur: 0.012, gain: 0.4, type: 'highpass', f: 6000 });
  }

  impact(pos, mat) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.2, 2);
    if (mat === 'snow') { o.gain.value = 0.42; this.burst(o, { dur: 0.11, gain: 1, type: 'lowpass', f: 1600, f2: 400 }); }
    else if (mat === 'metal' || mat === 'glass') { o.gain.value = 0.5; const f = 1800 + Math.random() * 2600; this.tone(o, { dur: 0.22, gain: 0.6, f, f2: f * 0.94 }); this.tone(o, { dur: 0.12, gain: 0.35, f: f * 1.63 }); this.burst(o, { dur: 0.03, gain: 0.9, type: 'highpass', f: 3500 }); if (Math.random() < 0.35) this.tone(o, { t: 0.02, dur: 0.4, gain: 0.25, f: 2600 + Math.random() * 1800, f2: 900, type: 'sawtooth' }); }
    else if (mat === 'wood') { o.gain.value = 0.55; this.burst(o, { dur: 0.07, gain: 1, type: 'bandpass', f: 700, q: 1 }); this.tone(o, { dur: 0.07, gain: 0.5, f: 260, f2: 120, type: 'triangle' }); }
    else { o.gain.value = 0.55; this.burst(o, { dur: 0.09, gain: 1, type: 'bandpass', f: 1400, f2: 500, q: 0.6 }); this.burst(o, { dur: 0.03, gain: 0.7, type: 'highpass', f: 4000 }); }
  }

  flesh(pos) { if (!this.ctx) return; const o = this.out(pos, 0.05, 2.5); o.gain.value = 0.7; this.burst(o, { dur: 0.09, gain: 1, type: 'lowpass', f: 900, f2: 200 }); this.tone(o, { dur: 0.08, gain: 0.6, f: 150, f2: 70 }); }

  hitmarker(kind) {
    if (!this.ctx) return;
    const o = this.out(); o.gain.value = 0.3;
    if (kind === 'kill') { this.tone(o, { dur: 0.07, gain: 0.9, f: 1250, type: 'triangle' }); this.tone(o, { t: 0.06, dur: 0.16, gain: 0.9, f: 1870, type: 'triangle' }); this.burst(o, { dur: 0.02, gain: 0.5, type: 'highpass', f: 5000 }); }
    else if (kind === 'head') { this.tone(o, { dur: 0.09, gain: 1, f: 2350, f2: 2100, type: 'triangle' }); this.tone(o, { dur: 0.06, gain: 0.5, f: 3520 }); }
    else { this.tone(o, { dur: 0.045, gain: 0.8, f: 1700, f2: 1300, type: 'triangle' }); this.burst(o, { dur: 0.015, gain: 0.5, type: 'highpass', f: 4500 }); }
  }

  whiz(pos) { if (!this.ctx) return; const o = this.out(pos, 0.1, 1.5); o.gain.value = 0.7; this.burst(o, { dur: 0.016, gain: 1, type: 'highpass', f: 2600 }); this.burst(o, { t: 0.01, dur: 0.2, gain: 0.5, type: 'bandpass', f: 3400, f2: 700, q: 4 }); }

  // ------------------------------------------------------------------ body
  step(sprint, crouch) {
    if (!this.ctx) return;
    const o = this.out(); o.gain.value = (sprint ? 0.3 : crouch ? 0.1 : 0.2) * (0.8 + Math.random() * 0.4);
    const r = 0.85 + Math.random() * 0.3;
    this.burst(o, { dur: 0.11, gain: 1, type: 'bandpass', f: 1250 * r, f2: 520, q: 0.9, attack: 0.012 });       // snow compressing
    this.burst(o, { t: 0.03, dur: 0.07, gain: 0.5, type: 'highpass', f: 3600 * r, attack: 0.01 });             // squeak
    this.tone(o, { dur: 0.06, gain: 0.35, f: 95, f2: 55 });
  }

  land(power) { if (!this.ctx) return; const o = this.out(); o.gain.value = Math.min(0.7, 0.2 + power * 0.05); this.burst(o, { dur: 0.2, gain: 1, type: 'lowpass', f: 1300, f2: 240 }); this.tone(o, { dur: 0.12, gain: 0.8, f: 110, f2: 45 }); }
  jump() { if (!this.ctx) return; const o = this.out(); o.gain.value = 0.14; this.burst(o, { dur: 0.13, gain: 1, type: 'bandpass', f: 800, f2: 1900, q: 0.7, attack: 0.03 }); }
  vault() { if (!this.ctx) return; const o = this.out(); o.gain.value = 0.3; this.burst(o, { dur: 0.3, gain: 0.8, type: 'bandpass', f: 600, f2: 2000, q: 0.6, attack: 0.08 }); this.burst(o, { t: 0.12, dur: 0.1, gain: 0.9, type: 'lowpass', f: 700 }); this.tone(o, { t: 0.12, dur: 0.09, gain: 0.5, f: 130, f2: 60 }); }

  hurt(dmg) {
    if (!this.ctx) return;
    const o = this.out(); o.gain.value = Math.min(0.75, 0.35 + dmg * 0.015);
    this.burst(o, { dur: 0.12, gain: 1, type: 'lowpass', f: 700, f2: 150 }); this.tone(o, { dur: 0.15, gain: 0.9, f: 120, f2: 50 });
    this.burst(o, { dur: 0.05, gain: 0.5, type: 'bandpass', f: 2500, q: 2 });
  }

  melee(pos) { if (!this.ctx) return; const o = this.out(pos, 0.1, 2); o.gain.value = 0.5; this.burst(o, { dur: 0.22, gain: 1, type: 'bandpass', f: 500, f2: 2600, q: 1.4, attack: 0.09 }); }

  // The knife: out of its sheath, through the air, and into whatever it meets.
  knife(kind, pos = null, mat = null) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.1, 1.6), r = 0.92 + Math.random() * 0.16;
    if (kind === 'draw') {
      o.gain.value = 0.2;
      this.burst(o, { dur: 0.09, gain: 0.7, type: 'bandpass', f: 900, f2: 2200, q: 0.8, attack: 0.03 });                    // sleeve and webbing
      this.burst(o, { t: 0.085, dur: 0.07, gain: 0.8, type: 'bandpass', f: 5200 * r, f2: 7400, q: 6, attack: 0.02 });       // steel leaving the sheath
      this.tone(o, { t: 0.1, dur: 0.16, gain: 0.07, f: 6100 * r, type: 'sine', attack: 0.01 });
    } else if (kind === 'swing') {
      o.gain.value = pos ? 0.5 : 0.42;
      this.burst(o, { dur: 0.17, gain: 1, type: 'bandpass', f: 520 * r, f2: 2700 * r, q: 1.7, attack: 0.07 });             // the arm
      this.burst(o, { t: 0.04, dur: 0.11, gain: 0.45, type: 'bandpass', f: 3200 * r, f2: 6400, q: 3, attack: 0.045 });     // the edge
    } else if (kind === 'hit') {
      o.gain.value = 0.75;
      this.burst(o, { dur: 0.05, gain: 1, type: 'highpass', f: 2600 * r, q: 0.6 });                                        // cloth parting
      this.burst(o, { dur: 0.14, gain: 1, type: 'lowpass', f: 820, f2: 190 });
      this.tone(o, { dur: 0.11, gain: 0.8, f: 135 * r, f2: 58 });
      this.burst(o, { t: 0.03, dur: 0.12, gain: 0.35, type: 'bandpass', f: 1500, f2: 600, q: 1.2 });
    } else if (mat === 'snow') {
      o.gain.value = 0.4; this.burst(o, { dur: 0.12, gain: 1, type: 'lowpass', f: 1500, f2: 380 });
    } else {
      // the point skating off something hard
      const hard = mat === 'metal' || mat === 'glass', f = (hard ? 3100 : 2100) * r;
      o.gain.value = 0.5;
      this.burst(o, { dur: 0.035, gain: 1, type: 'highpass', f: 3800 });
      this.tone(o, { dur: hard ? 0.3 : 0.09, gain: hard ? 0.5 : 0.3, f, f2: f * 0.97 }); this.tone(o, { dur: hard ? 0.18 : 0.06, gain: 0.25, f: f * 1.71 });
      this.burst(o, { dur: 0.08, gain: hard ? 0.3 : 0.8, type: 'bandpass', f: mat === 'wood' ? 620 : 1300, q: 1 });
    }
  }

  ui(kind) {
    if (!this.ctx) return;
    const o = this.out(null, 0.2); o.gain.value = 0.3;
    if (kind === 'wave') { this.tone(o, { dur: 1.2, gain: 0.8, f: 82, f2: 70, type: 'sawtooth', attack: 0.3 }); this.tone(o, { dur: 1.2, gain: 0.5, f: 123, f2: 105, type: 'sawtooth', attack: 0.3 }); this.burst(o, { dur: 1.1, gain: 0.3, type: 'lowpass', f: 300, f2: 1400, attack: 0.5 }); }
    else if (kind === 'clear') { for (const [t, f] of [[0, 392], [0.12, 523], [0.24, 659]]) this.tone(o, { t, dur: 0.5, gain: 0.5, f, type: 'triangle' }); }
    else if (kind === 'over') { this.tone(o, { dur: 2.2, gain: 0.9, f: 110, f2: 41, type: 'sawtooth', attack: 0.05 }); this.burst(o, { dur: 2, gain: 0.4, type: 'lowpass', f: 900, f2: 80 }); }
    else if (kind === 'ammo') { this.burst(o, { dur: 0.05, gain: 1, type: 'bandpass', f: 2000, q: 1.5 }); this.burst(o, { t: 0.1, dur: 0.05, gain: 1, type: 'bandpass', f: 2600, q: 1.5 }); this.tone(o, { t: 0.1, dur: 0.1, gain: 0.5, f: 880, type: 'triangle' }); }
    else if (kind === 'click') this.tone(o, { dur: 0.03, gain: 0.5, f: 1400, type: 'square' });
  }

  // ------------------------------------------------------------------ continuous
  ambient() {
    const ctx = this.ctx;
    const mk = (type, f, q, gain, lfoHz, depth) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoHz; const lg = ctx.createGain(); lg.gain.value = depth;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      const l2 = ctx.createOscillator(); l2.frequency.value = lfoHz * 0.37; const lg2 = ctx.createGain(); lg2.gain.value = f * 0.3; l2.connect(lg2); lg2.connect(fl.frequency); l2.start();
      src.connect(fl); fl.connect(g); g.connect(this.bus); src.start(0, Math.random());
    };
    mk('lowpass', 320, 0.4, 0.085, 0.09, 0.04);       // wind body
    mk('bandpass', 980, 5, 0.012, 0.13, 0.009);        // whistle round the eaves
    mk('lowpass', 90, 0.7, 0.07, 0.05, 0.02);          // city rumble
  }

  // heartbeat + muffled hearing as health drops (k: 0 healthy -> 1 nearly dead)
  setDanger(k, dt) {
    if (!this.ctx) return;
    const target = 20000 * Math.pow(0.045, k);
    this.muffle.frequency.value += (target - this.muffle.frequency.value) * Math.min(1, dt * 5);
    if (k < 0.25) { this.hbT = 0; return; }
    this.hbT -= dt;
    if (this.hbT <= 0) {
      this.hbT = 0.95 - k * 0.38;
      const o = this.ctx.createGain(); o.gain.value = 0.35 + k * 0.5; o.connect(this.master);
      this.tone(o, { dur: 0.13, gain: 1, f: 62, f2: 40 }); this.tone(o, { t: 0.17, dur: 0.16, gain: 0.75, f: 54, f2: 36 });
    }
  }
}
