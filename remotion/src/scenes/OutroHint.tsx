import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { SceneContainer } from './SceneContainer'

interface OutroHintProps {
  localFrame: number
  durationInFrames: number
}

export const OutroHint: React.FC<OutroHintProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()

  const keyReveal = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 130 }
  })

  const copyReveal = spring({
    frame: Math.max(0, localFrame - 10),
    fps,
    config: { damping: 18, stiffness: 110 }
  })

  const shortcutPulse = 1 + Math.sin(localFrame / 6) * 0.02

  return (
    <SceneContainer
      localFrame={localFrame}
      durationInFrames={durationInFrames}
      fadeInFrames={12}
      fadeOutFrames={16}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(59,130,246,0.14), transparent 55%), ${theme.bg}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          fontFamily: fontStack,
          color: theme.text
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontFamily: monoStack,
            color: theme.textDim,
            textTransform: 'uppercase',
            letterSpacing: 3,
            opacity: copyReveal,
            marginBottom: 22
          }}
        >
          That's the canvas in a nutshell
        </div>

        <div
          style={{
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: -1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            opacity: copyReveal,
            transform: `translateY(${interpolate(copyReveal, [0, 1], [10, 0])}px)`
          }}
        >
          Press
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 84,
              height: 84,
              borderRadius: 18,
              background: `linear-gradient(135deg, ${theme.blue} 0%, #6366f1 100%)`,
              boxShadow: '0 14px 40px rgba(59,130,246,0.45)',
              color: '#fff',
              fontSize: 48,
              transform: `scale(${keyReveal * shortcutPulse})`
            }}
          >
            ?
          </span>
          anytime
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 20,
            color: theme.textMuted,
            opacity: copyReveal,
            transform: `translateY(${interpolate(copyReveal, [0, 1], [6, 0])}px)`
          }}
        >
          <span style={{ fontFamily: monoStack, color: theme.text }}>⌘⇧?</span>
          {' '}or the{' '}
          <span style={{ fontFamily: monoStack, color: theme.text }}>?</span>
          {' '}icon in the header opens the tutorials library.
        </div>
      </AbsoluteFill>
    </SceneContainer>
  )
}
