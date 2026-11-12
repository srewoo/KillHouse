/**
 * World props the game layer places: objective relays, ammo crates and the
 * extraction beacon. Built from the level's own procedural materials so they sit
 * in the same light as everything else; status LEDs are unlit so they read at range.
 *
 * OWNER: game (src/game/**).
 */
import * as THREE from 'three';

const LED_ON = new THREE.Color(1.0, 0.18, 0.08).multiplyScalar(6);
const LED_DONE = new THREE.Color(0.15, 1.0, 0.35).multiplyScalar(3);
const LED_CRATE = new THREE.Color(1.0, 0.7, 0.2).multiplyScalar(3);

const DOWN = new THREE.Vector3(0, -1, 0);

/** Snap a world XZ onto the floor beneath it (physics first, nav grid second). */
export function groundAt(ctx, x, z, fromY = 3) {
  const phys = ctx.physics;
  if (phys?.world) {
    const hit = phys.raycast(new THREE.Vector3(x, fromY + 1.5, z), DOWN, 30, {
      group: 'PROJECTILE', mask: phys.GROUPS?.WORLD ?? 1,
    });
    if (hit && Number.isFinite(hit.point.y)) return hit.point.y;
  }
  const nav = ctx.ai?.nav;
  if (nav?.ready) return nav.groundAt(x, z, 0);
  return 0;
}

/** Nearest walkable nav cell centre to (x, z), or the raw point on the floor. */
export function walkableNear(ctx, x, z, radius = 6) {
  const nav = ctx.ai?.nav;
  if (nav?.ready) {
    const c = nav.nearestWalkable(x, z, radius);
    if (c >= 0) return nav.cellCentre(c, new THREE.Vector3());
  }
  return new THREE.Vector3(x, groundAt(ctx, x, z), z);
}

function material(ctx, name, fallback) {
  try { return ctx.materials?.get?.(name) ?? new THREE.MeshStandardMaterial({ color: fallback }); }
  catch { return new THREE.MeshStandardMaterial({ color: fallback }); }
}

function mesh(geo, mat, parent, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Shared base for anything the player walks up to and holds Interact on. */
class Prop {
  constructor(ctx, position, yaw = 0) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    this.position = position.clone();
    this._colliders = [];
    ctx.scene.add(this.group);
  }

  _collider(w, h, d, y = h / 2) {
    const phys = this.ctx.physics;
    if (!phys?.world) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
    const made = phys.addBox([w, h, d], { x: this.position.x, y: this.position.y + y, z: this.position.z }, q, {
      type: 'fixed', material: 'metal',
    });
    if (made) this._colliders.push(made.body);
  }

  dispose() {
    try { this.ctx.scene.remove(this.group); } catch { /* noop */ }
    // Geometry is per-prop; of the materials only our unlit LEDs are — the PBR ones
    // are the material system's shared cache and must survive.
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      try { o.geometry?.dispose(); } catch { /* noop */ }
      if (o.material && (o.material === this.ledMat || o.material === this.flareMat)) {
        try { o.material.dispose(); } catch { /* noop */ }
      }
    });
    for (const b of this._colliders) { try { this.ctx.physics?.removeBody?.(b); } catch { /* noop */ } }
    this._colliders.length = 0;
  }
}

