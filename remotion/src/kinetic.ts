import { interpolate, spring } from 'remotion'
import { seeded } from './math'

/** Random printable-ASCII character from a seed + tick. */
const SCRAMBLE_POOL = '!<>-_\\/[]{}—=+*^?#∆%&$§@ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * Returns a "scrambled" version of `target`. For frames below `lockFrame`
 * every unlocked character cycles through random pool chars (seeded) each
 * frame so the text feels alive. By `lockFrame` every character is the
 * real target char. Lock order is randomised per-index using the seed.
 */
export function scrambleText(
  target: string,
  frame: number,
  lockStartFrame: number,
  lockEndFrame: number,
  seed = 1
): string {
  const chars = target.split('')
  return chars
    .map((ch, i) => {
      if (ch === ' ') return ' '
      const perCharLock =
        lockStartFrame +
        (lockEndFrame - lockStartFrame) * seeded(seed * 31 + i * 7)
      if (frame >= perCharLock) return ch
      const poolIdx = Math.floor(
        seeded(seed * 17 + i * 3 + Math.floor(frame / 2) * 13) * SCRAMBLE_POOL.length
      )
      return SCRAMBLE_POOL[poolIdx]
    })
    .join('')
}

/** Spring-driven 0→1 progress for a given frame + start delay. */
export function springAt(
  frame: number,
  startFrame: number,
  fps: number,
  config: { damping: number; stiffness: number; mass?: number } = {
    damping: 14,
    stiffness: 140,
    mass: 0.6
  }
): number {
  return spring({
    frame: Math.max(0, frame - startFrame),
    fps,
    config
  })
}

/** Letter with blur-to-sharp resolve + scale overshoot. */
export function blurResolve(
  frame: number,
  startFrame: number,
  durationFrames: number
): { opacity: number; blurPx: number; scale: number } {
  const t = interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return {
    opacity: t,
    blurPx: (1 - t) * 18,
    scale: interpolate(t, [0, 0.7, 1], [1.6, 1.08, 1])
  }
}

/** Mask-wipe reveal: clip-path inset sweeping open from a direction. */
export function wipeReveal(
  frame: number,
  startFrame: number,
  durationFrames: number,
  direction: 'left' | 'right' | 'top' | 'bottom' = 'left'
): string {
  const t = interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const rem = (1 - t) * 100
  switch (direction) {
    case 'left':
      return `inset(0 0 0 ${rem}%)`
    case 'right':
      return `inset(0 ${rem}% 0 0)`
    case 'top':
      return `inset(${rem}% 0 0 0)`
    case 'bottom':
      return `inset(0 0 ${rem}% 0)`
  }
}

/** Skew-unskew entry: heavy skew at start, zero at end. */
export function skewIn(
  frame: number,
  startFrame: number,
  durationFrames: number,
  maxSkewDeg = 35
): { skewX: number; opacity: number; translateY: number } {
  const t = interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const eased = 1 - Math.pow(1 - t, 4)
  return {
    skewX: (1 - eased) * maxSkewDeg,
    opacity: t,
    translateY: (1 - eased) * 20
  }
}
