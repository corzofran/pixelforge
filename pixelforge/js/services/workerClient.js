import { MSG, CancelledError } from '../core/protocol.js';

const CANCEL_TIMEOUT_MS = 1500;

/**
 * Lanza un Dedicated Worker para un trabajo y garantiza su destrucción al terminar
 * (éxito, error o cancelación) para no dejar hilos ni listeners colgados.
 *
 * @returns {{promise: Promise<{buffer: ArrayBuffer, elapsedMs: number}>, cancel: () => void}}
 */
export function runFilterJob({ pixels, width, height, params, onProgress }) {
  const worker = new Worker(new URL('../workers/filter.worker.js', import.meta.url), { type: 'module' });
  let settled = false;
  let cancelTimer = null;
  let finish = () => {};
  let rejectJob = () => {};

  const promise = new Promise((resolve, reject) => {
    rejectJob = reject;
    finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(cancelTimer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      settle(value);
    };

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case MSG.PROGRESS:  onProgress?.(data.percent); break;
        case MSG.DONE:      finish(resolve, { buffer: data.buffer, elapsedMs: data.elapsedMs }); break;
        case MSG.CANCELLED: finish(reject, new CancelledError()); break;
        case MSG.ERROR:     finish(reject, new Error(data.message)); break;
        default: break; // MSG.STARTED: sin acción
      }
    };
    worker.onerror = (e) => finish(reject, new Error(e.message || 'Error inesperado en el Worker'));
    worker.onmessageerror = () => finish(reject, new Error('Mensaje del Worker ilegible'));

    // Transferable: el buffer se MUEVE al Worker (cero copias).
    worker.postMessage({ type: MSG.START, buffer: pixels.buffer, width, height, params }, [pixels.buffer]);
  });

  const cancel = () => {
    if (settled) return;
    worker.postMessage({ type: MSG.CANCEL });
    // Red de seguridad: si no responde, se destruye el Worker.
    cancelTimer = setTimeout(() => finish(rejectJob, new CancelledError()), CANCEL_TIMEOUT_MS);
  };

  return { promise, cancel };
}
