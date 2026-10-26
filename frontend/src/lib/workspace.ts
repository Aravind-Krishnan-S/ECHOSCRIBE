import type { ApiMode, Role, WorkspaceId } from './types'

export interface WorkspaceDef {
  id: WorkspaceId
  api: ApiMode
  label: string
  professional: string
  client: string
  clients: string
  note: string
  noteName: string
  sections: { key: string; letter: string; title: string; hint: string }[]
  riskLabel: string
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  therapy: {
    id: 'therapy',
    api: 'Therapy',
    label: 'Therapy',
    professional: 'Therapist',
    client: 'Patient',
    clients: 'Patients',
    note: 'SOAP',
    noteName: 'SOAP note',
    sections: [
      { key: 'subjective', letter: 'S', title: 'Subjective', hint: 'What the patient reports, in their own words' },
      { key: 'objective', letter: 'O', title: 'Objective', hint: 'Observable affect, speech and behaviour' },
      { key: 'assessment', letter: 'A', title: 'Assessment', hint: 'Clinical impression and reasoning' },
      { key: 'plan', letter: 'P', title: 'Plan', hint: 'Next steps, interventions and follow-up' },
    ],
    riskLabel: 'Risk screen',
  },
  mentoring: {
    id: 'mentoring',
    api: 'Mentoring',
    label: 'Mentoring',
    professional: 'Mentor',
    client: 'Mentee',
    clients: 'Mentees',
    note: 'GROW',
    noteName: 'GROW note',
    sections: [
      { key: 'goal', letter: 'G', title: 'Goal', hint: 'What the mentee wants to achieve' },
      { key: 'reality', letter: 'R', title: 'Reality', hint: 'Where things stand now' },
      { key: 'options', letter: 'O', title: 'Options', hint: 'Pathways considered' },
      { key: 'way_forward', letter: 'W', title: 'Way forward', hint: 'What the mentee committed to' },
    ],
    riskLabel: 'Wellbeing screen',
  },
}

export function workspacesFor(role: Role | undefined): WorkspaceId[] {
  if (role === 'mentor') return ['mentoring']
  if (role === 'both') return ['therapy', 'mentoring']
  return ['therapy']
}

export function isWorkspace(value: string | undefined): value is WorkspaceId {
  return value === 'therapy' || value === 'mentoring'
}

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'ta', label: 'Tamil' },
  { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
]
