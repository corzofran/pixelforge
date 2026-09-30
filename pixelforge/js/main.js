import { DEFAULT_PARAMS, applyFilters } from './core/imageProcessor.js';
import { CancelledError } from './core/protocol.js';
import { runFilterJob } from './services/workerClient.js';
import { PerfMonitor } from './ui/perfMonitor.js';
import {
  registerServiceWorker, setupInstallPrompt, watchConnectivity, saveResult, loadSavedResult,
  consumeSharedImage, requestNotificationPermission, notifyIfHidden,
} from './pwa.js';

const MAX_PIXELS = 24_000_000; // protege la memoria: imágenes mayores se reducen
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const el = {
  canvas: $('canvas'), wrap: document.querySelector('.canvas-wrap'),
  progress: $('progress'), progressLabel: $('progress-label'),
  file: $('file'), mode: $('mode'), format: $('format'), notify: $('notify'),
  apply: $('btn-apply'), cancel: $('btn-cancel'), reset: $('btn-reset'),
  sample: $('btn-sample'), exportBtn: $('btn-export'), recover: $('btn-recover'),
  log: $('log'),
};
const ctx = el.canvas.getContext('2d');
const scratch = document.createElement('canvas'); // lienzo auxiliar para leer píxeles
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

/** Estado único de la app. */
const state = { bitmap: null, job: null, busy: false, tapCount: 0 };

const perf = new PerfMonitor({ fpsEl: $('badge-fps'), longEl: $('badge-long'), dotEl: $('dot') });

