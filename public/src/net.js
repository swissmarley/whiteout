// WebSocket client: clock sync, snapshot buffering, and the per-frame interpolated view of
// every remote entity. `view` records exactly which two snapshots were blended and by how
// much, and travels with every shot so the server can rebuild the identical picture.
// Served without a game server (GitHub Pages), it hosts a solo match in the page instead.

import { INTERP_MS, lerpEnemy, lerpPlayer } from '../shared/constants.js';

export class Net {
  constructor() {
    this.ws = null; this.id = 0; this.open = false; this.joined = false; this.wasOpen = false; this.solo = false;
    this.snaps = [];
    this.offset = 0; this.rtt = 0; this.best = Infinity; this.pings = 0; this.interp = INTERP_MS;
    this.enemies = new Map(); this.players = new Map();
    this.poolE = []; this.poolP = [];
    this.view = { t0: 0, t1: 0, a: 0 };
    this.wave = [0, 0, 0, 0, 0];
    this.me = null;
    this.spawnSeq = 0; this.shotN = 0;
    this.handlers = new Map();
    this.onStatus = null;
    this.bytesIn = 0;
  }

  on(type, fn) { this.handlers.set(type, fn); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.attach(new WebSocket(`${proto}://${location.host}/ws`));
  }

  // Nothing answered where the page came from (a static host): run the match in this tab.
  async hostSolo() {
    try {
      const { LocalSocket } = await import('./local.js');
      this.solo = true;
      this.attach(new LocalSocket());
    } catch (err) { console.error(err); this.onStatus && this.onStatus('closed'); }
  }

  attach(ws) {
    this.ws = ws;
    ws.onopen = () => { this.open = this.wasOpen = true; this.onStatus && this.onStatus('open'); this.ping(); this.pingTimer = setInterval(() => this.ping(), 1000); };
    ws.onclose = () => {
      this.open = false; this.joined = false; clearInterval(this.pingTimer);
      if (!this.wasOpen && !this.solo) this.hostSolo(); else this.onStatus && this.onStatus('closed');
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      this.bytesIn += ev.data.length;
      const m = JSON.parse(ev.data);
      if (m.t === 's') { this.onSnap(m); return; }
      if (m.t === 'q') { this.onPong(m); return; }
      if (m.t === 'w') { this.id = m.id; this.joined = true; if (!this.pings) this.offset = m.T - performance.now(); }
      if (m.t === 'sp') this.spawnSeq = m.q;
      const h = this.handlers.get(m.t);
      if (h) h(m);
    };
  }

  send(o) { if (this.open) this.ws.send(JSON.stringify(o)); }
  join(name) { this.send({ t: 'hi', name }); }
  // Out of the match, back to the menu. The socket stays open so the player can deploy again.
  leave() { this.send({ t: 'bye' }); this.joined = false; this.snaps.length = 0; this.me = null; }
  ping() { this.send({ t: 'p', c: performance.now(), r: this.rtt }); }

  onPong(m) {
    const now = performance.now(), rtt = now - m.c;
    this.rtt += (rtt - this.rtt) * (this.pings ? 0.2 : 1);
    // trust the sample with the least network delay; re-arm every 12 pings to follow drift
    if (rtt <= this.best || this.pings % 12 === 0) { this.best = rtt; this.offset = m.s + rtt / 2 - now; }
    this.pings++;
  }

  serverNow() { return performance.now() + this.offset; }

  onSnap(m) {
    if (!this.joined) return;                   // one still in flight after leaving
    const e = new Map(), p = new Map();
    for (const r of m.e) e.set(r[0], r);
    for (const r of m.p) p.set(r[0], r);
    this.snaps.push({ T: m.T, w: m.w, e, p });
    if (this.snaps.length > 90) this.snaps.shift();
    this.wave = m.w;
    this.me = p.get(this.id) || null;
  }

  // Call once per frame, before anything aims or draws.
  sample() {
    const s = this.snaps;
    for (const o of this.enemies.values()) this.poolE.push(o);
    for (const o of this.players.values()) this.poolP.push(o);
    this.enemies.clear(); this.players.clear();
    if (!s.length) return;
    // stay far enough behind that there are (almost) always two snapshots to blend
    const want = Math.max(INTERP_MS, this.rtt / 2 + 75);
    this.interp += (want - this.interp) * 0.02;
    const rt = this.serverNow() - this.interp, last = s[s.length - 1];
    let s0, s1, a = 0;
    if (rt >= last.T) { s0 = s1 = last; }
    else if (rt <= s[0].T) { s0 = s1 = s[0]; }
    else {
      let i = s.length - 2;
      while (i > 0 && s[i].T > rt) i--;
      s0 = s[i]; s1 = s[i + 1];
      a = (rt - s0.T) / (s1.T - s0.T);
    }
    this.view.t0 = s0.T; this.view.t1 = s1.T; this.view.a = a;
    for (const [id, row] of s0.e) this.enemies.set(id, lerpEnemy(row, s1.e.get(id), a, this.poolE.pop() || {}));
    for (const [id, row] of s0.p) this.players.set(id, lerpPlayer(row, s1.p.get(id), a, this.poolP.pop() || {}));
    while (s.length > 3 && s[1].T < rt - 300) s.shift();
  }

  sendState(pl, flags) {
    const r = (v) => Math.round(v * 1000) / 1000;
    this.send({ t: 'u', q: this.spawnSeq, x: r(pl.pos.x), y: r(pl.pos.y), z: r(pl.pos.z), yaw: r(pl.yaw), pitch: r(pl.pitch), ph: r(pl.bobPh), mv: r(pl.mv), cr: r(pl.cr), f: flags });
  }

  // Full-precision origin + direction: the server traces the very same ray. kind: 'x' a
  // rifle shot, 'm' a knife cut.
  sendShot(o, d, hitId, seg, kind = 'x') {
    const n = ++this.shotN, v = this.view;
    this.send({ t: kind, n, t0: v.t0, t1: v.t1, a: v.a, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], h: hitId, s: seg });
    return n;
  }
}
