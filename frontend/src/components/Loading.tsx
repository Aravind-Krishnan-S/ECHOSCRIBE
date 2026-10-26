import { motion } from 'motion/react'
import { WORKSPACES } from '../lib/workspace'
import type { WorkspaceId } from '../lib/types'

/* Boot splash: the mark's two echoes draw outward from the voice, on a loop until the app is ready. */
export function BootSplash({ label = 'Opening EchoScribe' }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-chrome" role="status" aria-label={label}>
      <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden>
        <motion.circle cx="9" cy="16" r="3.2" fill="var(--accent)"
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
        {[{ d: 'M15 9.5a9 9 0 0 1 0 13', o: 1, delay: 0.15 }, { d: 'M21 5.5a14.5 14.5 0 0 1 0 21', o: 0.55, delay: 0.3 }].map(arc => (
          <motion.path key={arc.d} d={arc.d} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1, 1], opacity: [0, arc.o, 0] }}
            transition={{ duration: 1.6, delay: arc.delay, repeat: Infinity, ease: 'easeOut', times: [0, 0.45, 1] }} />
        ))}
      </svg>
      <span className="text-muted text-[13px]">{label}</span>
    </div>
  )
}

/* Workspace entry: the chosen workspace's colour fills the screen while its data loads. */
export function WorkspaceEntry({ workspace, name }: { workspace: WorkspaceId; name?: string }) {
  const ws = WORKSPACES[workspace]
  return (
    <motion.div data-workspace={workspace}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-chrome"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
      role="status" aria-label={`Opening ${ws.label}`}>
      <motion.div className="w-[88px] h-[88px] rounded-[26px] bg-accent-tint flex items-center justify-center"
        initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden>
          <circle cx="9" cy="16" r="3.2" fill="var(--accent)" />
          <motion.path d="M15 9.5a9 9 0 0 1 0 13" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.2 }} />
          <motion.path d="M21 5.5a14.5 14.5 0 0 1 0 21" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" opacity=".55"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.35 }} />
        </svg>
      </motion.div>
      <motion.p className="serif text-[30px] leading-9 m-0 mt-2" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.4 }}>
        {ws.label}
      </motion.p>
      <motion.p className="text-muted m-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        {name ? `${name} · ` : ''}{ws.clients} and sessions
      </motion.p>
    </motion.div>
  )
}
