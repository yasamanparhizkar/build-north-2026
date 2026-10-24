// Offscreen document: captures the Google Meet tab's playback audio, keeps it
// audible, and turns it into overlapping speech clips for the background worker.
// Raw audio is never stored; clips live only in memory until sent.
import { TARGET_SAMPLE_RATE } from '../shared/constants.js';
import { MSG, TARGET_OFFSCREEN } from '../shared/messages.js';
import { encodeWav, toBase64 } from './audio.js';
import { startClipCapture } from './captureGraph.js';

let state = null; // { generation, capture, seq }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== TARGET_OFFSCREEN || sender.id !== chrome.runtime.id) return;
  if (msg.action === MSG.START_CAPTURE) {
    startCapture(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => { stopCapture(); sendResponse({ ok: false, error: e.message }); });
    return true;
  }
  if (msg.action === MSG.STOP_CAPTURE) {
    stopCapture();
    sendResponse({ ok: true });
  }
});

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function startCapture({ streamId, generation }) {
  stopCapture();
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });
  const mine = { generation, capture: null, seq: 0 };
  state = mine;
  mine.capture = await startClipCapture(mediaStream, {
    onClip: (clip) => {
      if (state !== mine) return;
      send({
        action: MSG.AUDIO_CLIP,
        generation,
        seq: mine.seq++,
        audioBase64: toBase64(encodeWav(clip.samples, TARGET_SAMPLE_RATE)),
        mimeType: 'audio/wav',
        durationMs: clip.durationMs,
        speechMs: clip.speechMs,
        reason: clip.reason,
        capturedAt: clip.speechEndedAt
      });
    },
    onEnded: () => {
      send({ action: MSG.CAPTURE_ENDED, generation, detail: 'The Meet tab stopped sharing audio (closed or reloaded).' });
      stopCapture();
    }
  });
}

function stopCapture() {
  if (!state) return;
  const s = state;
  state = null;
  s.capture?.stop();
}
