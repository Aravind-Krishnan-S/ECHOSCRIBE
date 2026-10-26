export type Role = 'therapist' | 'mentor' | 'both'
export type WorkspaceId = 'therapy' | 'mentoring'
export type ApiMode = 'Therapy' | 'Mentoring'

export interface Profile {
  user_id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  title: string | null
  organisation: string | null
  license_id: string | null
  specialisations: string[]
  phone: string | null
  preferred_contact: 'email' | 'phone' | 'either' | null
  role: Role
  prefs: Prefs
  onboarding: Onboarding
  model_settings: ModelSettings
}

export interface Prefs {
  default_workspace?: 'ask' | WorkspaceId
  default_language?: string
  auto_save?: boolean
  reduce_motion?: boolean
  compact?: boolean
}

export interface Onboarding {
  tour_completed?: boolean
  tour_dismissed?: boolean
  checklist_dismissed?: boolean
  viewed_note?: boolean
}

export type SlotId = 'STT' | 'DIARIZE' | 'ROLE_LABEL' | 'NOTE_SYNTH' | 'PROFILE_GEN'

export interface ComboTarget { family: string; model: string }
export interface ModelSettings {
  strategy?: string
  combos?: Partial<Record<SlotId, { strategy?: string; targets: ComboTarget[] }>>
}

export interface Patient {
  id: string
  name: string
  age: number | null
  gender: string | null
  notes: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export interface Turn { role: string; start: number; end: number; words?: number; text?: string; speaker?: string | number }

export interface Analysis {
  soap?: { subjective: string; objective: string; assessment: string; plan: string }
  grow?: { goal: string; reality: string; options: string; way_forward: string }
  risk_assessment?: {
    suicidal_ideation?: boolean
    self_harm_risk?: string
    academic_burnout?: boolean
    severe_distress_risk?: string
    notes?: string
  }
  auto_booking?: { needs_follow_up: boolean; suggested_timeframe: string; reason: string }
  referral_form?: { referral_needed: boolean; specialty_or_service: string; reason: string }
  patient_communication?: { instructions_english: string; instructions_translated: string }
  diagnostic_impressions?: string[]
  interventions_used?: string[]
  medication_changes?: string[]
  progress_indicators?: string[]
  skill_progression?: string[]
  action_items?: string[]
  goal_completion_rate?: string
  motivational_state?: string
  emotional_tone?: string
  topics?: string[]
  confidence_score?: number
  wordCount?: number
  counselingStats?: Record<string, string>
  _provider?: string
  conversation?: {
    turns: Turn[]
    providers?: { stt?: string | null; diarization?: string | null; roles?: string | null }
    durationSec?: number | null
  }
}

export interface Session {
  id: string
  created_at: string
  transcript: string
  summary: string | null
  analysis_json: Analysis
  patient_id: string | null
  audio_url: string | null
  session_mode: ApiMode
}

export interface ClientProfileInsights {
  journey_summary?: string
  recurring_themes?: string[]
  emotional_trend?: string
  emotional_trend_data?: { session: number; score: number; label?: string }[]
  risk_trend?: string
  risk_trend_data?: { session: number; level: string }[]
  topic_frequency?: { topic: string; count: number }[]
  persistent_challenges?: string
  recommended_focus?: string[]
  treatment_effectiveness_score?: number
  psychological_profile?: string
  _provider?: string
}

export interface ProviderFamily { key: string; label: string; capabilities: string[]; requiresKey: boolean }
export interface ServerSlot {
  label: string
  capability: string
  userConfigurable: boolean
  source: string
  strategy: string
  entries: { family: string; model: string; keyCount: number; activeKeys: number }[]
}
export interface ProvidersInfo {
  families: ProviderFamily[]
  strategies: Record<string, string>
  slots: Record<SlotId, ServerSlot>
}
export interface SyncedKey { id: string; family: string; label: string | null; last4: string; created_at: string }
