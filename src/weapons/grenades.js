import * as THREE from 'three';

/**
 * KILL HOUSE — frag grenades.
 *
 * CONTROL SCHEME (hold-to-cook, release-to-throw):
 *   - Press 'Grenade' (G): pull the pin, fuse (3.0 s) starts, state = 'cooking'.
 *   - Keep it held: throw power charges 0..1 over 0.8 s.
 *   - Release 'Grenade': throw with that charge.
 *   - Right mouse while cooking: gentle underhand drop/lob (charge ~0.05).
 *   - If the fuse runs out in hand the grenade detonates on the player.
 *   - Rifle fire is blocked while cooking and the viewmodel is lowered.
 *
 * Driven by WeaponSystem: `update(dt, wantCook, wantRelease, wantLob)` once per frame.
 * OWNER: weapons.
 */

const FUSE = 3.0;
const CHARGE_TIME = 0.8;
const RADIUS = 7;
const GRAVITY = -18.5;
const STEP = 1 / 120;
const RESTITUTION = 0.35;
const FRICTION = 0.72;
const LIVE_PERIOD = 0.25;
const BOUNCE_GAP = 0.09;
const MAX_LIVE = 8;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _eyeUp = new THREE.Vector3();

export class Grenades {
  constructor(ctx, { max = 3 } = {}) {
    this.ctx = ctx;
    this.max = max;
    this.count = ctx.config?.gameplay?.grenades ?? max;
    this.state = 'idle';       // 'idle' | 'cooking'
    this.charge = 0;           // 0..1
    this.fuseLeft = 0;         // seconds; meaningful while cooking
    /** @type {Array<object>} */
    this.live = [];
    this._geom = null;
    this._mat = null;
    this._lastBounce = -1;
    this._clock = 0;
  }

  get busy() { return this.state === 'cooking'; }

  give(n = 1) { this.count = Math.min(this.max, this.count + Math.max(0, n | 0)); }
  refill() { this.count = this.max; }

  reset() {
    this.cancel();
    for (const g of this.live) this._removeMesh(g);
    this.live.length = 0;
    this.count = this.max;
  }

  cancel() { this.state = 'idle'; this.charge = 0; this.fuseLeft = 0; }

  /** Per-frame. `input` flags are computed by WeaponSystem (already lock/dead-gated). */
  update(dt, { start = false, release = false, lob = false, held = false, abort = false } = {}) {
    this._clock += dt;
    if (this.state === 'idle') {
      if (start && this.count > 0) {
        this.state = 'cooking';
        this.charge = 0;
        this.fuseLeft = FUSE;
        this._emitAudio('grenade_pin');
      }
    } else {
      this.fuseLeft -= dt;
      if (held) this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      if (abort) {
        // Player died / lost control: drop it at their feet, still armed.
        this._throw(0, true);
      } else if (this.fuseLeft <= 0) {
        this.count--;
        const p = this._eye(_a);
        this.cancel();
        this._explode(p.clone());
      } else if (lob) {
        this._throw(0.05, false, true);
      } else if (release || !held) {
        this._throw(this.charge, false);
      }
    }
    this._stepLive(dt);
  }

  /* ───────────────────────────── throw ────────────────────────────────── */

  _eye(out) {
    const { ctx } = this;
    return out.copy(ctx.player?.eyePosition?.isVector3 ? ctx.player.eyePosition : ctx.camera.position);
  }

  _throw(charge, drop, lob = false) {
    const { ctx } = this;
    const fuse = Math.max(0.05, this.fuseLeft);
    this.count = Math.max(0, this.count - 1);
    this.cancel();

    const pos = this._eye(new THREE.Vector3());
    ctx.camera.getWorldDirection(_fwd);
    const vel = new THREE.Vector3();
    if (drop) {
      pos.y -= 0.9;
    } else {
      const speed = lob ? 4.5 : 9 + 13 * charge;
      vel.copy(_fwd).multiplyScalar(speed);
      vel.y += 2.5;
      pos.addScaledVector(_fwd, 0.35);
      pos.y -= 0.15;
      const pv = ctx.player?.velocity;
      if (pv?.isVector3) vel.add(pv);
    }

    // Do not spawn inside a wall the player is hugging.
    const phys = ctx.physics;
    if (phys?.raycast && !drop) {
      const eye = this._eye(_b);
      _v.copy(pos).sub(eye);
      const d = _v.length();
      const hit = d > 1e-4 ? phys.raycast(eye, _v, d, this._filter()) : null;
      if (hit) pos.copy(hit.point).addScaledVector(hit.normal, 0.1);
    }

    const g = {
      pos, vel, fuse, mesh: this._makeMesh(), liveT: 0, rest: false,
      spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      acc: 0,
    };
    g.mesh.position.copy(pos);
    ctx.scene?.add(g.mesh);
    this.live.push(g);
    if (this.live.length > MAX_LIVE) {
      const old = this.live.shift();
      this._removeMesh(old);
    }
    try { ctx.events?.emit('grenade:thrown', { position: pos.clone(), velocity: vel.clone(), fuse }); } catch (e) { /* noop */ }
  }

