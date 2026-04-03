import { ReactFlowProvider } from '@xyflow/react'
import Canvas from './components/Canvas'

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
