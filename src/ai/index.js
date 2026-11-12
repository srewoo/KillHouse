/**
 * KILL HOUSE — AISystem.
 * OWNER: ai agent.  static id='ai', static order=30.
 *
 * Owns the enemy squad end to end: procedural bodies, procedural animation, a
 * rasterised navigation grid built from whatever geometry the level agent shipped,
 * perception, a cover-aware state machine, gunnery, ragdoll death and respawn.
 *
 * Everything expensive is budgeted per frame rather than per bot:
 *   · line-of-sight raycasts        (losBudget)
 *   · wall-probe raycasts           (wallBudget)
 *   · A* path solves                (2 per frame, queued)
 *   · cover evaluations             (1 per frame, queued)
 * so squad size scales without a frame-time cliff.
 *
 * Failure policy: every stage is wrapped. A broken nav grid degrades to direct
 * steering, a broken ragdoll degrades to a frozen corpse, a broken template
 * degrades to no bots at all — but the game always boots.
 */
import * as THREE from 'three';

import { buildTemplate } from './SoldierRig.js';
import { disposeSoldierTextures } from './textures.js';
import { NavGrid } from './NavGrid.js';
import { Bot, STATE } from './Bot.js';
import { Ragdoll } from './Ragdoll.js';
import { mulberry32, clamp01 } from './utils.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _e = new THREE.Vector3();

const MAX_BOTS = 24;
const TOKEN_MAX_HOLD = 2.5;
const SPAWN_REUSE_S = 6;

export class AISystem {
  static id = 'ai';
  static order = 30;

  constructor(ctx) {
    this.ctx = ctx;
    this.bots = [];
    this.template = null;
    this.nav = null;
    this.enabled = true;
    this.time = 0;

    this._rngSeed = 0x5eed1;
    this.rng = mulberry32(this._rngSeed);

    this.losBudget = 0;
    this.wallBudget = 0;
    this._pathQueue = [];
    this._coverQueue = [];
    this._pendingHits = [];
    this._ragdolls = [];
    this.maxRagdolls = 4;

    this._spawnPoints = [];
    this._pendingSpawns = [];
    this._materialsRegistered = false;
    this._offHandlers = [];

    /** When false, dead bots stay dead (respawn timers are ignored). */
    this.autoRespawn = true;

    // engager tokens: at most tuning().engagers bots may be firing at once
    this._tokens = [];
    // spawn bookkeeping (preallocated scratch, no per-pick allocation churn)
    this._recentSpawns = [];
    this._cand = [];
    // callout rate limit
    this._lastCalloutAt = -999;
    this._footBudget = 0;

    this.stats = { bots: 0, alive: 0, paths: 0, triangles: 0 };
  }

  makeRng(salt) { return mulberry32((this._rngSeed ^ (salt >>> 0)) >>> 0); }

  /** Current difficulty multipliers; falls back to medium on an unknown key. */
  tuning() {
    const g = this.ctx.config.gameplay;
    return g.difficulties[g.difficulty] ?? g.difficulties.medium;
  }

  respawnDelay() { return (5 + this.rng() * 7) * this.tuning().respawn; }

  /* ── init ─────────────────────────────────────────────────────────────── */

