// Runs jobs one at a time and keeps only the newest waiting job, so audio
// clips never pile up when Gemini is slow. Jobs run in arrival order.
export class LatestJobQueue {
  constructor(onError = console.warn) {
    this.busy = false;
    this.pending = null;
    this.dropped = 0;
    this.onError = onError;
  }

  async push(job) {
    if (this.busy) {
      if (this.pending) this.dropped++;
      this.pending = job;
      return;
    }
    this.busy = true;
    try {
      await job();
    } catch (e) {
      this.onError(e);
    }
    this.busy = false;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      await this.push(next);
    }
  }

  /** Drop waiting work (e.g. on Stop Listening). A running job finishes but its result is checked for staleness. */
  clear() {
    this.pending = null;
  }
}
