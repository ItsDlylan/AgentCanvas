import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { SceneContainer } from './SceneContainer'

export type FeatureIcon = 'terminal' | 'browser' | 'note' | 'task'

interface FeatureCardProps {
  localFrame: number
  durationInFrames: number
  step: number
  totalSteps: number
  title: string
  subtitle: string
  icon: FeatureIcon
  tint: string
  hint?: string
}

const iconPaths: Record<FeatureIcon, React.ReactNode> = {
  terminal: (
    <>
      <path
        d="M30 44 L50 60 L30 76"
        stroke="currentColor"
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M58 78 L88 78" stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
    </>
  ),
  browser: (
    <>
      <rect x={20} y={30} width={80} height={60} rx={8} stroke="currentColor" strokeWidth={5} fill="none" />
      <path d="M20 46 L100 46" stroke="currentColor" strokeWidth={5} />
      <circle cx={32} cy={38} r={3} fill="currentColor" />
      <circle cx={44} cy={38} r={3} fill="currentColor" />
      <circle cx={56} cy={38} r={3} fill="currentColor" />
    </>
  ),
  note: (
    <>
      <path
        d="M30 22 H76 L90 36 V96 H30 Z"
        stroke="currentColor"
        strokeWidth={5}
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M76 22 V36 H90" stroke="currentColor" strokeWidth={5} fill="none" />
      <path d="M42 58 H78 M42 72 H78 M42 86 H66" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
    </>
  ),
  task: (
    <>
      <rect x={22} y={22} width={76} height={76} rx={12} stroke="currentColor" strokeWidth={5} fill="none" />
      <path
        d="M38 62 L52 76 L82 42"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  )
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
  localFrame,
  durationInFrames,
  step,
  totalSteps,
  title,
  subtitle,
  icon,
  tint,
  hint
}) => {
  const { fps } = useVideoConfig()

  const iconPop = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 130, mass: 0.5 }
  })

  const titleReveal = spring({
    frame: Math.max(0, localFrame - 6),
    fps,
    config: { damping: 18, stiffness: 120 }
  })

  const subtitleReveal = spring({
    frame: Math.max(0, localFrame - 12),
    fps,
    config: { damping: 22, stiffness: 110 }
  })

  const progressWidth = interpolate(step + 1, [0, totalSteps], [0, 100])

  return (
    <SceneContainer
      localFrame={localFrame}
      durationInFrames={durationInFrames}
      fadeInFrames={10}
      fadeOutFrames={10}
    >
      <AbsoluteFill
        style={{
          background: theme.bg,
          fontFamily: fontStack,
          color: theme.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 980,
            display: 'flex',
            alignItems: 'center',
            gap: 60
          }}
        >
          {/* Icon tile */}
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 24,
              background: `linear-gradient(135deg, ${tint}33 0%, ${theme.panel} 100%)`,
              border: `1px solid ${tint}55`,
              boxShadow: `0 20px 60px ${tint}22`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${iconPop})`,
              flexShrink: 0
            }}
          >
            <svg width={140} height={140} viewBox="0 0 120 120" style={{ color: tint }}>
              {iconPaths[icon]}
            </svg>
          </div>

          {/* Copy */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontFamily: monoStack,
                color: tint,
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginBottom: 14,
                opacity: titleReveal,
                transform: `translateY(${interpolate(titleReveal, [0, 1], [8, 0])}px)`
              }}
            >
              {String(step + 1).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: 60,
                fontWeight: 700,
                letterSpacing: -1.5,
                lineHeight: 1.05,
                opacity: titleReveal,
                transform: `translateY(${interpolate(titleReveal, [0, 1], [12, 0])}px)`
              }}
            >
              {title}
            </div>
            <div
              style={{
                marginTop: 20,
                fontSize: 24,
                lineHeight: 1.4,
                color: theme.textMuted,
                maxWidth: 640,
                opacity: subtitleReveal,
                transform: `translateY(${interpolate(subtitleReveal, [0, 1], [8, 0])}px)`
              }}
            >
              {subtitle}
            </div>
            {hint && (
              <div
                style={{
                  marginTop: 24,
                  fontSize: 14,
                  fontFamily: monoStack,
                  color: theme.textDim,
                  opacity: subtitleReveal
                }}
              >
                {hint}
              </div>
            )}
          </div>
        </div>

        {/* Step progress */}
        <div
          style={{
            position: 'absolute',
            left: 80,
            right: 80,
            bottom: 60,
            height: 3,
            background: theme.border,
            borderRadius: 999,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${progressWidth}%`,
              height: '100%',
              background: tint,
              boxShadow: `0 0 12px ${tint}`
            }}
          />
        </div>
      </AbsoluteFill>
    </SceneContainer>
  )
}
