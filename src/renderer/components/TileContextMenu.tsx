import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface TileContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export interface TileContextMenuProps {
  x: number
  y: number
  items: TileContextMenuItem[]
  onClose: () => void
}

export function TileContextMenu({ x, y, items, onClose }: TileContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Render into document.body to escape ReactFlow's transformed viewport —
  // position: fixed is relative to transformed ancestors, which breaks placement.
  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        background: '#1f2024',
        border: '1px solid #3a3b42',
        borderRadius: 6,
        padding: 4,
        minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontSize: 13,
        color: '#e6e7ea'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} style={{ height: 1, background: '#3a3b42', margin: '4px 0' }} />
        ) : (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick()
                onClose()
              }
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              color: item.disabled ? '#6a6b72' : item.danger ? '#ff6b6b' : '#e6e7ea',
              cursor: item.disabled ? 'default' : 'pointer',
              borderRadius: 4,
              fontSize: 13
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = '#2a2b32'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
