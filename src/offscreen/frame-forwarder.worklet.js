// AudioWorklet that replaces the deprecated ScriptProcessorNode. Runs on the audio
// thread: collects mono input into fixed-size frames and posts each one to the page.
class FrameForwarder extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.frameSize = processorOptions.frameSize;
    this.pending = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const merged = new Float32Array(this.pending.length + input.length);
    merged.set(this.pending, 0);
    merged.set(input, this.pending.length);

    let offset = 0;
    while (merged.length - offset >= this.frameSize) {
      const frame = merged.slice(offset, offset + this.frameSize);
      this.port.postMessage(frame, [frame.buffer]);
      offset += this.frameSize;
    }
    this.pending = merged.slice(offset);
    return true;
  }
}

registerProcessor('frame-forwarder', FrameForwarder);
