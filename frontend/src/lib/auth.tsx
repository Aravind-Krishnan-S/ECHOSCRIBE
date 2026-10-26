import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, tokens, type SessionUser } from './api'
import type { Profile, Role } from './types'

interface AuthState {
  user: SessionUser | null
  profile: Profile | undefined
  profileLoading: boolean
  profileError: Error | null
  login: (email: string, password: string) => Promise<void>
  signup: (input: { email: string; password: string; full_name: string; role: Role }) => Promise<{ needsVerification: boolean }>
  logout: () => Promise<void>
  updateProfile: (patch: Partial<Profile>) => Promise<Profile>
}

const AuthContext = createContext<AuthState | null>(null)

interface AuthResponse {
  user: SessionUser | null
  session: { access_token: string; refresh_token: string } | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<SessionUser | null>(() => (tokens.access() ? tokens.user() : null))

  useEffect(() => {
    const onSignedOut = () => { setUser(null); qc.clear() }
    window.addEventListener('echoscribe:signed-out', onSignedOut)
    return () => window.removeEventListener('echoscribe:signed-out', onSignedOut)
  }, [qc])

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => api<Profile>('/api/auth/profile'),
    enabled: !!user,
    staleTime: 60_000,
  })

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<AuthResponse>('/api/auth/login', { method: 'POST', json: { email, password } })
    if (!data.session || !data.user) throw new Error('Login failed.')
    tokens.save(data.session, data.user)
    qc.clear()
    setUser(data.user)
  }, [qc])

  const signup = useCallback(async (input: { email: string; password: string; full_name: string; role: Role }) => {
    const data = await api<AuthResponse>('/api/auth/signup', { method: 'POST', json: input })
    if (data.session && data.user) {
      tokens.save(data.session, data.user)
      qc.clear()
      setUser(data.user)
      return { needsVerification: false }
    }
    return { needsVerification: true }
  }, [qc])

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* already signed out */ }
    tokens.clear()
    qc.clear()
    setUser(null)
  }, [qc])

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const next = await api<Profile>('/api/auth/profile', { method: 'PUT', json: patch })
    qc.setQueryData(['profile'], next)
    return next
  }, [qc])

  const value = useMemo<AuthState>(() => ({
    user,
    profile: profileQuery.data,
    profileLoading: !!user && profileQuery.isLoading,
    profileError: profileQuery.error as Error | null,
    login, signup, logout, updateProfile,
  }), [user, profileQuery.data, profileQuery.isLoading, profileQuery.error, login, signup, logout, updateProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
