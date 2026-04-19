import { useEffect, useRef } from 'react'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import { PaletteResultRow, type PaletteResultItem } from './PaletteResultRow'

const ROW_HEIGHT = 56
const MAX_HEIGHT = 360

interface PaletteListProps {
  items: PaletteResultItem[]
  selectedIndex: number
  onSelect: (index: number) => void
  onActivate: (index: number) => void
}

export function PaletteList({ items, selectedIndex, onSelect, onActivate }: PaletteListProps) {
  const listRef = useRef<FixedSizeList>(null)

  useEffect(() => {
    listRef.current?.scrollToItem(selectedIndex, 'smart')
  }, [selectedIndex])

  if (items.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-zinc-500">
        No results
      </div>
    )
  }

  const listHeight = Math.min(MAX_HEIGHT, items.length * ROW_HEIGHT)

  const Row = ({ index, style }: ListChildComponentProps) => {
    const item = items[index]
    return (
      <div
        style={style}
        onMouseMove={() => {
          if (selectedIndex !== index) onSelect(index)
        }}
      >
        <PaletteResultRow
          item={item}
          selected={index === selectedIndex}
          quickIndex={index}
          onClick={() => onActivate(index)}
        />
      </div>
    )
  }

  return (
    <FixedSizeList
      ref={listRef}
      height={listHeight}
      itemCount={items.length}
      itemSize={ROW_HEIGHT}
      width="100%"
      className="palette-list"
    >
      {Row}
    </FixedSizeList>
  )
}
