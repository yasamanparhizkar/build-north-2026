// Gemini Live API wire protocol helpers (pure, unit tested).
const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export function liveUrl(apiKey) {
  return `${LIVE_URL}?key=${encodeURIComponent(apiKey)}`;
}

/** First message on a new socket. We only want input transcription, never a spoken reply. */
export function buildSetupMessage(model) {
  return {
    setup: {
      model: model.startsWith('models/') ? model : `models/${model}`,
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: {
        parts: [{ text: 'You are a silent transcriber. Never speak or answer. Do not produce any response.' }]
      },
      inputAudioTranscription: {}
    }
  };
}

/** One chunk of 16 kHz mono 16-bit little-endian PCM. */
export function buildAudioMessage(base64Pcm) {
  return { realtimeInput: { audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } } };
}

/**
 * @returns {{setupComplete: boolean, inputText: string, turnComplete: boolean, goAway: boolean}}
 */
export function parseServerMessage(raw) {
  const out = { setupComplete: false, inputText: '', turnComplete: false, goAway: false };
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return out;
  }
  if (msg.setupComplete !== undefined) out.setupComplete = true;
  if (msg.goAway !== undefined) out.goAway = true;
  const sc = msg.serverContent;
  if (sc) {
    out.inputText = sc.inputTranscription?.text || '';
    out.turnComplete = Boolean(sc.turnComplete);
  }
  return out;
}

