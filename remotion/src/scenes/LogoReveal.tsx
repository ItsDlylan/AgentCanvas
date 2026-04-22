import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { fontStack, theme } from '../theme'
import { SceneContainer } from './SceneContainer'

interface LogoRevealProps {
  localFrame: number
  durationInFrames: number
}

export const LogoReveal: React.FC<LogoRevealProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()

  const markScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.6 }
  })

  const wordmarkReveal = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 18, stiffness: 120 }
  })

  const taglineReveal = spring({
    frame: Math.max(0, localFrame - 18),
    fps,
    config: { damping: 20, stiffness: 120 }
  })

  const dotFloat = Math.sin(localFrame / 10) * 2

  return (
    <SceneContainer
      localFrame={localFrame}
      durationInFrames={durationInFrames}
      fadeInFrames={8}
      fadeOutFrames={16}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 30% 20%, rgba(59,130,246,0.18), transparent 55%), radial-gradient(circle at 80% 80%, rgba(139,92,246,0.14), transparent 55%), ${theme.bg}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          fontFamily: fontStack,
          color: theme.text
        }}
      >
        {/* The "?" mark */}
        <div
          style={{
            width: 148,
            height: 148,
            borderRadius: 999,
            background: `linear-gradient(135deg, ${theme.blue} 0%, #6366f1 100%)`,
            boxShadow: '0 18px 60px rgba(59,130,246,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${markScale}) translateY(${dotFloat}px)`,
            marginBottom: 40
          }}
        >
          <span
            style={{
              fontSize: 88,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
              fontFamily: fontStack
            }}
          >
            ?
          </span>
        </div>

        {/* Wordmark */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2,
            opacity: wordmarkReveal,
            transform: `translateY(${interpolate(wordmarkReveal, [0, 1], [12, 0])}px)`
          }}
        >
          AgentCanvas
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 12,
            fontSize: 22,
            color: theme.textMuted,
            opacity: taglineReveal,
            transform: `translateY(${interpolate(taglineReveal, [0, 1], [8, 0])}px)`
          }}
        >
          An infinite canvas for terminals, browsers, notes & tasks.
        </div>
      </AbsoluteFill>
    </SceneContainer>
  )
}
