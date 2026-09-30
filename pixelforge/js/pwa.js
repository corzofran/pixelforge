/**
 * Capa PWA del lado de la página: registro del SW, instalación, notificaciones
 * y puente con Cache Storage. La lógica de red vive en /sw.js.
 */
const RESULTS_CACHE = 'pixelforge-results'; // mismo nombre que en sw.js
const SHARED_CACHE = 'pixelforge-shared';
let registration = null;

const resultUrl = () => new URL('results/last', document.baseURI).href;
const sharedUrl = () => new URL('shared/image', document.baseURI).href;

export async function registerServiceWorker(onStatus) {
  if (!('serviceWorker' in navigator)) { onStatus('no soportado'); return; }
  try {
    registration = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    onStatus(navigator.serviceWorker.controller ? 'activo' : 'listo (recarga la página)');
    navigator.serviceWorker.addEventListener('controllerchange', () => onStatus('activo'));
  } catch (err) {
    console.error('Registro de SW falló:', err);
    onStatus('error');
  }
}

/** Muestra el botón "Instalar" cuando el navegador lo permite. */
export function setupInstallPrompt(button) {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; button.hidden = false; });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null; button.hidden = true;
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; });
}

export function watchConnectivity(onChange) {
  const emit = () => onChange(navigator.onLine);
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  emit();
}

/** Guarda el último resultado en Cache Storage; el SW lo sirve en /results/last. */
export async function saveResult(blob) {
  const cache = await caches.open(RESULTS_CACHE);
  await cache.put(resultUrl(), new Response(blob, { headers: { 'Content-Type': blob.type } }));
}

/** Pide el resultado por fetch: la petición es interceptada por el Service Worker. */
export async function loadSavedResult() {
  const res = await fetch(resultUrl());
  if (!res.ok) throw new Error('Aún no hay un resultado guardado');
  return { blob: await res.blob(), servedBy: res.headers.get('X-Served-By') };
}

/** Recupera la imagen recibida por "Compartir" (Web Share Target), si existe. */
export async function consumeSharedImage() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return null;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open(SHARED_CACHE);
  const res = await cache.match(sharedUrl());
  if (!res) return null;
  const blob = await res.blob();
  await cache.delete(sharedUrl());
  return blob;
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  return (Notification.permission === 'granted') || (await Notification.requestPermission()) === 'granted';
}

/** Notifica solo si el usuario no está viendo la pestaña. */
export async function notifyIfHidden(body) {
  if (!document.hidden || !registration || Notification.permission !== 'granted') return;
  await registration.showNotification('PixelForge', { body, icon: 'icons/icon-192.png' });
}
