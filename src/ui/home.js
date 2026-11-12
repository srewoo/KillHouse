/**
 * Home page: how-to-play, key rebinding, mouse sensitivity, difficulty and practice mode.
 *
 * Settings write straight into `Config.gameplay`, which the AI and player read
 * live, so the page works both before the engine exists (picked while loading)
 * and as the pause menu mid-game. Choices persist per browser profile.
 */
import { Config } from '../core/Config.js';
import { ACTIONS, RESERVED, getBinding, setBinding, resetBindings, keyLabel } from '../core/Keybinds.js';

const STORE_KEY = 'killhouse:settings';
const BASE_SENS = Config.player.mouseSensitivity;
let sensMul = 1;

/** Controls grid: click a key, press the new one. Esc cancels. */
function initBinds() {
  const grid = document.getElementById('binds');
  const msg = document.getElementById('bind-msg');
  const buttons = new Map();
  let listening = null;   // action id awaiting a key

  const render = () => {
    for (const [id, btn] of buttons) {
      btn.textContent = listening === id ? 'Press a key…' : keyLabel(getBinding(id));
      btn.classList.toggle('listening', listening === id);
    }
  };

  for (const a of ACTIONS) {
    const label = document.createElement('label');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `${a.label} key`);
    btn.addEventListener('click', () => {
      listening = listening === a.id ? null : a.id;
      msg.textContent = listening ? `Press a key for ${a.label}. Esc cancels.` : '';
      render();
    });
    label.append(a.label, btn);
    grid.append(label);
    buttons.set(a.id, btn);
  }

  // Capture phase on window runs before Input's listener, so the key being
  // bound never reaches the game.
  window.addEventListener('keydown', (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const action = ACTIONS.find((a) => a.id === listening);
    if (e.code === 'Escape') msg.textContent = '';
    else if (RESERVED.has(e.code)) { msg.textContent = `${keyLabel(e.code)} is reserved. Pick another key.`; return; }
    else {
      const prev = ACTIONS.find((a) => a.id !== action.id && getBinding(a.id) === e.code);
      setBinding(action.id, e.code);
      msg.textContent = prev
        ? `${action.label} → ${keyLabel(e.code)}. ${prev.label} moved to ${keyLabel(getBinding(prev.id))}.`
        : `${action.label} → ${keyLabel(e.code)}.`;
    }
    buttons.get(listening).focus();
    listening = null;
    render();
  }, true);

  document.getElementById('bind-reset').addEventListener('click', () => {
    resetBindings();
    listening = null;
    msg.textContent = 'Controls reset to defaults.';
    render();
  });
  render();
  // Lets the menu disarm a pending capture when play resumes, so the next
  // gameplay key is not silently bound (and saved) to whatever was listening.
  return () => {
    if (!listening) return;
    listening = null;
    msg.textContent = '';
    render();
  };
}

const SENS_RANGE = [0.25, 3];
const QUALITY = ['low', 'medium', 'high', 'ultra'];
/** Settings persisted as-is; each entry: [key, validator]. */
const num = (lo, hi) => (v) => Number.isFinite(v) && v >= lo && v <= hi;
const bool = (v) => typeof v === 'boolean';

/** Live settings, mirrored into Config by apply(). */
const settings = {
  sens: 1, fov: Config.camera.fov, volume: Config.audio.master, adsSens: Config.player.adsSensitivityMul,
  quality: 'high', invertY: false,
  reducedMotion: false, colorblind: false, subtitles: true, voice: true, healthBar: false,
};
const VALID = {
  sens: num(...SENS_RANGE), fov: num(65, 100), volume: num(0, 1), adsSens: num(0.3, 1.2),
  quality: (v) => QUALITY.includes(v), invertY: bool,
  reducedMotion: bool, colorblind: bool, subtitles: bool, voice: bool, healthBar: bool,
};
const BASE_GRAIN = Config.render.filmGrain;
const BASE_CA = Config.render.chromaticAberration;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (s.difficulty in Config.gameplay.difficulties) Config.gameplay.difficulty = s.difficulty;
    if (typeof s.practice === 'boolean') Config.gameplay.practice = s.practice;
    if (['operation', 'deathmatch', 'drill'].includes(s.mode)) Config.gameplay.mode = s.mode;
    for (const k of Object.keys(VALID)) if (k in s && VALID[k](s[k])) settings[k] = s[k];
    // Honour the OS setting the first time, before the player has chosen.
    if (!('reducedMotion' in s) && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settings.reducedMotion = true;
  } catch { /* storage blocked or corrupt — defaults stand */ }
  sensMul = settings.sens;
}

