import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { LogoReveal } from './scenes/LogoReveal'
import { FeatureCard } from './scenes/FeatureCard'
import { OutroHint } from './scenes/OutroHint'
import { theme } from './theme'
import { useCurrentFrame } from 'remotion'

export const WELCOME_FPS = 30
// 12 seconds total
export const WELCOME_DURATION_FRAMES = 12 * WELCOME_FPS

const INTRO_FRAMES = 60 // 2s
const OUTRO_FRAMES = 75 // 2.5s
const FEATURE_TOTAL = WELCOME_DURATION_FRAMES - INTRO_FRAMES - OUTRO_FRAMES // ~7.5s
const FEATURE_COUNT = 4
const FEATURE_FRAMES = Math.floor(FEATURE_TOTAL / FEATURE_COUNT)

const features = [
  {
    title: 'Infinite canvas',
    subtitle: 'Terminals, browsers, notes and tasks live side-by-side. Pan, zoom, and arrange the space however you think.',
    icon: 'browser' as const,
    tint: theme.blue,
    hint: 'Drag to pan · Scroll to zoom'
  },
  {
    title: 'Spawn real terminals',
    subtitle: 'Each tile is a full PTY — run Claude Code, build scripts, dev servers, or whole agent teams.',
    icon: 'terminal' as const,
    tint: theme.green,
    hint: '⌘T · New terminal'
  },
  {
    title: 'Notes that stay in context',
    subtitle: 'Markdown-native notes link to terminals and tasks so the thinking never leaves the work.',
    icon: 'note' as const,
    tint: theme.orange,
    hint: '⌘N · New note'
  },
  {
    title: 'Tasks with derived state',
    subtitle: 'Capture work, let the classifier tag it, and watch state flow from raw → review automatically.',
    icon: 'task' as const,
    tint: theme.purple,
    hint: '⌘⇧T · Task Lens'
  }
]

export const Welcome: React.FC = () => {
  useVideoConfig()
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {/* Subtle moving background dots */}
      <BackgroundDots frame={frame} />

      <Sequence from={0} durationInFrames={INTRO_FRAMES}>
        <LogoRevealWrapper durationInFrames={INTRO_FRAMES} />
      </Sequence>

      {features.map((feature, index) => {
        const from = INTRO_FRAMES + index * FEATURE_FRAMES
        return (
          <Sequence key={feature.title} from={from} durationInFrames={FEATURE_FRAMES}>
            <FeatureCardWrapper
              step={index}
              totalSteps={FEATURE_COUNT}
              feature={feature}
              durationInFrames={FEATURE_FRAMES}
            />
          </Sequence>
        )
      })}

      <Sequence
        from={INTRO_FRAMES + FEATURE_COUNT * FEATURE_FRAMES}
        durationInFrames={OUTRO_FRAMES}
      >
        <OutroHintWrapper durationInFrames={OUTRO_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  )
}

// ── Wrappers: Remotion zeroes useCurrentFrame() inside Sequence, so we pass
// that through as `localFrame` to keep scene animations self-contained. ──

const LogoRevealWrapper: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const localFrame = useCurrentFrame()
  return <LogoReveal localFrame={localFrame} durationInFrames={durationInFrames} />
}

const FeatureCardWrapper: React.FC<{
  step: number
  totalSteps: number
  feature: (typeof features)[number]
  durationInFrames: number
}> = ({ step, totalSteps, feature, durationInFrames }) => {
  const localFrame = useCurrentFrame()
  return (
    <FeatureCard
      localFrame={localFrame}
      durationInFrames={durationInFrames}
      step={step}
      totalSteps={totalSteps}
      title={feature.title}
      subtitle={feature.subtitle}
      icon={feature.icon}
      tint={feature.tint}
      hint={feature.hint}
    />
  )
}

const OutroHintWrapper: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const localFrame = useCurrentFrame()
  return <OutroHint localFrame={localFrame} durationInFrames={durationInFrames} />
}

// ── Subtle animated dot grid background. Independent of scene frames. ──

const BackgroundDots: React.FC<{ frame: number }> = ({ frame }) => {
  const cols = 28
  const rows = 16
  const cellSize = 1280 / cols
  const dots: React.ReactNode[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x
      const phase = (frame / 30 + idx / 12) % (Math.PI * 2)
      const alpha = 0.04 + 0.06 * (Math.sin(phase) + 1) * 0.5
      dots.push(
        <circle
          key={idx}
          cx={x * cellSize + cellSize / 2}
          cy={y * cellSize + cellSize / 2}
          r={1.2}
          fill="#ffffff"
          opacity={alpha}
        />
      )
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={1280} height={720} viewBox="0 0 1280 720">{dots}</svg>
    </AbsoluteFill>
  )
}
