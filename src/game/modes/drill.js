/**
 * Killhouse drill: a timed clear of the warehouse. Twelve static targets come up
 * three at a time; each group appears when the last one is down. They do not
 * shoot back — this is a marksmanship and movement test against a par time.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';
import { ModeBase, RATINGS } from './base.js';
import { bearingDeg, bearingName, fmtTime } from '../ui.js';

const GROUPS = 4;
const PER_GROUP = 3;
const PAR = 45;
// Warehouse ground floor footprint (from the level's warehouse-* spawn tags).
const BOX = { x0: -35, x1: -14, z0: -21, z1: 4, yMax: 1.6 };

export class DrillMode extends ModeBase {
  id = 'drill';
  title = 'Killhouse drill · Warehouse';
  intro = { a: 'Warehouse · Live fire', b: 'Killhouse Drill', c: `${GROUPS * PER_GROUP} targets · Par ${PAR}s`, radio: 'Range is hot. Targets come up in threes. Clear them fast.', seconds: 2.4 };

  setup() {
    this.ai.despawnAll();
    this.ai.resetStats?.();
    this.placePlayer('warehouse-south', new THREE.Vector3(-24, 1.4, -4));
    this.cells = this._candidateCells();
    this.group = 0;
    this.alive = 0;
    this.downTotal = 0;
    this.nextIn = 0.4;
  }

  _candidateCells() {
    const nav = this.ai.nav;
    const out = [];
    if (!nav?.ready) return out;
    const p = new THREE.Vector3();
    for (let x = BOX.x0; x <= BOX.x1; x += 1) {
      for (let z = BOX.z0; z <= BOX.z1; z += 1) {
        const c = nav.cellAt(x, z);
        if (!nav.isWalkable(c)) continue;
        nav.cellCentre(c, p);
        if (p.y > BOX.yMax) continue;
        out.push(p.clone());
      }
    }
    return out;
  }

  _spawnGroup() {
    const pp = this.player.position;
    const picks = [];
    const pool = this.cells.filter((c) => c.distanceTo(pp) > 7 && c.distanceTo(pp) < 26);
    for (let tries = 0; tries < 200 && picks.length < PER_GROUP && pool.length; tries++) {
      const c = pool[(Math.random() * pool.length) | 0];
      if (picks.every((q) => q.distanceTo(c) > 3)) picks.push(c);
    }
    // Small or unbuilt nav grid: fall back to hidden spawns rather than an empty drill.
    while (picks.length < PER_GROUP) picks.push(this.ai.pickHiddenSpawn(new THREE.Vector3()));
    for (const c of picks) {
      if (this.ai.spawnBot({ position: c, passive: true, faceToward: pp })) this.alive++;
    }
    this.group++;
    const dir = bearingName(bearingDeg(pp, picks[0]));
    this.game.ui.banner(`Targets up · ${this.group} / ${GROUPS}`, dir, '', 1.6);
    this.game.audio('objective_tick');
  }

  onActorDeath(p) {
    if (!p?.actor?.bot) return;
    this.alive = Math.max(0, this.alive - 1);
    this.downTotal++;
    if (this.alive === 0) {
      if (this.group >= GROUPS) this.game.finish({ win: true, why: `Clear in ${fmtTime(this.time)}` });
      else this.nextIn = 0.6;
    }
  }

  onPlayerDeath() { this.game.fail({ title: 'Drill failed', why: 'You were killed' }); }

  update(dt) {
    this.time += dt;
    if (this.nextIn > 0) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) this._spawnGroup();
    }
  }

  markers() {
    const out = [];
    for (const b of this.ai.bots) {
      if (b.alive && b.passive) out.push({ id: `t-${b.id}`, position: b.pos.clone().setY(b.pos.y + 2.1), label: '', kind: 'obj' });
    }
    return out;
  }

  hud() {
    return {
      op: this.title,
      objective: `Clear the warehouse · ${this.downTotal} / ${GROUPS * PER_GROUP}`,
      pips: Array.from({ length: GROUPS }, (_, i) => ({ label: String(i + 1), done: i < this.group - (this.alive ? 1 : 0) })),
      timer: `${fmtTime(this.time)} · Par ${fmtTime(PAR)}`,
    };
  }

  deathRows() { return [['Time', fmtTime(this.time)], ['Targets down', `${this.downTotal} / ${GROUPS * PER_GROUP}`]]; }

  rate({ time }) {
    const r = time / PAR;
    const idx = r <= 0.7 ? 5 : r <= 0.85 ? 4 : r <= 1 ? 3 : r <= 1.25 ? 2 : r <= 1.6 ? 1 : 0;
    return RATINGS[idx];
  }
}