  async init(onProgress = () => {}) {
    const ctx = this.ctx;
    onProgress(0.05, 'ai: building soldiers');

    try {
      this.template = buildTemplate(ctx);
      this.stats.triangles = this.template.triangles;
      console.info(`[ai] soldier template: ${this.template.triangles} tris across ${Object.keys(this.template.geometries).length} materials`);
    } catch (err) {
      console.error('[ai] soldier template failed — no bots will spawn:', err);
      this.enabled = false;
      return;
    }

    onProgress(0.35, 'ai: navigation');
    try {
      this.nav = new NavGrid(ctx, { cell: 1.0 });
      const seed = ctx.player?.position ?? new THREE.Vector3();
      this.nav.build(seed);
    } catch (err) {
      console.warn('[ai] navigation build failed — bots will steer directly:', err);
      this.nav = null;
    }

    onProgress(0.7, 'ai: squad');
    this._collectSpawnPoints();

    const gp = ctx.config?.gameplay ?? {};
    const alive0 = Math.max(0, Math.min(MAX_BOTS, gp.botCount ?? 6));
    const count = Math.max(alive0, Math.min(MAX_BOTS, gp.botPool ?? 0));
    for (let i = 0; i < count; i++) {
      try {
        const bot = new Bot(this, i);
        this.bots.push(bot);
      } catch (err) {
        console.warn('[ai] bot construction failed:', err);
        break;
      }
    }
    this.stats.bots = this.bots.length;

    // Stagger the first wave so the map fills in rather than popping.
    this.bots.forEach((bot, i) => {
      if (i >= alive0) {            // reserve: hidden until ai.spawnBot()
        bot.reserved = true;
        bot.respawnTimer = Infinity;
        return;
      }
      const p = this.pickHiddenSpawn();
      if (p) bot.spawn(p);
      else bot.respawnTimer = 1 + i * 0.4;
    });

    this._wireEvents();
    onProgress(1, 'ai: ready');
  }