  _filter() {
    const phys = this.ctx.physics;
    const G = phys?.GROUPS ?? { PROJECTILE: 0x10, WORLD: 1 };
    return { group: G.PROJECTILE, mask: G.WORLD >>> 0, excludeActor: this.ctx.player ?? null };
  }

  /* ───────────────────────────── mesh ─────────────────────────────────── */

  _makeMesh() {
    if (!this._geom) {
      const body = new THREE.SphereGeometry(0.045, 12, 8);
      body.scale(1, 1.2, 1);
      const cap = new THREE.CylinderGeometry(0.018, 0.022, 0.04, 8);
      cap.translate(0, 0.07, 0);
      const lever = new THREE.BoxGeometry(0.012, 0.075, 0.016);
      lever.translate(0.03, 0.045, 0);
      this._geom = [body, cap, lever];
      this._mat = [
        new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.62, metalness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0x6b6f66, roughness: 0.4, metalness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x6b6f66, roughness: 0.4, metalness: 0.8 }),
      ];
    }
    const grp = new THREE.Group();
    this._geom.forEach((g, i) => {
      const m = new THREE.Mesh(g, this._mat[i]);
      m.castShadow = true;
      grp.add(m);
    });
    grp.scale.setScalar(1.15);
    return grp;
  }

  _removeMesh(g) {
    try { g.mesh?.parent?.remove(g.mesh); } catch (e) { /* noop */ }
  }

  /* ───────────────────────────── simulation ───────────────────────────── */

  _stepLive(dt) {
    const { ctx } = this;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      g.acc += Math.min(dt, 0.1);
      while (g.acc >= STEP && !g.rest) { g.acc -= STEP; this._integrate(g, STEP); }
      if (g.rest) g.acc = 0;
      g.mesh.position.copy(g.pos);
      if (!g.rest) {
        g.mesh.rotation.x += g.spin.x * dt;
        g.mesh.rotation.y += g.spin.y * dt;
        g.mesh.rotation.z += g.spin.z * dt;
      }

      g.liveT -= dt;
      if (g.liveT <= 0) {
        g.liveT = LIVE_PERIOD;
        try {
          ctx.events?.emit('grenade:live', { position: g.pos.clone(), radius: RADIUS, fuse: Math.max(0, g.fuse) });
        } catch (e) { /* noop */ }
      }

      if (g.fuse <= 0) {
        this.live.splice(i, 1);
        this._removeMesh(g);
        this._explode(g.pos.clone());
      }
    }
  }

  _integrate(g, h) {
    const phys = this.ctx.physics;
    g.vel.y += GRAVITY * h;
    _v.copy(g.vel).multiplyScalar(h);
    const len = _v.length();
    if (len < 1e-6) return;
    const hit = phys?.raycast ? phys.raycast(g.pos, _v, len + 0.05, this._filter()) : null;
    if (!hit || hit.distance > len + 0.05) {
      g.pos.add(_v);
      return;
    }
    const n = _n.copy(hit.normal);
    g.pos.copy(hit.point).addScaledVector(n, 0.05);
    const vn = g.vel.dot(n);
    if (vn < 0) {
      // reflect normal component with restitution, damp tangential (friction)
      _a.copy(n).multiplyScalar(vn);
      _b.copy(g.vel).sub(_a).multiplyScalar(FRICTION);
      g.vel.copy(_b).addScaledVector(n, -vn * RESTITUTION);
      g.spin.multiplyScalar(0.7);
      if (-vn > 2.0 && this._clock - this._lastBounce > BOUNCE_GAP) {
        this._lastBounce = this._clock;
        this._emitAudio('grenade_bounce', g.pos.clone(), Math.min(1, -vn / 8));
      }
    }
    if (n.y > 0.6 && g.vel.length() < 1.3) {
      g.vel.set(0, 0, 0);
      g.rest = true;
    }
  }

  /* ───────────────────────────── explosion ────────────────────────────── */

  _explode(pos) {
    const { ctx } = this;
    const events = ctx.events;
    try { events?.emit('grenade:explode', { position: pos.clone(), radius: RADIUS }); } catch (e) { /* noop */ }
    this._emitAudio('explosion', pos.clone(), 1);

    // camera shake scaled by distance
    try {
      const eye = ctx.player?.eyePosition ?? ctx.camera.position;
      const d = eye.distanceTo(pos);
      const k = Math.max(0, 1 - d / (RADIUS * 2.5));
      if (k > 0) events?.emit('camera:shake', { amplitude: 0.05 * k + 0.004, duration: 0.6, frequency: 14 });
    } catch (e) { /* noop */ }

    // visuals
    let ground = null;
    try {
      ctx.lighting?.flash?.(pos, 3);
      const phys = ctx.physics;
      if (phys?.raycast) {
        const h = phys.raycast(_a.copy(pos).setY(pos.y + 0.3), _eyeUp.set(0, -1, 0), 3, this._filter());
        if (h) ground = h;
      }
      const gp = ground ? ground.point.clone() : pos.clone();
      for (let i = 0; i < 3; i++) ctx.fx?.spawnImpact?.(gp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), _up, 'dirt', 2);
      ctx.physics?.spawnDebris?.(gp, _up, 12, 'concrete');
      if (ground) ctx.fx?.addDecal?.(ground.point, ground.normal, 1.2, 'scorch');
    } catch (e) { /* fx optional */ }

    this._damage(pos);
  }

  _damage(pos) {
    const { ctx } = this;
    const phys = ctx.physics;
    const origin = _b.copy(pos).setY(pos.y + 0.3).clone();
    const los = (to) => (phys?.hasLineOfSight ? phys.hasLineOfSight(origin, to) : true);

    const bots = ctx.ai?.bots ?? [];
    for (const bot of bots) {
      try {
        if (!bot?.alive || !bot.bodyActor) continue;
        const chest = bot.chestPoint ? bot.chestPoint(new THREE.Vector3()) : null;
        if (!chest) continue;
        const d = chest.distanceTo(pos);
        if (d > RADIUS || !los(chest)) continue;
        const dmg = 165 * Math.pow(1 - d / RADIUS, 1.2);
        if (dmg <= 0.5) continue;
        const actor = bot.bodyActor;
        const normal = chest.clone().sub(pos).normalize();
        // hit:actor FIRST (HUD hitmarker + AI deferred path), then direct damage,
        // which sets actor.__directDamage so the AI does not apply it twice.
        ctx.events?.emit('hit:actor', { actor, point: chest.clone(), normal, damage: dmg, isHeadshot: false });
        if (typeof actor.applyDamage === 'function') {
          actor.applyDamage(dmg, { from: pos.clone(), point: chest.clone(), killer: ctx.player ?? null, silentSource: true });
        }
      } catch (err) { /* one bad bot must not stop the blast */ }
    }

    try {
      const pl = ctx.player;
      if (pl && !pl.isDead && typeof pl.applyDamage === 'function') {
        const eye = pl.eyePosition?.isVector3 ? pl.eyePosition : ctx.camera.position;
        const d = eye.distanceTo(pos);
        if (d <= RADIUS && los(eye)) {
          const dmg = 120 * Math.pow(1 - d / RADIUS, 1.2);
          if (dmg > 0.5) pl.applyDamage(dmg, pos.clone(), pl);
        }
      }
    } catch (err) { /* noop */ }
  }

  _emitAudio(id, position = null, volume = 1) {
    try { this.ctx.events?.emit('audio:play', { id, position, volume, pitch: 1 }); } catch (e) { /* noop */ }
  }

  dispose() {
    for (const g of this.live) this._removeMesh(g);
    this.live.length = 0;
    try { this._geom?.forEach((g) => g.dispose()); this._mat?.forEach((m) => m.dispose()); } catch (e) { /* noop */ }
  }
}
