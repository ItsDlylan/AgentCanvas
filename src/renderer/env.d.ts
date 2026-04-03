/// <reference types="vite/client" />

import type { TerminalAPI } from '../preload/index'

declare global {
  interface Window {
    terminal: TerminalAPI
  }
}
