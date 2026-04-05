import { createContext, useContext } from 'react'

interface FocusedTerminalContextValue {
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  killTerminal: (id: string) => void
  killHighlight: boolean
}

export const FocusedTerminalContext = createContext<FocusedTerminalContextValue>({
  focusedId: null,
  setFocusedId: () => {},
  killTerminal: () => {},
  killHighlight: false
})

export function useFocusedTerminal() {
  return useContext(FocusedTerminalContext)
}