/* ---------- Utilidades de UI ---------- */

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString('es-MX')}] ${message}`; // textContent: sin inyección HTML
  el.log.prepend(li);
  while (el.log.children.length > 60) el.log.lastChild.remove();
}

function setProgress(percent, label) {
  el.progress.value = percent;
  el.progressLabel.textContent = label ?? `Procesando… ${percent}%`;
}

function setBusy(busy) {
  state.busy = busy;
  const hasImage = Boolean(state.bitmap);
  el.apply.disabled = busy || !hasImage;
  el.reset.disabled = busy || !hasImage;
  el.exportBtn.disabled = busy || !hasImage;
  el.cancel.disabled = !(busy && el.mode.value === 'worker');
  for (const control of [el.file, el.sample, el.mode, el.recover]) control.disabled = busy;
}

function readParams() {
  const num = (id) => Number($(id).value);
  return {
    ...DEFAULT_PARAMS,
    brightness: num('brightness'), contrast: num('contrast'),
    saturation: num('saturation'), blur: num('blur'),
    grayscale: $('grayscale').checked, sepia: $('sepia').checked,
  };
}

function resetControls() {
  for (const key of ['brightness', 'contrast', 'saturation', 'blur']) {
    $(key).value = DEFAULT_PARAMS[key];
    $(`o-${key}`).textContent = DEFAULT_PARAMS[key];
  }
  $('grayscale').checked = false;
  $('sepia').checked = false;
}

/* ---------- Manejo de imagen ---------- */

async function setBitmap(source) {
  let bitmap = await createImageBitmap(source);
  const pixels = bitmap.width * bitmap.height;
  if (pixels > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / pixels);
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.floor(bitmap.width * k), resizeHeight: Math.floor(bitmap.height * k),
    });
    bitmap.close();
    bitmap = resized;
    log('Imagen reducida a 24 MP para cuidar la memoria');
  }
  state.bitmap?.close(); // libera la imagen anterior
  state.bitmap = bitmap;
  drawOriginal();
  el.wrap.classList.add('has-image');
  setProgress(0, 'Inactivo');
  setBusy(false);
  log(`Imagen cargada: ${bitmap.width}×${bitmap.height} (${(pixels / 1e6).toFixed(1)} MP)`);
}

function drawOriginal() {
  el.canvas.width = state.bitmap.width;
  el.canvas.height = state.bitmap.height;
  ctx.drawImage(state.bitmap, 0, 0);
}

async function loadFile(file) {
  if (!file?.type.startsWith('image/')) { log('El archivo elegido no es una imagen'); return; }
  try { await setBitmap(file); } catch (err) { log(`No se pudo leer la imagen: ${err.message}`); }
}

/** Genera una foto sintética de 4000×3000 (12 MP) para probar sin subir archivos. */
async function generateSample() {
  const c = document.createElement('canvas');
  c.width = 4000; c.height = 3000;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#345c8a'); sky.addColorStop(0.6, '#e8b27a'); sky.addColorStop(1, '#2b3a2f');
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `hsla(${(i * 47) % 360} 70% 55% / .35)`;
    g.beginPath();
    g.arc((i * 733) % c.width, (i * 421) % c.height, 30 + ((i * 53) % 220), 0, Math.PI * 2);
    g.fill();
  }
  await setBitmap(c);
}

/* ---------- Pipeline principal ---------- */

function readSourcePixels() {
  const { width, height } = state.bitmap;
  scratch.width = width; scratch.height = height;
  scratchCtx.drawImage(state.bitmap, 0, 0);
  return scratchCtx.getImageData(0, 0, width, height);
}

async function runPipeline() {
  if (!state.bitmap || state.busy) return;
  const mode = el.mode.value;
  const params = readParams();
  const { width, height } = state.bitmap;

  setBusy(true);
  setProgress(0, mode === 'worker' ? 'Enviando al Worker…' : 'Procesando en el hilo principal (la UI se bloqueará)…');
  perf.beginSample();
  const t0 = performance.now();
  let elapsedMs;

  try {
    const imageData = readSourcePixels();
    let result;

    if (mode === 'worker') {
      state.job = runFilterJob({ pixels: imageData.data, width, height, params, onProgress: (p) => setProgress(p) });
      const { buffer, elapsedMs: workerMs } = await state.job.promise;
      elapsedMs = workerMs;
      result = new ImageData(new Uint8ClampedArray(buffer), width, height);
    } else {
      await nextFrame(); await nextFrame(); // deja pintar el estado antes de bloquear
      await applyFilters(imageData.data, width, height, params, { onProgress: (p) => setProgress(p) });
      elapsedMs = performance.now() - t0;
      result = imageData;
    }

    ctx.putImageData(result, 0, 0);
    setProgress(100, `Listo en ${(elapsedMs / 1000).toFixed(2)} s`);
    showMetrics(mode, width, height, elapsedMs, perf.endSample());
    log(`Procesamiento terminado (${mode === 'worker' ? 'Worker' : 'hilo principal'})`);
    notifyIfHidden('Tu foto ya está revelada.');
    persistResult();
  } catch (err) {
    perf.endSample();
    if (err instanceof CancelledError) { setProgress(0, 'Cancelado'); log('Procesamiento cancelado'); }
    else { setProgress(0, 'Error'); log(`Error: ${err.message}`); console.error(err); }
  } finally {
    state.job = null;
    setBusy(false);
  }
}

function showMetrics(mode, w, h, ms, sample) {
  $('m-mode').textContent = mode === 'worker' ? 'Web Worker' : 'Hilo principal';
  $('m-res').textContent = `${w}×${h}`;
  $('m-time').textContent = `${(ms / 1000).toFixed(2)} s`;
  $('m-fps').textContent = sample.minFps ?? '–';
  $('m-long').textContent = `${sample.longTasks} (${sample.blockedMs} ms)`;
}

/** Guarda el resultado en Cache Storage sin bloquear la UI (mejor esfuerzo). */
function persistResult() {
  el.canvas.toBlob((blob) => {
    if (blob) saveResult(blob).catch((err) => log(`No se pudo guardar el resultado: ${err.message}`));
  }, 'image/webp', 0.9);
}

/* ---------- Exportar / recuperar ---------- */

function exportImage() {
  const type = el.format.value;
  el.canvas.toBlob((blob) => {
    if (!blob) { log('El navegador no pudo codificar ese formato'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixelforge.${type.split('/')[1].replace('jpeg', 'jpg')}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // evita fuga de memoria
    log(`Exportado ${(blob.size / 1024).toFixed(0)} KB (${type})`);
  }, type, 0.92);
}

async function recoverLast() {
  try {
    const { blob, servedBy } = await loadSavedResult();
    await setBitmap(blob);
    log(`Resultado recuperado (${servedBy === 'service-worker' ? 'servido por el Service Worker' : 'sin SW activo'})`);
  } catch (err) { log(err.message); }
}

/* ---------- Eventos ---------- */

function bindEvents() {
  for (const key of ['brightness', 'contrast', 'saturation', 'blur']) {
    $(key).addEventListener('input', () => { $(`o-${key}`).textContent = $(key).value; });
  }
  el.file.addEventListener('change', () => loadFile(el.file.files[0]));
  el.sample.addEventListener('click', generateSample);
  el.apply.addEventListener('click', runPipeline);
  el.cancel.addEventListener('click', () => { state.job?.cancel(); setProgress(el.progress.value, 'Cancelando…'); });
  el.reset.addEventListener('click', () => { resetControls(); drawOriginal(); setProgress(0, 'Inactivo'); log('Imagen restablecida'); });
  el.exportBtn.addEventListener('click', exportImage);
  el.recover.addEventListener('click', recoverLast);
  el.mode.addEventListener('change', () => setBusy(state.busy));
  el.notify.addEventListener('change', async () => {
    if (el.notify.checked && !(await requestNotificationPermission())) { el.notify.checked = false; log('Permiso de notificaciones denegado'); }
  });
  $('btn-tap').addEventListener('click', () => { $('live-count').textContent = `${++state.tapCount} clics`; });

  // Arrastrar y soltar una foto sobre el lienzo
  el.wrap.addEventListener('dragover', (e) => e.preventDefault());
  el.wrap.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

  // Al salir, se destruye cualquier Worker vivo
  window.addEventListener('pagehide', () => state.job?.cancel());
}

async function init() {
  bindEvents();
  perf.start();
  setBusy(false);
  watchConnectivity((online) => {
    const badge = $('badge-net');
    badge.textContent = online ? 'En línea' : 'Sin conexión (modo offline)';
    badge.classList.toggle('warn', !online);
  });
  setupInstallPrompt($('btn-install'));
  await registerServiceWorker((status) => { $('badge-sw').textContent = `Service Worker: ${status}`; });
  const shared = await consumeSharedImage();
  if (shared) await loadFile(shared);
}

init();
