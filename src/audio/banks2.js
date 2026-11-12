/**
 * Second sound bank: grenades, melee, radio, UI and music stingers.
 * Same offline DSP approach as banks.js; every function returns one Float32Array.
 * OWNER: audio.
 */
import {
  buf, white, biquad, svfSweep, onePoleSweep, envAD, applyEnv,
  mixInto, scale, decaySine, noiseBurst, normalizePeak, softClip, fadeEdges,
  dcBlock,
} from './dsp.js';

const TAU = Math.PI * 2;

/** Big low thump + noise crack + debris rattle, ~2.2 s. */
export function explosion(sr, rng) {
  const n = Math.round(2.2 * sr);
  const out = buf(n);
  // sub thump: swept sine
  decaySine(out, sr, { freq: 95, freqEnd: 28, tau: 0.30, amp: 1.0, glide: 0.18, attack: 0.002 });
  decaySine(out, sr, { freq: 160, freqEnd: 50, tau: 0.12, amp: 0.6, glide: 0.07, attack: 0.001 });
  // crack
  mixInto(out, noiseBurst(sr, rng, { dur: 0.12, attack: 0.0002, tau: 0.018, tau2: 0.07, amp2: 0.25, hp: 400, lp: 7500 }), 0, 0.95);
  // body roar: low-passed noise, slowly closing
  {
    const m = Math.round(1.6 * sr);
    const b = white(m, rng);
    onePoleSweep(b, 2600, 180, sr, 0.5);
    applyEnv(b, envAD(m, sr, 0.004, 0.22, 1, 0.7, 0.25));
    mixInto(out, b, 0, 1.1);
  }
  // debris rattle: sparse ticks after the blast
  for (let i = 0; i < 46; i++) {
    const t = 0.18 + Math.pow(rng.next(), 0.7) * 1.7;
    const amp = 0.28 * Math.exp(-t * 1.5) * rng.range(0.4, 1);
    mixInto(out, noiseBurst(sr, rng, {
      dur: 0.03, attack: 0.0002, tau: rng.range(0.003, 0.009), bp: rng.range(900, 4200), bpQ: 1.3,
    }), Math.round(t * sr), amp);
  }
  dcBlock(out, sr);
  softClip(out, 1.8);
  normalizePeak(out, 0.96);
  fadeEdges(out, sr, 0.3, 80);
  return out;
}

export function grenadePin(sr, rng) {
  const out = buf(Math.round(0.4 * sr));
  mixInto(out, noiseBurst(sr, rng, { dur: 0.012, attack: 0.0001, tau: 0.002, hp: 2500 }), 0, 0.5);
  const f = rng.range(3300, 3700);
  decaySine(out, sr, { freq: f, tau: 0.09, amp: 0.45, glide: 0, offset: Math.round(0.004 * sr) });
  decaySine(out, sr, { freq: f * 2.76, tau: 0.04, amp: 0.25, glide: 0, offset: Math.round(0.004 * sr) });
  decaySine(out, sr, { freq: f * 1.51, tau: 0.06, amp: 0.2, glide: 0, offset: Math.round(0.004 * sr) });
  dcBlock(out, sr); normalizePeak(out, 0.6); fadeEdges(out, sr, 0.3, 15);
  return out;
}

export function grenadeBounce(sr, rng) {
  const out = buf(Math.round(0.25 * sr));
  mixInto(out, noiseBurst(sr, rng, { dur: 0.01, attack: 0.0001, tau: 0.0018, hp: 1800 }), 0, 0.5);
  const f = rng.range(1500, 1900);
  decaySine(out, sr, { freq: f, tau: 0.035, amp: 0.4, glide: 0 });
  decaySine(out, sr, { freq: f * 2.4, tau: 0.02, amp: 0.2, glide: 0 });
  decaySine(out, sr, { freq: 240, tau: 0.02, amp: 0.4, glide: 0.01 });
  dcBlock(out, sr); normalizePeak(out, 0.5); fadeEdges(out, sr, 0.3, 10);
  return out;
}

export function meleeSwing(sr, rng) {
  const n = Math.round(0.3 * sr);
  const out = white(n, rng);
  svfSweep(out, 500, 1900, 0.9, sr, 'band', 0.8);
  const e = buf(n);
  for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 2.2); }
  applyEnv(out, e);
  dcBlock(out, sr); normalizePeak(out, 0.42); fadeEdges(out, sr, 8, 20);
  return out;
}

export function meleeHit(sr, rng) {
  const out = buf(Math.round(0.28 * sr));
  decaySine(out, sr, { freq: rng.range(150, 180), freqEnd: 70, tau: 0.045, amp: 0.9, glide: 0.03 });
  mixInto(out, noiseBurst(sr, rng, { dur: 0.06, attack: 0.0002, tau: 0.012, bp: 700, bpQ: 0.6, lp: 2400 }), 0, 0.7);
  mixInto(out, noiseBurst(sr, rng, { dur: 0.02, attack: 0.0001, tau: 0.003, bp: 3000, bpQ: 0.8 }), 0, 0.18);
  dcBlock(out, sr); softClip(out, 1.3); normalizePeak(out, 0.7); fadeEdges(out, sr, 0.3, 15);
  return out;
}

