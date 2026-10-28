import { NavLink, Outlet } from 'react-router-dom'
import { Settings, SlidersHorizontal, User } from 'lucide-react'

export default function SettingsLayout() {
  return (
    <div className="px-4 sm:px-6 lg:px-10 py-7 lg:py-10 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 max-w-[1240px]">
      <nav aria-label="Settings" className="flex md:flex-col gap-0.5 overflow-x-auto md:border-t-2 md:border-ink md:pt-2 self-start">
        <NavLink to="/settings/profile" className="subnav-item whitespace-nowrap"><User size={16} />Profile</NavLink>
        <NavLink to="/settings/models" className="subnav-item whitespace-nowrap"><SlidersHorizontal size={16} />Models & API keys</NavLink>
        <NavLink to="/settings/general" className="subnav-item whitespace-nowrap"><Settings size={16} />General</NavLink>
      </nav>
      <div className="min-w-0"><Outlet /></div>
    </div>
  )
}

/* A settings section: title and description beside (or above, on narrow screens) its panel. */
export function SettingsSection({ title, description, children, id }: { title: string; description?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="grid grid-cols-1 xl:grid-cols-[240px_1fr] gap-x-8 gap-y-3 py-8 border-b border-border last:border-b-0 first:pt-0">
      <div>
        <h2 className="m-0 text-[16px] leading-6 font-bold">{title}</h2>
        {description && <p className="m-0 mt-1 text-[14px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="panel !rounded-[6px] min-w-0">{children}</div>
    </section>
  )
}
