/**
 * window.__harness — deterministic control surface for automated tests.
 *
 * Headless Chromium refuses pointer lock, and software rendering runs the sim far
 * slower than wall clock, so tests drive inputs directly and wait in SIMULATED
 * time (engine.elapsed), never in milliseconds. Nothing here runs unless a test
 * calls it.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';

export function installHarness(game) {
  const ctx = game.ctx;
  const engine = () => ctx.engine;
  const held = new Map();   // code -> sim time to release at (Infinity = until release())

  const h = {
    /** Run the simulation without pointer lock (tests cannot obtain one). */
    unpause() {
      engine().paused = false;
      ctx.input.locked = true;
      ctx.audio?.setPaused?.(false);
      // The home page is the pause screen; with no real lock it would sit over the game.
      document.getElementById('enter')?.classList.remove('show');
    },
    pause() { engine().paused = true; },
    simTime: () => engine().elapsed,

    /** Resolves after `seconds` of simulated time. */
    wait(seconds) {
      const target = engine().elapsed + seconds;
      return new Promise((resolve) => {
        const tick = () => (engine().elapsed >= target ? resolve(engine().elapsed) : requestAnimationFrame(tick));
        tick();
      });
    },

    /** Hold a game code ('KeyW', 'Interact', 'Grenade', 'Fire', 'Space'…) for `seconds` of sim time. */
    press(code, seconds = 0.05) {
      ctx.input.keys.add(code);
      ctx.input._pressedThisFrame.add(code);
      held.set(code, engine().elapsed + seconds);
    },
    release(code) { ctx.input.keys.delete(code); ctx.input._releasedThisFrame.add(code); held.delete(code); },
    mouse(button, seconds = 0.05) {
      ctx.input.buttons.add(button);
      ctx.input._buttonsPressedThisFrame.add(button);
      held.set(`mouse${button}`, engine().elapsed + seconds);
    },

    teleport(x, y, z) {
      ctx.player.movement.teleport(new THREE.Vector3(x, y, z));
      ctx.render?.setVelocityDirty?.();
    },
    aim(yaw, pitch = 0) { ctx.player.yaw = yaw; ctx.player.pitch = pitch; },
    /** Point the camera at a world point. Camera looks down -Z at yaw 0. */
    aimAt(x, y, z) {
      const e = ctx.player.eyePosition;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      ctx.player.yaw = Math.atan2(-dx, -dz);
      ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    freezeAI(on = true) { ctx.ai.enabled = !on; },
    invulnerable(on = true) { ctx.config.gameplay.practice = !!on; },

    start(mode) { game.start(mode); return h.snapshot(); },
    quit() { game.quit(); },
    restart() { game.restart(); },
    /** Skip the intro so a test can act immediately. */
    skipIntro() { if (game.state === 'intro') game._introLeft = 0; },

    /** Mode-specific points of interest. */
    interactables() {
      return (game.mode?.interactables() ?? []).map((i) => ({ label: i.label, x: i.focus.x, y: i.focus.y, z: i.focus.z, radius: i.radius, hold: i.hold }));
    },
    exfil() { const e = game.mode?.exfil; return e ? { x: e.x, y: e.y, z: e.z } : null; },

    /** Kill every living bot through the real damage path. */
    killAll() {
      let n = 0;
      for (const b of ctx.ai.bots) {
        if (!b.alive) continue;
        try { b.bodyActor.applyDamage(9999, { killer: ctx.player, from: ctx.player.eyePosition }); n++; } catch { /* noop */ }
      }
      return n;
    },
    damagePlayer(amount) { ctx.player.applyDamage(amount, ctx.player.position.clone().add(new THREE.Vector3(3, 0, 0))); },

    clickCard(index = 0) {
      const btns = document.querySelectorAll('#game-ui .card-wrap .card button');
      btns[index]?.click();
      return btns.length;
    },

    snapshot() {
      const p = ctx.player, w = ctx.weapons, ai = ctx.ai, m = game.mode;
      const cur = w?.current;
      return {
        state: game.state,
        mode: game.modeId,
        card: game.cardOpen ? document.querySelector('#game-ui .card-wrap .card h2')?.textContent ?? '' : null,
        hud: m ? m.hud() : null,
        retries: game.retries,
        simTime: engine().elapsed,
        player: {
          x: p.position.x, y: p.position.y, z: p.position.z,
          health: p.health, dead: p.isDead, inputLocked: !!p.inputLocked,
          leanT: p.leanT ?? 0, sliding: !!p.isSliding, crouching: !!p.isCrouching,
          speed: p.planarSpeed ?? 0, sprinting: !!p.isSprinting, grounded: !!p.isGrounded,
        },
        weapons: cur ? { name: cur.name, ammo: cur.ammo, reserve: cur.reserve, grenades: w.grenades, grenadeState: w.grenadeState, shotsFired: w.shotsFired, shotsHit: w.shotsHit } : null,
        bots: { alive: ai.aliveCount(), total: ai.bots.length, autoRespawn: ai.autoRespawn },
        stats: game.stats ? { ...game.stats } : null,
        markers: m ? m.markers().length : 0,
        promptVisible: document.querySelector('#game-ui .prompt')?.classList.contains('on') ?? false,
      };
    },
  };

  // Release held inputs on sim time, before systems read them next frame.
  const sweep = () => {
    const t = engine()?.elapsed ?? 0;
    for (const [code, until] of held) {
      if (t < until) continue;
      held.delete(code);
      if (code.startsWith('mouse')) ctx.input.buttons.delete(Number(code.slice(5)));
      else { ctx.input.keys.delete(code); ctx.input._releasedThisFrame.add(code); }
    }
    requestAnimationFrame(sweep);
  };
  requestAnimationFrame(sweep);

  window.__harness = h;
  return h;
}
