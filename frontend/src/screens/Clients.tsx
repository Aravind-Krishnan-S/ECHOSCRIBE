import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Avatar, Dialog, EmptyState, ErrorState, Field, Skel, Spinner, useToast } from '../components/ui'
import { api } from '../lib/api'
import { relativeDay } from '../lib/format'
import { isRiskFlagged, useHistory, usePatients } from '../lib/queries'
import { useWorkspace } from '../lib/useWorkspace'
import type { Patient } from '../lib/types'

export default function Clients() {
  const navigate = useNavigate()
  const ws = useWorkspace()
  const patients = usePatients(ws.api)
  const history = useHistory(ws.api)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Patient | 'new' | null>(null)

  const stats = useMemo(() => {
    const m: Record<string, { count: number; last?: string; flagged: boolean }> = {}
    for (const s of history.data || []) {
      if (!s.patient_id) continue
      const e = (m[s.patient_id] ||= { count: 0, flagged: false })
      e.count++
      if (!e.last || s.created_at > e.last) e.last = s.created_at
      if (isRiskFlagged(s)) e.flagged = true
    }
    return m
  }, [history.data])

  const list = (patients.data || []).filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <>
      <PageHeader
        title={ws.clients}
        subtitle={patients.data ? `${patients.data.length} in ${ws.label}` : undefined}
        actions={<button className="btn btn-primary" data-tour="add-client" onClick={() => setEditing('new')}><Plus size={15} />Add {ws.client.toLowerCase()}</button>}
      />
      <div className="px-4 sm:px-6 lg:px-10 pt-2 pb-12 max-w-[1200px]">
        <label className="relative block max-w-[360px] mb-6">
          <span className="sr-only">Search {ws.clients.toLowerCase()}</span>
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-10" placeholder={`Search ${ws.clients.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} />
        </label>

        {patients.isLoading ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map(i => <Skel key={i} h={63} />)}</div> :
          patients.error ? <ErrorState message={`Couldn't load ${ws.clients.toLowerCase()}.`} onRetry={() => patients.refetch()} /> :
          list.length === 0 ? (
            <EmptyState action={!query && <button className="link" onClick={() => setEditing('new')}>Add the first one</button>}>
              {query ? `No ${ws.clients.toLowerCase()} match “${query}”.` : `No ${ws.clients.toLowerCase()} yet.`}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col" className="hidden sm:table-cell">Age · gender</th>
                    <th scope="col">Last session</th>
                    <th scope="col" className="text-right">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(p => {
                    const st = stats[p.id]
                    const href = `/w/${ws.id}/clients/${p.id}`
                    return (
                      <tr key={p.id} className="cursor-pointer" onClick={() => navigate(href)}>
                        <td>
                          <Link to={href} className="flex items-center gap-3 font-semibold hover:underline" onClick={e => e.stopPropagation()}>
                            <Avatar name={p.name} size={30} />
                            <span className="truncate">{p.name}</span>
                            {st?.flagged && <span className="pill pill-negative">Flag</span>}
                          </Link>
                        </td>
                        <td className="hidden sm:table-cell text-muted">{[p.age ? `${p.age}` : null, p.gender].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="text-muted whitespace-nowrap">{st?.last ? relativeDay(st.last) : 'No sessions yet'}</td>
                        <td className="text-right num font-semibold">{st?.count || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      <ClientDialog open={editing !== null} patient={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    </>
  )
}

export function ClientDialog({ open, patient, onClose }: { open: boolean; patient: Patient | null; onClose: () => void }) {
  const ws = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', age: '', gender: '', email: '', phone: '', notes: '' })
  const [lastId, setLastId] = useState<string | null | undefined>(undefined)
  if (open && lastId !== (patient?.id ?? null)) {
    setLastId(patient?.id ?? null)
    setForm({ name: patient?.name || '', age: patient?.age?.toString() || '', gender: patient?.gender || '', email: patient?.email || '', phone: patient?.phone || '', notes: patient?.notes || '' })
  }
  if (!open && lastId !== undefined) setLastId(undefined)

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), age: form.age ? Number(form.age) : null, gender: form.gender || null, email: form.email || null, phone: form.phone || null, notes: form.notes, mode: ws.api }
      return patient ? api(`/api/patients/${patient.id}`, { method: 'PUT', json: body }) : api('/api/patients', { method: 'POST', json: body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient'] })
      toast(patient ? 'Saved' : `${ws.client} added`, 'success')
      onClose()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const ageInvalid = form.age !== '' && (!/^\d+$/.test(form.age) || Number(form.age) > 150)

  return (
    <Dialog open={open} onClose={onClose} title={patient ? `Edit ${ws.client.toLowerCase()}` : `Add a ${ws.client.toLowerCase()}`}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!form.name.trim() || ageInvalid || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />}{patient ? 'Save' : 'Add'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" className="col-span-2">{p => <input {...p} className="input" value={form.name} onChange={set('name')} data-autofocus />}</Field>
        <Field label="Age" error={ageInvalid ? 'Use a whole number up to 150.' : undefined}>{p => <input {...p} className="input" inputMode="numeric" value={form.age} onChange={set('age')} />}</Field>
        <Field label="Gender">{p => <input {...p} className="input" value={form.gender} onChange={set('gender')} />}</Field>
        <Field label="Email" hint="Used to send take-home summaries.">{p => <input {...p} className="input" type="email" value={form.email} onChange={set('email')} />}</Field>
        <Field label="Phone">{p => <input {...p} className="input" type="tel" value={form.phone} onChange={set('phone')} />}</Field>
        <Field label="Notes" className="col-span-2">{p => <textarea {...p} className="input min-h-[80px]" value={form.notes} onChange={set('notes')} />}</Field>
      </div>
    </Dialog>
  )
}
