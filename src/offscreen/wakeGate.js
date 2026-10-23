// Wake-word gate (pure, unit tested).
//
// CLOSED (default): keeps only the last `prerollMs` of audio in memory, overwriting
//   it continuously. Nothing is emitted, so nothing can be sent anywhere.
// open(): called when the on-device detector hears the wake phrase. The gate keeps
//   the pre-roll (it contains the wake phrase, and possibly the start of the command)
//   and records what follows until the speaker pauses.
// It closes and emits ONE clip when, after the wake phrase,
//   - the command was spoken and then `endOfCommandMs` of silence followed, or
//   - `maxCommandMs` passed (long talk), or
//   - no command speech started within `waitForCommandMs` (nothing is emitted).
import { EnergyVad } from './segmenter.js';

export const GATE = Object.freeze({ CLOSED: 'closed', OPEN: 'open' });

export class WakeGate {
  /**
   * @param {{sampleRate?: number, prerollMs: number, graceMs: number, minCommandSpeechMs: number,
   *          endOfCommandMs: number, waitForCommandMs: number, maxCommandMs: number, vad?: EnergyVad,
   *          onClip: (clip: {samples: Float32Array, durationMs: number, speechMs: number, reason: string,
   *                          speechEndedAt: number}) => void,
   *          onClose?: (reason: 'command'|'max-length'|'no-command'|'stopped') => void}} opts
   */
  constructor({
    sampleRate = 16000, prerollMs, graceMs, minCommandSpeechMs, endOfCommandMs, waitForCommandMs, maxCommandMs,
    vad, onClip, onClose = () => {}
  }) {
    Object.assign(this, {
      sampleRate, prerollMs, graceMs, minCommandSpeechMs, endOfCommandMs, waitForCommandMs, maxCommandMs, onClip, onClose
    });
    this.vad = vad || new EnergyVad();
    this.state = GATE.CLOSED;
    this.preroll = []; // {samples, speech, ms}
    this.prerollTotalMs = 0;
    this.resetOpen();
  }

  resetOpen() {
    this.frames = [];
    this.openMs = 0; // time since open()
    this.commandSpeechMs = 0; // loud speech after the grace period
    this.silenceMs = 0; // silence since the last speech after the grace period
  }

  get isOpen() {
    return this.state === GATE.OPEN;
  }

  /** Feed 16 kHz float samples. VAD runs in both states so its noise floor stays current. */
  push(samples, now = Date.now()) {
    if (!samples.length) return;
    const ms = (samples.length / this.sampleRate) * 1000;
    const speech = this.vad.isSpeech(samples, ms);
    const frame = { samples, speech, ms };

    if (this.state === GATE.CLOSED) {
      this.preroll.push(frame);
      this.prerollTotalMs += ms;
      while (this.preroll.length > 1 && this.prerollTotalMs - this.preroll[0].ms >= this.prerollMs) {
        this.prerollTotalMs -= this.preroll.shift().ms;
      }
      return;
    }

    this.frames.push(frame);
    this.openMs += ms;
    // The tail of the wake phrase is still being spoken right after detection: don't count it.
    if (this.openMs > this.graceMs) {
      if (speech && this.vad.lastLoud) {
        this.commandSpeechMs += ms;
        this.silenceMs = 0;
      } else if (!speech && this.commandSpeechMs > 0) {
        this.silenceMs += ms;
      }
    }

    const heardCommand = this.commandSpeechMs >= this.minCommandSpeechMs;
    if (heardCommand && this.silenceMs >= this.endOfCommandMs) this.close('command', now);
    else if (this.openMs >= this.maxCommandMs) this.close(heardCommand ? 'max-length' : 'no-command', now);
    else if (!heardCommand && this.commandSpeechMs === 0 && this.openMs >= this.waitForCommandMs) this.close('no-command', now);
  }

  /** The detector heard the wake phrase. */
  open() {
    if (this.state === GATE.OPEN) return;
    this.state = GATE.OPEN;
    this.resetOpen();
    this.frames = this.preroll; // the wake phrase itself, and whatever came right after it
    this.preroll = [];
    this.prerollTotalMs = 0;
  }

  close(reason, now = Date.now()) {
    if (this.state !== GATE.OPEN) return;
    const frames = this.frames;
    const silenceMs = this.silenceMs;
    this.state = GATE.CLOSED;
    this.resetOpen();

    if (reason === 'command' || reason === 'max-length') {
      // Trim trailing silence (keep ~300 ms) to save upload time and tokens.
      let end = frames.length - 1;
      for (let trimmed = silenceMs; end > 0 && trimmed > 300 && !frames[end].speech; end--) trimmed -= frames[end].ms;
      const chosen = frames.slice(0, end + 1);
      const total = chosen.reduce((n, f) => n + f.samples.length, 0);
      const samples = new Float32Array(total);
      let offset = 0;
      for (const f of chosen) { samples.set(f.samples, offset); offset += f.samples.length; }
      this.onClip({
        samples,
        durationMs: Math.round((total / this.sampleRate) * 1000),
        speechMs: Math.round(chosen.filter((f) => f.speech).reduce((n, f) => n + f.ms, 0)),
        reason: `wake-${reason}`,
        speechEndedAt: Math.round(now - silenceMs)
      });
    }
    this.onClose(reason);
  }

  /** Drop everything (Stop Listening). */
  reset() {
    this.state = GATE.CLOSED;
    this.preroll = [];
    this.prerollTotalMs = 0;
    this.resetOpen();
  }
}
