import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import type { PropsWithChildren } from 'react'

interface SceneContainerProps {
  /** Local frame within the scene. */
  localFrame: number
  /** Duration of the scene in frames. */
  durationInFrames: number
  /** Frames to fade in (from transparent/slightly-offset). */
  fadeInFrames?: number
  /** Frames to fade out at the end of the scene. */
  fadeOutFrames?: number
}

/**
 * Wraps a scene with a consistent fade/slide in-and-out so scenes can be
 * composed by simply toggling which one is visible on a given frame range.
 */
export const SceneContainer: React.FC<PropsWithChildren<SceneContainerProps>> = ({
  localFrame,
  durationInFrames,
  fadeInFrames = 14,
  fadeOutFrames = 14,
  children
}) => {
  const frame = useCurrentFrame()
  // Allow passing an already-local frame; fall back to current frame.
  const f = localFrame

  const fadeIn = interpolate(f, [0, fadeInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const fadeOut = interpolate(
    f,
    [durationInFrames - fadeOutFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const opacity = Math.min(fadeIn, fadeOut)

  const translateY = interpolate(f, [0, fadeInFrames], [12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        willChange: 'opacity, transform'
      }}
      data-frame={frame}
    >
      {children}
    </AbsoluteFill>
  )
}
