// Voice activity detection + overlapping clip segmentation (pure, unit tested).
//
// Clips are emitted
//   a) right after an utterance ends (>= END_OF_SPEECH_MS of silence)  -> low latency
//   b) every CLIP_HOP_MS during long continuous speech                  -> bounded delay
// Each clip contains up to CLIP_WINDOW_MS of recent audio, so consecutive clips
// overlap (default 6 s window / 4 s hop = 2 s overlap) and a sentence crossing a
// boundary is still heard whole. Duplicate commands are removed in the background.
import { rms } from './audio.js';

/** Energy VAD with an adaptive noise floor and a short hangover. */
export class EnergyVad {
  constructor({ absMin = 0.004, ratio = 3, hangoverMs = 250, adapt = 0.05 } = {}) {
    Object.assign(this, { absMin, ratio, hangoverMs, adapt });
    this.noiseFloor = 0.002;
    this.hang = 0;
    this.lastLoud = false;
  }

  /** @returns {boolean} whether this frame counts as speech (including hangover) */
  isSpeech(samples, frameMs) {
    const level = rms(samples);
    const threshold = Math.max(this.absMin, this.noiseFloor * this.ratio);
    const loud = level > threshold;
    this.lastLoud = loud;
    // Track background noise in quiet frames; drift very slowly during "speech" so
    // a permanent noise increase cannot lock the detector on (escapes in ~1-2 min)
    // while long continuous speech is not mistaken for noise.
    const a = loud ? this.adapt / 250 : this.adapt;
    this.noiseFloor = Math.max(0.0005, this.noiseFloor * (1 - a) + level * a);
    if (loud) {
      this.hang = this.hangoverMs;
      return true;
    }
    if (this.hang > 0) {
      this.hang -= frameMs;
      return true;
    }
    return false;
  }
}

export class ClipSegmenter {
  /**
   * @param {{sampleRate?: number, windowMs: number, hopMs: number, minSpeechMs: number,
   *          endOfSpeechMs: number, paddingMs?: number, vad?: EnergyVad,
   *          onClip: (clip: {samples: Float32Array, durationMs: number, speechMs: number,
   *                          reason: string, speechEndedAt: number}) => void}} opts
   */
  constructor({ sampleRate = 16000, windowMs, hopMs, minSpeechMs, endOfSpeechMs, paddingMs = 300, vad, onClip }) {
    Object.assign(this, { sampleRate, windowMs, hopMs, minSpeechMs, endOfSpeechMs, paddingMs, onClip });
    this.vad = vad || new EnergyVad();
    this.reset();
  }

  reset() {
    this.frames = []; // {samples, speech, ms}
    this.bufferedMs = 0;
    this.newSpeechMs = 0; // speech since the last emitted clip
    this.spanMs = 0; // time since new speech started (for hop emission)
    this.silenceMs = 0; // silence since the last speech frame (after the VAD hangover)
    this.quietMs = 0; // time since the last genuinely loud frame (what end-of-speech is measured from)
  }

  push(samples, now = Date.now()) {
    if (!samples.length) return;
    const ms = (samples.length / this.sampleRate) * 1000;
    const speech = this.vad.isSpeech(samples, ms);

    this.frames.push({ samples, speech, ms });
    this.bufferedMs += ms;
    while (this.frames.length > 1 && this.bufferedMs - this.frames[0].ms >= this.windowMs) {
      this.bufferedMs -= this.frames.shift().ms;
    }

    if (speech) {
      // Only genuinely loud frames count toward the minimum (hangover doesn't).
      if (this.vad.lastLoud !== false) this.newSpeechMs += ms;
      this.silenceMs = 0;
    } else if (this.newSpeechMs > 0) {
      this.silenceMs += ms;
    }
    // End of speech is measured from the last loud frame; the VAD hangover must not add to the wait.
    if (this.vad.lastLoud) this.quietMs = 0;
    else this.quietMs += ms;
    if (this.newSpeechMs > 0) this.spanMs += ms;

    const enoughSpeech = this.newSpeechMs >= this.minSpeechMs;
    if (enoughSpeech && this.quietMs >= this.endOfSpeechMs) {
      this.emit('end-of-speech', now);
    } else if (enoughSpeech && this.spanMs >= this.hopMs) {
      this.emit('hop', now);
    } else if (!enoughSpeech && this.silenceMs >= this.endOfSpeechMs) {
      // A click or cough: forget it.
      this.newSpeechMs = 0;
      this.spanMs = 0;
      this.silenceMs = 0;
    }
  }

  emit(reason, now) {
    const frames = this.frames;
    const firstSpeech = frames.findIndex((f) => f.speech);
    let lastSpeech = -1;
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].speech) { lastSpeech = i; break; }

    // Keep a little padding around speech; drop long leading/trailing silence (saves tokens).
    let start = Math.max(0, firstSpeech);
    for (let pad = 0; start > 0 && pad < this.paddingMs; ) pad += frames[--start].ms;
    let end = lastSpeech < 0 ? frames.length - 1 : lastSpeech;
    for (let pad = 0; end < frames.length - 1 && pad < this.paddingMs; ) pad += frames[++end].ms;

    const chosen = frames.slice(start, end + 1);
    const total = chosen.reduce((n, f) => n + f.samples.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const f of chosen) { samples.set(f.samples, offset); offset += f.samples.length; }

    const clip = {
      samples,
      durationMs: Math.round((total / this.sampleRate) * 1000),
      speechMs: Math.round(chosen.filter((f) => f.speech).reduce((n, f) => n + f.ms, 0)),
      reason,
      speechEndedAt: Math.round(now - this.quietMs)
    };
    this.newSpeechMs = 0;
    this.spanMs = 0;
    this.silenceMs = 0;
    this.quietMs = 0;
    if (reason === 'end-of-speech') {
      // The command is finished: forget its audio so the NEXT clip holds only the next command.
      // (After a 'hop' the audio is kept on purpose: the sentence continues and needs the overlap.)
      this.frames = [];
      this.bufferedMs = 0;
    }
    this.onClip(clip);
  }
}
