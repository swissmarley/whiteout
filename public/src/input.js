// Keyboard + mouse with pointer lock. `hit()` is edge-triggered and consumed on read.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.edges = new Set();
    this.mx = 0; this.my = 0;
    this.buttons = [false, false, false]; this.clicks = [false, false, false];
    this.locked = false; this.forced = false;
    this.onLockChange = null;

    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (this.active && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'KeyF' || e.code === 'Slash' || e.code === 'Quote')) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.edges.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.clear());
    addEventListener('mousedown', (e) => {
      if (!this.active || e.button > 2) return;
      if (e.button === 1) e.preventDefault();       // the wheel is a button here, not auto-scroll
      this.buttons[e.button] = true; this.clicks[e.button] = true;
    });
    addEventListener('mouseup', (e) => { if (e.button <= 2) this.buttons[e.button] = false; });
    addEventListener('mousemove', (e) => { if (this.locked) { this.mx += e.movementX; this.my += e.movementY; } });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => this.fail());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockFailed = false;
      if (!this.locked) this.clear();
      this.onLockChange && this.onLockChange(this.locked);
    });
  }

  get active() { return this.locked || this.forced; }
  clear() { this.keys.clear(); this.edges.clear(); this.buttons.fill(false); this.clicks.fill(false); this.mx = this.my = 0; }
  down(code) { return this.active && this.keys.has(code); }
  hit(code) { const h = this.edges.has(code); this.edges.delete(code); return h && this.active; }
  click(b) { const c = this.clicks[b]; this.clicks[b] = false; return c && this.active; }
  held(b) { return this.active && this.buttons[b]; }
  endFrame() { this.edges.clear(); this.clicks.fill(false); this.mx = this.my = 0; }

  // Raw (unaccelerated) mouse input where the browser supports it, plain pointer lock otherwise.
  lock() {
    const plain = () => { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => this.fail()); } catch { this.fail(); } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(plain); } catch { plain(); }
  }
  fail() { this.lockFailed = true; this.onLockChange && this.onLockChange(false); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
}
