/**
 * User-remappable keyboard controls.
 *
 * Systems keep asking Input for an action's fixed code (isDown('KeyW')).
 * Input runs every physical key through `translate()`, which maps the user's
 * chosen key onto that code and swallows default keys that were moved away — so
 * no call site knows remapping exists. Bindings are a permutation (binding a key
 * already in use swaps the two actions), so one key never drives two actions.
 */

/**
 * `code` is what systems listen for (defaults to `def`, the default physical key).
 * `alt` is a second physical key that also works while the action is unmoved.
 * Fire has a virtual code: Input folds it into mouse button 0.
 */
export const ACTIONS = [
  { id: 'fire',     label: 'Fire',           def: 'Enter',  code: 'Fire' },
  { id: 'forward',  label: 'Move forward',   def: 'KeyW' },
  { id: 'back',     label: 'Move back',      def: 'KeyS' },
  { id: 'left',     label: 'Strafe left',    def: 'KeyA' },
  { id: 'right',    label: 'Strafe right',   def: 'KeyD' },
  { id: 'sprint',   label: 'Sprint',         def: 'ShiftLeft',   alt: 'ShiftRight' },
  // Crouch defaults to C, not Ctrl: Ctrl+W closes the tab and cannot be intercepted.
  { id: 'crouch',   label: 'Crouch / slide (hold)', def: 'KeyC', code: 'ControlLeft' },
  { id: 'crouchT',  label: 'Crouch (toggle)', def: 'KeyZ',  code: 'KeyC' },
  { id: 'jump',     label: 'Jump',           def: 'Space' },
  { id: 'reload',   label: 'Reload',         def: 'KeyR' },
  { id: 'interact', label: 'Interact',       def: 'KeyF',   code: 'Interact' },
  { id: 'grenade',  label: 'Frag grenade',   def: 'KeyG',   code: 'Grenade' },
  { id: 'melee',    label: 'Melee',          def: 'KeyV',   code: 'Melee' },
  { id: 'leanL',    label: 'Lean left',      def: 'KeyQ',   code: 'LeanL' },
  { id: 'leanR',    label: 'Lean right',     def: 'KeyE',   code: 'LeanR' },
  { id: 'rifle',    label: 'M4A1',           def: 'Digit1' },
  { id: 'smg',      label: 'MP5',            def: 'Digit2' },
  { id: 'next',     label: 'Next weapon',    def: 'KeyX',   code: 'KeyQ' },
  { id: 'firemode', label: 'Fire mode',      def: 'KeyB' },
  { id: 'inspect',  label: 'Inspect weapon', def: 'KeyT',   code: 'KeyF' },
  { id: 'lookL',    label: 'Look left',      def: 'ArrowLeft' },
  { id: 'lookR',    label: 'Look right',     def: 'ArrowRight' },
  { id: 'lookU',    label: 'Look up',        def: 'ArrowUp' },
  { id: 'lookD',    label: 'Look down',      def: 'ArrowDown' },
];

/**
 * Default keys that collide with a browser shortcut when a modifier is held
 * (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab…). Checked by tools/test-keybinds.mjs.
 */
export const BROWSER_MODIFIERS = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** Keys the game or browser owns outright; they can't be bound. */
export const RESERVED = new Set(['Escape', 'Tab', 'MetaLeft', 'MetaRight']);

// v2: the default layout changed (Space jumps, C crouches); stale v1 sets are ignored.
const STORE_KEY = 'killhouse:keys:v2';
/** Physical keys the game claims by default; swallowed unless currently bound. */
const CLAIMED = new Set(ACTIONS.flatMap((a) => [a.def, a.code ?? a.def, a.alt].filter(Boolean)));

/** action id -> physical code */
const bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));
/** physical code -> code the game listens for */
let map = new Map();

function rebuild() {
  map = new Map();
  // Alts first, so an explicit binding onto an alt key (e.g. Fire → R-Shift) wins.
  for (const a of ACTIONS) if (a.alt && bindings[a.id] === a.def) map.set(a.alt, a.alt);
  for (const a of ACTIONS) map.set(bindings[a.id], a.code ?? a.def);
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(bindings)); } catch { /* noop */ }
}

export function loadBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    const codes = ACTIONS.map((a) => saved[a.id]);
    // Only accept a complete, duplicate-free set; anything else is stale or tampered.
    if (codes.every((c) => typeof c === 'string' && !RESERVED.has(c)) && new Set(codes).size === codes.length) {
      ACTIONS.forEach((a, i) => { bindings[a.id] = codes[i]; });
    }
  } catch { /* storage blocked or corrupt — defaults stand */ }
  rebuild();
}

export function getBinding(id) { return bindings[id]; }

/** Bind `code` to action `id`; whichever action held `code` takes `id`'s old key. */
export function setBinding(id, code) {
  if (!(id in bindings) || RESERVED.has(code)) return false;
  const holder = Object.keys(bindings).find((k) => bindings[k] === code);
  if (holder) bindings[holder] = bindings[id];
  bindings[id] = code;
  rebuild();
  save();
  return true;
}

export function resetBindings() {
  for (const a of ACTIONS) bindings[a.id] = a.def;
  rebuild();
  save();
}

/** Physical code -> the code systems listen for, or null to swallow it. */
export function translate(code) {
  if (map.has(code)) return map.get(code);
  return CLAIMED.has(code) ? null : code;
}

export function keyLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code];
  const named = {
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Space: 'Space', CapsLock: 'Caps', Backquote: '`',
  };
  return named[code] ?? code;
}

loadBindings();
