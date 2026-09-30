'use strict';
/**
 * Service Worker de PixelForge.
 * Ventajas implementadas (requisito: mínimo 2):
 *  1) Caché manual: Cache First (app shell), Network First (navegación), Stale-While-Revalidate (resto).
 *  2) Intercepción de recursos: /results/last se sirve desde Cache Storage (resultado pre-calculado).
 *  Extra: Web Share Target (recibir fotos desde "Compartir") y notificaciones.
 * Al modificar archivos del shell, sube VERSION para renovar la caché.
 */
const VERSION = 'v1';
const STATIC_CACHE = `pixelforge-static-${VERSION}`;
const RUNTIME_CACHE = `pixelforge-runtime-${VERSION}`;
const RESULTS_CACHE = 'pixelforge-results';
const SHARED_CACHE = 'pixelforge-shared';
const NETWORK_TIMEOUT_MS = 3000;

const scope = self.registration.scope;
const abs = (path) => new URL(path, scope).href;

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/main.js', 'js/pwa.js', 'js/ui/perfMonitor.js',
  'js/core/protocol.js', 'js/core/imageProcessor.js',
  'js/services/workerClient.js', 'js/workers/filter.worker.js',
  'icons/icon-192.png', 'icons/icon-512.png',
].map(abs);
const PRECACHE_SET = new Set(PRECACHE);
const RESULT_URL = abs('results/last');
const SHARE_URL = abs('share-target');
const SHARED_IMAGE_URL = abs('shared/image');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, RUNTIME_CACHE, RESULTS_CACHE, SHARED_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && request.url === SHARE_URL) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  if (request.url === RESULT_URL) event.respondWith(serveStoredResult());
  else if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (PRECACHE_SET.has(request.url)) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(event));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow(scope);
  })());
});

/* ---------- Estrategias ---------- */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await caches.match(abs('index.html'))) || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => { if (response.ok) cache.put(event.request, response.clone()); return response; })
    .catch(() => null);
  event.waitUntil(refresh); // mantiene vivo el SW hasta terminar la revalidación
  return cached || (await refresh) || Response.error();
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/* ---------- Intercepción de recursos ---------- */

async function serveStoredResult() {
  const cache = await caches.open(RESULTS_CACHE);
  const stored = await cache.match(RESULT_URL);
  if (!stored) return new Response('Sin resultado guardado', { status: 404 });
  const headers = new Headers(stored.headers);
  headers.set('X-Served-By', 'service-worker');
  return new Response(stored.body, { status: 200, headers });
}

/* ---------- Web Share Target ---------- */

async function handleShare(request) {
  const form = await request.formData();
  const file = form.get('image');
  if (file instanceof File) {
    const cache = await caches.open(SHARED_CACHE);
    await cache.put(SHARED_IMAGE_URL, new Response(file, { headers: { 'Content-Type': file.type } }));
  }
  return Response.redirect(abs('./?shared=1'), 303);
}
