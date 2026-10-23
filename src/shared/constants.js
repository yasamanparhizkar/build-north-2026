// Tunable settings shared across extension contexts.

// ---- Gemini (request/response) ----
/**
 * Default model. Measured with scripts/gemini-check.mjs (Oct 2026): flash-lite answered
 * audio in ~3 s, while the `gemini-flash-latest` alias sometimes never answered at all.
 * Override in the popup. If a model is not found, gemini.js auto-selects an available
 * Flash model via ListModels. Check https://ai.google.dev/gemini-api/docs/models when
 * these retire, and re-run scripts/gemini-check.mjs.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/**
 * Tried in order when the chosen model is overloaded (5xx), does not answer within
 * GEMINI_ATTEMPT_TIMEOUT_MS, or does not exist. The chosen model itself is skipped.
 */
export const BUSY_FALLBACK_MODELS = Object.freeze(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Longest wait for ONE model before switching to the next fallback. */
export const GEMINI_ATTEMPT_TIMEOUT_MS = 8000;
/** Longest wait for an answer in total, across all models. */
export const GEMINI_TIMEOUT_MS = 20000;

// ---- Listening modes ----
/**
 * WAKE (default): nothing leaves the computer until the wake phrase is heard on-device.
 * ALWAYS: every utterance on the call is sent to Gemini.
 */
export const VOICE_MODES = Object.freeze({ WAKE: 'wake', ALWAYS: 'clips' });
export const DEFAULT_VOICE_MODE = VOICE_MODES.WAKE;

// ---- Wake word (on-device, openWakeWord models in models/wakeword/) ----
/** What people should say. Must match WAKE_MODEL_FILE. */
export const WAKE_PHRASE = 'Hey Jarvis';
export const WAKE_MODEL_DIR = 'models/wakeword/';
export const WAKE_MODEL_FILE = 'hey_jarvis_v0.1.onnx';
export const WAKE_MEL_FILE = 'melspectrogram.onnx';
export const WAKE_EMBEDDING_FILE = 'embedding_model.onnx';
/** Score (0..1) at which the wake phrase counts as heard. Higher = fewer false alarms, more misses. */
export const WAKE_THRESHOLD = 0.5;
/** Audio kept in memory before the wake phrase is detected (holds the phrase itself). */
export const WAKE_PREROLL_MS = 2000;
/** Speech right after detection is the end of the wake phrase, not the command. */
export const WAKE_GRACE_MS = 300;
/** Command speech needed after the wake phrase before a pause can end it. */
export const WAKE_MIN_COMMAND_SPEECH_MS = 300;
/** Pause that ends the command. */
export const WAKE_END_OF_COMMAND_MS = 900;
/** Give up if no command starts this long after the wake phrase. */
export const WAKE_WAIT_FOR_COMMAND_MS = 5000;
/** Hard limit on how much audio is sent after one wake phrase. */
export const WAKE_MAX_COMMAND_MS = 8000;
/** Play a short tone when the wake phrase is heard. */
export const WAKE_CHIME = true;

// ---- Audio ----
/** Sample rate sent to Gemini (16 kHz mono). */
export const TARGET_SAMPLE_RATE = 16000;
/** Samples per audio frame sent from the AudioWorklet (2048 @ 48 kHz is about 43 ms). */
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

// ---- Page elements ----
export const MAX_ELEMENTS = 180;
export const MAX_OFFSCREEN_ELEMENTS = 30;
export const MAX_SAME_NAME = 4;
export const MAX_NAME_LENGTH = 60;
export const MAX_SNAPSHOTS = 4;

// ---- Pointer ----
export const HIGHLIGHT_TIMEOUT_MS = 20000;
export const MAX_CANDIDATE_HIGHLIGHTS = 3;
