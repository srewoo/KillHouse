import * as THREE from 'three';

/**
 * Shadow-caster LOD for the merged level meshes.
 *
 * Measured on the warehouse pose: every merged level mesh is ONE object, so each of
 * the four cascade passes submits the whole ~565 k-triangle caster set (frustum culling
 * cannot split a 300 m mesh, and at an 8.7 degree sun the cascade volumes are so
 * elongated that spatial splitting does not help either; see Builder.flush). Shadows
 * were 2.3 M of a 3.7 M triangle frame.
 *
 * The far cascades do not resolve that detail. Cascade 2 (22-52 m) filters over ~3
 * texels of 8 cm and cascade 3 (52-140 m) over ~4 texels of 20 cm; a rivet, a bag
 * seam or a 5 cm bevel strip is far below one texel there. So each shadow-casting
 * group also gets position-only proxies built by vertex clustering: every vertex is
 * snapped into a `cell`-sized bucket and replaced by the bucket's MEAN (so flat faces
 * stay flat and bases stay on the ground), triangles that collapse are dropped. The
 * mesh stays watertight, nothing can open a light-leaking crack the way plain
 * small-triangle culling would, and it is ~80 % fewer triangles at 0.3 m.
 *
 * Proxies live on SHADOW_PROXY_LAYER, which the main camera does not enable, so they
 * are never drawn by the beauty or G-buffer passes. CascadeShadows enables the layer
 * for the duration of the shadow pass and picks, per cascade, which caster set is
 * flagged `castShadow`. Cascades 0 and 1 (everything within 22 m) still draw the
 * full-detail meshes, so near contact shadows are untouched.
 */
export const SHADOW_PROXY_LAYER = 5;

/** `from` = first cascade index that uses this proxy. Ascending. */
export const SHADOW_LODS = [
  { from: 1, cell: 0.1 },
  { from: 2, cell: 0.25 },
  { from: 3, cell: 0.6 },
];

/** Below this many caster triangles a group is not worth an extra object. */
export const SHADOW_PROXY_MIN_TRIS = 3000;

const BIAS = 4096;
const SPAN = 8192;

/**
 * Cluster `geos` (position-only use) into one indexed proxy geometry.
 * @returns {THREE.BufferGeometry|null}
 */
export function buildShadowProxy(geos, cell) {
  const inv = 1 / cell;
  const ids = new Map();
  let sx = [], sy = [], sz = [], cnt = [];
  const tris = [];
  const seen = new Set();

  const cluster = (x, y, z) => {
    const key = ((Math.round(x * inv) + BIAS) * SPAN + (Math.round(y * inv) + BIAS)) * SPAN
      + (Math.round(z * inv) + BIAS);
    let id = ids.get(key);
    if (id === undefined) {
      id = cnt.length;
      ids.set(key, id);
      sx.push(0); sy.push(0); sz.push(0); cnt.push(0);
    }
    sx[id] += x; sy[id] += y; sz[id] += z; cnt[id]++;
    return id;
  };

  for (const g of geos) {
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const at = (i) => (idx ? idx.getX(i) : i);
    for (let t = 0; t + 2 < n; t += 3) {
      const a = cluster(pos.getX(at(t)), pos.getY(at(t)), pos.getZ(at(t)));
      const b = cluster(pos.getX(at(t + 1)), pos.getY(at(t + 1)), pos.getZ(at(t + 1)));
      const c = cluster(pos.getX(at(t + 2)), pos.getY(at(t + 2)), pos.getZ(at(t + 2)));
      if (a === b || b === c || a === c) continue;
      // rotate so the smallest id leads: same winding + same corners = duplicate
      let k;
      if (a < b && a < c) k = `${a},${b},${c}`;
      else if (b < c) k = `${b},${c},${a}`;
      else k = `${c},${a},${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      tris.push(a, b, c);
    }
  }
  if (!tris.length) return null;

  const positions = new Float32Array(cnt.length * 3);
  for (let i = 0; i < cnt.length; i++) {
    positions[i * 3] = sx[i] / cnt[i];
    positions[i * 3 + 1] = sy[i] / cnt[i];
    positions[i * 3 + 2] = sz[i] / cnt[i];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
