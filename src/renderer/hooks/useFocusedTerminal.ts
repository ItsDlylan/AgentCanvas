import { createContext, useContext } from 'react'

interface FocusedTerminalContextValue {
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  killTerminal: (id: string) => void
}

export const FocusedTerminalContext = createContext<FocusedTerminalContextValue>({
  focusedId: null,
  setFocusedId: () => {},
  killTerminal: () => {}
})

export function useFocusedTerminal() {
  return useContext(FocusedTerminalContext)
}
