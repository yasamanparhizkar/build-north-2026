// Turns a stream of transcript fragments into complete utterances: a command is
// considered finished after `silenceMs` without new text (or when flushed).
export class UtteranceDetector {
  constructor({ onUtterance, silenceMs = 400, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { onUtterance, silenceMs, setTimer, clearTimer });
    this.buffer = '';
    this.timer = null;
  }

  feed(fragment) {
    this.buffer += fragment;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.flush(), this.silenceMs);
  }

  flush() {
    this.clearTimer(this.timer);
    this.timer = null;
    const text = this.buffer.replace(/\s+/g, ' ').trim();
    this.buffer = '';
    if (text) this.onUtterance(text);
  }

  reset() {
    this.clearTimer(this.timer);
    this.timer = null;
    this.buffer = '';
  }
}

