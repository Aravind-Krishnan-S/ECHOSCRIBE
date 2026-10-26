/* API client: bearer token with one refresh retry on 401, the user's browser-local
   provider keys in X-Provider-Chain, and errors that keep the server's structured details. */

import { localKeys } from './keys'

const TOKEN_KEY = 'echoscribe_token'
const REFRESH_KEY = 'echoscribe_refresh_token'
const USER_KEY = 'echoscribe_user'

export interface SessionUser { id: string; email: string }

export class ApiError extends Error {
  status: number
  attempts?: { provider: string; outcome: string; error?: string }[]
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message)
    this.status = status
    if (body && Array.isArray(body.attempts)) this.attempts = body.attempts as ApiError['attempts']
  }
}

function safeGet(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* ignore */ }
}

export const tokens = {
  access: () => safeGet(TOKEN_KEY),
  refresh: () => safeGet(REFRESH_KEY),
  user(): SessionUser | null {
    try { return JSON.parse(safeGet(USER_KEY) || 'null') } catch { return null }
  },
  save(session: { access_token: string; refresh_token: string }, user?: SessionUser) {
    safeSet(TOKEN_KEY, session.access_token)
    safeSet(REFRESH_KEY, session.refresh_token)
    if (user) safeSet(USER_KEY, JSON.stringify(user))
  },
  clear() {
    safeSet(TOKEN_KEY, null)
    safeSet(REFRESH_KEY, null)
    safeSet(USER_KEY, null)
  },
}

let refreshing: Promise<boolean> | null = null
async function refreshSession(): Promise<boolean> {
  const refresh_token = tokens.refresh()
  if (!refresh_token) return false
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  })
    .then(async r => {
      if (!r.ok) return false
      const data = await r.json()
      tokens.save(data.session)
      return true
    })
    .catch(() => false)
    .finally(() => { refreshing = null })
  return refreshing
}

function buildHeaders(init: RequestInit) {
  const headers = new Headers(init.headers)
  const access = tokens.access()
  if (access) headers.set('Authorization', `Bearer ${access}`)
  const chain = localKeys.header()
  if (chain) headers.set('X-Provider-Chain', chain)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

async function toError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {}
  try { body = await res.json() } catch { /* not JSON */ }
  const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`
  return new ApiError(message, res.status, body)
}

/** fetch() with auth; resolves to the Response (for blobs) or throws ApiError. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await fetch(path, { ...init, headers: buildHeaders(init) })
  if (res.status === 401 && tokens.refresh()) {
    if (await refreshSession()) res = await fetch(path, { ...init, headers: buildHeaders(init) })
  }
  if (res.status === 401) {
    tokens.clear()
    window.dispatchEvent(new Event('echoscribe:signed-out'))
  }
  if (!res.ok) throw await toError(res)
  return res
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await apiFetch(path, json !== undefined ? { ...rest, body: JSON.stringify(json) } : rest)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Multipart POST with real upload progress (fetch cannot report it). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  const send = () => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    const access = tokens.access()
    if (access) xhr.setRequestHeader('Authorization', `Bearer ${access}`)
    const chain = localKeys.header()
    if (chain) xhr.setRequestHeader('X-Provider-Chain', chain)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.upload.onload = () => onProgress(1)
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    xhr.onerror = () => reject(new ApiError('Network error: the server could not be reached.', 0))
    xhr.send(form)
  })

  return (async () => {
    let r = await send()
    if (r.status === 401 && (await refreshSession())) r = await send()
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(r.body) } catch { /* not JSON */ }
    if (r.status < 200 || r.status >= 300) {
      throw new ApiError(typeof body.error === 'string' ? body.error : `Request failed (${r.status})`, r.status, body)
    }
    return body as T
  })()
}

/** Download an authenticated file (PDF, CSV) through a temporary object URL. */
export async function download(path: string, filename: string) {
  const res = await apiFetch(path)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
