import { applyFilters } from '../core/imageProcessor.js';
import { MSG, CancelledError } from '../core/protocol.js';

let cancelRequested = false;
let busy = false;

// Cede el turno al event loop del Worker para que pueda llegar un mensaje CANCEL.
const channel = new MessageChannel();
const yieldToEvents = () => new Promise((resolve) => {
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

self.onmessage = async ({ data }) => {
  if (data.type === MSG.CANCEL) { cancelRequested = true; return; }
  if (data.type !== MSG.START || busy) return;

  busy = true;
  cancelRequested = false;
  const t0 = performance.now();
  try {
    self.postMessage({ type: MSG.STARTED });
    const pixels = new Uint8ClampedArray(data.buffer);
    await applyFilters(pixels, data.width, data.height, data.params, {
      onProgress: (percent) => self.postMessage({ type: MSG.PROGRESS, percent }),
      isCancelled: () => cancelRequested,
      yieldToEvents,
    });
    // Transferable Object: el buffer regresa sin copiarse (latencia ~0).
    self.postMessage(
      { type: MSG.DONE, buffer: pixels.buffer, elapsedMs: performance.now() - t0 },
      [pixels.buffer],
    );
  } catch (err) {
    self.postMessage(err instanceof CancelledError
      ? { type: MSG.CANCELLED }
      : { type: MSG.ERROR, message: err.message });
  } finally {
    busy = false;
  }
};
