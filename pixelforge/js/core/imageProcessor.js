import { CancelledError } from './protocol.js';

/** Valores neutros: no modifican la imagen. */
export const DEFAULT_PARAMS = Object.freeze({
  brightness: 0, contrast: 0, saturation: 0, blur: 0, grayscale: false, sepia: false,
});

const BLUR_PASSES = 3; // 3 pasadas de box blur aproximan un desenfoque gaussiano
const BAND = 96;       // filas/columnas por bloque: granularidad de progreso y cancelación

/**
 * Aplica los filtros sobre `pixels` (RGBA) modificándolos en el mismo buffer.
 * Es puro (sin DOM), por eso corre igual en un Worker o en el hilo principal.
 *
 * @param {Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {typeof DEFAULT_PARAMS} params
 * @param {{onProgress?:(p:number)=>void, isCancelled?:()=>boolean, yieldToEvents?:()=>Promise<void>}} hooks
 * @throws {CancelledError}
 */
export async function applyFilters(pixels, width, height, params, hooks = {}) {
  const { onProgress = () => {}, isCancelled = () => false, yieldToEvents = null } = hooks;
  const radius = Math.max(0, Math.round(params.blur));
  const totalUnits = height + (radius > 0 ? BLUR_PASSES * (height + width) : 0);
  let doneUnits = 0;
  let lastPercent = -1;

  // Punto de control tras cada bloque: reporta avance, atiende cancelación
  // y (en el Worker) cede el turno para poder recibir mensajes nuevos.
  const checkpoint = async (units) => {
    doneUnits += units;
    const percent = Math.min(100, Math.floor((doneUnits * 100) / totalUnits));
    if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
    if (isCancelled()) throw new CancelledError();
    if (yieldToEvents) await yieldToEvents();
  };

  const lut = buildToneLut(params.brightness, params.contrast);
  const saturation = 1 + params.saturation / 100;
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const y1 = Math.min(y0 + BAND, height);
    colorBand(pixels, width, y0, y1, lut, saturation, params.grayscale, params.sepia);
    await checkpoint(y1 - y0);
  }

  if (radius > 0) {
    const tmp = new Uint8ClampedArray(pixels.length);
    for (let pass = 0; pass < BLUR_PASSES; pass++) {
      for (let y0 = 0; y0 < height; y0 += BAND) {
        const y1 = Math.min(y0 + BAND, height);
        boxBlurRows(pixels, tmp, width, y0, y1, radius);
        await checkpoint(y1 - y0);
      }
      for (let x0 = 0; x0 < width; x0 += BAND) {
        const x1 = Math.min(x0 + BAND, width);
        boxBlurColumns(tmp, pixels, width, height, x0, x1, radius);
        await checkpoint(x1 - x0);
      }
    }
  }
}

/** Tabla de 256 valores: brillo + contraste precalculados una sola vez. */
function buildToneLut(brightness, contrast) {
  const offset = brightness * 2.55;
  const c = contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Uint8ClampedArray(256); // el propio tipo satura a 0..255
  for (let i = 0; i < 256; i++) lut[i] = factor * (i - 128) + 128 + offset;
  return lut;
}

function colorBand(px, width, y0, y1, lut, sat, gray, sepia) {
  const end = y1 * width * 4;
  for (let i = y0 * width * 4; i < end; i += 4) {
    let r = lut[px[i]], g = lut[px[i + 1]], b = lut[px[i + 2]];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (gray) { r = g = b = l; }
    else if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
    if (sepia) {
      const nr = 0.393 * r + 0.769 * g + 0.189 * b;
      const ng = 0.349 * r + 0.686 * g + 0.168 * b;
      const nb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = nr; g = ng; b = nb;
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
}

/** Box blur horizontal con ventana deslizante (O(n), independiente del radio). */
function boxBlurRows(src, dst, width, y0, y1, r) {
  const div = 2 * r + 1, last = width - 1;
  for (let y = y0; y < y1; y++) {
    const row = y * width * 4;
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[row + Math.min(Math.max(i, 0), last) * 4 + ch];
      for (let x = 0; x < width; x++) {
        dst[row + x * 4 + ch] = sum / div;
        sum += src[row + Math.min(x + r + 1, last) * 4 + ch] - src[row + Math.max(x - r, 0) * 4 + ch];
      }
    }
  }
}

/** Box blur vertical sobre un rango de columnas. */
function boxBlurColumns(src, dst, width, height, x0, x1, r) {
  const div = 2 * r + 1, last = height - 1, stride = width * 4;
  for (let x = x0; x < x1; x++) {
    for (let ch = 0; ch < 4; ch++) {
      const base = x * 4 + ch;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[base + Math.min(Math.max(i, 0), last) * stride];
      for (let y = 0; y < height; y++) {
        dst[base + y * stride] = sum / div;
        sum += src[base + Math.min(y + r + 1, last) * stride] - src[base + Math.max(y - r, 0) * stride];
      }
    }
  }
}
