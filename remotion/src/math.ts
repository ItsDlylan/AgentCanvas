import { interpolate } from 'remotion'

/** Deterministic pseudo-random — stable across renders. */
export function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Cubic ease-in-out. */
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Exponential ease-out — fast start, long tail. */
export const easeOutExpo = (t: number): number =>
  t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)

/** Interpolate with an easing function applied. */
export function interpEase(
  frame: number,
  from: number,
  to: number,
  outFrom: number,
  outTo: number,
  ease: (t: number) => number = easeInOut
): number {
  const t = interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return outFrom + (outTo - outFrom) * ease(t)
}
