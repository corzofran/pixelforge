/**
 * Mide la salud del hilo principal:
 *  - FPS reales con requestAnimationFrame (si el hilo se bloquea, bajan).
 *  - Long Tasks (>50 ms) con PerformanceObserver (solo Chromium).
 *  - Anima un punto con JS (no con CSS) para que se note visualmente cualquier congelamiento.
 */
export class PerfMonitor {
  #fpsEl; #longEl; #dotEl;
  #frames = 0;
  #windowStart = performance.now();
  #sampling = false;
  #minFps = Infinity;
  #longTasks = 0;
  #blockedMs = 0;
  #totalLong = 0;

  constructor({ fpsEl, longEl, dotEl }) {
    this.#fpsEl = fpsEl; this.#longEl = longEl; this.#dotEl = dotEl;
  }

  start() {
    requestAnimationFrame(this.#tick);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.#totalLong++;
          if (this.#sampling) { this.#longTasks++; this.#blockedMs += entry.duration; }
        }
        this.#longEl.textContent = `Long Tasks: ${this.#totalLong}`;
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      this.#longEl.textContent = 'Long Tasks: n/d';
    }
  }

  /** Empieza a acumular métricas para un procesamiento. */
  beginSample() {
    this.#sampling = true; this.#minFps = Infinity; this.#longTasks = 0; this.#blockedMs = 0;
  }

  /** Termina la muestra y devuelve el resumen. */
  endSample() {
    this.#sampling = false;
    return {
      minFps: Number.isFinite(this.#minFps) ? this.#minFps : null,
      longTasks: this.#longTasks,
      blockedMs: Math.round(this.#blockedMs),
    };
  }

  #tick = (now) => {
    this.#frames++;
    const elapsed = now - this.#windowStart;
    if (elapsed >= 500) {
      const fps = Math.round((this.#frames * 1000) / elapsed);
      this.#fpsEl.textContent = `${fps} FPS`;
      this.#fpsEl.classList.toggle('warn', fps < 30);
      if (this.#sampling) this.#minFps = Math.min(this.#minFps, fps);
      this.#frames = 0; this.#windowStart = now;
    }
    const range = this.#dotEl.parentElement.clientWidth - this.#dotEl.offsetWidth;
    const x = ((Math.sin(now / 400) + 1) / 2) * range;
    this.#dotEl.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(this.#tick);
  };
}
