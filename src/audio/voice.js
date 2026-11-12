/**
 * Procedural radio voice. Not text-to-speech: a formant "babble" voice that
 * follows the rhythm, stress and punctuation of the caption it accompanies —
 * the convention games use when the words are carried by subtitles and the
 * voice only has to carry tone, urgency and who is talking.
 *
 * Built offline into a Float32Array per line, then cached. Two profiles:
 *   control  low, measured, through a band-limited handheld radio: squelch
 *            key-up, compression, static bed, squelch tail.
 *   enemy    higher, faster, shouted, open-air and gritty. Played spatially at
 *            the shouter, so a callout also tells you where he is.
 *
 * OWNER: audio.
 */
import { Rng, buf, white, biquad, applyEnv, envAD, mixInto, softClip, normalizePeak, fadeEdges, dcBlock, noiseBurst } from './dsp.js';

/** First three formants (Hz) of an adult male voice, per vowel. */
const VOWELS = {
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2200, 2960],
  o: [570, 840, 2410], u: [320, 900, 2240], y: [300, 2100, 2900],
};
const FRICATIVES = new Set(['s', 'z', 'f', 'v', 'h', 'x', 'c', 'j']);
const STOPS = new Set(['p', 'b', 't', 'd', 'k', 'g', 'q']);
const SONORANTS = { m: [280, 1100, 2300], n: [280, 1500, 2500], l: [360, 1300, 2700], r: [420, 1300, 1700], w: [300, 700, 2200] };

const PROFILES = {
  control: { f0: 104, rate: 1.0, breath: 0.05, drive: 2.4, hp: 420, lp: 2900, radio: true, gain: 0.82 },
  enemy:   { f0: 150, rate: 1.18, breath: 0.12, drive: 3.4, hp: 220, lp: 4200, radio: false, gain: 0.9 },
};

/** Text → timed segments: {kind, dur, formants, stress, gap}. */
function segment(text, rate, rng) {
  const out = [];
  const t = String(text).toLowerCase();
  let syll = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (VOWELS[ch]) {
      // Diphthongs read as one longer, gliding nucleus.
      const next = VOWELS[t[i + 1]] ? t[i + 1] : null;
      const dur = (next ? 0.15 : 0.1) * rng.range(0.85, 1.2) / rate;
      out.push({ kind: 'v', dur, f: VOWELS[ch], f2: next ? VOWELS[next] : null, stress: syll % 3 === 0 ? 1 : 0 });
      if (next) i++;
      syll++;
    } else if (/[0-9]/.test(ch)) {
      out.push({ kind: 'v', dur: 0.12 / rate, f: VOWELS.e, stress: 1 });
      syll++;
    } else if (SONORANTS[ch]) {
      out.push({ kind: 'n', dur: 0.05 / rate, f: SONORANTS[ch] });
    } else if (FRICATIVES.has(ch)) {
      out.push({ kind: 'f', dur: (ch === 's' || ch === 'x' ? 0.075 : 0.05) / rate, hi: ch === 's' || ch === 'z' || ch === 'c' ? 5200 : ch === 'h' ? 1500 : 3200 });
    } else if (STOPS.has(ch)) {
      out.push({ kind: 's', dur: 0.045 / rate, hi: 'tdk'.includes(ch) ? 3500 : 1600 });
    } else if (ch === ' ') {
      out.push({ kind: 'gap', dur: 0.035 / rate });
    } else if (ch === ',' || ch === '—' || ch === '-' || ch === ';' || ch === ':') {
      out.push({ kind: 'gap', dur: 0.16 / rate });
    } else if (ch === '.' || ch === '!' || ch === '?') {
      out.push({ kind: 'gap', dur: 0.24 / rate, end: ch });
    }
  }
  return out;
}

/** Glottal source: a band-limited-ish pulse with jitter and shimmer. */
function voicedSource(n, sr, f0a, f0b, rng, breath) {
  const out = buf(n);
  let ph = rng.next();
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const f0 = (f0a + (f0b - f0a) * k) * (1 + rng.gauss() * 0.004);
    ph += f0 / sr;
    if (ph >= 1) ph -= 1;
    // Rosenberg-style pulse: slow open, fast close — brighter than a sine, softer than a saw.
    const g = ph < 0.6 ? 0.5 * (1 - Math.cos(Math.PI * ph / 0.6)) : Math.cos(Math.PI * (ph - 0.6) / 0.8);
    out[i] = g + (rng.next() * 2 - 1) * breath;
  }
  dcBlock(out, sr);
  return out;
}

function formantFilter(src, sr, f, shift, amps = [1, 0.55, 0.28]) {
  const out = buf(src.length);
  for (let j = 0; j < 3; j++) {
    const b = src.slice();
    biquad(b, 'bandpass', f[j] * shift, 6 + j * 2, sr);
    mixInto(out, b, 0, amps[j] * 3.2);
  }
  return out;
}

