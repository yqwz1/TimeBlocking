import { useEffect, useRef } from 'react';
import { onCelebrate } from '../lib/celebrate.js';
import { playCompletionChime } from '../lib/sound.js';
import { useSettings } from '../hooks.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vr: number;
  life: number;
}

const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6', '#14b8a6'];

/** Confetti burst + chime fired via `celebrateTaskComplete()`. Mounted once at the app root. */
export default function ConfettiBurst() {
  const { data: settings } = useSettings();
  const enabledRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    enabledRef.current = settings?.celebrationToasts ?? true;
  }, [settings?.celebrationToasts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext('2d');
    if (!canvas || !ctx2d) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const tick = () => {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 0.18;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.life -= 0.012;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx2d.save();
        ctx2d.globalAlpha = Math.max(p.life, 0);
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rotation);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx2d.restore();
      }
      rafRef.current = particles.length ? requestAnimationFrame(tick) : null;
    };

    const unsub = onCelebrate((x, y) => {
      if (!enabledRef.current) return;
      playCompletionChime();
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;
      for (let i = 0; i < 28; i++) {
        const angle = Math.random() * Math.PI + Math.PI; // spray upward
        const speed = 4 + Math.random() * 6;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 4 + Math.random() * 4,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          rotation: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.4,
          life: 1,
        });
      }
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    });

    return () => {
      window.removeEventListener('resize', resize);
      unsub();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[60]" />;
}
