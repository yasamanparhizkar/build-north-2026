// Tunable settings shared across extension contexts.

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Length of each audio clip sent to Gemini. */
export const CLIP_SECONDS = 6;
/** Sample rate of clips sent to Gemini (16 kHz mono keeps uploads small). */
export const TARGET_SAMPLE_RATE = 16000;
/** Clips quieter than this RMS level are treated as silence and skipped. */
export const SILENCE_RMS = 0.005;

/** Max interactive elements listed in the prompt. */
export const MAX_ELEMENTS = 150;
/** The pointer removes itself after this long. */
export const HIGHLIGHT_TIMEOUT_MS = 20000;
