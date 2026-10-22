// Rolling latency/usage metrics (pure). Stored in chrome.storage.session.

export const EMPTY_METRICS = Object.freeze({
  startedAt: 0,
  clipsReceived: 0,
  clipsSkipped: 0,
  apiCalls: 0,
  apiErrors: 0,
  audioSecondsSent: 0,
  highlights: 0,
  samples: [] // last N {gemini, match, total}
});

const MAX_SAMPLES = 30;

export function recordSample(metrics, sample) {
  return { ...metrics, samples: [...metrics.samples, sample].slice(-MAX_SAMPLES) };
}

export function bump(metrics, field, by = 1) {
  return { ...metrics, [field]: (metrics[field] || 0) + by };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarize(metrics, now) {
  const pick = (k) => metrics.samples.map((s) => s[k]).filter((v) => typeof v === 'number');
  const minutes = metrics.startedAt ? Math.max((now - metrics.startedAt) / 60000, 1 / 60) : 0;
  return {
    medianGeminiMs: median(pick('gemini')),
    medianMatchMs: median(pick('match')),
    medianTotalMs: median(pick('total')),
    apiCallsPerMinute: minutes ? +(metrics.apiCalls / minutes).toFixed(1) : 0,
    apiErrorRate: metrics.apiCalls ? +(metrics.apiErrors / metrics.apiCalls).toFixed(2) : 0,
    audioSecondsSent: +metrics.audioSecondsSent.toFixed(1),
    clipsReceived: metrics.clipsReceived,
    clipsSkipped: metrics.clipsSkipped,
    highlights: metrics.highlights
  };
}

