/**
 * Global tunables. Every system reads from here rather than hard-coding numbers,
 * so the critic loop can retune the whole game from one file.
 *
 * OWNER: core (do not add system-specific state here — only shared constants).
 */

export const Config = {
  render: {
    // Internal render scale. 1.0 = native. TAA lets us sit at 1.0 on desktop.
    resolutionScale: 1.0,
    // Device-pixel cap. 2.0 rendered a MacBook's 1728x902 window at 3456x1804 —
    // 6.2 MP through a deferred + SSR + TAA stack — and held ~20 fps on an M3 Pro.
    // TAA resolves well at 1x; the pixel budget below also caps huge windows.
    maxPixelRatio: 1.0,
    // Hard ceiling on drawing-buffer pixels (~1080p). Larger windows render below
    // native and are upscaled by the browser rather than tanking frame rate.
    maxPixels: 1920 * 1080,
    // Adaptive internal-scale controller in RenderPipeline._adaptResolution.
    dynamicResolution: true,
    exposure: 1.05,
    // Filmic look. Modern Warfare sits cool-shadowed / warm-highlighted.
    tonemap: 'agx',            // 'agx' | 'aces' | 'reinhard'
    shadowMapSize: 2048,
    csmCascades: 4,
    csmMaxDistance: 140,
    taa: true,
    ssao: true,
    ssr: true,
    volumetrics: true,
    bloom: true,
    motionBlur: true,
    filmGrain: 0.028,
    chromaticAberration: 0.0016,
    vignette: 0.34,
  },

  // Art direction: contemporary military, overcast dusk, cool ambient / warm practicals.
  art: {
    sunColor: 0xffd7a8,
    sunIntensity: 3.1,
    sunElevation: 11.5,        // degrees above horizon — low sun = long dramatic shadows
    sunAzimuth: 118,
    skyTurbidity: 6.2,
    fogColor: 0x9aa4ad,
    fogDensity: 0.0085,
    ambientTint: 0x4a5a68,
    practicalColor: 0xffb257,  // sodium-vapour interior lights
  },

  player: {
    height: 1.75,
    crouchHeight: 1.05,
    eyeOffset: -0.14,          // eye sits below top of capsule
    radius: 0.34,
    walkSpeed: 3.6,
    sprintSpeed: 6.3,
    crouchSpeed: 1.9,
    adsSpeedMul: 0.55,
    accelGround: 58,
    accelAir: 9,
    friction: 11.5,
    jumpVelocity: 5.0,
    gravity: -18.5,
    stepHeight: 0.42,
    mouseSensitivity: 0.0021,
    adsSensitivityMul: 0.62,
    maxPitch: 1.53,
    invertY: false,            // settings menu
  },

  camera: {
    fov: 78,
    adsFov: 52,
    sprintFov: 84,
    near: 0.02,
    far: 900,
    viewmodelFov: 55,          // separate FOV for the weapon layer — critical for AAA feel
  },

  audio: {
    master: 0.85,
    sfx: 1.0,
    music: 0.35,
  },

  gameplay: {
    botCount: 7,
    playerHealth: 100,
    healthRegenDelay: 4.2,
    healthRegenRate: 22,
    // Enemy rifle fire. The player's weapons have always rolled off with range;
    // bot rounds did full damage out to 140 m, which is what made long-range
    // deaths feel unearned (measured: killed in ~3 s by a bot 56 m away).
    botFalloff: { near: 22, far: 60, min: 0.45 },
    // Extra reaction time per metre beyond `botFalloff.near` on a fresh acquisition.
    botReactionPerMetre: 0.022,
    // A bot that has not fired at the player for this long counts as a fresh contact
    // and fires its warning shots again.
    botWarnReset: 6,
    // Set from the home page. Read live, so changing it from the pause menu applies at once.
    difficulty: 'medium',      // key into `difficulties`
    practice: false,           // true = the player takes no damage
    // Multipliers on the AI's baseline gunnery (medium = the original tuning).
    difficulties: {
      // engagers = how many bots may be shooting at the player at the same moment.
      // warnShots = deliberate near-misses a bot fires when it first opens up on
      // the player, so the opening of a fight is "cracks and tracers, find him",
      // not "dead before you saw anyone".
      easy:   { spread: 1.8, reaction: 2.0, damage: 0.5, respawn: 1.6, engagers: 2, warnShots: 4 },
      medium: { spread: 1.0, reaction: 1.0, damage: 1.0, respawn: 1.0, engagers: 2, warnShots: 3 },
      hard:   { spread: 0.6, reaction: 0.5, damage: 1.4, respawn: 0.6, engagers: 3, warnShots: 1 },
    },
    // Bots pre-built at boot. Modes spawn from this pool; extra ones stay hidden.
    botPool: 12,
    grenades: 3,
    // 'operation' | 'deathmatch' | 'drill' — picked on the home page.
    mode: 'operation',
  },

  // Settings-menu accessibility switches. Read live by player / hud / game.
  accessibility: {
    reducedMotion: false,      // scales camera shake, kills grain + motion blur
    colorblind: false,         // hitmarkers + damage use blue/orange instead of red
    subtitles: true,           // radio + callout captions
    healthBar: false,          // optional numeric health bar
    voice: true,               // spoken callouts via local speech synthesis
  },

  debug: {
    showStats: false,
    freeCam: false,
    wireframe: false,
  },
};

export default Config;
