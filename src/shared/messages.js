// Message names exchanged between popup, background, offscreen and content scripts.

export const MSG = Object.freeze({
  // popup -> background
  START_LISTENING: 'START_LISTENING',
  STOP_LISTENING: 'STOP_LISTENING', // also allowed from the on-page Stop button
  GET_STATE: 'GET_STATE',
  MANUAL_COMMAND: 'MANUAL_COMMAND',
  // offscreen -> background
  AUDIO_CLIP: 'AUDIO_CLIP',
  UTTERANCE: 'UTTERANCE',
  LIVE_STATUS: 'LIVE_STATUS',
  CAPTURE_STARTED: 'CAPTURE_STARTED',
  CAPTURE_ENDED: 'CAPTURE_ENDED',
  CAPTURE_ERROR: 'CAPTURE_ERROR',
  // background -> offscreen
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  // background/popup -> content
  GET_ELEMENTS: 'GET_ELEMENTS',
  HIGHLIGHT: 'HIGHLIGHT',
  STATUS: 'STATUS',
  INDICATOR: 'INDICATOR',
  CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT'
});

/** Messages with this `target` are only handled by the offscreen document. */
export const TARGET_OFFSCREEN = 'offscreen';

/** Messages a content script (i.e. a web page context) is allowed to send. */
export const CONTENT_ALLOWED = new Set([MSG.STOP_LISTENING]);

/** Messages only the offscreen document may send. */
export const OFFSCREEN_ONLY = new Set([
  MSG.AUDIO_CLIP, MSG.UTTERANCE, MSG.LIVE_STATUS, MSG.CAPTURE_STARTED, MSG.CAPTURE_ENDED, MSG.CAPTURE_ERROR
]);