/** Radio static: hiss band plus sparse crackle. */
function staticBed(n, sr, rng, level) {
  const s = white(n, rng);
  biquad(s, 'bandpass', 2400, 0.7, sr);
  for (let i = 0; i < n; i++) s[i] *= level;
  for (let c = 0; c < n / sr * 18; c++) {
    const at = (rng.next() * n) | 0;
    mixInto(s, noiseBurst(sr, rng, { dur: 0.004, tau: 0.0008, hp: 1800 }), at, level * 6 * rng.next());
  }
  return s;
}

/**
 * @param {number} sr
 * @param {string} text  the caption — drives rhythm and intonation only
 * @param {'control'|'enemy'} profileName
 * @param {number} seed  per-speaker identity (pitch + formant shift)
 * @returns {Float32Array}
 */
export function synthVoice(sr, text, profileName = 'control', seed = 1) {
  const P = PROFILES[profileName] ?? PROFILES.control;
  const rng = new Rng((seed * 2654435761) >>> 0 || 1);
  const pitchShift = 1 + ((seed % 7) - 3) * 0.045;
  const formantShift = 1 + ((seed % 5) - 2) * 0.03;
  const segs = segment(text, P.rate, rng);
  const exclaim = /!/.test(text);
  const question = /\?\s*$/.test(text);

  const lead = P.radio ? 0.14 : 0.02;
  const tail = P.radio ? 0.22 : 0.08;
  let total = lead + tail;
  for (const s of segs) total += s.dur;
  const n = Math.round(total * sr);
  const out = buf(n);

  // Phrase intonation: declination, punctuation resets, end rise for questions.
  let t = lead;
  const base = P.f0 * pitchShift * (exclaim ? 1.14 : 1);
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const at = Math.round(t * sr);
    const len = Math.max(8, Math.round(s.dur * sr));
    const prog = t / total;
    let f0 = base * (1.08 - prog * 0.22) * (s.stress ? 1.1 : 1) * rng.range(0.96, 1.04);
    if (question && prog > 0.78) f0 *= 1 + (prog - 0.78) * 1.6;
    if (s.kind === 'v' || s.kind === 'n') {
      const src = voicedSource(len, sr, f0, f0 * rng.range(0.94, 1.0), rng, P.breath);
      let v = formantFilter(src, sr, s.f, formantShift);
      if (s.f2) {
        // Glide: crossfade into the second vowel over the back half.
        const w = formantFilter(src, sr, s.f2, formantShift);
        for (let i = 0; i < len; i++) { const k = Math.min(1, Math.max(0, (i / len - 0.35) / 0.5)); v[i] = v[i] * (1 - k) + w[i] * k; }
      }
      const amp = (s.kind === 'n' ? 0.45 : 1) * (s.stress ? 1.15 : 1);
      applyEnv(v, envAD(len, sr, 0.012, s.dur * 0.9, amp));
      mixInto(out, v, at, 1);
    } else if (s.kind === 'f') {
      mixInto(out, noiseBurst(sr, rng, { dur: s.dur, attack: 0.008, tau: s.dur * 0.6, bp: s.hi, bpQ: 1.4 }), at, 0.22);
    } else if (s.kind === 's') {
      mixInto(out, noiseBurst(sr, rng, { dur: 0.02, attack: 0.0004, tau: 0.006, bp: s.hi, bpQ: 1.0 }), at + Math.round(s.dur * 0.55 * sr), 0.4);
    }
    t += s.dur;
  }

  // Voice channel.
  biquad(out, 'highpass', P.hp, 0.8, sr, 0, 2);
  biquad(out, 'lowpass', P.lp, 0.8, sr, 0, 2);
  if (P.radio) biquad(out, 'peaking', 1700, 1.2, sr, 5);   // handheld-speaker honk
  normalizePeak(out, 0.9);
  softClip(out, P.drive);

  if (P.radio) {
    mixInto(out, staticBed(n, sr, rng, 0.035), 0, 1);
    // Key-up click and the squelch tail when the transmitter drops.
    mixInto(out, noiseBurst(sr, rng, { dur: 0.012, tau: 0.003, bp: 1800, bpQ: 0.9 }), Math.round(0.02 * sr), 0.6);
    const sq = noiseBurst(sr, rng, { dur: 0.16, attack: 0.002, tau: 0.06, bp: 2600, bpQ: 0.6 });
    mixInto(out, sq, Math.max(0, n - Math.round(0.19 * sr)), 0.5);
  }
  normalizePeak(out, P.gain);
  fadeEdges(out, sr, 2, 20);
  return out;
}

/** Stable per-speaker seed from a callsign. */
export function voiceSeed(name) {
  let h = 2166136261;
  const s = String(name ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 997 + 1;
}
