/**
 * GameUI — the DOM overlay owned by the game layer. Pure view: GameSystem tells it
 * what to show; it never reads game rules. Per-frame writes are transform/opacity
 * and text only, cached so an unchanged value never touches the DOM.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';
import { injectGameStyles } from './styles.js';

const CARDINALS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const PX_PER_DEG = 3.2;
const _v = new THREE.Vector3();

function el(tag, cls, parent, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  parent?.appendChild(n);
  return n;
}

const setText = (n, s) => { if (n.textContent !== s) n.textContent = s; };
const toggle = (n, cls, on) => { if (n.classList.contains(cls) !== on) n.classList.toggle(cls, on); };

export function fmtTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class GameUI {
  constructor() {
    injectGameStyles();
    const root = el('div', null, document.body);
    root.id = 'game-ui';
    root.hidden = true;
    this.root = root;
    this.play = el('div', 'play', root);
    this.crit = el('div', 'crit', this.play);
    this._buildCompass();
    this._buildTracker();
    this._buildScore();
    this.markerHost = el('div', null, this.play);
    this.markers = new Map();
    this._buildPrompt();
    this.subs = el('div', 'subs', this.play);
    this.bannerEl = el('div', 'banner', this.play);
    this.bannerT = el('div', 't', this.bannerEl);
    this.bannerS = el('div', 's', this.bannerEl);
    this._buildEquipment();
    this.respawn = el('div', 'respawn', this.play);
    this.intro = el('div', 'intro', root);
    this.introA = el('div', 'a', this.intro);
    this.introB = el('div', 'b', this.intro);
    this.introC = el('div', 'c', this.intro);
    this.fade = el('div', 'fade', root);
    this.cardWrap = el('div', 'card-wrap', root);
    this.cardWrap.hidden = true;
    this._bannerUntil = 0;
  }

  /* ── construction ─────────────────────────────────────────────────── */

  _buildCompass() {
    const c = el('div', 'compass', this.play);
    this.tape = el('div', 'tape', c);
    // Three full turns so the tape never runs out while wrapping.
    for (let turn = -1; turn <= 1; turn++) {
      for (let d = 0; d < 360; d += 15) {
        const card = CARDINALS.find(([, a]) => a === d);
        const t = el('div', card ? 'ct cardinal' : 'ct minor', this.tape, card ? card[0] : '');
        t.style.left = `${(d + turn * 360) * PX_PER_DEG}px`;
      }
    }
    el('div', 'needle', c);
    this.compassMarks = el('div', null, c);
    this.compassMarks.style.cssText = 'position:absolute;left:50%;top:0;height:100%';
    this._compassPool = [];
  }

  _buildTracker() {
    const t = el('div', 'tracker', this.play);
    this.trOp = el('div', 'op', t);
    this.trObj = el('div', 'obj', t);
    this.trPips = el('div', 'pips', t);
    this.trTimer = el('div', 'timer', t);
  }

  _buildScore() {
    this.score = el('div', 'score', this.play);
    this.scoreUs = el('div', 'us', this.score);
    const mid = el('div', 'mid', this.score);
    this.scoreClock = el('div', null, mid);
    this.scoreTarget = el('div', null, mid);
    this.scoreThem = el('div', 'them', this.score);
    this.score.hidden = true;
  }

  _buildPrompt() {
    this.prompt = el('div', 'prompt', this.play);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 34 34');
    for (const cls of ['bg', 'fg']) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '17'); c.setAttribute('cy', '17'); c.setAttribute('r', '14');
      c.setAttribute('class', cls);
      svg.appendChild(c);
    }
    this.promptRing = svg.querySelector('.fg');
    this.prompt.appendChild(svg);
    this.promptKey = el('kbd', null, this.prompt, 'F');
    this.promptText = el('span', null, this.prompt);
  }

  _buildEquipment() {
    this.gren = el('div', 'gren', this.play);
    this.grenLabel = el('span', null, this.gren, 'Frag');
    this.grenPips = [];
    this.charge = el('div', 'charge', this.play);
    this.chargeFill = el('i', null, this.charge);
    this.hbar = el('div', 'hbar', this.play);
    this.hbarV = el('div', 'v', this.hbar);
    this.hbarFill = el('i', null, el('div', 'b', this.hbar));
  }

  /* ── state setters ────────────────────────────────────────────────── */

  show(on) { this.root.hidden = !on; }
  setFlags({ colorblind, reducedMotion }) {
    toggle(this.root, 'cb', !!colorblind);
    toggle(this.root, 'rm', !!reducedMotion);
  }
  setCinema(on) { toggle(this.root, 'cinema', on); }
  setFade(on) { toggle(this.fade, 'on', on); }

  setTracker(op, objective, pips = [], timer = '') {
    setText(this.trOp, op);
    setText(this.trObj, objective);
    const sig = pips.map((p) => p.label + p.done).join('|');
    if (sig !== this._pipSig) {
      this._pipSig = sig;
      this.trPips.textContent = '';
      for (const p of pips) el('span', p.done ? 'pip done' : 'pip', this.trPips, p.label);
    }
    setText(this.trTimer, timer);
  }

  setScore(visible, us = 0, them = 0, clock = '', target = '') {
    this.score.hidden = !visible;
    if (!visible) return;
    setText(this.scoreUs, String(us));
    setText(this.scoreThem, String(them));
    setText(this.scoreClock, clock);
    setText(this.scoreTarget, target);
  }

  setIntro(on, a = '', b = '', c = '') {
    if (on) { setText(this.introA, a); setText(this.introB, b); setText(this.introC, c); }
    toggle(this.intro, 'on', on);
  }

  setPrompt(text, progress = 0, key = 'F') {
    const on = !!text;
    toggle(this.prompt, 'on', on);
    if (!on) return;
    setText(this.promptText, text);
    setText(this.promptKey, key);
    // Inline style, not the attribute: the stylesheet's stroke-dashoffset outranks a presentation attribute.
    const off = `${Math.round(88 * (1 - Math.max(0, Math.min(1, progress))))}`;
    if (this.promptRing.style.strokeDashoffset !== off) this.promptRing.style.strokeDashoffset = off;
  }

  setRespawn(text) { setText(this.respawn, text); }

  setEquipment(grenades, max, cooking, charge, fuseLeft) {
    while (this.grenPips.length < max) this.grenPips.push(el('i', null, this.gren));
    this.grenPips.forEach((p, i) => { p.hidden = i >= max; toggle(p, 'off', i >= grenades); });
    toggle(this.charge, 'on', !!cooking);
    if (cooking) {
      this.chargeFill.style.width = `${Math.round(charge * 100)}%`;
      toggle(this.charge, 'hot', fuseLeft < 1.2);
    }
  }

  setHealth(showBar, hp01, crit) {
    this.hbar.hidden = !showBar;
    if (showBar) {
      setText(this.hbarV, `${Math.ceil(hp01 * 100)} HP`);
      this.hbarFill.style.width = `${Math.round(hp01 * 100)}%`;
      toggle(this.hbar, 'low', hp01 < 0.3);
    }
    toggle(this.crit, 'on', crit);
  }

  banner(title, sub = '', tone = '', seconds = 2.6) {
    setText(this.bannerT, title);
    setText(this.bannerS, sub);
    this.bannerEl.className = `banner on ${tone}`;
    this._bannerUntil = performance.now() + seconds * 1000;
  }

  /** Caption line. `who` is shown as the speaker tag; enemy chatter is red. */
  caption(who, text, seconds = 4, enemy = false) {
    const line = el('div', 'line', this.subs);
    const w = el('span', enemy ? 'who enemy' : 'who', line, who);
    void w;
    const body = el('span', null, line, '');
    requestAnimationFrame(() => line.classList.add('on'));
    // Typewriter at ~58 chars/s — slow enough to read along, fast enough to keep up.
    let i = 0;
    const tick = setInterval(() => {
      i = Math.min(text.length, i + 2);
      body.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(tick);
    }, 34);
    setTimeout(() => { line.classList.remove('on'); setTimeout(() => { clearInterval(tick); line.remove(); }, 300); }, seconds * 1000);
    while (this.subs.children.length > 3) this.subs.firstChild.remove();
  }

  clearCaptions() { this.subs.textContent = ''; }

  /* ── markers ──────────────────────────────────────────────────────── */

  /**
   * @param {Array<{id, position:THREE.Vector3, label, kind:'obj'|'ex'|'crate', showDistance}>} list
   */
  updateMarkers(list, camera, eye, heading) {
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    let ci = 0;
    for (const m of list) {
      seen.add(m.id);
      let n = this.markers.get(m.id);
      if (!n) {
        n = el('div', `wm ${m.kind}`, this.markerHost);
        el('i', null, n);
        n._b = el('b', null, n);
        n._em = el('em', null, n);
        this.markers.set(m.id, n);
      }
      const dist = eye.distanceTo(m.position);
      _v.copy(m.position).project(camera);
      const behind = _v.z > 1;
      let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      if (behind) { x = W - x; y = H * 0.85; }
      x = Math.max(28, Math.min(W - 28, x));
      y = Math.max(60, Math.min(H - 60, y));
      n.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      // Crates only matter up close; objectives fade a little when you are on top of them.
      const op = m.kind === 'crate' ? (dist < 22 ? 0.85 : 0) : (dist < 2.5 ? 0.35 : 1);
      n.style.opacity = String(op);
      setText(n._b, m.showDistance === false ? '' : `${Math.round(dist)}m`);
      setText(n._em, m.label ?? '');

      if (m.kind !== 'crate') {
        let cm = this._compassPool[ci];
        if (!cm) { cm = el('div', 'cm', this.compassMarks); this._compassPool.push(cm); }
        cm.hidden = false;
        toggle(cm, 'ex', m.kind === 'ex');
        let rel = bearingDeg(eye, m.position) - heading;
        rel = ((rel + 540) % 360) - 180;
        cm.style.transform = `translateX(${(rel * PX_PER_DEG).toFixed(1)}px)`;
        cm.style.opacity = Math.abs(rel) > 80 ? '0' : '1';
        ci++;
      }
    }
    for (let i = ci; i < this._compassPool.length; i++) this._compassPool[i].hidden = true;
    for (const [id, n] of this.markers) {
      if (!seen.has(id)) { n.remove(); this.markers.delete(id); }
    }
  }

  setHeading(deg) {
    const x = (-deg * PX_PER_DEG).toFixed(1);
    if (x !== this._tapeX) { this._tapeX = x; this.tape.style.transform = `translateX(${x}px)`; }
  }

  tick() {
    if (this._bannerUntil && performance.now() > this._bannerUntil) {
      this._bannerUntil = 0;
      this.bannerEl.classList.remove('on');
    }
  }

  /* ── cards ────────────────────────────────────────────────────────── */

  /**
   * @param {{eyebrow, title, tone, why, rows:[[k,v,best?]], rating?, table?, buttons:[{label, primary, onClick}], hint}} spec
   */
  showCard(spec) {
    const w = this.cardWrap;
    w.textContent = '';
    const card = el('div', 'card', w);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    el('div', 'eyebrow', card, spec.eyebrow ?? '');
    const h = el('h2', spec.tone ?? '', card, spec.title ?? '');
    h.id = 'game-card-title';
    card.setAttribute('aria-labelledby', h.id);
    if (spec.why) el('div', 'why', card, spec.why);
    if (spec.rows?.length) {
      const dl = el('dl', null, card);
      for (const [k, v, best] of spec.rows) { el('dt', null, dl, k); el('dd', best ? 'best' : null, dl, v); }
    }
    if (spec.rating) { const r = el('div', 'rating', card, 'Rating'); el('b', null, r, spec.rating); }
    if (spec.table) {
      const t = el('table', null, card);
      const head = el('tr', null, t);
      for (const c of spec.table.cols) el('th', null, head, c);
      for (const row of spec.table.rows) {
        const tr = el('tr', row.you ? 'you' : null, t);
        for (const c of row.cells) el('td', null, tr, String(c));
      }
    }
    const btns = el('div', 'btns', card);
    let first = null;
    for (const b of spec.buttons ?? []) {
      const btn = el('button', b.primary ? 'primary' : null, btns, b.label);
      btn.type = 'button';
      btn.addEventListener('click', (e) => { e.stopPropagation(); b.onClick?.(); });
      if (!first || b.primary) first = btn;
    }
    if (spec.hint) el('div', 'hint', card, spec.hint);
    w.hidden = false;
    // Keyboard: Enter on the focused primary button; Tab cycles inside the card.
    setTimeout(() => first?.focus(), 50);
    this._cardKeys = (e) => {
      // Enter is also Fire: a held trigger's auto-repeat must not click straight through the card.
      if (e.key === 'Enter' && e.repeat) { e.preventDefault(); return; }
      if (e.key !== 'Tab') return;
      const f = [...card.querySelectorAll('button')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    };
    window.addEventListener('keydown', this._cardKeys);
  }

  hideCard() {
    this.cardWrap.hidden = true;
    this.cardWrap.textContent = '';
    if (this._cardKeys) window.removeEventListener('keydown', this._cardKeys);
    this._cardKeys = null;
  }

  get cardOpen() { return !this.cardWrap.hidden; }

  dispose() { this.hideCard(); this.root.remove(); }
}

/** Compass bearing in degrees: 0 = north (+Z), 90 = east (+X). */
export function bearingDeg(from, to) {
  const d = Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI;
  return (d + 360) % 360;
}

export function bearingName(deg) {
  const names = ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
