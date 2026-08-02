export const TIKZ_MOTION = {
  spring: {
    type: 'spring' as const,
    stiffness: 440,
    damping: 38,
    mass: 0.72,
  },
  softSpring: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 34,
    mass: 0.84,
  },
  panel: {
    initial: { opacity: 0, y: 8, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 5, scale: 0.99 },
  },
  status: {
    initial: { opacity: 0, y: 4, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -3, scale: 0.98 },
  },
  listItem: {
    initial: { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -3 },
  },
} as const;

export const TIKZ_TAP = { scale: 0.965 } as const;
export const TIKZ_HOVER = { y: -1 } as const;
