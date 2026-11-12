/**
 * Deathmatch: you against the squad. First to 30 kills, or the higher score when
 * the 10-minute clock runs out. Their score is the number of times they killed
 * you. Respawns are out of enemy sight, facing the nearest threat, and can be
 * skipped with Fire after a short beat.
 *
 * OWNER: game (src/game/**).
 */
import { ModeBase } from './base.js';
import { AmmoCrate } from '../props.js';
import { clearSpot } from './base.js';
import { fmtTime } from '../ui.js';

const SCORE_LIMIT = 30;
const TIME_LIMIT = 600;
const RESPAWN_DELAY = 3.0;
const SKIP_AFTER = 1.1;
const STREAKS = { 3: 'Triple', 5: 'Rampage', 8: 'Unstoppable' };

export class DeathmatchMode extends ModeBase {
  id = 'deathmatch';
  title = 'Deathmatch · Kharkiv Yard';
  intro = { a: 'Kharkiv Yard', b: 'Deathmatch', c: `First to ${SCORE_LIMIT} · ${TIME_LIMIT / 60} minutes`, radio: 'Weapons free. Thirty confirmed and you are done.', seconds: 2.4 };

  setup() {
    const ai = this.ai;
    ai.despawnAll();
    ai.resetStats?.();
    this.crates = [{ x: -18.5, z: -16.5 }, { x: 22.0, z: -4.0 }, { x: -6.0, z: 20.0 }].map((c) => {
      const crate = new AmmoCrate(this.ctx, clearSpot(this.ctx, c.x, c.z, 1.0), Math.random() * Math.PI);
      this.props.push(crate);
      return crate;
    });
    const n = Math.max(1, this.ctx.config.gameplay.botCount ?? 7);
    for (let i = 0; i < n; i++) ai.spawnBot({ kind: i === n - 1 ? 'heavy' : 'rifleman' });
    this.playerSpawn();
    this.them = 0;
    this.streak = 0;
    this.respawnQueue = [];
    this.deadFor = -1;
  }

  /** Spawn the player away from every living bot, facing the nearest one. */
  playerSpawn() {
    const enemies = this.ai.livingPositions([]).map((p) => p.clone());
    const pos = this.player.pickSpawnPoint?.(enemies) ?? null;
    let nearest = null, best = Infinity;
    if (pos) for (const e of enemies) { const d = e.distanceTo(pos); if (d < best) { best = d; nearest = e; } }
    this.player.respawn(true, { position: pos ?? undefined, faceToward: nearest ?? undefined });
  }

  interactables() {
    return this.crates.filter((c) => c.ready).map((c) => ({
      prop: c, focus: c.focus, radius: 2.0, label: 'Resupply ammo', hold: 0.6, onComplete: () => this.game.resupply(c),
    }));
  }

  onActorDeath(p) {
    const bot = p?.actor?.bot;
    if (!bot) return;
    this.kills++;
    this.streak++;
    const word = STREAKS[this.streak] ?? (this.streak > 8 && this.streak % 3 === 2 ? 'Unstoppable' : null);
    if (word) { this.game.ui.banner(word, `${this.streak} kill streak`, 'good', 2); this.game.audio('objective_done'); }
    // A heavy comes back as a heavy; the squad is always the same size.
    this.respawnQueue.push({ t: this.ai.respawnDelay?.() ?? 6, kind: bot.kind ?? 'rifleman' });
    if (this.kills >= SCORE_LIMIT) this.game.finish({ win: true, why: `${SCORE_LIMIT} confirmed kills` });
  }

  onPlayerDeath() {
    this.them++;
    this.streak = 0;
    this.deadFor = 0;
    if (this.them >= SCORE_LIMIT) this.game.finish({ win: false, why: `The squad reached ${SCORE_LIMIT}` });
  }

  update(dt) {
    this.time += dt;
    for (const c of this.crates) c.update(dt);
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      r.t -= dt;
      if (r.t <= 0 && this.ai.spawnBot({ kind: r.kind })) this.respawnQueue.splice(i, 1);
    }

    if (this.deadFor >= 0) {
      this.deadFor += dt;
      const left = Math.max(0, RESPAWN_DELAY - this.deadFor);
      const input = this.ctx.input;
      const skip = this.deadFor > SKIP_AFTER && (input?.wasMousePressed?.(0) || input?.wasPressed?.('Space'));
      this.game.ui.setRespawn(this.deadFor > SKIP_AFTER ? `Redeploying in ${left.toFixed(1)} · Fire to skip` : `Redeploying in ${left.toFixed(1)}`);
      if (left <= 0 || skip) {
        this.deadFor = -1;
        this.game.ui.setRespawn('');
        this.playerSpawn();
        this.ctx.weapons?.refill?.();
        this.game.ui.banner('Redeployed', '', '', 1.4);
      }
    }

    if (this.time >= TIME_LIMIT) {
      const win = this.kills > this.them;
      this.game.finish({ win, draw: this.kills === this.them, why: 'Time expired' });
    }
  }

  hud() {
    return {
      op: this.title,
      objective: `First to ${SCORE_LIMIT}`,
      pips: [],
      timer: '',
      score: { us: this.kills, them: this.them, clock: fmtTime(TIME_LIMIT - this.time), target: `Target ${SCORE_LIMIT}` },
    };
  }

  markers() {
    return this.crates.map((c, i) => (c.ready ? { id: `crate-${i}`, position: c.focus, label: '', kind: 'crate', showDistance: false } : null)).filter(Boolean);
  }

  /** Final table: everyone in the match, ordered by kills. */
  table(stats) {
    const rows = [{ you: true, cells: ['You', this.kills, this.them, (this.kills / Math.max(1, this.them)).toFixed(2), stats.headshots, `${Math.round(stats.accuracy * 100)}%`] }];
    const hud = this.ctx.hud;
    for (const b of this.ai.bots) {
      if (!(b.kills || b.deaths)) continue;
      rows.push({ cells: [hud?._actorName?.(b.bodyActor) ?? b.name, b.kills | 0, b.deaths | 0, ((b.kills | 0) / Math.max(1, b.deaths | 0)).toFixed(2), '—', '—'] });
    }
    rows.sort((a, b) => b.cells[1] - a.cells[1]);
    return { cols: ['Operator', 'K', 'D', 'K/D', 'HS', 'Acc'], rows };
  }
}
