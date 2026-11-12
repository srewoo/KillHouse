/**
 * Radio: captioned lines from Control and overheard enemy chatter.
 *
 * The voice is the audio system's procedural radio voice (src/audio/voice.js):
 * a formant babble that follows each caption's rhythm and urgency, with the
 * words carried by the caption. Control comes through a handheld radio; enemy
 * shouts are played at the shouter's position, so a callout also gives him away.
 * No speech engine, no network — it is synthesised like every other sound here.
 *
 * Captions follow Config.accessibility.subtitles, the voice follows
 * Config.accessibility.voice.
 *
 * OWNER: game (src/game/**).
 */

export const CALLOUT_LINES = {
  contact: ['Contact front!', 'Eyes on, eyes on!', 'There he is!'],
  reloading: ['Reloading!', 'Changing mags!', 'Cover me, I\'m dry!'],
  flanking: ['Moving to flank!', 'Going around!', 'Flanking left!'],
  grenade: ['Grenade!', 'Frag out — move!', 'Get clear!'],
  mandown: ['Man down!', 'We lost one!', 'He\'s down, he\'s down!'],
  covering: ['Taking cover!', 'Moving to cover!', 'Falling back!'],
};

export class Radio {
  constructor(ctx, ui) {
    this.ctx = ctx;
    this.ui = ui;
    this._queue = [];
    this._busyUntil = 0;
    this._warm = [];
  }

  get _a11y() { return this.ctx.config.accessibility ?? {}; }
  get _voiceOn() { return this._a11y.voice !== false; }

  /** Control speaking. Queued so two beats never talk over each other. */
  say(text, seconds = 4.2) {
    this._queue.push({ who: 'Control', text, seconds });
  }

  /** An enemy shouting. Never queued: stale chatter is worse than none. */
  callout(name, kind, position = null) {
    const lines = CALLOUT_LINES[kind];
    if (!lines) return;
    const text = lines[(Math.random() * lines.length) | 0];
    let seconds = 2.2;
    if (this._voiceOn) {
      const d = this.ctx.audio?.speak?.(text, { profile: 'enemy', speaker: name, position, volume: 0.9 }) ?? 0;
      if (d) seconds = Math.max(seconds, d + 1);
    }
    if (this._a11y.subtitles !== false) this.ui.caption(name, text, seconds, true);
  }

  /** Build voice buffers ahead of time, one per tick, so playback never hitches. */
  warm(lines) { this._warm.push(...lines); }

  clear() {
    this._queue.length = 0;
    this._busyUntil = 0;
    this.ui.clearCaptions();
  }

  update() {
    if (this._warm.length && this._voiceOn) {
      const w = this._warm.shift();
      try { this.ctx.audio?.prepareVoice?.(w.text, w); } catch { /* warming is optional */ }
    }
    if (!this._queue.length) return;
    const now = performance.now();
    if (now < this._busyUntil) return;
    const line = this._queue.shift();
    let seconds = line.seconds;
    if (this._voiceOn) {
      // The voice carries its own key-up squelch and tail.
      const d = this.ctx.audio?.speak?.(line.text, { profile: 'control', speaker: 'Control' }) ?? 0;
      if (d) seconds = Math.max(seconds, d + 0.6);
    } else {
      try { this.ctx.audio?.play?.('radio_squelch', { volume: 0.7 }); } catch { /* optional */ }
    }
    this._busyUntil = now + seconds * 1000 * 0.9;
    if (this._a11y.subtitles !== false) this.ui.caption(line.who, line.text, seconds, false);
  }
}
