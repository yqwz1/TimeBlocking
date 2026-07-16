type Listener = (x: number, y: number) => void;

const listeners = new Set<Listener>();

let lastX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
let lastY = typeof window !== 'undefined' ? window.innerHeight / 3 : 0;

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
  });
}

export function onCelebrate(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fire from wherever a task just got marked done — bursts near the last click/tap. */
export function celebrateTaskComplete() {
  listeners.forEach((fn) => fn(lastX, lastY));
}
