// Message names exchanged between popup, background, offscreen and content scripts.

export const MSG = Object.freeze({
  // popup -> background
  START_LISTENING: 'START_LISTENING',
  STOP_LISTENING: 'STOP_LISTENING',
  GET_STATE: 'GET_STATE',
  MANUAL_COMMAND: 'MANUAL_COMMAND',
  // offscreen -> background
  AUDIO_CLIP: 'AUDIO_CLIP',
  // background -> offscreen
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  // background/popup -> content
  GET_ELEMENTS: 'GET_ELEMENTS',
  HIGHLIGHT: 'HIGHLIGHT',
  STATUS: 'STATUS',
  CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT'
});

/** Messages with this `target` are only handled by the offscreen document. */
export const TARGET_OFFSCREEN = 'offscreen';

