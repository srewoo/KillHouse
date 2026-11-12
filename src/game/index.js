/**
 * KILL HOUSE — GameSystem. id 'game', order 35 (after player 20 and ai 30, so it
 * reads this frame's positions; before weapons 40 so Interact wins the F key).
 *
 * Owns the match lifecycle on top of the simulation:
 *
 *   idle ──start(mode)──▶ intro ──▶ playing ──finish/fail──▶ over ──restart──▶ intro
 *     ▲                                                     │
 *     └──────────────────────── quit() ◀────────────────────┘
 *
 * In `idle` the yard runs as the old free-roam sandbox behind the home page.
 * Modes (src/game/modes/*) hold the rules; this file holds the plumbing they
 * share: interaction, resupply, overlay, radio, results and records.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';
import { GameUI, fmtTime } from './ui.js';
import { Radio } from './radio.js';
import { OperationMode } from './modes/operation.js';
import { DeathmatchMode } from './modes/deathmatch.js';
import { DrillMode } from './modes/drill.js';
import { loadRecords, saveRecord } from './records.js';
import { installHarness } from './harness.js';
import { getBinding, keyLabel } from '../core/Keybinds.js';

export const MODES = { operation: OperationMode, deathmatch: DeathmatchMode, drill: DrillMode };

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

export class GameSystem {
  static id = 'game';
  static order = 35;

  constructor(ctx) {
    this.ctx = ctx;
    this.state = 'idle';
    this.mode = null;
    this.modeId = null;
    this.retries = 0;
    this.simTime = 0;
    this._offs = [];
    this._hold = 0;
    this._holdTarget = null;
    this._introLeft = 0;
    this._cardTimer = -1;
    /** Wall-clock timeouts owned by the current match; cleared on teardown. */
    this._timers = [];
    /** Called by main.js so a card can hand control back to the menu / pointer lock. */
    this.onRequestLock = null;
    this.onRequestMenu = null;
    this.records = loadRecords();
  }

  async init(onProgress = () => {}) {
    onProgress(0.2, 'game: overlay');
    this.ui = new GameUI();
    this.radio = new Radio(this.ctx, this.ui);
    const ev = this.ctx.events;
    const on = (name, fn) => this._offs.push(ev.on(name, (p) => { try { fn(p); } catch (e) { console.warn(`[game] ${name}:`, e); } }));
    on('actor:death', (p) => { if (this.state === 'playing' && p?.actor?.bot) { this.stats.kills++; this.mode?.onActorDeath?.(p); } });
    on('player:death', (p) => { if (this.state === 'playing') { this.stats.deaths++; this.mode?.onPlayerDeath?.(p?.killer ?? null); } });
    on('ai:callout', (p) => this._onCallout(p));
    on('player:damage', () => { if (this.state === 'playing') this.mode?.onContact?.(); });
    installHarness(this);
    onProgress(1, 'game');
  }

  /* ── lifecycle ────────────────────────────────────────────────────── */

  get playing() { return this.state === 'playing' || this.state === 'intro'; }
  /** True while a mission card owns the screen; main.js keeps the home menu hidden. */
  get cardOpen() { return !!this.ui?.cardOpen; }

  start(modeId = this.ctx.config.gameplay.mode, { retry = false } = {}) {
    const Mode = MODES[modeId] ?? MODES.operation;
    this._teardown();
    this.retries = retry && this.modeId === modeId ? this.retries + 1 : 0;
    this.modeId = modeId;
    this.mode = new Mode(this);
    // Headshots are counted once, by the weapon system (it is the only place that
    // knows a round hit a head). This used to be a separate field that nothing ever
    // incremented, so anything reading game.stats saw 0 forever.
    const weaponsRef = this.ctx.weapons;
    this.stats = { kills: 0, deaths: 0, get headshots() { return weaponsRef?.headshots ?? 0; } };

    const { player, ai, weapons, hud } = this.ctx;
    ai.autoRespawn = false;
    player.autoRespawn = false;
    if (player.isDead) player.respawn(true);
    weapons?.refill?.();
    weapons?.resetStats?.();
    if (hud?.stats) { hud.stats.kills = 0; hud.stats.deaths = 0; }
    hud?.setMode?.(this.mode.title);

    try { this.mode.setup(); } catch (err) {
      // A half-built mode would throw every frame and could never end; back out cleanly.
      console.error('[game] mode setup failed:', err);
      this.quit();
      return;
    }

    this.ui.hideCard();
    this.ui.show(true);
    this.radio.clear();
    this.ui.setRespawn('');
    const intro = this.mode.intro;
    // Build this match's Control lines in the background (one per frame) before they are needed.
    this.radio.warm([intro.radio, ...(this.mode.voiceLines?.() ?? [])].map((text) => ({ text, profile: 'control', speaker: 'Control' })));
    this._introLeft = retry ? 1.3 : intro.seconds;
    this.state = 'intro';
    this.simTime = 0;
    player.inputLocked = true;
    this.ui.setCinema(true);
    this.ui.setFade(true);
    this._later(60, () => this.ui.setFade(false));
    if (!retry) {
      this.ui.setIntro(true, intro.a, intro.b, intro.c);
      this._later(900, () => this.radio.say(intro.radio, 6));
    }
    this.audio('stinger_start');
    this.ctx.events.emit('game:start', { mode: modeId, retry });
  }

  restart() { this.start(this.modeId, { retry: true }); this.onRequestLock?.(); }

  /** Back to the free-roam sandbox behind the home page. */
  quit() {
    this._teardown();
    this.state = 'idle';
    this.modeId = null;
    this.ui.hideCard();
    this.ui.setScore(false);   // otherwise the deathmatch strip keeps its visible flag into the next mode
    this.ui.show(false);
    this.radio.clear();
    this._restoreSandbox();
    this.ctx.events.emit('game:quit', {});
    this.onRequestMenu?.();
  }

  _restoreSandbox() {
    const { ai, player, hud } = this.ctx;
    player.inputLocked = false;
    player.autoRespawn = true;
    if (player.isDead) player.respawn(true);
    try {
      ai.despawnAll();
      const n = this.ctx.config.gameplay.botCount ?? 7;
      for (let i = 0; i < n; i++) {
        const b = ai.spawnBot({});
        // Sandbox bots recycle themselves, like the original game.
        if (b) { b.extra = false; }
      }
      ai.autoRespawn = true;
    } catch (err) { console.warn('[game] sandbox restore:', err); }
    hud?.setMode?.('Free roam · Kharkiv Yard');
  }

  /** setTimeout tied to the current match: teardown cancels it. */
  _later(ms, fn) { this._timers.push(setTimeout(fn, ms)); }

  _teardown() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
    try { this.mode?.dispose(); } catch (err) { console.warn('[game] mode dispose:', err); }
    this.mode = null;
    this._hold = 0;
    this._holdTarget = null;
    this._cardTimer = -1;
    this.ui?.setPrompt('');
    this.ui?.setIntro(false);
    this.ui?.setRespawn('');
    if (this.ctx.player) this.ctx.player.inputLocked = false;
  }

  finish({ win, draw = false, why = '' } = {}) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    const s = this._summary();
    const m = this.mode;
    const rating = win && m.rate ? m.rate({ time: m.time, accuracy: s.accuracy, retries: this.retries }) : null;
    const practice = !!this.ctx.config.gameplay.practice;
    let bestTime = false;
    if (win && !practice && m.id !== 'deathmatch') bestTime = saveRecord(this.records, m.id, { time: m.time, rating });
    if (m.id === 'deathmatch' && !practice) saveRecord(this.records, m.id, { kills: m.kills, win });
    this.ctx.player.inputLocked = true;
    this.ui.setRespawn('');
    this.audio(win ? 'stinger_win' : 'stinger_lose');
    this.ctx.events.emit('game:over', { mode: m.id, win, draw, stats: s, rating });

    const rows = m.id === 'deathmatch' ? [] : [
      ['Time', fmtTime(m.time), bestTime],
      ['Kills', String(this.stats.kills)],
      ['Headshots', String(s.headshots)],
      ['Accuracy', `${Math.round(s.accuracy * 100)}%`],
      ['Retries', String(this.retries)],
    ];
    const rec = this.records[m.id];
    if (rec?.time && m.id !== 'deathmatch') rows.push(['Best time', fmtTime(rec.time)]);
    this._showCardSoon(win ? 2.6 : 1.4, {
      eyebrow: m.title,
      title: draw ? 'Draw' : !win ? 'Defeat' : ({ deathmatch: 'Victory', drill: 'Range clear' }[m.id] ?? 'Mission complete'),
      tone: draw ? '' : win ? 'good' : 'bad',
      why: why + (practice ? ' · practice mode (not recorded)' : ''),
      rows,
      rating: rating ?? undefined,
      table: m.table ? m.table(s) : undefined,
      buttons: [
        { label: m.id === 'operation' ? 'Redeploy' : 'Play again', primary: true, onClick: () => { this.retries = -1; this.restart(); } },
        { label: 'Main menu', onClick: () => this.quit() },
      ],
      hint: 'Enter · play again',
    });
  }

  /** Mission failure (death in a no-respawn mode). */
  fail({ title, why }) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.audio('stinger_lose');
    this.ctx.events.emit('game:over', { mode: this.mode.id, win: false, stats: this._summary() });
    this._showCardSoon(1.6, {
      eyebrow: this.mode.title,
      title,
      tone: 'bad',
      why,
      rows: [...(this.mode.deathRows?.() ?? []), ['Retries', String(this.retries)]],
      buttons: [
        { label: 'Retry', primary: true, onClick: () => this.restart() },
        { label: 'Main menu', onClick: () => this.quit() },
      ],
      hint: 'Enter · retry',
    });
  }

  _showCardSoon(seconds, spec) {
    this._cardSpec = spec;
    this._cardTimer = seconds;
  }

  _openCard() {
    this.ui.setPrompt('');
    this.ui.showCard(this._cardSpec);
    this._cardSpec = null;
    // A card needs a real cursor. Releasing the lock pauses the engine behind it.
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* noop */ }
    if (this.ctx.input?.cursorMode) this.ctx.input.exitCursorMode();
    this.ctx.events.emit('game:card', {});
  }

  _summary() {
    const w = this.ctx.weapons;
    const fired = w?.shotsFired ?? 0;
    return { accuracy: fired ? (w.shotsHit ?? 0) / fired : 0, headshots: w?.headshots ?? 0, kills: this.stats.kills, deaths: this.stats.deaths };
  }

  resupply(crate) {
    crate.use();
    this.ctx.weapons?.refill?.();
    this.audio('reload_mag_in');
    this.ui.banner('Resupplied', 'Magazines and frags', '', 1.4);
  }

  audio(id, volume = 1) { try { this.ctx.audio?.play?.(id, { volume }); } catch { /* optional */ } }
  shake(amount) { try { this.ctx.events.emit('camera:shake', { amplitude: amount, duration: 0.35, frequency: 18 }); } catch { /* noop */ } }

  _onCallout(p) {
    if (!this.playing || !p?.actor) return;
    const name = this.ctx.hud?._actorName?.(p.actor) ?? 'Hostile';
    this.radio.callout(name, p.kind, p.position ?? null);
    if (p.kind === 'contact') this.mode?.onContact?.();
  }

  /* ── frame ────────────────────────────────────────────────────────── */

  update(dt) {
    if (!this.ui) return;
    try {
      this.radio.update();
      this.ui.tick();
      const a11y = this.ctx.config.accessibility ?? {};
      this.ui.setFlags(a11y);
      if (this.state === 'idle' || !this.mode) return;
      this.simTime += dt;

      if (this._cardTimer >= 0) {
        this._cardTimer -= dt;
        if (this._cardTimer < 0) this._openCard();
      }

      if (this.state === 'intro') {
        this._introLeft -= dt;
        if (this._introLeft <= 0) {
          this.state = 'playing';
          this.ctx.player.inputLocked = false;
          this.ui.setCinema(false);
          this._later(1200, () => this.ui.setIntro(false));
        }
      } else if (this.state === 'playing') {
        this.mode.update(dt);
        this._updateInteract(dt);
      }
      this._updateOverlay();
    } catch (err) {
      if (!this._loggedErr) { this._loggedErr = true; console.error('[game] update failed:', err); }
    }
  }

  _updateInteract(dt) {
    const player = this.ctx.player;
    const input = this.ctx.input;
    if (player.isDead) { this._hold = 0; this.ui.setPrompt(''); return; }
    const eye = player.eyePosition;
    this.ctx.camera.getWorldDirection(_fwd);
    let best = null, bestScore = Infinity;
    for (const it of this.mode.interactables()) {
      _to.copy(it.focus).sub(eye);
      const d = _to.length();
      if (d > it.radius + 0.6) continue;
      const facing = _to.normalize().dot(_fwd);
      if (facing < 0.55) continue;
      const score = d - facing;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    // interactables() is rebuilt every frame, so identity is the prop, not the entry.
    const target = best?.prop ?? null;
    if (target !== this._holdTarget) { this._hold = 0; this._holdTarget = target; }
    if (!best) { this.ui.setPrompt(''); return; }
    const held = input?.isDown?.('Interact');
    if (held) {
      this._hold += dt;
      this._tickT = (this._tickT ?? 0) - dt;
      if (this._tickT <= 0) { this._tickT = 0.42; this.audio('objective_tick', 0.6); }
    } else {
      // Letting go drains faster than it fills — commit or start over.
      this._hold = Math.max(0, this._hold - dt * 1.6);
    }
    const prog = Math.min(1, this._hold / best.hold);
    this.ui.setPrompt(best.label, prog, keyName('interact'));
    if (prog >= 1) {
      this._hold = 0;
      this._holdTarget = null;
      best.onComplete();
    }
  }

  _updateOverlay() {
    const { player, camera, weapons } = this.ctx;
    const yaw = player.yaw;
    const heading = ((Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) * 180 / Math.PI) + 360) % 360;
    this.ui.setHeading(heading);
    this.ui.updateMarkers(this.mode.markers(), camera, player.eyePosition, heading);
    const h = this.mode.hud();
    this.ui.setTracker(h.op, h.objective, h.pips, h.timer);
    if (h.score) this.ui.setScore(true, h.score.us, h.score.them, h.score.clock, h.score.target);
    else this.ui.setScore(false);
    const a11y = this.ctx.config.accessibility ?? {};
    const hp01 = Math.max(0, Math.min(1, player.health / (player.maxHealth || 100)));
    this.ui.setHealth(!!a11y.healthBar, hp01, !player.isDead && hp01 < 0.28);
    if (weapons) {
      this.ui.setEquipment(weapons.grenades ?? 0, weapons.maxGrenades ?? 3,
        weapons.grenadeState === 'cooking', weapons.grenadeCharge ?? 0, weapons.grenadeFuseLeft ?? 3);
    }
  }

  dispose() {
    this._teardown();
    for (const off of this._offs) { try { off(); } catch { /* noop */ } }
    this._offs.length = 0;
    this.ui?.dispose();
  }
}

function keyName(id) { try { return keyLabel(getBinding(id)); } catch { return 'F'; } }

export { fmtTime };
export default GameSystem;
