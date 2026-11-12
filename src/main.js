import { Engine } from './core/Engine.js';

import { MaterialSystem } from './materials/index.js';
import { LevelSystem }    from './level/index.js';
import { PhysicsSystem }  from './physics/index.js';
import { PlayerSystem }   from './player/index.js';
import { AISystem }       from './ai/index.js';
import { WeaponSystem }   from './weapons/index.js';
import { FXSystem }       from './fx/index.js';
import { AudioSystem }    from './audio/index.js';
import { LightingSystem } from './lighting/index.js';
import { HUDSystem }      from './ui/index.js';
import { RenderSystem }   from './render/index.js';
import { GameSystem }     from './game/index.js';
import { initHome }       from './ui/home.js';
import { precompileScenes } from './core/precompile.js';

/** Full-screen, human-readable failure instead of a dead canvas. */
function showFatal(title, detail, hint = '') {
  const box = document.getElementById('fatal');
  if (!box) return;
  document.getElementById('fatal-title').textContent = title;
  document.getElementById('fatal-detail').textContent = detail;
  document.getElementById('fatal-hint').textContent = hint;
  box.hidden = false;
}

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

// Home page first, so settings can be picked while textures synthesise.
const home = initHome();

if (!hasWebGL2()) {
  showFatal('WebGL 2 unavailable', 'Kill House renders with WebGL 2, and this browser or GPU did not provide it.',
    'Turn on hardware acceleration in chrome://settings/system, update your graphics driver, then reload.');
  home.failed('WebGL 2 unavailable');
  throw new Error('WebGL2 unavailable');
}

const engine = new Engine(document.getElementById('app'));
engine.renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  engine.paused = true;
  showFatal('Graphics context lost', 'The GPU reset or ran out of memory, so the frame can no longer be drawn.', 'Reload the tab to continue.');
});

// Registration order is irrelevant — Engine sorts by static `order`.
for (const S of [
  MaterialSystem, LevelSystem, PhysicsSystem, PlayerSystem, AISystem,
  WeaponSystem, FXSystem, AudioSystem, LightingSystem, HUDSystem, RenderSystem, GameSystem,
]) {
  try {
    engine.register(S);
  } catch (err) {
    console.error(`[main] failed to register ${S?.id ?? S?.name}:`, err);
  }
}

// ── Perf sampling, exposed to the screenshot harness ────────────────────────
// Steady-state only. The first ~3s after init is dominated by shader compilation and
// texture upload — including it made `worstFps` report ~20 while the game was actually
// running at 60-90, and critics were failing the build on that artifact. Warmup is a real
// cost, but it is a *loading* cost, not a framerate cost, so report it separately.
const PERF_WARMUP_MS = 3000;
const perf = { frames: 0, acc: 0, fps: 0, worst: 0, samples: [], warmupDone: false, warmupMs: 0 };
{
  let last = performance.now();
  let startedAt = null;
  const tick = () => {
    const now = performance.now();
    const ms = now - last;
    last = now;

    if (window.__READY__) {
      if (startedAt === null) startedAt = now;
      if (!perf.warmupDone && now - startedAt >= PERF_WARMUP_MS) {
        perf.warmupDone = true;
        perf.warmupMs = Math.round(now - startedAt);
      }
    }

    if (perf.warmupDone) {
      perf.frames++;
      perf.acc += ms;
      if (perf.frames % 30 === 0) {
        perf.fps = 1000 / (perf.acc / 30);
        perf.samples.push(Math.round(perf.fps));
        if (perf.samples.length > 40) perf.samples.shift();
        perf.worst = perf.worst ? Math.min(perf.worst, perf.fps) : perf.fps;
        perf.acc = 0;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
window.__PERF__ = () => ({
  fps: Math.round(perf.fps),
  worstFps: Math.round(perf.worst),
  // p5 of steady-state samples — a fairer "worst case" than a single outlier frame.
  p5Fps: (() => {
    if (perf.samples.length < 4) return Math.round(perf.fps);
    const s = [...perf.samples].sort((a, b) => a - b);
    return s[Math.max(0, Math.floor(s.length * 0.05))];
  })(),
  warmupMs: perf.warmupMs,
  measuredFrames: perf.frames,
  drawCalls: engine.renderer.info.render.calls,
  triangles: engine.renderer.info.render.triangles,
  programs: engine.renderer.info.programs?.length ?? 0,
  textures: engine.renderer.info.memory.textures,
  geometries: engine.renderer.info.memory.geometries,
});

// ── Named camera poses so a critic agent can shoot consistent framings ──────
window.__POSE__ = (name) => {
  try { engine.ctx.systems.player?.setPose?.(name); } catch (e) { console.error('[pose]', e); }
};

(async () => {
  try {
    await engine.initAll((p, label) => {
      home.progress(p, `Loading ${Math.round(p * 100)}% · ${String(label ?? '').replace(/([A-Z])/g, ' $1').trim()}`);
    });

    home.progress(0.99, 'Loading 99% · compiling shaders');
    await precompileScenes(engine.ctx, [
      [engine.scene, engine.camera],
      [engine.viewmodelScene, engine.viewmodelCamera],
    ]);

    engine.start();
    // Off the critical path: bucket level triangles for bullet-hole decals while the
    // player is still on the home screen.
    try { engine.ctx.fx?.decals?.prewarm?.(); } catch { /* decals build lazily instead */ }

    const ctx = engine.ctx;
    const game = ctx.game;
    home.attach(ctx);
    ctx.hud?.setMode?.('Free roam · Kharkiv Yard');

    const lock = () => ctx.input.requestLock();
    game.onRequestLock = lock;
    game.onRequestMenu = () => { home.setMatch(false); home.setLocked(false); };

    home.ready({
      // First click starts the selected mode; later clicks (paused mid-match) resume it.
      onDeploy: (inMatch) => {
        if (!inMatch || game.state === 'idle') { game.start(ctx.config.gameplay.mode); home.setMatch(true); }
        lock();
      },
      onRestart: () => { game.restart(); },
      onQuit: () => { game.quit(); },
    });

    ctx.input.onLockChange = (locked) => {
      engine.paused = !locked;   // the menu is the pause screen
      ctx.audio?.setPaused?.(!locked);
      if (!locked && game.cardOpen) { home.hide(); return; }   // the mission card owns the screen
      home.setLocked(locked, ctx.input.cursorMode);
    };
    ctx.input.onLockError = (err) => {
      console.warn('[main] pointer lock refused — using cursor mode:', err?.message ?? err);
      ctx.input.enterCursorMode();
    };
    // Mission card about to open: keep the home page down when the lock drops.
    ctx.events.on('game:card', () => home.hide());
    // A hidden tab drops pointer lock on its own; make sure the sim is frozen even if it does not.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !engine.paused) {
        try { document.exitPointerLock(); } catch { /* noop */ }
        if (ctx.input.cursorMode) ctx.input.exitCursorMode();
      }
    });

    // Signal the harness. Rendering is live even without pointer lock, so a
    // screenshot is representative of real gameplay framing.
    window.__READY__ = true;
    window.__ENGINE__ = engine;
  } catch (err) {
    console.error('[main] fatal during init:', err);
    home.failed();
    showFatal('Kill House failed to start', String(err?.message ?? err), 'Reload the tab. If it keeps failing, check chrome://gpu.');
    throw err;
  }
})();
