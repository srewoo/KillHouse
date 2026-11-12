/**
 * Shared plumbing for game modes. A mode owns its rules and its props; the
 * GameSystem owns the lifecycle (intro → playing → over) and the overlay.
 *
 * Contract a mode implements:
 *   id, title                      identity for menus / records
 *   intro                          { a, b, c, radio, seconds }
 *   setup()                        place props, spawn the opening population
 *   update(dt)                     rules, called only while playing
 *   onActorDeath(p)                a bot died
 *   onPlayerDeath(killer)          the player died
 *   markers()                      [{ id, position, label, kind, showDistance }]
 *   hud()                          { op, objective, pips, timer, score? }
 *   interactables()                [{ focus, radius, label, hold, onComplete, prop }]
 *   dispose()                      remove props
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';

export class ModeBase {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
    this.props = [];
    this.time = 0;
    this.kills = 0;
  }

  get player() { return this.ctx.player; }
  get ai() { return this.ctx.ai; }

  spawnTag(tag) {
    const s = this.ctx.level?.spawns?.find((x) => x.tag === tag);
    return s ? { position: s.position.clone(), yaw: s.yaw } : null;
  }

  /** Put the player at a level spawn by tag, facing `faceToward` if given. */
  placePlayer(tag, faceToward = null) {
    const s = this.spawnTag(tag);
    const opts = {};
    if (s) opts.position = s.position;
    if (faceToward) opts.faceToward = faceToward;
    this.player?.respawn?.(true, opts);
  }

  setup() {}
  update() {}
  onActorDeath() {}
  onPlayerDeath() {}
  markers() { return []; }
  hud() { return { op: this.title, objective: '', pips: [], timer: '' }; }
  interactables() { return []; }

  dispose() {
    for (const p of this.props) { try { p.dispose(); } catch { /* noop */ } }
    this.props.length = 0;
  }
}

/** Find a floor point near (x, z) with at least `clear` metres free all round. */
export function clearSpot(ctx, x, z, clear = 0.9) {
  const nav = ctx.ai?.nav;
  const phys = ctx.physics;
  const probe = (p) => {
    if (!phys?.world) return true;
    const o = new THREE.Vector3(p.x, p.y + 0.6, p.z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      if (phys.raycast(o, d, clear, { group: 'PROJECTILE', mask: phys.GROUPS?.WORLD ?? 1 })) return false;
    }
    return true;
  };
  if (nav?.ready) {
    for (let r = 0; r <= 6; r++) {
      for (let i = 0; i < Math.max(1, r * 8); i++) {
        const a = (i / Math.max(1, r * 8)) * Math.PI * 2;
        const c = nav.nearestWalkable(x + Math.sin(a) * r, z + Math.cos(a) * r, 1);
        if (c < 0) continue;
        const p = nav.cellCentre(c, new THREE.Vector3());
        if (probe(p)) return p;
      }
    }
    const c = nav.nearestWalkable(x, z, 8);
    if (c >= 0) return nav.cellCentre(c, new THREE.Vector3());
  }
  return new THREE.Vector3(x, 0, z);
}

/** Yaw that turns a prop's +Z face toward a world point. */
export function yawToward(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export const RATINGS = ['Messy', 'Loud', 'Steady', 'Clean', 'Sharp', 'Surgical'];
