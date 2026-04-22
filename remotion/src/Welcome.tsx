import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { Wordmark } from './scenes/Wordmark'
import { StarfieldZoom } from './scenes/StarfieldZoom'
import { CanvasDive } from './scenes/CanvasDive'
import { WorkflowGlobe } from './scenes/WorkflowGlobe'
import { Outro } from './scenes/Outro'
import { theme } from './theme'

export const WELCOME_FPS = 30
// ~21.67 seconds — Ignition removed; Wordmark opens cold.
export const WELCOME_DURATION_FRAMES = 650

const WORDMARK_FRAMES = 110 // 3.67s (cold-open zoom + scramble + 1s hang)
const STARFIELD_FRAMES = 200 // 6.67s (hyperspace → orbit glide → enter Frontend)
const CANVAS_FRAMES = 150 // 5.00s
const WORKFLOWGLOBE_FRAMES = 130 // 4.33s (globe + tagline simultaneous)
const OUTRO_FRAMES = 90 // 3s
const OVERLAP = 10

export const Welcome: React.FC = () => {
  let cursor = 0
  const wordmarkStart = cursor
  cursor += WORDMARK_FRAMES - OVERLAP
  const starfieldStart = cursor
  cursor += STARFIELD_FRAMES - OVERLAP
  const canvasStart = cursor
  cursor += CANVAS_FRAMES - OVERLAP
  const workflowStart = cursor
  cursor += WORKFLOWGLOBE_FRAMES - OVERLAP
  const outroStart = cursor

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={wordmarkStart} durationInFrames={WORDMARK_FRAMES + OVERLAP}>
        <WordmarkWrap duration={WORDMARK_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={starfieldStart} durationInFrames={STARFIELD_FRAMES + OVERLAP}>
        <StarfieldWrap duration={STARFIELD_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={canvasStart} durationInFrames={CANVAS_FRAMES + OVERLAP}>
        <CanvasWrap duration={CANVAS_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={workflowStart} durationInFrames={WORKFLOWGLOBE_FRAMES + OVERLAP}>
        <WorkflowGlobeWrap duration={WORKFLOWGLOBE_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES + OVERLAP}>
        <OutroWrap duration={OUTRO_FRAMES + OVERLAP} />
      </Sequence>
    </AbsoluteFill>
  )
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
const WorkflowGlobeWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <WorkflowGlobe localFrame={f} durationInFrames={duration} />
}
const OutroWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <Outro localFrame={f} durationInFrames={duration} />
}
