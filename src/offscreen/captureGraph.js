// Audio graph for tab capture: plays the stream back once (tab capture mutes the
// tab), feeds a muted analysis branch through an AudioWorklet, downsamples to
// 16 kHz and cuts speech into overlapping clips. Split from offscreen.js so the
// whole path can be tested in a browser with a synthetic MediaStream.
import {
  AUDIO_FRAME_SIZE, CLIP_HOP_MS, CLIP_WINDOW_MS, END_OF_SPEECH_MS, MIN_SPEECH_MS, TARGET_SAMPLE_RATE
} from '../shared/constants.js';
import { StreamDownsampler } from './audio.js';
import { ClipSegmenter } from './segmenter.js';

const WORKLET_URL = 'src/offscreen/frame-forwarder.worklet.js';

/**
 * @param {MediaStream} mediaStream
 * @param {{audioCtx?: AudioContext, playback?: boolean, onClip: (clip: object) => void,
 *          onEnded?: () => void, segmenterOptions?: object}} opts
 * @returns {Promise<{audioCtx: AudioContext, segmenter: ClipSegmenter, framesReceived: () => number, stop: () => void}>}
 */
export async function startClipCapture(mediaStream, { audioCtx = new AudioContext(), playback = true, onClip, onEnded, segmenterOptions = {} }) {
  await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  // Tab capture mutes the tab for the user: play it back exactly once.
  if (playback) source.connect(audioCtx.destination);

  // Analysis branch goes through a muted gain node so it can never double the playback.
  await audioCtx.audioWorklet.addModule(chrome.runtime.getURL(WORKLET_URL));
  const processor = new AudioWorkletNode(audioCtx, 'frame-forwarder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { frameSize: AUDIO_FRAME_SIZE }
  });
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const downsampler = new StreamDownsampler(audioCtx.sampleRate, TARGET_SAMPLE_RATE);
  const segmenter = new ClipSegmenter({
    sampleRate: TARGET_SAMPLE_RATE,
    windowMs: CLIP_WINDOW_MS,
    hopMs: CLIP_HOP_MS,
    minSpeechMs: MIN_SPEECH_MS,
    endOfSpeechMs: END_OF_SPEECH_MS,
    onClip,
    ...segmenterOptions
  });

  let frames = 0;
  processor.port.onmessage = (e) => {
    frames++;
    segmenter.push(downsampler.process(e.data), Date.now());
  };

  // Meet tab closed / navigated away / capture revoked.
  for (const track of mediaStream.getAudioTracks()) {
    track.onended = () => onEnded?.();
  }

  let stopped = false;
  return {
    audioCtx,
    segmenter,
    framesReceived: () => frames,
    stop() {
      if (stopped) return;
      stopped = true;
      processor.port.onmessage = null;
      try { processor.disconnect(); } catch { /* ignore */ }
      mediaStream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      audioCtx.close().catch(() => {});
      segmenter.reset();
    }
  };
}

