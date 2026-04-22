import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { Ignition } from './scenes/Ignition'
import { Wordmark } from './scenes/Wordmark'
import { CanvasDive } from './scenes/CanvasDive'
import { Outro } from './scenes/Outro'
import { theme } from './theme'

export const WELCOME_FPS = 30
// 12 seconds
export const WELCOME_DURATION_FRAMES = 12 * WELCOME_FPS

// Scenes overlap slightly so exit-blur/fade of one meets enter of next.
const IGNITION_FRAMES = 60 // 2s
const WORDMARK_FRAMES = 70 // 2.33s
const CANVAS_FRAMES = 150 // 5s
const OUTRO_FRAMES = 100 // 3.33s — total 380 with 20 frame overlap budget

const OVERLAP = 8

export const Welcome: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={0} durationInFrames={IGNITION_FRAMES}>
        <IgnitionWrap duration={IGNITION_FRAMES} />
      </Sequence>

      <Sequence
        from={IGNITION_FRAMES - OVERLAP}
        durationInFrames={WORDMARK_FRAMES + OVERLAP}
      >
        <WordmarkWrap duration={WORDMARK_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence
        from={IGNITION_FRAMES + WORDMARK_FRAMES - OVERLAP * 2}
        durationInFrames={CANVAS_FRAMES + OVERLAP}
      >
        <CanvasWrap duration={CANVAS_FRAMES + OVERLAP} />
      </Sequence>

      <Sequence
        from={IGNITION_FRAMES + WORDMARK_FRAMES + CANVAS_FRAMES - OVERLAP * 3}
        durationInFrames={OUTRO_FRAMES + OVERLAP}
      >
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
const CanvasWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <CanvasDive localFrame={f} durationInFrames={duration} />
}
const OutroWrap: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame()
  return <Outro localFrame={f} durationInFrames={duration} />
}
