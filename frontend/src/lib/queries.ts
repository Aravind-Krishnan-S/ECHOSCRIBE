import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { ApiMode, Patient, ProviderModels, ProvidersInfo, Session, SyncedKey } from './types'

export function usePatients(mode: ApiMode, enabled = true) {
  return useQuery({
    queryKey: ['patients', mode],
    queryFn: () => api<Patient[]>(`/api/patients?mode=${mode}`),
    enabled,
  })
}

export function useHistory(mode: ApiMode, enabled = true) {
  return useQuery({
    queryKey: ['history', mode],
    queryFn: () => api<Session[]>(`/api/history?mode=${mode}`),
    enabled,
  })
}

export function useSession(id: string | undefined, mode: ApiMode) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => api<Session>(`/api/session/${id}?mode=${mode}`),
    enabled: !!id,
  })
}

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => api<ProvidersInfo>('/api/providers'),
    staleTime: 30_000,
  })
}

/** Models one provider offers, with what each can do; keyed by the keys on hand so a new key refetches. */
export function useProviderModels(family: string | undefined, keyStamp: string) {
  return useQuery({
    queryKey: ['provider-models', family, keyStamp],
    queryFn: () => api<ProviderModels>(`/api/providers/models?family=${encodeURIComponent(family!)}`),
    enabled: !!family,
    staleTime: 5 * 60_000,
  })
}

export function useSyncedKeys() {
  return useQuery({
    queryKey: ['synced-keys'],
    queryFn: () => api<{ keys: SyncedKey[]; syncAvailable: boolean }>('/api/providers/keys'),
  })
}

/** Risk flagged by the model on a saved session (therapy or mentoring). */
export function isRiskFlagged(s: Pick<Session, 'analysis_json'>) {
  const r = s.analysis_json?.risk_assessment
  if (!r) return false
  return !!(r.suicidal_ideation || r.academic_burnout ||
    ['moderate', 'high'].includes(String(r.self_harm_risk || '').toLowerCase()) ||
    ['moderate', 'high'].includes(String(r.severe_distress_risk || '').toLowerCase()))
}