function save() {
  const { difficulty, practice, mode } = Config.gameplay;
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ difficulty, practice, mode, ...settings, sens: sensMul })); } catch { /* noop */ }
}

/** Push settings into Config (read live by every system) and the optional engine hooks. */
let engineCtx = null;
function apply() {
  Config.player.mouseSensitivity = BASE_SENS * sensMul;
  Config.player.adsSensitivityMul = settings.adsSens;
  Config.player.invertY = settings.invertY;
  Config.camera.fov = settings.fov;
  Config.camera.sprintFov = settings.fov + 6;
  Config.audio.master = settings.volume;
  const a = Config.accessibility;
  a.reducedMotion = settings.reducedMotion;
  a.colorblind = settings.colorblind;
  a.subtitles = settings.subtitles;
  a.voice = settings.voice;
  a.healthBar = settings.healthBar;
  const r = Config.render;
  r.motionBlur = !settings.reducedMotion && settings.quality !== 'low';
  r.filmGrain = settings.reducedMotion ? 0 : BASE_GRAIN;
  r.chromaticAberration = settings.reducedMotion ? 0 : BASE_CA;
  r.ssr = settings.quality === 'high' || settings.quality === 'ultra';
  r.volumetrics = settings.quality !== 'low';
  r.ssao = settings.quality !== 'low';
  r.resolutionScale = settings.quality === 'low' ? 0.75 : settings.quality === 'medium' ? 0.88 : 1.0;
  if (engineCtx) {
    try { engineCtx.audio?.setMasterVolume?.(settings.volume); } catch { /* optional */ }
    try { engineCtx.render?.setQuality?.(settings.quality); } catch { /* optional */ }
    try { engineCtx.lighting?.csm?.setQuality?.(settings.quality); } catch { /* optional */ }
  }
}

function initSettings() {
  const range = (id, key, fmt) => {
    const input = document.getElementById(id);
    const out = document.getElementById(`${id}-val`);
    const show = () => { if (out) out.textContent = fmt(Number(input.value)); };
    input.value = String(key === 'sens' ? sensMul : settings[key]);
    show();
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (key === 'sens') { sensMul = v; settings.sens = v; } else settings[key] = v;
      show(); apply(); save();
    });
  };
  range('fov', 'fov', (v) => `${v}°`);
  range('vol', 'volume', (v) => `${Math.round(v * 100)}%`);
  range('sens', 'sens', (v) => `${v.toFixed(2)}×`);
  range('ads-sens', 'adsSens', (v) => `${v.toFixed(2)}×`);
  const q = document.getElementById('quality');
  q.value = settings.quality;
  q.addEventListener('change', () => { settings.quality = q.value; apply(); save(); });
  const toggles = { 'opt-invert': 'invertY', 'opt-motion': 'reducedMotion', 'opt-cb': 'colorblind', 'opt-subs': 'subtitles', 'opt-voice': 'voice', 'opt-hbar': 'healthBar' };
  for (const [id, key] of Object.entries(toggles)) {
    const box = document.getElementById(id);
    box.checked = !!settings[key];
    box.addEventListener('change', () => { settings[key] = box.checked; apply(); save(); });
  }
}

const FLAVOUR = [
  'Pouring concrete', 'Rusting the containers', 'Hanging sodium lamps', 'Laying the lanes',
  'Briefing the squad', 'Checking the rifle', 'Tuning the radio', 'Waiting for first light',
];

function renderRecords() {
  let rec = {};
  try { rec = JSON.parse(localStorage.getItem('killhouse:records') ?? '{}') ?? {}; } catch { /* noop */ }
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  for (const em of document.querySelectorAll('#enter .rec')) {
    const r = rec[em.dataset.rec];
    if (!r) { em.textContent = ''; continue; }
    if (em.dataset.rec === 'deathmatch') em.textContent = r.kills ? `Best ${r.kills} kills · ${r.wins ?? 0} wins` : '';
    else em.textContent = r.time ? `Best ${fmt(r.time)}${r.rating ? ` · ${r.rating}` : ''}` : '';
  }
}

