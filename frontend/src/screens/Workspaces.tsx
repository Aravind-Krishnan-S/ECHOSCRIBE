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

/* "Who's working today?" — shown to people with both roles. Each tile carries its workspace's
   colour and its real counts; choosing one zooms into it and opens the workspace. */
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
    <div className="min-h-screen bg-ground flex flex-col">
      <header className="px-6 sm:px-10 pt-6 pb-8 flex flex-wrap items-end justify-between gap-4 border-b border-ink">
        <div>
          <span className="text-accent"><Wordmark /></span>
          <h1 className="text-[32px] sm:text-[44px] leading-[1.05] font-bold tracking-[-0.035em] m-0 mt-8">Who's working today, {firstName(profile?.full_name, profile?.email)}?</h1>
        </div>
        <p className="text-muted m-0 max-w-[340px]">Therapy and Mentoring keep separate clients, sessions and notes.</p>
      </header>
      <main className="flex-1 flex">
        <div className="grid grid-cols-1 sm:grid-cols-2 w-full">
          {allowed.map((id, i) => <Tile key={id} id={id} index={i} onEnter={enter} dimmed={!!entering && entering !== id} zoom={entering === id} />)}
        </div>
      </main>
      <AnimatePresence>{entering && <WorkspaceEntry workspace={entering} name={profile?.full_name || undefined} />}</AnimatePresence>
    </div>
  )
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
      initial={{ opacity: 0 }}
      animate={{ opacity: dimmed ? 0.4 : 1 }}
      transition={{ duration: 0.3, delay: zoom || dimmed ? 0 : 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
      className="field-accent group text-left flex flex-col justify-between gap-10 p-8 sm:p-10 min-h-[340px] hover:bg-accent-ink transition-colors focus-visible:outline-offset-[-6px]"
      aria-label={`Open ${ws.label}`}
    >
      <Icon size={36} strokeWidth={2} />
      <span>
        <span className="block text-[44px] sm:text-[56px] leading-none font-bold tracking-[-0.04em]">{ws.label}</span>
        <span className="block text-on-accent-muted mt-3 text-[15px]">{ws.noteName}s with {ws.clients.toLowerCase()}</span>
      </span>
      <span className="flex items-center justify-between gap-3 text-[13px] text-on-accent-muted border-t border-white/30 pt-4">
        <span className="num">{patients.data ? plural(patients.data.length, ws.client.toLowerCase()) : '—'}</span>
        <span className="truncate">{last ? `Last session ${relativeDay(last.created_at).toLowerCase()}` : history.data ? 'No sessions yet' : '—'}</span>
      </span>
    </motion.button>
  )
}
