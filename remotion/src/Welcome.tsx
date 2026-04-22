import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { Ignition } from './scenes/Ignition'
import { Wordmark } from './scenes/Wordmark'
import { StarfieldZoom } from './scenes/StarfieldZoom'
import { CanvasDive } from './scenes/CanvasDive'
import { WorkflowTagline } from './scenes/WorkflowTagline'
import { GlobeSpin } from './scenes/GlobeSpin'
import { Outro } from './scenes/Outro'
import { theme } from './theme'

export const WELCOME_FPS = 30
// 20 seconds total
export const WELCOME_DURATION_FRAMES = 20 * WELCOME_FPS // 600

// Per-scene durations (before overlap). Summed they slightly exceed 600;
// the OVERLAP frames between adjacent scenes handle crossfades.
const IGNITION_FRAMES = 60 // 2.0s
const WORDMARK_FRAMES = 80 // 2.67s (more time for scramble + glitch)
const STARFIELD_FRAMES = 120 // 4.0s (starfield → folders → enter workspace)
const CANVAS_FRAMES = 110 // 3.67s (connected tiles, trimmed from 5s)
const TAGLINE_FRAMES = 95 // 3.17s ("built to ship the world")
const GLOBE_FRAMES = 75 // 2.5s (rotating globe)
const OUTRO_FRAMES = 90 // 3.0s (kinetic typography close)
const OVERLAP = 10

export const Welcome: React.FC = () => {
  // Running cursor for scene start frames with overlap
  let cursor = 0
  const ignitionStart = cursor
  cursor += IGNITION_FRAMES - OVERLAP
  const wordmarkStart = cursor
  cursor += WORDMARK_FRAMES - OVERLAP
  const starfieldStart = cursor
  cursor += STARFIELD_FRAMES - OVERLAP
  const canvasStart = cursor
  cursor += CANVAS_FRAMES - OVERLAP
  const taglineStart = cursor
  cursor += TAGLINE_FRAMES - OVERLAP
  const globeStart = cursor
  cursor += GLOBE_FRAMES - OVERLAP
  const outroStart = cursor

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={ignitionStart} durationInFrames={IGNITION_FRAMES}>
        <IgnitionWrap duration={IGNITION_FRAMES} />
      </Sequence>

      <Sequence from={wordmarkStart} durationInFrames={WORDMARK_FRAMES + OVERLAP}>
        <WordmarkWrap duration={WORDMARK_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={starfieldStart} durationInFrames={STARFIELD_FRAMES + OVERLAP}>
        <StarfieldWrap duration={STARFIELD_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={canvasStart} durationInFrames={CANVAS_FRAMES + OVERLAP}>
        <CanvasWrap duration={CANVAS_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={taglineStart} durationInFrames={TAGLINE_FRAMES + OVERLAP}>
        <TaglineWrap duration={TAGLINE_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={globeStart} durationInFrames={GLOBE_FRAMES + OVERLAP}>
        <GlobeWrap duration={GLOBE_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES + OVERLAP}>
        <OutroWrap duration={OUTRO_FRAMES + OVERLAP} />
      </Sequence>
    </AbsoluteFill>
  )
}

const IgnitionWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <Ignition localFrame={f} durationInFrames={duration} />
}
const WordmarkWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <Wordmark localFrame={f} durationInFrames={duration} />
}
const StarfieldWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <StarfieldZoom localFrame={f} durationInFrames={duration} />
}
const CanvasWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <CanvasDive localFrame={f} durationInFrames={duration} />
}
const TaglineWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <WorkflowTagline localFrame={f} durationInFrames={duration} />
}
const GlobeWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <GlobeSpin localFrame={f} durationInFrames={duration} />
}
const OutroWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <Outro localFrame={f} durationInFrames={duration} />
}