export function initHome() {
  const root = document.getElementById('enter');
  const deployBtn = document.getElementById('deploy');
  const practiceEl = document.getElementById('practice');
  const practiceState = document.getElementById('practice-state');
  const tag = document.getElementById('mode-tag');
  const radios = root.querySelectorAll('input[name="difficulty"]');
  const modeRadios = root.querySelectorAll('input[name="mode"]');
  const pauseActions = document.getElementById('pause-actions');
  const flavour = document.getElementById('boot-flavour');

  let cursorNote = '';   // shown in the in-game tag when pointer lock was refused
  let inMatch = false;
  load();
  const cancelBind = initBinds();
  // Enter is the keyboard Fire key; its auto-repeat must not click a freshly focused menu button.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.repeat && document.activeElement?.tagName === 'BUTTON') e.preventDefault();
  }, true);
  initSettings();
  renderRecords();

  const render = () => {
    const { difficulty, practice, mode } = Config.gameplay;
    for (const r of radios) r.checked = r.value === difficulty;
    for (const r of modeRadios) { r.checked = r.value === mode; r.disabled = inMatch; }
    practiceEl.checked = practice;
    practiceState.textContent = practice ? 'On' : 'Off';
    tag.textContent = (practice ? `${difficulty} · practice` : difficulty) + cursorNote;
    apply();
  };

  for (const r of radios) {
    r.addEventListener('change', () => { Config.gameplay.difficulty = r.value; save(); render(); });
  }
  for (const r of modeRadios) {
    r.addEventListener('change', () => { Config.gameplay.mode = r.value; save(); render(); });
  }
  practiceEl.addEventListener('change', () => { Config.gameplay.practice = practiceEl.checked; save(); render(); });
  render();

  let flavourI = 0;
  let flavourTimer = setInterval(() => { flavour.textContent = FLAVOUR[flavourI++ % FLAVOUR.length]; }, 900);
  flavour.textContent = FLAVOUR[flavourI++];

  return {
    /** Lets settings reach engine-owned hooks (audio volume, render quality) once they exist. */
    attach(ctx) { engineCtx = ctx; apply(); },
    progress(p, label) {
      deployBtn.querySelector('i').style.width = `${Math.round(p * 100)}%`;
      deployBtn.querySelector('span').textContent = label;
    },
    failed(message) {
      clearInterval(flavourTimer);
      flavour.textContent = '';
      deployBtn.querySelector('span').textContent = message ?? 'Init failed — see console';
      deployBtn.style.color = '#c0392b';
    },
    ready({ onDeploy, onRestart, onQuit }) {
      clearInterval(flavourTimer);
      flavourTimer = null;
      flavour.textContent = '';
      deployBtn.disabled = false;
      deployBtn.querySelector('span').textContent = 'Deploy';
      root.classList.add('live');   // loaded: let the live frame show through
      deployBtn.addEventListener('click', () => onDeploy(inMatch));
      document.getElementById('restart-btn').addEventListener('click', () => onRestart?.());
      document.getElementById('quit-btn').addEventListener('click', () => onQuit?.());
      deployBtn.focus();
    },
    /** In a match the menu is a pause screen: Resume / Restart / Quit, mode locked. */
    setMatch(on) {
      inMatch = on;
      pauseActions.hidden = !on;
      if (!on) { deployBtn.querySelector('span').textContent = 'Deploy'; renderRecords(); }
      render();
    },
    setLocked(locked, cursorMode = false) {
      if (locked) { deployBtn.blur(); cancelBind(); }   // a focused button would eat keyboard input
      root.classList.toggle('show', !locked);
      tag.hidden = !locked;
      cursorNote = cursorMode ? ' · cursor mode — arrow keys also look · Esc for menu' : '';
      render();
      if (!locked && inMatch) deployBtn.querySelector('span').textContent = 'Resume';
      if (!locked) setTimeout(() => deployBtn.focus(), 30);
    },
    /** Hide the menu without taking the lock (a mission card owns the screen). */
    hide() { root.classList.remove('show'); tag.hidden = true; },
  };
}
