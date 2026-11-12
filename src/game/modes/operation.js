/**
 * Operation "Sector 07": plant charges on three comms relays (warehouse, central
 * lane, container yard), surviving a wave after each, then reach the north-yard
 * exfil. Waves are triggered by objectives rather than timers, so the player sets
 * the pace; a pursuit phase keeps pressure on the run to exfil.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';
import { ModeBase, clearSpot, yawToward, RATINGS } from './base.js';
import { Relay, AmmoCrate, Beacon } from '../props.js';
import { bearingDeg, bearingName, fmtTime } from '../ui.js';

const RELAYS = [
  { key: 'A', label: 'Relay A — Warehouse', x: -22.5, z: -12.5 },
  { key: 'B', label: 'Relay B — Lane', x: 3.5, z: 4.0 },
  { key: 'C', label: 'Relay C — Containers', x: 27.0, z: 8.0 },
];
const CRATES = [{ x: -18.5, z: -16.5 }, { x: 22.0, z: -4.0 }];
const EXFIL = { x: -24.0, z: 30.0, radius: 3.6 };
const WAVES = [
  { count: 3, heavy: 0 },
  { count: 4, heavy: 1 },
  { count: 5, heavy: 2 },
];
const MAX_ALIVE = 9;
const HOLD_SECONDS = 2.4;

const LINES = {
  intro: 'Operator, Control. Sector 07 is hostile. Plant charges on the three comms relays — warehouse, lane, container yard. Then exfil from the north yard.',
  contact: "They've seen you. Put them down.",
  relay: [
    'Relay one is dark. They felt that — reinforcements inbound.',
    "Two down. They're throwing everything they have left.",
    'All relays dark. Exfil is hot — north yard, move!',
  ],
  lowHp: "You're hit hard. Get behind cover and breathe.",
  early: 'Relays still live. Exfil will not wait under fire.',
  win: 'Operator is out. Sector 07 is dark. Good work.',
};

export class OperationMode extends ModeBase {
  id = 'operation';
  title = 'Operation · Sector 07';
  intro = { a: 'Sector 07 · Kharkiv Yard', b: 'Kill House', c: '05:42 local · 1 operator', radio: LINES.intro, seconds: 3.4 };

  voiceLines() { return [LINES.contact, ...LINES.relay, LINES.lowHp, LINES.win]; }

  setup() {
    const ai = this.ai;
    ai.despawnAll();
    ai.resetStats?.();
    this.relays = RELAYS.map((r) => {
      const p = clearSpot(this.ctx, r.x, r.z, 1.0);
      const relay = new Relay(this.ctx, p, yawToward(p, new THREE.Vector3(0, 0, 0)), r.label);
      relay.key = r.key;
      this.props.push(relay);
      return relay;
    });
    this.crates = CRATES.map((c) => {
      const p = clearSpot(this.ctx, c.x, c.z, 1.0);
      const crate = new AmmoCrate(this.ctx, p, Math.random() * Math.PI);
      this.props.push(crate);
      return crate;
    });
    this.exfil = clearSpot(this.ctx, EXFIL.x, EXFIL.z, 1.2);
    this.beacon = new Beacon(this.ctx, this.exfil);
    this.props.push(this.beacon);

    this.placePlayer('lane-south', this.relays[1].position);
    // Opening patrol: hidden, unaware — the yard should feel occupied, not ambushed.
    for (let i = 0; i < 4; i++) ai.spawnBot({ kind: 'rifleman' });

    this.done = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.pursuit = false;
    this.pursuitSpawned = 0;
    this.pursuitTimer = 7;
    this.alertTimer = 12;
    this.saidContact = false;
    this.saidLowHp = false;
    this.earlyCooldown = 0;
    this.extracted = false;
  }

  interactables() {
    const out = [];
    for (const r of this.relays) {
      if (r.done) continue;
      out.push({ prop: r, focus: r.focus, radius: 2.3, label: `Plant charge · ${r.label}`, hold: HOLD_SECONDS, onComplete: () => this._relayDone(r) });
    }
    for (const c of this.crates) {
      if (!c.ready) continue;
      out.push({ prop: c, focus: c.focus, radius: 2.0, label: 'Resupply ammo', hold: 0.6, onComplete: () => this.game.resupply(c) });
    }
    return out;
  }

  _relayDone(relay) {
    relay.complete();
    this.done++;
    const g = this.game;
    g.audio('objective_done');
    g.shake(0.4);
    try { this.ctx.fx?.spawnImpact?.(relay.focus, new THREE.Vector3(0, 1, 0), 'metal', 2); } catch { /* optional */ }
    g.radio.say(LINES.relay[this.done - 1], 4.6);
    if (this.done >= RELAYS.length) {
      this.pursuit = true;
      this.beacon.activate();
      g.ui.banner('Exfil open', 'North yard', 'good');
    } else {
      g.ui.banner('Relay down', `${this.done} / ${RELAYS.length}`, 'good');
    }
    const wave = WAVES[this.done - 1];
    for (let i = 0; i < wave.count; i++) this.spawnQueue.push(i >= wave.count - wave.heavy ? 'heavy' : 'rifleman');
    this.spawnTimer = 1.2;
    this.ai.alertAll(this.player.position);
    this._warnAt = true;
  }

  update(dt) {
    this.time += dt;
    for (const p of this.props) p.update?.(dt);
    const ai = this.ai;
    const pp = this.player.position;

    // Staggered wave spawns, capped so the yard never becomes a shooting gallery.
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && ai.aliveCount() < MAX_ALIVE) {
        this.spawnTimer = 0.85;
        const bot = ai.spawnBot({ kind: this.spawnQueue.shift(), alert: true });
        if (bot && this._warnAt) {
          this._warnAt = false;
          this.game.ui.banner(`Contact — ${bearingName(bearingDeg(pp, bot.pos))}`, 'Hostiles inbound', 'warn');
        }
      }
    }

    if (this.pursuit) {
      this.pursuitTimer -= dt;
      if (this.pursuitTimer <= 0) {
        this.pursuitTimer = 7;
        if (ai.aliveCount() < 4 && this.pursuitSpawned < 6) {
          this.pursuitSpawned++;
          ai.spawnBot({ kind: Math.random() < 0.3 ? 'heavy' : 'rifleman', alert: true });
        }
      }
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) { this.alertTimer = 12; ai.alertAll(pp); }
    }

    // Exfil.
    this.earlyCooldown -= dt;
    const dx = pp.x - this.exfil.x, dz = pp.z - this.exfil.z;
    if (Math.hypot(dx, dz) < EXFIL.radius && !this.player.isDead) {
      if (this.pursuit && !this.extracted) {
        this.extracted = true;
        this.game.radio.say(LINES.win, 4);
        this.game.finish({ win: true });
      } else if (!this.pursuit && this.earlyCooldown <= 0) {
        this.earlyCooldown = 6;
        this.game.ui.banner('Relays still live', LINES.early, 'warn', 3);
      }
    }

    const hp = this.player.health / (this.player.maxHealth || 100);
    if (hp < 0.3 && !this.saidLowHp && !this.player.isDead) { this.saidLowHp = true; this.game.radio.say(LINES.lowHp, 3.6); }
    if (hp > 0.8) this.saidLowHp = false;
  }

  onContact() {
    if (this.saidContact) return;
    this.saidContact = true;
    this.game.radio.say(LINES.contact, 3);
  }

  onPlayerDeath() {
    this.game.fail({ title: 'Operator down', why: 'Signal lost' });
  }

  markers() {
    const out = [];
    if (!this.pursuit) {
      for (const r of this.relays) if (!r.done) out.push({ id: `relay-${r.key}`, position: r.focus, label: r.key, kind: 'obj' });
    } else {
      out.push({ id: 'exfil', position: this.exfil.clone().setY(this.exfil.y + 1.2), label: 'EXFIL', kind: 'ex' });
    }
    for (const [i, c] of this.crates.entries()) if (c.ready) out.push({ id: `crate-${i}`, position: c.focus, label: '', kind: 'crate', showDistance: false });
    return out;
  }

  hud() {
    const left = RELAYS.length - this.done;
    const objective = this.pursuit ? 'Reach exfil — north yard'
      : left === 3 ? 'Plant charges on the three relays'
        : left === 1 ? 'Plant a charge on the last relay' : `Plant charges on the remaining ${left} relays`;
    return {
      op: this.title,
      objective,
      pips: this.relays.map((r) => ({ label: r.key, done: r.done })),
      timer: fmtTime(this.time),
    };
  }

  /** Death-card summary. */
  deathRows() {
    return [['Time survived', fmtTime(this.time)], ['Relays down', `${this.done} / ${RELAYS.length}`]];
  }

  /** Points: time, accuracy, retries → 0..5. */
  rate({ time, accuracy, retries }) {
    let pts = 0;
    if (time < 300) pts += 2; else if (time < 420) pts += 1;
    if (accuracy >= 0.45) pts += 2; else if (accuracy >= 0.28) pts += 1;
    if (retries === 0) pts += 1;
    return RATINGS[Math.min(5, pts)];
  }
}