  _collectSpawnPoints() {
    const level = this.ctx.level;
    const list = [];
    const push = (v) => {
      if (!v) return;
      const p = v.isVector3 ? v : (Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2])
        : (typeof v === 'object' && 'x' in v ? new THREE.Vector3(v.x, v.y, v.z) : null));
      if (p) list.push(p);
    };
    for (const key of ['botSpawns', 'enemySpawns', 'spawnPoints', 'spawns']) {
      const src = level?.[key];
      if (Array.isArray(src)) for (const v of src) push(v?.position ?? v);
    }
    this._spawnPoints = list;
  }

  /** A spawn point on walkable ground, well away from the player. */
  _pickSpawn(seq = 0) {
    const player = this.ctx.player?.position;
    const minDist = 16;
    const candidates = [];

    for (const p of this._spawnPoints) {
      if (!player || p.distanceTo(player) > minDist) candidates.push(p);
    }
    if (candidates.length) {
      const p = candidates[(seq + ((this.rng() * candidates.length) | 0)) % candidates.length];
      _a.copy(p);
      if (this.nav?.ready) {
        const c = this.nav.nearestWalkable(_a.x, _a.z, 6);
        if (c >= 0) return this.nav.cellCentre(c, new THREE.Vector3());
      }
      return _a.clone();
    }

    if (this.nav?.ready) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cell = this.nav.randomWalkable(this.rng, player, minDist - attempt * 4);
        if (cell >= 0) return this.nav.cellCentre(cell, new THREE.Vector3());
      }
    }

    // last resort: a ring around the origin
    const ang = this.rng() * Math.PI * 2;
    const r = 18 + this.rng() * 8;
    return new THREE.Vector3(Math.sin(ang) * r, 0, Math.cos(ang) * r);
  }

  _wireEvents() {
    const ev = this.ctx.events;
    if (!ev) return;

    // Gunfire is the loudest thing in the world; every bot in earshot reacts.
    this._offHandlers.push(ev.on('weapon:fire', (p) => {
      const origin = p?.origin ?? this.ctx.player?.eyePosition;
      if (!origin) return;
      for (const bot of this.bots) {
        if (!bot.alive) continue;
        const d = bot.pos.distanceTo(origin);
        if (d > 55) continue;
        // Muffled through geometry: a shot you cannot see is harder to place.
        bot.hearGunshot(origin, clamp01(1 - d / 55) * 0.9 + 0.1);
      }
      try { this._nearMiss(p, origin); } catch (err) { console.warn('[ai] near-miss failed:', err); }
    }));

    this._offHandlers.push(ev.on('grenade:live', (p) => {
      try { this._onGrenadeLive(p); } catch (err) { console.warn('[ai] grenade response failed:', err); }
    }));

    this._offHandlers.push(ev.on('player:death', (p) => {
      const bot = p?.killer?.bot;
      if (bot && this.bots.includes(bot)) bot.kills++;
    }));

    /**
     * Fallback path for a weapon system that reports hits by EVENT ONLY.
     *
     * The shipped one does both: it emits `hit:actor` and then calls
     * `actor.applyDamage(...)` on the very next line. Handling the event here as
     * well applied every round twice and halved the number of shots a soldier
     * could take. So this defers: it records the hit, and a deferred pass at the
     * top of the next update() applies it only if nobody called the actor
     * directly in the meantime.
     */
    this._offHandlers.push(ev.on('hit:actor', (p) => {
      const actor = p?.actor;
      const bot = actor?.bot ?? (actor?.isBot ? actor : null);
      if (!bot || !bot.alive || !(p.damage > 0)) return;
      actor.__directDamage = false;
      this._pendingHits.push({
        actor,
        bot,
        damage: p.damage,
        headshot: !!p.isHeadshot || !!actor.isHead,
        point: p.point ? p.point.clone() : null,
        from: (p.origin ?? this.ctx.player?.eyePosition)?.clone?.() ?? null,
      });
    }));
  }

  /* ── shared services the bots call ────────────────────────────────────── */

  /** Queue an A* solve. Returns true if the request was accepted. */
  requestPath(bot) {
    if (!this.nav?.ready) return false;
    if (this._pathQueue.includes(bot)) return true;
    if (this._pathQueue.length > 12) return false;
    this._pathQueue.push(bot);
    return true;
  }

  _servicePaths() {
    let solved = 0;
    while (this._pathQueue.length && solved < 2) {
      const bot = this._pathQueue.shift();
      if (!bot.alive || !bot.hasGoal) continue;
      solved++;
      try {
        const ok = this.nav.findPath(bot.pos, bot.goal, bot.path);
        bot.pathIndex = 0;
        bot.pathAge = 0;
        this.stats.paths++;
        if (!ok) {
          bot.path.length = 0;
          // Unreachable goal: stop asking for it.
          if (bot.state === STATE.PATROL || bot.state === STATE.SEEK_COVER) bot.hasGoal = false;
        }
      } catch (err) {
        console.warn('[ai] pathfind failed:', err);
        bot.path.length = 0;
        bot.hasGoal = false;
      }
    }
  }

  /**
   * A nearby cell that breaks the player's line of sight. Evaluated against the
   * real physics world, budgeted to one bot per frame so a whole squad calling
   * this at once cannot spike the frame.
   */
  findCover(bot) {
    const nav = this.nav;
    const player = this.ctx.player;
    if (!nav?.ready || !player) return null;
    if (this._coverThisFrame) return null;
    this._coverThisFrame = true;

    const eye = _a.copy(player.eyePosition ?? player.position).setY(
      (player.eyePosition ?? player.position).y + (player.eyePosition ? 0 : 1.6),
    );

    let best = null, bestScore = -Infinity;
    const radius = 11;
    for (let i = 0; i < 10; i++) {
      const ang = this.rng() * Math.PI * 2;
      const r = 2.5 + this.rng() * radius;
      const x = bot.pos.x + Math.sin(ang) * r;
      const z = bot.pos.z + Math.cos(ang) * r;
      const cell = nav.cellAt(x, z);
      if (!nav.isWalkable(cell)) continue;
      nav.cellCentre(cell, _b);

      // Standing chest height at the candidate.
      _c.set(_b.x, _b.y + 1.15, _b.z);
      const exposed = this.ctx.physics?.hasLineOfSight(eye, _c) ?? true;
      if (exposed) continue;

      // Prefer close, enclosed cells that still face roughly toward the threat.
      const distCost = _b.distanceTo(bot.pos);
      const score = nav.exposure[cell] * 1.5 - distCost * 0.6
        + (_b.distanceTo(player.position) > 8 ? 1.5 : -2);
      if (score > bestScore) { bestScore = score; best = _b.clone(); }
    }
    return best;
  }

  /** A cell with sight of the last known position from a materially different bearing. */
  findFlank(bot) {
    const nav = this.nav;
    if (!nav?.ready || !bot.hasLastKnown) return null;
    const target = bot.lastKnown;
    const baseAng = Math.atan2(bot.pos.x - target.x, bot.pos.z - target.z);
    const side = this.rng() < 0.5 ? 1 : -1;
    const dist = Math.max(7, Math.min(24, bot.pos.distanceTo(target)));
    for (let i = 0; i < 5; i++) {
      const ang = baseAng + side * (0.8 + i * 0.28);
      const x = target.x + Math.sin(ang) * dist;
      const z = target.z + Math.cos(ang) * dist;
      const cell = nav.nearestWalkable(x, z, 3);
      if (cell < 0) continue;
      nav.cellCentre(cell, _b);
      if (_b.distanceTo(bot.pos) < 4) continue;
      return _b.clone();
    }
    return null;
  }

  /**
   * Damage the player.
   *
   * INTEGRATION: `ctx.player.applyDamage()` is the authority — it decrements
   * health, kicks the rig and emits the canonical `player:damage` itself. The
   * previous version of this method emitted the event *instead* of calling
   * applyDamage whenever anything was subscribed, and audio + hud subscribe, so
   * the "somebody is listening" test always passed and the player's health
   * never moved: bots shot you forever and you never died. Call the system;
   * only fall back to a raw emit if the player system is missing entirely.
   */
  damagePlayer(amount, fromWorld, bot = null) {
    const ctx = this.ctx;
    const from = _c.copy(fromWorld);
    const player = ctx.player;
    if (player && typeof player.applyDamage === 'function') {
      try {
        player.applyDamage(amount, from, bot?.bodyActor ?? null);
        return;
      } catch (err) {
        console.warn('[ai] player.applyDamage threw:', err);
      }
    }
    // No player system (or it threw) — at least let the HUD and audio react.
    try { ctx.events?.emit('player:damage', { amount, from: from.clone(), attacker: bot?.bodyActor ?? null }); } catch { /* noop */ }
  }

  acquireRagdoll(bot, opts) {
    // Hard cap: retire the oldest corpse before adding a new one.
    while (this._ragdolls.length >= this.maxRagdolls) {
      const old = this._ragdolls.shift();
      try { old.owner.rig.group.visible = false; } catch { /* noop */ }
      try { old.dispose(); } catch { /* noop */ }
      if (old.owner) old.owner.ragdoll = null;
    }
    const rd = new Ragdoll(this.ctx, bot.rig, opts);
    rd.owner = bot;
    if (rd.ok) this._ragdolls.push(rd);
    return rd;
  }

  _clearRagdoll(bot) {
    if (!bot.ragdoll) return;
    const i = this._ragdolls.indexOf(bot.ragdoll);
    if (i >= 0) this._ragdolls.splice(i, 1);
    try { bot.ragdoll.dispose(); } catch { /* noop */ }
    bot.ragdoll = null;
  }

  requestRespawn(bot) {
    if (bot.alive || !this.autoRespawn || bot.reserved) return;
    this._clearRagdoll(bot);
    const p = this.pickHiddenSpawn();
    if (!p) { bot.respawnTimer = 2; return; }
    try { bot.spawn(p); } catch (err) {
      console.warn('[ai] respawn failed:', err);
      bot.respawnTimer = 4;
    }
  }

  /* ── public control API ───────────────────────────────────────────────── */

  aliveCount() {
    let n = 0;
    for (let i = 0; i < this.bots.length; i++) if (this.bots[i].alive) n++;
    return n;
  }

  /** Fills `out` with the live bots' position vectors (references, not copies). */
  livingPositions(out = []) {
    out.length = 0;
    for (let i = 0; i < this.bots.length; i++) if (this.bots[i].alive) out.push(this.bots[i].pos);
    return out;
  }

  resetStats() {
    for (const bot of this.bots) { bot.kills = 0; bot.deaths = 0; }
  }

  /**
   * Bring one bot into the world. Takes a reserved bot if there is one, otherwise
   * the longest-dead. opts: { position, kind: 'rifleman'|'heavy', passive,
   * faceToward, alert }. Returns the Bot, or null when none is free.
   */
  spawnBot(opts = {}) {
    if (!this.enabled) return null;
    let pick = null;
    for (const b of this.bots) {
      if (b.alive) continue;
      if (b.reserved) { pick = b; break; }
      if (!pick || b.corpseTimer > pick.corpseTimer) pick = b;
    }
    if (!pick) return null;

    this._clearRagdoll(pick);
    const pos = _a.set(0, 0, 0);
    let ok = false;
    if (opts.position) {
      pos.copy(opts.position);
      if (this.nav?.ready) {
        const c = this.nav.nearestWalkable(pos.x, pos.z, 6);
        if (c >= 0) this.nav.cellCentre(c, pos);
      }
      ok = true;
    }
    if (!ok) pos.copy(this.pickHiddenSpawn(_e));
    try {
      pick.spawn(pos, opts);
    } catch (err) {
      console.warn('[ai] spawnBot failed:', err);
      return null;
    }
    pick.extra = true;
    pick.respawnTimer = Infinity;
    if (opts.alert && !pick.passive) {
      const target = this.ctx.player?.position;
      if (target) this._alert(pick, target);
    }
    return pick;
  }

  /** Silently remove every bot (no death event, no audio). */
  despawnAll() {
    for (const bot of this.bots) {
      try { this._clearRagdoll(bot); } catch { /* noop */ }
      try { bot.despawn(); } catch (err) { console.warn('[ai] despawn failed:', err); }
    }
    for (const rd of this._ragdolls) {
      try { rd.dispose(); } catch { /* noop */ }
      if (rd.owner) rd.owner.ragdoll = null;
    }
    this._ragdolls.length = 0;
    this._pathQueue.length = 0;
    this._tokens.length = 0;
  }

  /** Every living bot learns `position` and goes to ENGAGE. */
  alertAll(position) {
    if (!position) return;
    for (const bot of this.bots) if (bot.alive && !bot.passive) this._alert(bot, position);
  }

  _alert(bot, position) {
    bot.lastKnown.copy(position);
    bot.hasLastKnown = true;
    bot.awareness = Math.max(bot.awareness, 1);
    if (bot.state !== STATE.ENGAGE && bot.state !== STATE.RELOAD) {
      bot.hasGoal = false;
      bot.setState(STATE.ENGAGE);
    }
  }

  /* ── smart spawns ─────────────────────────────────────────────────────── */

  _spawnVisible(eye, p) {
    const phys = this.ctx.physics;
    if (!eye || !phys?.hasLineOfSight) return false;
    _d.set(p.x, p.y + 1.25, p.z);
    try { return !!phys.hasLineOfSight(eye, _d); } catch { return false; }
  }

  _spawnRecent(p) {
    const list = this._recentSpawns;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (this.time - r.t > SPAWN_REUSE_S) { list.splice(i, 1); continue; }
      if (Math.hypot(r.x - p.x, r.z - p.z) < 3) return true;
    }
    return false;
  }

  /**
   * A spawn the player cannot currently see: level spawn points plus random nav
   * cells, no line of sight from the player's eye to the chest, as far away as
   * possible (26 m, then 14 m, then any), never a point used in the last 6 s.
   */
  pickHiddenSpawn(out = new THREE.Vector3()) {
    const player = this.ctx.player;
    const feet = player?.position ?? null;
    const eye = player?.eyePosition ?? null;
    const nav = this.nav?.ready ? this.nav : null;
    const cand = this._cand;
    let n = 0;
    const slot = () => (cand[n] ??= { p: new THREE.Vector3(), d: 0, vis: -1, recent: false });

    for (const sp of this._spawnPoints) {
      const c = slot(); c.p.copy(sp);
      if (nav) {
        const cell = nav.nearestWalkable(sp.x, sp.z, 6);
        if (cell >= 0) nav.cellCentre(cell, c.p);
      }
      n++;
    }
    if (nav) {
      for (let i = 0; i < 16; i++) {
        const cell = nav.randomWalkable(this.rng);
        if (cell < 0) break;
        nav.cellCentre(cell, slot().p);
        n++;
      }
    }
    if (n === 0) return out.copy(this._pickSpawn(0));

    for (let i = 0; i < n; i++) {
      const c = cand[i];
      c.d = feet ? Math.hypot(c.p.x - feet.x, c.p.z - feet.z) : 1e6;
      c.vis = -1;
      c.recent = this._spawnRecent(c.p);
    }

    let chosen = null;
    for (const minDist of [26, 14, 0]) {
      let bestScore = -Infinity;
      for (let i = 0; i < n; i++) {
        const c = cand[i];
        if (c.recent || c.d < minDist) continue;
        if (c.vis < 0) c.vis = this._spawnVisible(eye, c.p) ? 1 : 0;
        if (c.vis) continue;
        const score = Math.min(c.d, 90) + this.rng() * 8;
        if (score > bestScore) { bestScore = score; chosen = c; }
      }
      if (chosen) break;
    }
    if (!chosen) {   // nothing hidden: take the farthest point rather than fail
      let bestD = -1;
      for (let i = 0; i < n; i++) if (cand[i].d > bestD) { bestD = cand[i].d; chosen = cand[i]; }
    }
    out.copy(chosen.p);
    this._recentSpawns.push({ x: out.x, z: out.z, t: this.time });
    return out;
  }

  /* ── engager tokens ───────────────────────────────────────────────────── */

  requestToken(bot) {
    if (bot.hasToken) return true;
    if (bot.passive || this.time < bot.tokenCooldownUntil) return false;
    if (this._tokens.length >= Math.max(1, this.tuning().engagers | 0)) return false;
    this._tokens.push(bot);
    bot.hasToken = true;
    bot.tokenSince = this.time;
    return true;
  }

  releaseToken(bot, cooldown = 0) {
    if (!bot.hasToken) return;
    const i = this._tokens.indexOf(bot);
    if (i >= 0) this._tokens.splice(i, 1);
    bot.hasToken = false;
    if (cooldown > 0) bot.tokenCooldownUntil = this.time + cooldown;
  }

  _sweepTokens() {
    for (let i = this._tokens.length - 1; i >= 0; i--) {
      const b = this._tokens[i];
      if (!b.alive || b.state !== STATE.ENGAGE) this.releaseToken(b);
    }
  }

  /* ── squad reactions ──────────────────────────────────────────────────── */

  onBotDamaged(bot, from) {
    const src = from ?? this.ctx.player?.eyePosition ?? this.ctx.player?.position;
    if (!src) return;
    for (const o of this.bots) {
      if (o === bot || !o.alive || o.passive) continue;
      if (o.pos.distanceToSquared(bot.pos) > 26 * 26) continue;
      o.lastKnown.copy(src);
      o.hasLastKnown = true;
      o.awareness = Math.max(o.awareness, 0.8);
    }
  }

  onBotDied(bot) {
    if (bot.passive) return;
    for (const o of this.bots) {
      if (o === bot || !o.alive || o.passive) continue;
      if (o.pos.distanceToSquared(bot.pos) > 30 * 30) continue;
      if (this.callout(o, 'mandown')) break;
    }
  }

  /** Radio call, rate limited (global 2.5 s, per bot 6 s), only near the player. */
  callout(bot, kind) {
    if (bot.passive || !bot.alive) return false;
    const t = this.time;
    if (t - this._lastCalloutAt < 2.5 || t - bot.lastCalloutAt < 6) return false;
    const player = this.ctx.player;
    if (!player || bot.pos.distanceToSquared(player.position) > 45 * 45) return false;
    this._lastCalloutAt = t;
    bot.lastCalloutAt = t;
    try { this.ctx.events?.emit('ai:callout', { actor: bot.bodyActor, kind, position: bot.pos.clone() }); } catch { /* noop */ }
    return true;
  }

  /** Rounds cracking past a bot pin it down and tell it where they came from. */
  _nearMiss(p, origin) {
    let dir = _dir;
    if (p?.dir && Number.isFinite(p.dir.x)) dir.set(p.dir.x, p.dir.y, p.dir.z).normalize();
    else if (this.ctx.camera) this.ctx.camera.getWorldDirection(dir);
    else return;
    for (const bot of this.bots) {
      if (!bot.alive || bot.passive) continue;
      bot.chestPoint(_e);
      const vx = _e.x - origin.x, vy = _e.y - origin.y, vz = _e.z - origin.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t < 0 || t > 80) continue;
      const perp2 = vx * vx + vy * vy + vz * vz - t * t;
      if (perp2 >= 1.6 * 1.6) continue;
      bot.suppression = Math.min(1.6, bot.suppression + 0.35);
      bot.lastKnown.copy(origin);
      bot.hasLastKnown = true;
      bot.awareness = Math.min(1.35, Math.max(bot.awareness, 0.6) + 0.25);
    }
  }

  /** A live grenade near a bot: run to a cell clear of the blast. */
  _onGrenadeLive(p) {
    const gp = p?.position;
    if (!gp) return;
    const radius = Number(p.radius) || 6;
    const clear = radius + 3;
    const nav = this.nav?.ready ? this.nav : null;
    for (const bot of this.bots) {
      if (!bot.alive || bot.passive) continue;
      const d = bot.pos.distanceTo(gp);
      if (d > radius + 2.5) continue;
      if (bot.fleeing && bot.hasGoal) continue;   // already running

      const base = Math.atan2(bot.pos.x - gp.x, bot.pos.z - gp.z);
      let found = false, bestCost = Infinity;
      for (let i = 0; i < 7; i++) {
        const ang = base + (i === 0 ? 0 : ((i & 1) ? 1 : -1) * Math.ceil(i / 2) * 0.55);
        const x = gp.x + Math.sin(ang) * (clear + 1.5);
        const z = gp.z + Math.cos(ang) * (clear + 1.5);
        if (nav) {
          const cell = nav.nearestWalkable(x, z, 3);
          if (cell < 0) continue;
          nav.cellCentre(cell, _d);
        } else _d.set(x, bot.pos.y, z);
        if (Math.hypot(_d.x - gp.x, _d.z - gp.z) < clear) continue;
        const cost = _d.distanceTo(bot.pos);
        if (cost < bestCost) { bestCost = cost; _e.copy(_d); found = true; }
      }
      if (!found) continue;
      bot.fleeing = true;
      bot.hasCover = false;
      bot.setGoal(_e);
      bot.setState(STATE.SEEK_COVER);
      this.callout(bot, 'grenade');
    }
  }

  /** Distance-based bot footsteps, at most three per frame. */
  _footsteps(bot, dt) {
    if (!bot.alive || bot.passive || bot.speed < 0.6) return;
    bot.stepAcc += bot.speed * dt;
    const k = clamp01((bot.speed - 1.5) / 3.9);
    const stride = 1.3 + 0.6 * k;
    if (bot.stepAcc < stride) return;
    bot.stepAcc -= stride;
    const player = this.ctx.player;
    if (!player || this._footBudget <= 0) return;
    if (bot.pos.distanceToSquared(player.position) > 35 * 35) return;
    this._footBudget--;
    let volume = 0.25 + 0.30 * k;
    if (bot.crouch) volume *= 0.55;
    bot.footPos.copy(bot.pos);
    try {
      this.ctx.audio?.play?.('footstep', {
        position: bot.footPos, volume, pitch: 0.9 + bot.rng() * 0.2, surface: 'concrete',
      });
    } catch { /* optional */ }
  }

  /* ── frame ────────────────────────────────────────────────────────────── */

  update(dt, elapsed) {
    if (!this.enabled) return;
    this.time = elapsed ?? (this.time + dt);

    // The lighting system comes up after us (order 70). Register our materials the
    // first frame it exists — an unregistered lit material takes the non-CSM branch
    // and receives all four cascades at full intensity, i.e. 4x overexposed.
    if (!this._materialsRegistered && this.ctx.lighting) {
      this._materialsRegistered = true;
      try {
        const mats = this.template?.materials;
        const scale = this.ctx.materials?.envIntensityScale ?? 1;
        for (const key of Object.keys(mats || {})) {
          const m = mats[key];
          if (this.ctx.lighting.registerMaterial) this.ctx.lighting.registerMaterial(m);
          else this.ctx.lighting.csm?.setupMaterial?.(m);
          // MaterialSystem.applyEnvMap() only walks its own cache, and ours are
          // built at order 30 — before the PMREM exists. Bind it ourselves, at the
          // same env weight the rest of the scene is using, or the squad sits a
          // stop out of key with everything around it.
          if (this.ctx.materials?.envMap) {
            m.envMap = this.ctx.materials.envMap;
            m.envMapIntensity = (m.userData.baseEnv ?? 1) * scale;
            m.needsUpdate = true;
          }
        }
      } catch (err) {
        console.warn('[ai] material registration failed:', err);
      }
    }

    // Deferred event-only damage — see the 'hit:actor' handler.
    if (this._pendingHits.length) {
      for (const h of this._pendingHits) {
        if (h.actor.__directDamage) { h.actor.__directDamage = false; continue; }
        try {
          h.bot.applyDamage(h.damage, {
            headshot: h.headshot,
            point: h.point,
            from: h.from,
            killer: this.ctx.player ?? null,
          });
        } catch (err) { console.warn('[ai] deferred hit failed:', err); }
      }
      this._pendingHits.length = 0;
    }

    // Per-frame budgets.
    this.losBudget = 14;
    this.wallBudget = 10;
    this._coverThisFrame = false;

    this._servicePaths();
    this._sweepTokens();
    this._footBudget = 3;

    const cam = this.ctx.camera;
    let alive = 0;
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      let detail = 1;
      if (cam) {
        const d = bot.pos.distanceTo(cam.position);
        // Far background bots still walk and shoot, they just do not solve IK.
        if (d > 62) detail = 0;
        /**
         * Four cascades × three skinned meshes is the real cost of a soldier, so
         * shadow casting is a RAMP rather than one on/off cutoff:
         *
         *   < 30 m   all three buckets cast
         *   < 46 m   fabric + hard        (drop the load-bearing gear)
         *   < 55 m   fabric only          (body silhouette)
         *   ≥ 55 m   nothing casts
         *
         * Both middle bands are free quality, because a cast shadow only carries
         * the OUTLINE. The gear bucket is pouches, MOLLE ladders, straps and the
         * sling — 3.0k triangles of 2-centimetre relief that sits *inside* a
         * silhouette the body and plate already define, so through a cascade-2
         * penumbra several texels wide it changes no pixel of the shadow. Past
         * 46 m the helmet and boots are two screen pixels and the fabric bucket
         * (torso, limbs, skull) is the whole readable shape on its own.
         *
         * Measured at the warehouse pose, where three of seven bots sit in the
         * 44-47 m band: this removes ~24 shadow draw calls and ~130k triangles a
         * frame. That is what pays for the boot, webbing and helmet-cover
         * geometry this pass added (+2,524 tris per soldier, 8,160 -> 10,684).
         *
         * At a 9° sun a man throws a 12-metre shadow and that shadow is the ONLY
         * thing anchoring him to the ground at mid distance, so the OUTER cutoff
         * does not move — the ramp only thins what casts, never how far.
         */
        const lod = d < 30 ? 3 : d < 46 ? 2 : d < 55 ? 1 : 0;
        if (bot._shadowLod !== lod) {
          bot._shadowLod = lod;
          for (const m of bot.rig.meshes) {
            const b = m.userData.aiBucket;
            m.castShadow = lod === 3
              || (lod === 2 && b !== 'gear')
              || (lod === 1 && b === 'fabric');
          }
        }
      }
      try {
        bot.update(dt, detail);
      } catch (err) {
        if (!bot._updateError) {
          bot._updateError = true;
          console.error('[ai] bot update failed (suppressing further reports):', err);
        }
      }
      if (bot.alive) { alive++; this._footsteps(bot, dt); }
    }
    this.stats.alive = alive;
  }

  /* ── teardown ─────────────────────────────────────────────────────────── */

  dispose() {
    for (const off of this._offHandlers) { try { off(); } catch { /* noop */ } }
    this._offHandlers.length = 0;
    for (const rd of this._ragdolls) { try { rd.dispose(); } catch { /* noop */ } }
    this._ragdolls.length = 0;
    for (const bot of this.bots) { try { bot.dispose(); } catch { /* noop */ } }
    this.bots.length = 0;
    try {
      for (const key of Object.keys(this.template?.geometries || {})) {
        this.template.geometries[key].dispose();
      }
      for (const key of Object.keys(this.template?.materials || {})) {
        this.template.materials[key].dispose();
      }
    } catch { /* noop */ }
    try { disposeSoldierTextures(); } catch { /* noop */ }
    this.template = null;
    this.nav = null;
  }
}

export default AISystem;
