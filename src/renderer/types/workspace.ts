export interface Workspace {
  id: string
  name: string
  path: string | null
  isDefault: boolean
  createdAt: number
}

export const DEFAULT_WORKSPACE: Workspace = {
  id: 'default',
  name: 'AgentCanvas',
  path: null,
  isDefault: true,
  createdAt: 0
}
