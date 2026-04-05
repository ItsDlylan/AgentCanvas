import { ReactFlowProvider } from '@xyflow/react'
import Canvas from './components/Canvas'
import { SettingsProvider } from './hooks/useSettings'

export default function App() {
  return (
    <SettingsProvider>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </SettingsProvider>
  )
}