/** Comms relay: a steel cabinet with an antenna mast and a status LED. */
export class Relay extends Prop {
  constructor(ctx, position, yaw, label) {
    super(ctx, position, yaw);
    this.label = label;
    this.progress = 0;
    this.done = false;
    const body = material(ctx, 'paintedMetal', 0x55605a);
    const rust = material(ctx, 'rustMetal', 0x6a4a3a);
    mesh(new THREE.BoxGeometry(0.72, 1.18, 0.46), body, this.group, 0, 0.59, 0);
    mesh(new THREE.BoxGeometry(0.8, 0.08, 0.54), rust, this.group, 0, 1.22, 0);
    mesh(new THREE.CylinderGeometry(0.018, 0.026, 1.6, 6), rust, this.group, 0.22, 2.05, 0);
    mesh(new THREE.BoxGeometry(0.5, 0.2, 0.04), rust, this.group, 0, 0.86, 0.25);
    this.ledMat = new THREE.MeshBasicMaterial({ color: LED_ON.clone(), toneMapped: false });
    this.led = mesh(new THREE.SphereGeometry(0.035, 10, 8), this.ledMat, this.group, -0.2, 1.02, 0.24);
    this.led.castShadow = false;
    this.mastLed = mesh(new THREE.SphereGeometry(0.03, 8, 6), this.ledMat, this.group, 0.22, 2.86, 0);
    this.mastLed.castShadow = false;
    this._collider(0.72, 1.2, 0.46);
    this._blink = Math.random() * 2;
  }

  /** World point the player has to face while interacting. */
  get focus() { return this._focus ??= this.position.clone().setY(this.position.y + 0.9); }

  complete() {
    this.done = true;
    this.progress = 1;
    this.ledMat.color.copy(LED_DONE);
  }

  update(dt) {
    if (this.done) return;
    this._blink += dt;
    const on = (this._blink % 1.1) < 0.55;
    this.led.visible = on;
    this.mastLed.visible = !on;
  }
}

/** Ammo crate: refills both weapons and grenades on Interact, with a cooldown. */
export class AmmoCrate extends Prop {
  constructor(ctx, position, yaw) {
    super(ctx, position, yaw);
    this.cooldown = 0;
    const wood = material(ctx, 'wood', 0x6b5a3a);
    const metal = material(ctx, 'paintedMetal', 0x3d4a3a);
    mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), wood, this.group, 0, 0.25, 0);
    mesh(new THREE.BoxGeometry(1.04, 0.07, 0.64), metal, this.group, 0, 0.52, 0);
    mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), metal, this.group, 0.15, 0.71, 0);
    this.ledMat = new THREE.MeshBasicMaterial({ color: LED_CRATE.clone(), toneMapped: false });
    const led = mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), this.ledMat, this.group, 0, 0.42, 0.31);
    led.castShadow = false;
    this._collider(1.0, 0.86, 0.6);
  }

  get focus() { return this._focus ??= this.position.clone().setY(this.position.y + 0.5); }
  get ready() { return this.cooldown <= 0; }

  use() {
    this.cooldown = 25;
    this.ledMat.color.setRGB(0.3, 0.3, 0.3);
  }

  update(dt) {
    if (this.cooldown <= 0) return;
    this.cooldown -= dt;
    if (this.cooldown <= 0) this.ledMat.color.copy(LED_CRATE);
  }
}

/** Extraction beacon: a flare pole that only lights once extraction is open. */
export class Beacon extends Prop {
  constructor(ctx, position) {
    super(ctx, position, 0);
    const metal = material(ctx, 'rustMetal', 0x5a4a3a);
    mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 8), metal, this.group, 0, 1.2, 0);
    this.flareMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.05, 0.03), toneMapped: false });
    this.flare = mesh(new THREE.SphereGeometry(0.09, 12, 10), this.flareMat, this.group, 0, 2.48, 0);
    this.flare.castShadow = false;
    this.active = false;
    this._t = 0;
  }

  activate() {
    this.active = true;
    try {
      this._light = this.ctx.lighting?.addPractical?.(this.position.clone().setY(this.position.y + 2.5), 0x40ff70, 6, 8);
    } catch { /* optional */ }
  }

  dispose() {
    try { if (this._light) this.ctx.lighting?.removePractical?.(this._light); } catch { /* noop */ }
    super.dispose();
  }

  update(dt) {
    if (!this.active) return;
    this._t += dt;
    const k = 0.75 + 0.25 * Math.sin(this._t * 9) * Math.sin(this._t * 2.3);
    this.flareMat.color.setRGB(0.3 * k * 8, 1.0 * k * 8, 0.45 * k * 8);
  }
}
