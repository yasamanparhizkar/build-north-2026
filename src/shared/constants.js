// Tunable settings shared across extension contexts.

// ---- Gemini (request/response) ----
/**
 * Default model. `gemini-flash-latest` is Google's alias for the current Flash
 * model, so the extension keeps working when versioned models (e.g. 2.5) retire.
 * Override in the popup. If the model is not found, gemini.js auto-selects an
 * available Flash model via ListModels.
 */
export const DEFAULT_MODEL = 'gemini-flash-latest';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_TIMEOUT_MS = 15000;

// ---- Gemini Live (experimental streaming mode) ----
export const DEFAULT_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
export const VOICE_MODES = Object.freeze({ CLIPS: 'clips', LIVE: 'live' });

// ---- Audio ----
/** Sample rate sent to Gemini (16 kHz mono). */
export const TARGET_SAMPLE_RATE = 16000;
/** Samples per ScriptProcessor frame (2048 @ 48 kHz is about 43 ms). */
export const AUDIO_FRAME_SIZE = 2048;
/** Rolling window length: each clip holds up to this much recent audio. */
export const CLIP_WINDOW_MS = 6000;
/** During continuous speech a clip is emitted this often (2 s overlap). */
export const CLIP_HOP_MS = 4000;
/** A clip is only sent if it contains at least this much *new* speech. */
export const MIN_SPEECH_MS = 250;
/** After this much silence following speech, the utterance is sent at once. */
export const END_OF_SPEECH_MS = 700;
/** Clips older than this when processing starts are discarded as stale. */
export const MAX_CLIP_AGE_MS = 15000;
/** The same command (same target) within this window is ignored (overlap dedupe). */
export const DEDUPE_WINDOW_MS = 10000;
/** Live mode: transcript silence that ends an utterance. */
export const UTTERANCE_SILENCE_MS = 400;

// ---- Page elements ----
export const MAX_ELEMENTS = 180;
export const MAX_OFFSCREEN_ELEMENTS = 30;
export const MAX_SAME_NAME = 4;
export const MAX_NAME_LENGTH = 60;
export const MAX_SNAPSHOTS = 4;

// ---- Pointer ----
export const HIGHLIGHT_TIMEOUT_MS = 20000;
export const MAX_CANDIDATE_HIGHLIGHTS = 3;
