# PixelForge — Arquitectura Web Concurrente y Resiliente (Vanilla JS)

Editor de fotos cliente (sin librerías, bundlers ni frameworks). Actividad SH01 · Programación concurrente.

## Ejecutar
Los Service Workers requieren `localhost` o HTTPS:

```bash
cd pixelforge
python3 -m http.server 8080      # o: npx serve .
# abrir http://localhost:8080 en Chrome
```

## Estructura
```
index.html · manifest.webmanifest · sw.js
css/styles.css
js/main.js                    UI, estado y orquestación (hilo principal)
js/pwa.js                     registro del SW, instalación, notificaciones, Cache Storage
js/ui/perfMonitor.js          FPS, Long Tasks y animación de prueba
js/services/workerClient.js   ciclo de vida del Worker (crear, progreso, cancelar, destruir)
js/core/protocol.js           contrato de mensajes
js/core/imageProcessor.js     algoritmo (puro, sin DOM)
js/workers/filter.worker.js   Dedicated Worker
```

## Demostración rápida (para la clase)
1. "Generar imagen de prueba (12 MP)" → blur 20 + Aplicar con **Web Worker**: el punto rojo sigue moviéndose, puedes escribir y hacer clic.
2. Cambia a **Hilo principal** y repite: la UI se congela (FPS ≈ 0, Long Tasks). Es la evidencia del reporte.
3. Apaga la red (DevTools → Network → Offline) y recarga: la app abre. "Recuperar último resultado" lo sirve el SW.

## Historial de commits sugerido (mínimo 5)
Haz cada commit al terminar de entender y probar esa etapa:
1. `chore: estructura base, HTML y estilos`
2. `feat: procesador de imagen puro (filtros de color y blur)`
3. `feat: Dedicated Worker con protocolo de mensajes y progreso`
4. `feat: cancelación, Transferable Objects y destrucción del Worker`
5. `feat: Service Worker con estrategias de caché y modo offline`
6. `feat: intercepción de resultados, share target y notificaciones`
7. `docs: reporte arquitectónico y evidencias de rendimiento`

## Modificación express (ideas para practicar)
- **Filtro "Invertir"**: checkbox en `index.html` → `readParams()` en `main.js` → campo en `DEFAULT_PARAMS` → línea en `colorBand()` (`r = 255 - r`…).
- **Cambiar el límite de imagen**: `MAX_PIXELS` en `main.js`.
- **Otra estrategia de caché**: cambia la rama del `fetch` en `sw.js`.
- **Renovar la caché** tras editar archivos: sube `VERSION` en `sw.js`.
