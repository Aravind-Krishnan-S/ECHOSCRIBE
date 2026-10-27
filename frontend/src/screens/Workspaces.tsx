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
    <div className="min-h-screen bg-chrome flex flex-col">
      <header className="px-6 py-5"><Wordmark /></header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
        <h1 className="serif text-[34px] sm:text-[40px] leading-[1.1] m-0 text-center">Who's working today, {firstName(profile?.full_name, profile?.email)}?</h1>
        <p className="text-muted mt-3 mb-10 text-center">Therapy and Mentoring keep separate clients, sessions and notes.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-[720px]">
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: dimmed ? 0.35 : 1, y: 0, scale: zoom ? 1.06 : 1 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.35, delay: zoom || dimmed ? 0 : 0.08 * index, ease: [0.22, 1, 0.36, 1] }}
      className="panel !p-6 text-left flex flex-col gap-5 min-h-[230px] hover:!bg-raised focus-visible:outline-2"
      aria-label={`Open ${ws.label}`}
    >
      <span className="w-14 h-14 rounded-[18px] bg-accent-tint text-accent flex items-center justify-center"><Icon size={26} /></span>
      <span className="flex-1">
        <span className="block serif text-[30px] leading-9">{ws.label}</span>
        <span className="block text-muted mt-1">{ws.noteName}s with {ws.clients.toLowerCase()}</span>
      </span>
      <span className="flex items-center justify-between gap-3 text-[13px] text-muted border-t border-border pt-4">
        <span className="num">{patients.data ? plural(patients.data.length, ws.client.toLowerCase()) : '—'}</span>
        <span className="truncate">{last ? `Last session ${relativeDay(last.created_at).toLowerCase()}` : history.data ? 'No sessions yet' : '—'}</span>
      </span>
    </motion.button>
  )
}
