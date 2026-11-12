// Self-check for the key remapping layer. Run: node tools/test-keybinds.mjs
import assert from 'node:assert/strict';
import { ACTIONS, BROWSER_MODIFIERS, translate, setBinding, getBinding, resetBindings } from '../src/core/Keybinds.js';

resetBindings();

// Default layout: the conventional one, not the old Space-fires/E-jumps layout.
assert.equal(translate('Space'), 'Space', 'Space jumps by default');
assert.equal(translate('Enter'), 'Fire', 'Enter is the keyboard fire key');
assert.equal(translate('KeyC'), 'ControlLeft', 'C is crouch-hold (and slide)');
assert.equal(translate('KeyZ'), 'KeyC', 'Z is crouch-toggle');
assert.equal(translate('KeyF'), 'Interact');
assert.equal(translate('KeyG'), 'Grenade');
assert.equal(translate('KeyV'), 'Melee');
assert.equal(translate('KeyQ'), 'LeanL');
assert.equal(translate('KeyE'), 'LeanR');
assert.equal(translate('KeyX'), 'KeyQ', 'X cycles weapons (systems still listen for KeyQ)');
assert.equal(translate('KeyT'), 'KeyF', 'T inspects (systems still listen for KeyF)');
assert.equal(translate('ControlLeft'), null, 'Ctrl is not a default: Ctrl+W closes the tab');
assert.equal(translate('KeyW'), 'KeyW');
assert.equal(translate('ShiftRight'), 'ShiftRight', 'alt sprint key works while unmoved');
assert.equal(translate('KeyP'), 'KeyP', 'unclaimed keys pass through');

// No default binding may be a browser modifier — a held Ctrl/Alt/Meta plus W, T, N,
// Tab… is a browser shortcut the page cannot intercept.
for (const a of ACTIONS) {
  assert.ok(!BROWSER_MODIFIERS.has(a.def), `${a.id} defaults to browser modifier ${a.def}`);
  if (a.alt) assert.ok(!BROWSER_MODIFIERS.has(a.alt), `${a.id} alt is browser modifier ${a.alt}`);
}
// Defaults are a permutation: no physical key drives two actions.
assert.equal(new Set(ACTIONS.map((a) => a.def)).size, ACTIONS.length, 'duplicate default key');

// Binding a key already in use swaps the two actions.
setBinding('forward', 'KeyS');
assert.equal(getBinding('back'), 'KeyW');
assert.equal(translate('KeyS'), 'KeyW');
assert.equal(translate('KeyW'), 'KeyS');

// Moving an action off its default swallows the old key and its alt.
resetBindings();
setBinding('sprint', 'KeyN');
assert.equal(translate('KeyN'), 'ShiftLeft');
assert.equal(translate('ShiftLeft'), null);
assert.equal(translate('ShiftRight'), null);

// Explicit binding onto an unmoved action's alt key beats the alt.
resetBindings();
setBinding('fire', 'ShiftRight');
assert.equal(translate('ShiftRight'), 'Fire');
assert.equal(translate('Enter'), null, 'old fire key is freed');

assert.equal(setBinding('fire', 'Escape'), false, 'reserved keys are refused');
resetBindings();
console.log('keybinds ok');
