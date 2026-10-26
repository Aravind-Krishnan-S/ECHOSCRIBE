/* API keys kept only in this browser (the default). Keys the user chooses to
   "Sync to my account" live encrypted on the server instead (see api.ts / settings). */

const STORAGE_KEY = 'echoscribe_local_keys'

export interface LocalKey { id: string; family: string; key: string; label?: string; addedAt: string }

function read(): LocalKey[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function write(keys: LocalKey[]) {
  try {
    if (keys.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage blocked: keys last for this page only */ }
  window.dispatchEvent(new Event('echoscribe:keys'))
}

export const localKeys = {
  list: read,
  add(family: string, key: string, label?: string) {
    const entry: LocalKey = { id: crypto.randomUUID(), family, key: key.trim(), label, addedAt: new Date().toISOString() }
    write([...read(), entry])
    return entry
  },
  remove(id: string) {
    write(read().filter(k => k.id !== id))
  },
  clear() {
    write([])
  },
  /** Value for the X-Provider-Chain header: { keys: { family: [key, ...] } }, base64. */
  header(): string | null {
    const keys = read()
    if (!keys.length) return null
    const byFamily: Record<string, string[]> = {}
    for (const k of keys) (byFamily[k.family] = byFamily[k.family] || []).push(k.key)
    return btoa(unescape(encodeURIComponent(JSON.stringify({ keys: byFamily }))))
  },
}

export function maskKey(key: string) {
  return key.length <= 8 ? '••••' + key.slice(-2) : key.slice(0, 4) + '••••' + key.slice(-4)
}
