import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { GraduationCap, HeartPulse } from 'lucide-react'
import { Wordmark } from '../components/ui'
import { WorkspaceEntry } from '../components/Loading'
import { useAuth } from '../lib/auth'
import { firstName, relativeDay, plural } from '../lib/format'
import { useHistory, usePatients } from '../lib/queries'
import { rememberWorkspace } from '../lib/useWorkspace'
import { WORKSPACES, workspacesFor } from '../lib/workspace'
import type { WorkspaceId } from '../lib/types'

/* "Who's working today?" — profile-style picker for people with both roles. Each workspace is a
   square colour-field tile with its name and real counts beneath; choosing one opens it. */
export default function Workspaces() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [entering, setEntering] = useState<WorkspaceId | null>(null)
  const allowed = workspacesFor(profile?.role)
  if (allowed.length === 1) return <Navigate to={`/w/${allowed[0]}`} replace />

  function enter(id: WorkspaceId) {
    setEntering(id)
    rememberWorkspace(id)
    document.body.dataset.workspace = id
    setTimeout(() => navigate(`/w/${id}`), 950)
  }

  return (
    <div className="min-h-dvh bg-ground flex flex-col">
      <header className="px-6 sm:px-10 pt-6"><span className="text-accent"><Wordmark /></span></header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
        <h1 className="text-[30px] sm:text-[40px] leading-[1.1] font-bold tracking-[-0.03em] m-0 text-center">Who's working today, {firstName(profile?.full_name, profile?.email)}?</h1>
        <p className="text-muted m-0 mt-3 text-center">Therapy and Mentoring keep separate clients, sessions and notes.</p>
        <div className="flex flex-wrap justify-center gap-6 sm:gap-12 mt-10 sm:mt-12">
          {allowed.map((id, i) => <Tile key={id} id={id} index={i} onEnter={enter} dimmed={!!entering && entering !== id} zoom={entering === id} />)}
        </div>
      </main>
      <AnimatePresence>{entering && <WorkspaceEntry workspace={entering} name={profile?.full_name || undefined} />}</AnimatePresence>
    </div>
  )
}

/** "Today"/"Yesterday" read naturally in lower case mid-sentence; dates keep their capitals. */
function lastSessionText(iso: string) {
  const day = relativeDay(iso)
  return /^(today|yesterday)/i.test(day) ? day.toLowerCase() : day
}

function Tile({ id, index, onEnter, dimmed, zoom }: { id: WorkspaceId; index: number; onEnter: (id: WorkspaceId) => void; dimmed: boolean; zoom: boolean }) {
  const ws = WORKSPACES[id]
  const patients = usePatients(ws.api)
  const history = useHistory(ws.api)
  const Icon = id === 'therapy' ? HeartPulse : GraduationCap
  const last = history.data?.[0]
  return (
    <motion.button
      type="button"
      data-workspace={id}
      onClick={() => onEnter(id)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dimmed ? 0.35 : 1, y: 0, scale: zoom ? 1.06 : 1 }}
      transition={{ duration: 0.3, delay: zoom || dimmed ? 0 : 0.07 * index, ease: [0.16, 1, 0.3, 1] }}
      className="group w-[136px] sm:w-[184px] flex flex-col items-center text-center focus-visible:outline-none"
      aria-label={`Open ${ws.label}`}
    >
      <span className="field-accent w-full aspect-square rounded-[6px] flex items-center justify-center outline outline-[3px] outline-offset-[4px] outline-transparent transition-[outline-color,transform] duration-200 group-hover:outline-ink group-focus-visible:outline-ink group-hover:scale-[1.04] group-active:scale-[0.98]">
        <Icon className="w-12 h-12 sm:w-16 sm:h-16" strokeWidth={1.6} />
      </span>
      <span className="mt-3 sm:mt-4 text-[17px] sm:text-[20px] font-bold tracking-[-0.02em] text-muted group-hover:text-ink group-focus-visible:text-ink transition-colors">{ws.label}</span>
      <span className="mt-1 text-[12px] text-faint num">{patients.data ? plural(patients.data.length, ws.client.toLowerCase()) : '—'}</span>
      <span className="text-[12px] text-faint">{last ? `Last session ${lastSessionText(last.created_at)}` : history.data ? 'No sessions yet' : ''}</span>
    </motion.button>
  )
}