export function radioSquelch(sr, rng) {
  const n = Math.round(0.28 * sr);
  const out = buf(n);
  const b = noiseBurst(sr, rng, { dur: 0.16, attack: 0.002, tau: 0.05, bp: 1700, bpQ: 1.0 });
  mixInto(out, b, 0, 0.9);
  const m = Math.round(0.07 * sr);
  const chirp = buf(m);
  let ph = 0;
  for (let i = 0; i < m; i++) {
    const t = i / m;
    ph += TAU * (1100 + 900 * t) / sr;
    chirp[i] = Math.sin(ph) * Math.sin(Math.PI * t);
  }
  mixInto(out, chirp, Math.round(0.015 * sr), 0.35);
  biquad(out, 'bandpass', 1500, 0.7, sr);
  softClip(out, 2.2);
  dcBlock(out, sr); normalizePeak(out, 0.4); fadeEdges(out, sr, 0.5, 15);
  return out;
}

export function uiClick(sr, rng) {
  const out = buf(Math.round(0.05 * sr));
  decaySine(out, sr, { freq: 1500, tau: 0.006, amp: 0.5, glide: 0 });
  mixInto(out, noiseBurst(sr, rng, { dur: 0.006, attack: 0.00005, tau: 0.001, hp: 3000 }), 0, 0.25);
  dcBlock(out, sr); normalizePeak(out, 0.4); fadeEdges(out, sr, 0.2, 8);
  return out;
}

export function uiHover(sr) {
  const out = buf(Math.round(0.035 * sr));
  decaySine(out, sr, { freq: 2100, tau: 0.004, amp: 0.5, glide: 0 });
  dcBlock(out, sr); normalizePeak(out, 0.15); fadeEdges(out, sr, 0.2, 6);
  return out;
}

export function objectiveTick(sr) {
  const out = buf(Math.round(0.14 * sr));
  decaySine(out, sr, { freq: 520, tau: 0.03, amp: 0.6, glide: 0, attack: 0.002 });
  decaySine(out, sr, { freq: 1040, tau: 0.02, amp: 0.2, glide: 0, attack: 0.002 });
  dcBlock(out, sr); normalizePeak(out, 0.3); fadeEdges(out, sr, 1, 15);
  return out;
}

export function objectiveDone(sr) {
  const out = buf(Math.round(0.9 * sr));
  const note = (f, off, tau, amp) => {
    decaySine(out, sr, { freq: f, tau, amp, glide: 0, offset: Math.round(off * sr), attack: 0.004 });
    decaySine(out, sr, { freq: f * 2, tau: tau * 0.5, amp: amp * 0.25, glide: 0, offset: Math.round(off * sr), attack: 0.004 });
  };
  note(659.25, 0, 0.12, 0.6);
  note(987.77, 0.12, 0.22, 0.65);
  dcBlock(out, sr); normalizePeak(out, 0.5); fadeEdges(out, sr, 1, 40);
  return out;
}

/** Sum of detuned saw-ish partials with a slow envelope, for synth swells. */
function swell(sr, dur, freqs, o = {}) {
  const { peak = 0.5, bendTo = 1, lpFrom = 400, lpTo = 1800, shape = 1.5 } = o;
  const n = Math.round(dur * sr);
  const out = buf(n);
  for (const f0 of freqs) {
    for (const det of [-0.004, 0.004]) {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const f = f0 * (1 + det) * (1 + (bendTo - 1) * t);
        ph += TAU * f / sr;
        // soft saw from 4 harmonics
        out[i] += (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph) + 0.25 * Math.sin(4 * ph)) * 0.18;
      }
    }
  }
  onePoleSweep(out, lpFrom, lpTo, sr, 1);
  const e = buf(n);
  for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.pow(Math.sin(Math.PI * Math.pow(t, shape)), 1.5); }
  applyEnv(out, e);
  dcBlock(out, sr); normalizePeak(out, peak); fadeEdges(out, sr, 5, 30);
  return out;
}

export function stingerStart(sr) {
  const out = swell(sr, 1.5, [55, 82.4, 116.5], { peak: 0.5, lpFrom: 250, lpTo: 1400, shape: 1.3 });
  decaySine(out, sr, { freq: 48, freqEnd: 40, tau: 0.5, amp: 0.25, glide: 0.3, offset: Math.round(1.1 * sr) });
  return normalizePeak(out, 0.5);
}

export function stingerWin(sr) {
  // C major-ish: C3 G3 C4 E4
  const out = swell(sr, 2.5, [130.8, 196, 261.6, 329.6], { peak: 0.5, bendTo: 1.0, lpFrom: 500, lpTo: 3200, shape: 0.9 });
  return out;
}

export function stingerLose(sr) {
  // minor, descending
  const out = swell(sr, 2.5, [110, 130.8, 164.8], { peak: 0.5, bendTo: 0.8, lpFrom: 1400, lpTo: 220, shape: 1.0 });
  decaySine(out, sr, { freq: 55, freqEnd: 38, tau: 0.7, amp: 0.3, glide: 0.5, offset: Math.round(0.3 * sr) });
  return normalizePeak(out, 0.5);
}
