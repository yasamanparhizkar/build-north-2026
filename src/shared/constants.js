// Tunable settings shared across extension contexts.

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Default Gemini Live model used for streaming speech-to-text. Live model names
 * change often; override it in the popup ("Live model") without editing code.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

/** Sample rate the Live API expects (16 kHz mono PCM16). */
export const TARGET_SAMPLE_RATE = 16000;
/** Samples per audio frame (2048 @ 48 kHz is about 43 ms): smaller = lower latency. */
export const AUDIO_FRAME_SIZE = 2048;
/** A spoken command counts as finished after this much transcript silence. */
export const UTTERANCE_SILENCE_MS = 400;

/** Max interactive elements listed in the prompt. */
export const MAX_ELEMENTS = 150;
/** The pointer removes itself after this long. */
export const HIGHLIGHT_TIMEOUT_MS = 20000;
