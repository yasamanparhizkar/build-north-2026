// Runs jobs one at a time and keeps only the newest waiting job, so audio
// clips never pile up when Gemini is slow.
export class LatestJobQueue {
  constructor(onError = console.warn) {
    this.busy = false;
    this.pending = null;
    this.onError = onError;
  }

  async push(job) {
    if (this.busy) {
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
}

