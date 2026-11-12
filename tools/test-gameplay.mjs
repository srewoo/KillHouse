#!/usr/bin/env node
/**
 * Gameplay regression suite. Drives the PRODUCTION build (vite preview of dist/)
 * through window.__harness in headless Chromium.
 *
 *   npm run build && node tools/test-gameplay.mjs [--only operation]
 *
 * Every wait is in SIMULATED time (harness.wait), never wall clock: headless
 * software rendering runs the sim far below real time, and wall-clock waits were
 * the main source of flaky results in the sibling project this borrows from.
 * Any uncaught page error fails the run.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
const PORT = 6100 + (process.pid % 800);

const portOpen = (port) => new Promise((res) => {
  const s = net.createConnection({ port, host: '127.0.0.1' }, () => { s.end(); res(true); });
  s.on('error', () => res(false));
});

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await sleep(500); if (await portOpen(PORT)) return proc; }
  proc.kill('SIGKILL');
  throw new Error('vite preview did not start');
}

const results = [];
const pageErrors = [];
let page;

const H = (fn, arg) => page.evaluate(fn, arg);
const snap = () => H(() => window.__harness.snapshot());
const wait = (s) => page.evaluate((x) => window.__harness.wait(x), s);

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function suite(name, fn) {
  if (ONLY && ONLY !== name) return;
  console.log(`\n▸ ${name}`);
  const before = pageErrors.length;
  try { await fn(); } catch (err) { check(`${name}: threw`, false, err.message.split('\n')[0]); }
  check(`${name}: no page errors`, pageErrors.length === before, pageErrors.slice(before).join(' | ').slice(0, 400));
}

/** Walk the player onto an interactable and hold Interact until it completes. */
async function interactWith(it) {
  await H((p) => {
    const h = window.__harness;
    h.teleport(p.x + 1.3, p.y - 0.4, p.z + 0.2);
    h.aimAt(p.x, p.y, p.z);
  }, it);
  await wait(0.3);
  await H((p) => { window.__harness.aimAt(p.x, p.y, p.z); window.__harness.press('Interact', p.hold + 0.8); }, it);
  await wait(it.hold + 1.2);
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__READY__ === true && window.__harness, null, { timeout: 180000 });

    await suite('boot', async () => {
      const ui = await H(() => ({
        menu: document.getElementById('enter').classList.contains('show'),
        modes: document.querySelectorAll('input[name="mode"]').length,
        deploy: document.getElementById('deploy').textContent.trim(),
        settings: ['fov', 'vol', 'sens', 'ads-sens', 'quality', 'opt-motion', 'opt-cb', 'opt-subs', 'opt-hbar'].every((id) => document.getElementById(id)),
        objectiveText: document.body.innerText.includes('Secure the yard'),
        voice: (() => {
          const a = window.__ENGINE__.ctx.audio;
          const c = a.prepareVoice?.('Relay one is dark.', { profile: 'control', speaker: 'Control' });
          const e = a.prepareVoice?.('Reloading!', { profile: 'enemy', speaker: 'VULTURE' });
          return !!(c && e && c.duration > 0.5 && e.duration > 0.2);
        })(),
        tts: typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking,
      }));
      check('procedural radio voice synthesises Control + enemy lines', ui.voice);
      check('browser speech synthesis unused', !ui.tts);
      check('home menu visible after load', ui.menu);
      check('three game modes offered', ui.modes === 3, String(ui.modes));
      check('deploy button ready', /deploy/i.test(ui.deploy), ui.deploy);
      check('settings controls present', ui.settings);
      check('fake static objective removed', !ui.objectiveText);
    });

    await suite('settings', async () => {
      const r = await H(() => {
        const set = (id, v) => { const e = document.getElementById(id); e.value = String(v); e.dispatchEvent(new Event('input')); };
        set('fov', 90);
        const box = document.getElementById('opt-motion'); box.checked = true; box.dispatchEvent(new Event('change'));
        const c = window.__ENGINE__.ctx.config;
        const out = { fov: c.camera.fov, sprint: c.camera.sprintFov, rm: c.accessibility.reducedMotion, grain: c.render.filmGrain };
        const saved = JSON.parse(localStorage.getItem('killhouse:settings'));
        out.persisted = saved.fov === 90 && saved.reducedMotion === true;
        set('fov', 78); box.checked = false; box.dispatchEvent(new Event('change'));
        return out;
      });
      check('FOV slider drives Config.camera.fov', r.fov === 90 && r.sprint === 96, JSON.stringify(r));
      check('reduced motion disables film grain', r.rm && r.grain === 0);
      check('settings persist to localStorage', r.persisted);
    });

    await suite('operation', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.invulnerable(true); h.start('operation'); });
      let s = await snap();
      check('match enters intro', s.state === 'intro');
      check('input locked during intro', s.player.inputLocked);
      await wait(4.0);
      s = await snap();
      check('intro hands over to play', s.state === 'playing' && !s.player.inputLocked, s.state);
      check('opening patrol of 4 spawned, no auto-respawn', s.bots.alive === 4 && s.bots.autoRespawn === false, JSON.stringify(s.bots));
      check('three relay pips on tracker', s.hud.pips.length === 3, JSON.stringify(s.hud.pips));
      check('objective markers shown', s.markers >= 3, String(s.markers));
      const relays = (await H(() => window.__harness.interactables())).filter((i) => /Relay/.test(i.label));
      check('three relays to interact with', relays.length === 3, relays.map((r) => r.label).join(', '));

      // Prompt appears in range.
      await H((p) => { const h = window.__harness; h.teleport(p.x + 1.3, p.y - 0.4, p.z + 0.2); h.aimAt(p.x, p.y, p.z); }, relays[0]);
      await wait(0.4);
      await H((p) => window.__harness.aimAt(p.x, p.y, p.z), relays[0]);
      await wait(0.2);
      s = await snap();
      check('interact prompt shows next to a relay', s.promptVisible);

      for (let i = 0; i < relays.length; i++) {
        await interactWith(relays[i]);
        s = await snap();
        check(`relay ${i + 1} planted`, s.hud.pips.filter((p) => p.done).length === i + 1, JSON.stringify(s.hud.pips));
      }
      await wait(3);
      s = await snap();
      check('waves spawned after objectives', s.bots.alive > 0, `alive ${s.bots.alive}`);
      check('objective switches to exfil', /exfil/i.test(s.hud.objective), s.hud.objective);

      const ex = await H(() => window.__harness.exfil());
      await H((p) => { window.__harness.killAll(); window.__harness.teleport(p.x, p.y + 0.3, p.z); }, ex);
      await wait(4.5);
      s = await snap();
      check('reaching exfil completes the mission', s.state === 'over' && /complete/i.test(s.card ?? ''), `${s.state} / ${s.card}`);
      const card = await H(() => document.querySelector('#game-ui .card-wrap .card')?.innerText ?? '');
      check('debrief shows rating + accuracy', /Rating/i.test(card) && /Accuracy/i.test(card), card.replace(/\s+/g, ' ').slice(0, 160));
      await H(() => window.__harness.clickCard(1));
      await wait(0.2).catch(() => {});
      const back = await H(() => ({ state: window.__harness.snapshot().state, menu: document.getElementById('enter').classList.contains('show'), rec: localStorage.getItem('killhouse:records') }));
      check('main menu returns to idle sandbox', back.state === 'idle' && back.menu, JSON.stringify(back).slice(0, 120));
      check('practice-mode result is not recorded', !back.rec || !JSON.parse(back.rec).operation);
    });

    await suite('operation-death', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.invulnerable(false); h.start('operation'); h.skipIntro(); });
      await wait(0.3);
      await H(() => window.__harness.freezeAI(true));
      await wait(4.8);   // past spawn protection
      await H(() => window.__harness.damagePlayer(500));
      await wait(2.4);
      let s = await snap();
      check('death opens the failure card', s.state === 'over' && /down/i.test(s.card ?? ''), `${s.state} / ${s.card}`);
      check('player stays dead (no auto-respawn) in operation', s.player.dead);
      await H(() => { window.__harness.clickCard(0); window.__harness.unpause(); });
      await wait(0.3);
      s = await snap();
      check('retry restarts the mission and counts the retry', s.state === 'intro' && s.retries === 1 && !s.player.dead, JSON.stringify({ st: s.state, r: s.retries }));
      await H(() => { window.__harness.freezeAI(false); window.__harness.invulnerable(true); });
    });

    await suite('deathmatch', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.invulnerable(true); h.start('deathmatch'); h.skipIntro(); });
      await wait(0.5);
      let s = await snap();
      check('deathmatch spawns the squad', s.bots.alive === 7, String(s.bots.alive));
      check('score strip on HUD', !!s.hud.score && s.hud.score.us === 0);
      const killed = await H(() => window.__harness.killAll());
      await wait(0.3);
      s = await snap();
      check('kills count toward score', s.hud.score.us === killed, `${s.hud.score.us} vs ${killed}`);
      await wait(14);
      s = await snap();
      check('dead bots are redeployed by the mode', s.bots.alive === 7, String(s.bots.alive));
      await H(() => { window.__harness.invulnerable(false); });
      await wait(4.8);
      await H(() => window.__harness.damagePlayer(500));
      await wait(0.5);
      s = await snap();
      check('their score increments on player death', s.hud.score.them === 1 && s.player.dead, JSON.stringify(s.hud.score));
      await wait(3.4);
      s = await snap();
      check('player redeploys after the delay', !s.player.dead && s.state === 'playing');
      await H(() => window.__harness.invulnerable(true));

      // Grenade: cook, throw, explode, count drops.
      const g0 = s.weapons.grenades;
      await H(() => {
        window.__booms = 0;
        window.__ENGINE__.ctx.events.on('grenade:explode', () => { window.__booms++; });
        window.__harness.aim(0, -0.2);
        window.__harness.press('Grenade', 0.5);
      });
      await wait(0.25);
      s = await snap();
      check('grenade cooks while key held', s.weapons.grenadeState === 'cooking', s.weapons.grenadeState);
      await wait(4.0);
      s = await snap();
      const booms = await H(() => window.__booms);
      check('grenade thrown and detonated', s.weapons.grenades === g0 - 1 && booms === 1, `${g0}->${s.weapons.grenades}, booms ${booms}`);

      // Lean.
      await H(() => window.__harness.press('LeanR', 0.8));
      await wait(0.45);
      s = await snap();
      check('lean right moves the eye', s.player.leanT > 0.3, String(s.player.leanT));
      await wait(0.8);

      // Melee doesn't throw.
      await H(() => window.__harness.press('Melee', 0.1));
      await wait(0.8);
      await H(() => window.__harness.quit());
    });

    await suite('slide', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.start('drill'); h.skipIntro(); });
      await wait(0.3);
      await H(() => window.__harness.quit());
      await H(() => { const h = window.__harness; h.unpause(); h.freezeAI(true); h.teleport(9.5, 0.1, -30); h.aim(Math.PI, 0); });   // lane-south, facing up the open lane
      await wait(0.3);
      await H(() => { const h = window.__harness; h.press('KeyW', 2.5); h.press('ShiftLeft', 2.5); });
      await wait(1.4);
      const pre = (await snap()).player;
      await H(() => window.__harness.press('ControlLeft', 0.6));
      let sliding = false;
      for (let i = 0; i < 6 && !sliding; i++) { await wait(0.08); sliding = (await snap()).player.sliding; }
      check('crouch while sprinting starts a slide', sliding, `before: speed ${pre.speed.toFixed(2)} sprinting ${pre.sprinting} grounded ${pre.grounded}`);
      await wait(1.5);
      await H(() => window.__harness.freezeAI(false));
    });

    await suite('drill', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.start('drill'); h.skipIntro(); });
      await wait(1.0);
      let s = await snap();
      check('first group of 3 targets up', s.bots.alive === 3, String(s.bots.alive));
      check('drill targets are marked', s.markers === 3, String(s.markers));
      for (let g = 0; g < 4; g++) { await H(() => window.__harness.killAll()); await wait(1.2); }
      await wait(2);
      s = await snap();
      check('clearing 12 targets completes the drill', s.state === 'over' && /range clear/i.test(s.card ?? ''), `${s.state} / ${s.card} / ${s.hud?.objective}`);
      await H(() => window.__harness.clickCard(1));
    });

    await suite('combat-tuning', async () => {
      await H(() => { const h = window.__harness; h.unpause(); h.invulnerable(true); h.start('deathmatch'); h.skipIntro(); });
      await wait(1.5);
      await H(() => window.__harness.freezeAI(true));

      // Headshot damage is applied once. Ballistics already multiplies by the gun's
      // headshotMul; Bot.applyDamage used to multiply by 2.6 again (55.9 -> 145).
      const hs = await H(async () => {
        const h = window.__harness, E = window.__ENGINE__, ai = E.ctx.ai, p = E.ctx.player, T = E.ctx.THREE, ph = E.ctx.physics;
        let bot = null;
        outer: for (const b of ai.bots.filter((x) => x.alive && x.kind !== 'heavy')) {
          for (let a = 0; a < 12; a++) {
            h.teleport(b.pos.x + Math.cos(a / 12 * 6.283) * 6, b.pos.y + 0.1, b.pos.z + Math.sin(a / 12 * 6.283) * 6);
            await h.wait(0.1);
            const e = p.eyePosition.clone();
            const dir = new T.Vector3(b.pos.x, b.pos.y + 1.56, b.pos.z).sub(e);
            const d = dir.length(); dir.normalize();
            if (ph.raycast(e, dir, d + 1, { group: 'PROJECTILE' })?.actor) { bot = b; break outer; }
          }
        }
        if (!bot) return { found: false };
        const ev = [];
        const off = E.ctx.events.on('hit:actor', (x) => ev.push(x.damage));
        h.aimAt(bot.pos.x, bot.pos.y + 1.56, bot.pos.z);
        await h.wait(0.15);
        const hp0 = bot.health, hsWeapon = E.ctx.weapons.headshots, fired0 = E.ctx.weapons.shotsFired;
        // Exactly one round. Headless frames are long, so tap until the weapon reports
        // a shot rather than trusting one short press to land on a frame.
        for (let i = 0; i < 40 && E.ctx.weapons.shotsFired === fired0; i++) {
          h.aimAt(bot.pos.x, bot.pos.y + 1.56, bot.pos.z);
          E.ctx.input.buttons.add(0); E.ctx.input._buttonsPressedThisFrame.add(0);
          await new Promise((r) => requestAnimationFrame(r));
        }
        E.ctx.input.buttons.delete(0);
        await h.wait(0.4);
        off?.();
        return {
          found: true, fired: E.ctx.weapons.shotsFired - fired0, events: ev, applied: hp0 - bot.health, alive: bot.alive,
          headshot: E.ctx.weapons.headshots > hsWeapon, statHs: h.snapshot().stats.headshots, weaponHs: E.ctx.weapons.headshots,
        };
      });
      if (!hs.found) check('headshot test found a bot in line of sight', false);
      else {
        // An auto rifle can put two rounds out in one long headless frame, so these
        // checks hold for any number of hits.
        const sum = hs.events.reduce((a, b) => a + b, 0);
        check('headshot registers', hs.headshot && hs.events.length >= 1, JSON.stringify(hs));
        check('headshot damage applied once (applied == sum of hit events)', Math.abs(hs.applied - sum) < 0.01, JSON.stringify(hs));
        check('a single M4 headshot is below a rifleman\'s 100 HP', hs.events.every((d) => d < 100), JSON.stringify(hs));
        check('game.stats.headshots reflects real headshots', hs.statHs === hs.weaponHs && hs.statHs > 0, JSON.stringify(hs));
      }

      // Enemy rounds roll off with range; warning shots always miss.
      const ai = await H(() => {
        const E = window.__ENGINE__, bot = E.ctx.ai.bots[0], Bot = bot.constructor, f = E.ctx.config.gameplay.botFalloff;
        const p = E.ctx.player, T = E.ctx.THREE;
        let misses = 0;
        for (let i = 0; i < 50; i++) {
          const from = p.position.clone().add(new T.Vector3(Math.cos(i) * 40, 1.5, Math.sin(i) * 40));
          const dir = p.position.clone().setY(p.position.y + 1.2).sub(from).normalize();
          bot._deflectPastPlayer(from, dir, p);
          if (bot._rayCapsule(from, dir, p.position, 1.75, 0.30) === null) misses++;
        }
        return { near: Bot.rangeFalloff(10, f), mid: Bot.rangeFalloff(41, f), far: Bot.rangeFalloff(90, f), min: f.min, misses };
      });
      check('bot damage full inside falloff range', ai.near === 1, JSON.stringify(ai));
      check('bot damage rolls off with range', ai.mid < 1 && ai.mid > ai.far && Math.abs(ai.far - ai.min) < 1e-9, JSON.stringify(ai));
      check('warning shots never strike the player', ai.misses === 50, `${ai.misses}/50`);

      // Camera renders from an interpolated position between the last two sim steps.
      const interp = await H(async () => {
        const h = window.__harness, E = window.__ENGINE__, p = E.ctx.player;
        // Teleport a long way and check the very next rendered frame: the camera must
        // jump with the player, not sweep through the level from the old spot.
        h.teleport(30, 0.3, 30);
        await h.wait(0.3);
        h.teleport(9.5, 0.1, -30); h.aim(Math.PI, 0);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const snapped = p.renderPosition.distanceTo(p.position) < 0.5;
        await h.wait(0.3);
        let onSegment = 0, frames = 0, lagged = 0;
        await new Promise((res) => {
          const f = () => {
            h.press('KeyW', 0.3);
            const a = p._prevSimPos, b = p.position, r = p.renderPosition;
            const seg = a.distanceTo(b), d = a.distanceTo(r) + r.distanceTo(b);
            if (Math.abs(d - seg) < 1e-4) onSegment++;
            if (r.distanceTo(b) > 1e-5) lagged++;
            if (++frames < 40) requestAnimationFrame(f); else res();
          };
          requestAnimationFrame(f);
        });
        return { snapped, onSegment, frames, lagged };
      });
      check('teleport snaps the camera (no sweep)', interp.snapped, JSON.stringify(interp));
      check('camera position interpolated between sim steps', interp.onSegment === interp.frames && interp.lagged > 0, JSON.stringify(interp));

      // Resolution: device ratio capped by maxPixelRatio and the pixel budget.
      const res = await H(() => {
        const E = window.__ENGINE__, r = E.ctx.config.render, sz = E.renderer.getDrawingBufferSize(new E.ctx.THREE.Vector2());
        return { ratio: E.renderer.getPixelRatio(), cap: r.maxPixelRatio, px: sz.x * sz.y, budget: r.maxPixels };
      });
      check('pixel ratio capped', res.ratio <= res.cap + 1e-9, JSON.stringify(res));
      check('drawing buffer within pixel budget', res.px <= res.budget * 1.01, JSON.stringify(res));

      // Low preset reaches geometry: shadow range and cascade map size.
      const q = await H(() => {
        const csm = window.__ENGINE__.ctx.lighting.csm;
        csm.setQuality('low');
        const low = { far: csm.csm.maxFar, map: csm.lights[0].shadow.mapSize.x };
        csm.setQuality('high');
        const high = { far: csm.csm.maxFar, map: csm.lights[0].shadow.mapSize.x };
        return { low, high };
      });
      check('Low quality shortens shadow range and map size', q.low.far < q.high.far && q.low.map < q.high.map, JSON.stringify(q));

      await H(() => { const h = window.__harness; h.freezeAI(false); h.quit(); });
    });

    await suite('materials-upgrade', async () => {
      // 2048² materials boot at 1024² and are rebuilt in the background.
      const r = await page.waitForFunction(
        () => window.__ENGINE__.ctx.materials.info('concrete').size === 2048
          && window.__ENGINE__.ctx.materials.info('asphalt').size === 2048,
        null, { timeout: 120000 },
      ).then(() => true).catch(() => false);
      check('concrete and asphalt upgraded to 2048² after boot', r);
    });

    const leak = await H(() => { const e = document.querySelector('#game-ui .score'); return e ? getComputedStyle(e).display : 'none'; });
    check('deathmatch score strip hidden outside deathmatch', leak === 'none', leak);
    const html = await H(() => document.querySelector('#hud-root .board')?.innerText ?? '');
    check('scoreboard has no fake ping column', !/\bMS\b/.test(html));
  } finally {
    await browser.close();
    server.kill('SIGKILL');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
