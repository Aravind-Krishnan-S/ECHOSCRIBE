import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, BookOpen, ChevronsUpDown, Home, LogOut, Menu, Mic, Settings, SlidersHorizontal, User, Users, X } from 'lucide-react'
import { Avatar, Wordmark } from './ui'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/useWorkspace'
import { workspacesFor } from '../lib/workspace'
import { useTour } from '../tour/TourProvider'

/* The workspace is a product line: the rail is a solid field of its colour, the work sits on white paper.
   On a phone the rail becomes a 52px bar in the same colour and a full-screen menu. */
export function AppShell() {
  const ws = useWorkspace()
  const { profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div data-workspace={ws.id} className="min-h-dvh bg-ground">
      <aside className="field-accent hidden lg:flex fixed inset-y-0 left-0 w-[240px] flex-col px-3 pt-5 pb-4" aria-label="Main navigation">
        <SidebarContent />
      </aside>

      {/* phone / tablet bar */}
      <div className="field-accent lg:hidden sticky top-0 z-30 min-h-[52px] pt-[env(safe-area-inset-top)] pl-[max(8px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] flex items-center gap-2">
        <button className="btn btn-icon btn-sm text-on-accent hover:bg-white/10" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
        <Wordmark />
        <span className="ml-auto" />
        <Link to={`/w/${ws.id}/record`} className="btn btn-sm bg-white text-accent-ink" aria-label="New session"><Mic size={15} />New</Link>
        <Avatar name={profile?.full_name} src={profile?.avatar_url} size={28} />
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.div className="field-accent lg:hidden fixed inset-0 z-50 flex flex-col px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <div className="flex justify-end">
              <button className="btn btn-icon text-on-accent hover:bg-white/10" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
            </div>
            <SidebarContent />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="lg:ml-[240px] min-h-dvh bg-ground">
        <Outlet />
      </main>
    </div>
  )
}

function SidebarContent() {
  const ws = useWorkspace()
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const tour = useTour()
  const canSwitch = workspacesFor(profile?.role).length > 1
  const base = `/w/${ws.id}`

  const items: { to: string; label: string; icon: ReactNode; tour?: string; end?: boolean }[] = [
    { to: base, label: 'Home', icon: <Home size={16} />, end: true },
    { to: `${base}/clients`, label: ws.clients, icon: <Users size={16} />, tour: 'nav-clients' },
    { to: `${base}/record`, label: 'New session', icon: <Mic size={16} />, tour: 'nav-record' },
  ]

  return (
    <>
      <Link to={base} className="px-2 h-9 flex items-center"><Wordmark /></Link>

      {/* the product line: workspace name set large, its note format beneath */}
      <button
        type="button"
        data-tour="workspace-switcher"
        disabled={!canSwitch}
        onClick={() => navigate('/workspaces')}
        className="mt-6 mx-1 flex items-end gap-2 border-t border-white/25 pt-3 pb-1 text-left enabled:hover:opacity-90"
        aria-label={canSwitch ? `Workspace: ${ws.label}. Switch workspace` : `Workspace: ${ws.label}`}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[26px] leading-[30px] font-bold tracking-[-0.03em]">{ws.label}</span>
          <span className="block text-[12px] leading-4 text-on-accent-muted mt-1">{ws.note} notes</span>
        </span>
        {canSwitch && <ChevronsUpDown size={15} className="text-on-accent-muted mb-1" />}
      </button>

      <nav className="mt-6 flex flex-col gap-1">
        {items.map(it => (
          <NavLink key={it.to} to={it.to} end={it.end} className="nav-item" data-tour={it.tour}>
            {it.icon}{it.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <button type="button" className="nav-item text-left" onClick={() => tour.start()}><BookOpen size={16} />Show me around</button>
        {canSwitch && <NavLink to="/workspaces" className="nav-item"><ArrowLeftRight size={16} />Switch workspace</NavLink>}
        <NavLink to="/settings/models" className="nav-item" data-tour="nav-models"><SlidersHorizontal size={16} />Models & API keys</NavLink>
        <NavLink to="/settings/general" className="nav-item"><Settings size={16} />Settings</NavLink>
        <UserRow name={profile?.full_name || profile?.email || ''} email={profile?.email} avatar={profile?.avatar_url} title={profile?.title}
          onLogout={async () => { await logout(); navigate('/login') }} />
      </div>
    </>
  )
}

function UserRow({ name, email, avatar, title, onLogout }: { name: string; email?: string; avatar?: string | null; title?: string | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative mt-3 border-t border-white/25 pt-3">
      <button type="button" data-tour="user-menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-2 py-1.5 text-left hover:bg-white/10 transition-colors">
        <Avatar name={name} src={avatar} size={30} tone="neutral" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold leading-5 truncate" title={name}>{name}</span>
          <span className="block text-[12px] leading-4 text-on-accent-muted truncate">{title || email}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" className="layer absolute bottom-[calc(100%+6px)] left-0 right-0 rounded-[4px] p-1 z-40 text-ink"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 2 }} transition={{ duration: 0.14 }}>
            <Link role="menuitem" to="/settings/profile" className="menu-item" onClick={() => setOpen(false)}><User size={16} />Profile</Link>
            <Link role="menuitem" to="/settings/general" className="menu-item" onClick={() => setOpen(false)}><Settings size={16} />Settings</Link>
            <button role="menuitem" type="button" className="menu-item" onClick={onLogout}><LogOut size={16} />Log out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* Page header: title set large on the paper; a 1px ink rule appears once the page scrolls under it. */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`sticky top-[calc(52px+env(safe-area-inset-top))] lg:top-0 z-20 bg-ground transition-[border-color] duration-200 border-b ${stuck ? 'border-ink' : 'border-transparent'}`}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 sm:px-6 lg:px-10 pt-7 pb-4">
        <div className="min-w-0 flex-1">
          {back}
          <h1 className="text-[28px] sm:text-[32px] leading-[36px] font-bold tracking-[-0.03em] m-0 truncate">{title}</h1>
          {subtitle && <p className="text-muted m-0 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
