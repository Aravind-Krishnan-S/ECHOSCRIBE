import { motion } from 'motion/react'
import { WORKSPACES } from '../lib/workspace'
import type { WorkspaceId } from '../lib/types'

/* Boot splash: the mark's two echoes draw outward from the voice, on a loop until the app is ready. */
export function BootSplash({ label = 'Opening EchoScribe' }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-ground text-accent" role="status" aria-label={label}>
      <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden>
        <motion.rect x="5.5" y="12.5" width="7" height="7" fill="currentColor"
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} />
        {[{ d: 'M16 8.5a10 10 0 0 1 0 15', o: 1, delay: 0.15 }, { d: 'M22 4.5a15.5 15.5 0 0 1 0 23', o: 0.55, delay: 0.3 }].map(arc => (
          <motion.path key={arc.d} d={arc.d} fill="none" stroke="currentColor" strokeWidth="3"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1, 1], opacity: [0, arc.o, 0] }}
            transition={{ duration: 1.6, delay: arc.delay, repeat: Infinity, ease: 'easeOut', times: [0, 0.45, 1] }} />
        ))}
      </svg>
      <span className="text-muted text-[13px]">{label}</span>
    </div>
  )
}

/* Workspace entry: a quiet paper screen; the product line's tile settles in the centre while its data loads. */
export function WorkspaceEntry({ workspace, name }: { workspace: WorkspaceId; name?: string }) {
  const ws = WORKSPACES[workspace]
  return (
    <motion.div data-workspace={workspace}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ground"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
      role="status" aria-label={`Opening ${ws.label}`}>
      <motion.span className="field-accent w-[96px] h-[96px] rounded-[6px]"
        initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
      <motion.p className="text-[32px] leading-none font-bold tracking-[-0.03em] m-0 mt-2"
        initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
        {ws.label}
      </motion.p>
      <motion.p className="text-muted m-0 text-[14px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
        {name ? `${name} · ` : ''}{ws.clients} and sessions
      </motion.p>
    </motion.div>
  )
}
