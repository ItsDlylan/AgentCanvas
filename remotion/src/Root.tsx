import { Composition } from 'remotion'
import { Welcome, WELCOME_DURATION_FRAMES, WELCOME_FPS } from './Welcome'

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Welcome"
        component={Welcome}
        durationInFrames={WELCOME_DURATION_FRAMES}
        fps={WELCOME_FPS}
        width={1280}
        height={720}
      />
    </>
  )
}
