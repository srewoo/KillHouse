import * as THREE from 'three';

/**
 * KILL HOUSE — melee strike (key 'Melee', physical V).
 * 0.5 s cooldown; the strike lands ~0.12 s after the swing starts. Hits are found
 * with a ray first, then a 0.25 m sphere cast so a slightly off-centre jab still
 * connects. Bot hit -> 'hit:actor' then applyDamage(110); world hit -> 'hit:world'.
 * OWNER: weapons.
 */

const REACH = 2.0;
const RADIUS = 0.25;
const COOLDOWN = 0.5;
const WINDUP = 0.12;
const DAMAGE = 110;

const _fwd = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class Melee {
  constructor(ctx, weapons) {
    this.ctx = ctx;
    this.weapons = weapons;
    this.cooldown = 0;
    this._pending = -1;
  }

  get busy() { return this.cooldown > 0; }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this._pending >= 0) {
      this._pending -= dt;
      if (this._pending < 0) this._resolve();
    }
  }

  strike() {
    if (this.cooldown > 0) return false;
    const { ctx } = this;
    this.cooldown = COOLDOWN;
    this._pending = WINDUP;
    try {
      const vm = this.weapons.viewmodel;
      vm?.kickPos?.impulse(0.02, -0.06, -0.55);
      vm?.kickRot?.impulse(0.7, -0.35, 0.0);
    } catch (e) { /* viewmodel is cosmetic */ }
    try { ctx.events?.emit('audio:play', { id: 'melee_swing', position: null, volume: 1, pitch: 0.95 + Math.random() * 0.1 }); } catch (e) { /* noop */ }
    return true;
  }

  _filter() {
    const phys = this.ctx.physics;
    const G = phys?.GROUPS ?? { PROJECTILE: 0x10, WORLD: 1, ENEMY: 4 };
    return { group: G.PROJECTILE, mask: (G.WORLD | G.ENEMY) >>> 0, excludeActor: this.ctx.player ?? null };
  }

  _resolve() {
    const { ctx } = this;
    const phys = ctx.physics;
    if (!phys || ctx.player?.isDead) return;
    try {
      ctx.camera.getWorldDirection(_fwd);
      _eye.copy(ctx.player?.eyePosition?.isVector3 ? ctx.player.eyePosition : ctx.camera.position);
      const f = this._filter();
      let hit = phys.raycast?.(_eye, _fwd, REACH, f) ?? null;
      if (!hit?.actor) {
        const s = phys.spherecast?.(_eye, _fwd, RADIUS, REACH, f) ?? null;
        if (s && (s.actor || !hit)) hit = s;
      }
      if (!hit) return;

      const actor = hit.actor;
      const bot = actor?.bot ?? null;
      if (actor && actor !== ctx.player && (bot ? bot.alive !== false : true)) {
        ctx.events?.emit('hit:actor', {
          actor, point: hit.point.clone(), normal: hit.normal.clone(), damage: DAMAGE, isHeadshot: false,
        });
        if (typeof actor.applyDamage === 'function') {
          actor.applyDamage(DAMAGE, { from: _eye.clone(), point: hit.point.clone(), killer: ctx.player ?? null });
        }
        ctx.events?.emit('audio:play', { id: 'melee_hit', position: hit.point.clone(), volume: 1, pitch: 1 });
        ctx.events?.emit('camera:shake', { amplitude: 0.006, duration: 0.12, frequency: 26 });
      } else if (!actor) {
        ctx.events?.emit('hit:world', {
          point: hit.point.clone(), normal: hit.normal.clone(), material: hit.material, impulse: 4,
        });
        ctx.events?.emit('audio:play', { id: 'melee_hit', position: hit.point.clone(), volume: 0.6, pitch: 1.15 });
      }
    } catch (err) { /* melee must never throw into the frame loop */ }
  }
}
