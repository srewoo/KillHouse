/**
 * Pointer-lock mouse + keyboard input. Accumulates mouse delta between frames
 * so the player controller reads a clean per-frame value regardless of how many
 * mousemove events the OS delivered.
 *
 * OWNER: core. Do not edit from system agents.
 */

import { translate } from './Keybinds.js';

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    /** Controls captured: real pointer lock, or cursor mode (see enterCursorMode). */
    this.locked = false;
    this.cursorMode = false;
    this.wheel = 0;

    // Edge-triggered sets, cleared at end of each frame by endFrame().
    this._pressedThisFrame = new Set();
    this._releasedThisFrame = new Set();
    this._buttonsPressedThisFrame = new Set();

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Pointer lock releases on Esc by itself; cursor mode has to do it here.
      if (e.code === 'Escape' && this.cursorMode) { this.exitCursorMode(); return; }
      const c = translate(e.code);   // user remapping — see Keybinds.js
      if (c === null) return;
      this.keys.add(c);
      this._pressedThisFrame.add(c);
      // Stop the browser scrolling / quick-find while playing.
      if (['Fire', 'Space', 'Tab', 'KeyR', 'ControlLeft', 'Slash', 'Grenade', 'Interact', 'Melee', 'LeanL', 'LeanR'].includes(c) && this.locked) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      const c = translate(e.code);
      if (c === null) return;
      this.keys.delete(c);
      this._releasedThisFrame.add(c);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this._buttonsPressedThisFrame.add(e.button);
    });

    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (this.cursorMode) this.exitCursorMode(false);   // a late real lock supersedes the fallback
      this.locked = document.pointerLockElement === this.dom;
      // Never carry a key across a lock change: a key held in the menu (Enter to
      // resume — Enter is also Fire) would otherwise fire the first frame back.
      this.keys.clear();
      this.buttons.clear();
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('pointerlockerror', () => this.onLockError?.(new Error('pointerlockerror')));

    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
  }

  /**
   * Chrome refuses a lock requested within ~1s of the user pressing Esc, and
   * older builds fire only 'pointerlockerror'. Either way it used to fail
   * silently, leaving WASD live but a dead mouse — so report it.
   */
  requestLock() {
    try {
      const p = this.dom.requestPointerLock?.();
      p?.catch?.((err) => this.onLockError?.(err));
    } catch (err) {
      this.onLockError?.(err);
    }
  }

  /**
   * Fallback when Chrome refuses pointer lock (unfocused window, mouse lock
   * blocked in site settings or by policy, remote desktop). Plain mousemove
   * still carries movementX/Y, so look works with a visible cursor; arrow keys
   * cover turning past the screen edge. Esc returns to the menu.
   */
  enterCursorMode() {
    if (this.locked) return;
    this.cursorMode = true;
    this.locked = true;
    this.dom.style.cursor = 'crosshair';
    this.onLockChange?.(true);
  }

  exitCursorMode(notify = true) {
    if (!this.cursorMode) return;
    this.cursorMode = false;
    this.locked = false;
    this.dom.style.cursor = '';
    this.keys.clear();
    this.buttons.clear();
    if (notify) this.onLockChange?.(false);
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this._pressedThisFrame.has(code); }
  wasReleased(code) { return this._releasedThisFrame.has(code); }
  // The remappable Fire key (Keybinds.js) counts as the left mouse button.
  isMouseDown(btn) { return this.buttons.has(btn) || (btn === 0 && this.keys.has('Fire')); }
  wasMousePressed(btn) {
    return this._buttonsPressedThisFrame.has(btn) || (btn === 0 && this._pressedThisFrame.has('Fire'));
  }

  /** Movement intent in local space: x = strafe (+right), z = forward (+forward). */
  moveAxis() {
    let x = 0, z = 0;
    if (this.isDown('KeyW')) z += 1;
    if (this.isDown('KeyS')) z -= 1;
    if (this.isDown('KeyD')) x += 1;
    if (this.isDown('KeyA')) x -= 1;
    // Normalise so diagonals aren't faster.
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  /** Consume accumulated mouse delta. Call exactly once per frame. */
  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this._pressedThisFrame.clear();
    this._releasedThisFrame.clear();
    this._buttonsPressedThisFrame.clear();
    this.wheel = 0;
  }
}

export default Input;
