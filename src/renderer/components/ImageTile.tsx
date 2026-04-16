import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { useCanvasStore } from '@/store/canvas-store'
import { EditableLabel } from './EditableLabel'

export interface ImageNodeData {
  sessionId: string
  label: string
  imagePath: string
  onDelete?: (sessionId: string) => void
}

function ImageTileComponent({ data }: NodeProps) {
  const { sessionId, label, imagePath, onDelete } = data as unknown as ImageNodeData
  const focusedId = useCanvasStore((s) => s.focusedId)
  const setFocusedId = useCanvasStore((s) => s.setFocusedId)
  const renameTile = useCanvasStore((s) => s.renameTile)
  const isFocused = focusedId === sessionId
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  // Build file:// URL for the stored image
  const [imgSrc, setImgSrc] = useState('')
  useEffect(() => {
    if (imagePath) {
      window.image.getUrl(sessionId).then((url) => {
        if (url) setImgSrc(url)
      })
    }
  }, [sessionId, imagePath])

  return (
    <div
      className={`image-tile ${isFocused ? 'ring-1 ring-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : ''}`}
      style={{ width: '100%', height: '100%' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={200}
        minHeight={160}
        isVisible={isFocused}
        color="#06b6d4"
      />

      {/* Header */}
      <div className={`image-tile-header ${isFocused ? 'border-b-cyan-500/30' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-cyan-400' : 'bg-cyan-600'}`} />
          <EditableLabel
            label={label}
            onRename={(newLabel) => renameTile(sessionId, newLabel)}
            className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
          />
        </div>
        <button
          className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => onDelete?.(sessionId)}
        >
          Close
        </button>
      </div>

      {/* Image body */}
      <div className="image-tile-body">
        {imgSrc ? (
          <img
            ref={imgRef}
            src={imgSrc}
            alt={label}
            onLoad={() => setLoaded(true)}
            className={`w-full h-full object-contain select-none ${loaded ? 'opacity-100' : 'opacity-0'}`}
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-zinc-600">
            Loading...
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const ImageTile = memo(ImageTileComponent)
