// Streaming speech-to-text over the Gemini Live WebSocket, with auto-reconnect.
// The WebSocket class is injectable so this can be unit tested with a fake.
import { buildAudioMessage, buildSetupMessage, liveUrl, parseServerMessage } from './protocol.js';

const MAX_ATTEMPTS = 6;
const FATAL_CLOSE_CODES = new Set([1007, 1008]); // bad request / policy (e.g. invalid key)

export class LiveTranscriber {
  /**
   * @param {{apiKey: string, model: string,
   *   onText: (fragment: string) => void,
   *   onTurnComplete?: () => void,
   *   onStatus?: (state: 'connecting'|'connected'|'reconnecting'|'error'|'stopped', detail?: string) => void,
   *   WebSocketImpl?: typeof WebSocket}} opts
   */
  constructor({ apiKey, model, onText, onTurnComplete = () => {}, onStatus = () => {}, WebSocketImpl = WebSocket }) {
    Object.assign(this, { apiKey, model, onText, onTurnComplete, onStatus, WS: WebSocketImpl });
    this.ws = null;
    this.ready = false;
    this.wanted = false;
    this.attempts = 0;
    this.retryTimer = null;
  }

  start() {
    this.wanted = true;
    this._open();
  }

  stop() {
    this.wanted = false;
    this.ready = false;
    clearTimeout(this.retryTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.onStatus('stopped');
  }

  /** Real-time: audio produced while disconnected is dropped, never queued. */
  sendAudio(base64Pcm) {
    if (this.ready && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(buildAudioMessage(base64Pcm)));
    }
  }

  _open() {
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    const ws = new this.WS(liveUrl(this.apiKey));
    this.ws = ws;
    this.ready = false;

    ws.onopen = () => ws.send(JSON.stringify(buildSetupMessage(this.model)));

    ws.onmessage = async (event) => {
      const raw = typeof event.data === 'string' ? event.data : await event.data.text();
      const msg = parseServerMessage(raw);
      if (msg.setupComplete) {
        this.ready = true;
        this.attempts = 0;
        this.onStatus('connected');
      }
      if (msg.inputText) this.onText(msg.inputText);
      if (msg.turnComplete) this.onTurnComplete();
      if (msg.goAway) ws.close(); // server asked us to reconnect (session limit)
    };

    ws.onerror = () => {};

    ws.onclose = (event) => {
      this.ready = false;
      if (!this.wanted) return;
      if (FATAL_CLOSE_CODES.has(event.code) || this.attempts >= MAX_ATTEMPTS) {
        this.wanted = false;
        this.onStatus('error', event.reason || `Connection closed (${event.code})`);
        return;
      }
      const delay = Math.min(1000 * 2 ** this.attempts, 8000);
      this.attempts++;
      this.onStatus('reconnecting');
      this.retryTimer = setTimeout(() => this._open(), delay);
    };
  }
}

