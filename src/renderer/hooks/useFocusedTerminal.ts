import { createContext, useContext } from 'react'

interface FocusedTerminalContextValue {
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  killTerminal: (id: string) => void
  killHighlight: boolean
  toggleDiffViewer: (id: string) => void
  hasDiffViewer: (id: string) => boolean
  toggleDevTools: (id: string) => void
  hasDevTools: (id: string) => boolean
}

export const FocusedTerminalContext = createContext<FocusedTerminalContextValue>({
  focusedId: null,
  setFocusedId: () => {},
  killTerminal: () => {},
  killHighlight: false,
  toggleDiffViewer: () => {},
  hasDiffViewer: () => false,
  toggleDevTools: () => {},
  hasDevTools: () => false
})

export function useFocusedTerminal() {
  return useContext(FocusedTerminalContext)
}
