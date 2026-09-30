/**
 * Contrato de mensajes Main Thread <-> Dedicated Worker.
 * Se comparte entre ambos lados para evitar "strings mágicos".
 *
 *  Main -> Worker : START {buffer,width,height,params} | CANCEL
 *  Worker -> Main : STARTED | PROGRESS {percent} | DONE {buffer,elapsedMs}
 *                   | CANCELLED | ERROR {message}
 */
export const MSG = Object.freeze({
  START: 'start',
  CANCEL: 'cancel',
  STARTED: 'started',
  PROGRESS: 'progress',
  DONE: 'done',
  CANCELLED: 'cancelled',
  ERROR: 'error',
});

export class CancelledError extends Error {
  constructor() {
    super('Procesamiento cancelado');
    this.name = 'CancelledError';
  }
}
