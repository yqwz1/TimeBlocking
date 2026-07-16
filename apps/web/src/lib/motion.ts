import type { Transition, Variants } from 'motion/react';

/**
 * Shared motion vocabulary so every component springs the same way.
 * Tuned to feel like the existing --tb-fast (120ms) / --tb-med (150ms) CSS tokens.
 */
export const springs = {
  snappy: { type: 'spring', stiffness: 500, damping: 32, mass: 0.6 } satisfies Transition,
  gentle: { type: 'spring', stiffness: 300, damping: 28, mass: 0.7 } satisfies Transition,
  soft: { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 } satisfies Transition,
};

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: springs.gentle },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/** Mirrors the existing CSS `tb-pop` keyframe (translateY(-4px) scale(0.98) -> identity). */
export const popIn: Variants = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: springs.snappy },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.12 } },
};

/** For list rows: fade+slide in, fade+collapse out. Pair with `layout` for reorders. */
export const listItem: Variants = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: springs.gentle },
  exit: {
    opacity: 0,
    scale: 0.97,
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    paddingTop: 0,
    paddingBottom: 0,
    transition: { duration: 0.18, ease: 'easeOut' },
  },
};

/** Toast entrance/exit: slides in from the right, springs out. */
export const toast: Variants = {
  initial: { opacity: 0, x: 24, scale: 0.96 },
  animate: { opacity: 1, x: 0, scale: 1, transition: springs.snappy },
  exit: { opacity: 0, x: 16, scale: 0.96, transition: { duration: 0.15 } },
};

/** Popover/modal scale-in near its anchor. */
export const popoverVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: springs.snappy },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.12 } },
};

/**
 * Route-level page transition: quick fade + slight rise. The exiting page is
 * pulled out of normal flow (position: absolute) so it overlays rather than
 * pushing the entering page down during the brief overlap — this also means
 * the new route is already visible/interactive even if the old page's exit
 * animation stalls (e.g. a backgrounded tab throttling rAF).
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, position: 'relative', transition: { duration: 0.18, ease: 'easeOut' } },
  exit: {
    opacity: 0,
    y: -4,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    transition: { duration: 0.12, ease: 'easeIn' },
  },
};
