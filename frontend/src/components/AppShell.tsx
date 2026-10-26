import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, BookOpen, ChevronsUpDown, Home, LogOut, Menu, Mic, Settings, SlidersHorizontal, User, Users, X } from 'lucide-react'
import { Avatar, Wordmark } from './ui'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/useWorkspace'
import { workspacesFor } from '../lib/workspace'
import { useTour } from '../tour/TourProvider'

/* Tinted L-frame (sidebar on the chrome tint) with the work on a white sheet inset 8px.
   On a phone the frame disappears: a 48px glass bar and a full-screen menu sheet. */
export function AppShell() {
  const ws = useWorkspace()
  const { profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div data-workspace={ws.id} className="min-h-screen bg-chrome">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[228px] flex-col px-3 pt-4 pb-3" aria-label="Main navigation">
        <SidebarContent />
      </aside>

      {/* phone / tablet bar */}
      <div className="lg:hidden sticky top-0 z-30 glass !rounded-none !border-x-0 !border-t-0 h-12 flex items-center gap-2 px-2">
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
        <Wordmark />
        <span className="ml-auto" />
        <Link to={`/w/${ws.id}/record`} className="btn btn-accent btn-sm" aria-label="New session"><Mic size={15} /></Link>
        <Avatar name={profile?.full_name} src={profile?.avatar_url} size={28} />
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.div className="lg:hidden fixed inset-0 z-50 bg-chrome flex flex-col px-4 pt-3 pb-4"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div className="flex justify-end">
              <button className="btn btn-ghost btn-icon" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
            </div>
            <SidebarContent />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="lg:ml-[228px] lg:p-2 lg:pl-0 min-h-screen">
        <div className="lg:sheet min-h-[calc(100vh-16px)] bg-ground">
          <Outlet />
        </div>
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
      <Link to={base} className="px-2 h-9 flex items-center rounded-[10px]"><Wordmark /></Link>

      {/* workspace scope */}
      <button
        type="button"
        data-tour="workspace-switcher"
        disabled={!canSwitch}
        onClick={() => navigate('/workspaces')}
        className="mt-4 flex items-center gap-2.5 rounded-[12px] px-2 py-2 text-left enabled:hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] transition-colors"
        aria-label={canSwitch ? `Workspace: ${ws.label}. Switch workspace` : `Workspace: ${ws.label}`}
      >
        <span className="w-8 h-8 rounded-[10px] bg-accent-tint text-accent-ink flex items-center justify-center font-semibold">{ws.label[0]}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-5">{ws.label}</span>
          <span className="block text-[12px] leading-4 text-muted">{ws.note} notes</span>
        </span>
        {canSwitch && <ChevronsUpDown size={14} className="text-muted" />}
      </button>

      <nav className="mt-4 flex flex-col gap-0.5">
        {items.map(it => (
          <NavLink key={it.to} to={it.to} end={it.end} className="nav-item" data-tour={it.tour}>
            {it.icon}{it.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5">
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
    <div ref={ref} className="relative mt-2">
      <button type="button" data-tour="user-menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 rounded-[12px] px-2 py-2 text-left hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] transition-colors">
        <Avatar name={name} src={avatar} size={30} />
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-5 truncate">{name}</span>
          <span className="block text-[12px] leading-4 text-muted truncate">{title || email}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" className="glass absolute bottom-[calc(100%+6px)] left-0 right-0 rounded-[16px] p-1.5 z-40"
            initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16 }}>
            <Link role="menuitem" to="/settings/profile" className="nav-item" onClick={() => setOpen(false)}><User size={16} />Profile</Link>
            <Link role="menuitem" to="/settings/general" className="nav-item" onClick={() => setOpen(false)}><Settings size={16} />Settings</Link>
            <button role="menuitem" type="button" className="nav-item w-full text-left" onClick={onLogout}><LogOut size={16} />Log out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* Page header: title row inside the sheet; becomes a glass bar once the page scrolls under it. */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`sticky top-12 lg:top-2 z-20 transition-[background-color,box-shadow,backdrop-filter] duration-200 lg:rounded-t-[16px] ${stuck ? 'glass !rounded-none lg:!rounded-[16px] !border-x-0 lg:!border-x' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 lg:px-8 py-4">
        <div className="min-w-0 flex-1">
          {back}
          <h1 className="text-[22px] sm:text-[24px] leading-8 font-semibold tracking-[-0.01em] m-0 truncate">{title}</h1>
          {subtitle && <p className="text-muted m-0 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
