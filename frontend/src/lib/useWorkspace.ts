import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { WORKSPACES, isWorkspace } from './workspace'
import type { WorkspaceId } from './types'

const LAST_KEY = 'echoscribe_workspace'

export function lastWorkspace(): WorkspaceId | null {
  try {
    const v = localStorage.getItem(LAST_KEY) || undefined
    return isWorkspace(v) ? v : null
  } catch { return null }
}

export function rememberWorkspace(id: WorkspaceId) {
  try { localStorage.setItem(LAST_KEY, id) } catch { /* ignore */ }
}

/** The workspace in the URL (/w/:mode/...), else the last one used (settings pages). */
export function useWorkspace(fallback: WorkspaceId = 'therapy') {
  const { mode } = useParams()
  const id: WorkspaceId = isWorkspace(mode) ? mode : lastWorkspace() || fallback
  useEffect(() => {
    document.body.dataset.workspace = id
    if (isWorkspace(mode)) rememberWorkspace(id)
  }, [id, mode])
  return WORKSPACES[id]
}
