import * as THREE from 'three';

/**
 * Shader warm-up, run once behind the loading bar.
 *
 * Three.js compiles a material's program the first time an object using it is
 * drawn. Anything hidden at boot — parked bots, pooled muzzle flashes, tracers,
 * smoke — and anything created on demand — debris pools, objective props — used to
 * compile mid-game, on the first shot or the first contact (measured: a 75-92 ms
 * frame on the first trigger pull).
 *
 * Three things have to match the real frame or the warm-up compiles the wrong
 * program variant and buys nothing:
 *   1. Render target. The world is drawn into the pipeline's linear HDR target, not
 *      the sRGB canvas; outputColorSpace is part of the program key.
 *   2. CSM hook. Lit materials get their cascade-shadow chunks from a scene scan;
 *      a material compiled before the scan compiles again after it.
 *   3. Instancing. Debris draws world materials through InstancedMesh, which is a
 *      separate variant from the plain mesh.
 *
 * Never throws: a failed warm-up only means shaders compile lazily, as before.
 */
export async function precompileScenes(ctx, pairs) {
  const renderer = ctx.renderer;
  const t0 = performance.now();
  const programsBefore = renderer.info.programs?.length ?? 0;

  const stand = buildStandIns(ctx);
  if (stand) ctx.scene.add(stand);

  const prevTarget = renderer.getRenderTarget();
  const hdrTarget = ctx.render?.targets?.scene ?? null;

  try {
    for (const [scene, camera] of pairs) {
      if (!scene || !camera) continue;
      const hidden = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      try {
        if (scene === ctx.scene) ctx.lighting?.csm?.scanScene?.(true);
        uploadTextures(renderer, scene);
        renderer.setRenderTarget(scene === ctx.scene ? hdrTarget : (ctx.render?.targets?.viewmodel ?? hdrTarget));
        if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
        // compile() covers the colour pass only. Shadow-map depth programs (one per
        // vertex variant: plain, skinned, instanced) compile when a caster is first
        // drawn into a cascade — measured as a 68 ms link on the first debris chunk.
        // One real draw with everything visible and unculled compiles those too; the
        // target is overwritten by the first genuine frame.
        if (scene === ctx.scene) {
          const culled = [];
          scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
          try { renderer.render(scene, camera); } finally { for (const o of culled) o.frustumCulled = true; }
        }
      } catch (err) {
        console.warn('[precompile] scene warm-up failed; shaders will compile on first use:', err);
      } finally {
        for (const o of hidden) o.visible = false;
      }
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    if (stand) {
      ctx.scene.remove(stand);
      stand.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
  }

  const added = (renderer.info.programs?.length ?? 0) - programsBefore;
  console.log(`[precompile] ${added} programs in ${Math.round(performance.now() - t0)} ms`);
  return added;
}

/**
 * compile() builds programs but uploads no textures; a hidden smoke sprite or
 * impact atlas still uploads on the frame it first appears. Push every texture
 * referenced by a material in the scene (properties and shader uniforms) now.
 */
function uploadTextures(renderer, scene) {
  if (!renderer.initTexture) return;
  const seen = new Set();
  const push = (t) => {
    if (!t || !t.isTexture || seen.has(t) || t.isRenderTargetTexture) return;
    seen.add(t);
    try { renderer.initTexture(t); } catch { /* uploads on first use instead */ }
  };
  scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of ms) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) push(v); }
      if (m.uniforms) for (const k in m.uniforms) push(m.uniforms[k]?.value);
    }
  });
}

/**
 * One plain and one instanced stand-in per cached world material, so materials that
 * only appear later (debris, props spawned by a mode) are compiled in both forms.
 */
function buildStandIns(ctx) {
  const mats = ctx.materials?._mats;
  if (!mats || !mats.size) return null;
  const group = new THREE.Group();
  group.name = 'precompile:standins';
  const geo = new THREE.PlaneGeometry(0.01, 0.01);
  for (const mat of mats.values()) {
    if (!mat) continue;
    const plain = new THREE.Mesh(geo, mat);
    plain.castShadow = plain.receiveShadow = true;
    const inst = new THREE.InstancedMesh(geo, mat, 1);
    inst.castShadow = inst.receiveShadow = true;
    group.add(plain, inst);
  }
  return group;
}
