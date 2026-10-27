import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { SettingsSection } from './SettingsLayout'
import { Avatar, Field, Spinner, useToast } from '../../components/ui'
import { api, apiFetch } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Profile, Role } from '../../lib/types'

const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: 'therapist', label: 'Therapist', hint: 'Therapy workspace only' },
  { id: 'mentor', label: 'Mentor', hint: 'Mentoring workspace only' },
  { id: 'both', label: 'Both', hint: 'Both workspaces, chosen at sign-in' },
]

export default function ProfileSettings() {
  const { profile, updateProfile } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(() => toForm(profile))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  useEffect(() => setForm(toForm(profile)), [profile])
  if (!profile) return null

  const set = (k: keyof ReturnType<typeof toForm>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(profile))

  async function save() {
    setSaving(true)
    try {
      await updateProfile({
        full_name: form.full_name.trim(),
        title: form.title.trim() || null,
        organisation: form.organisation.trim() || null,
        license_id: form.license_id.trim() || null,
        specialisations: form.specialisations.split(',').map(s => s.trim()).filter(Boolean),
        phone: form.phone.trim() || null,
        preferred_contact: (form.preferred_contact || null) as Profile['preferred_contact'],
        role: form.role as Role,
      })
      toast('Profile saved', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { toast('Choose an image under 4 MB.', 'error'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('photo', file)
      const res = await apiFetch('/api/auth/avatar', { method: 'POST', body: form })
      qc.setQueryData(['profile'], await res.json())
      toast('Photo updated', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function changePassword() {
    setPwSaving(true)
    try {
      await api('/api/auth/password', { method: 'POST', json: { current_password: pw.current, new_password: pw.next } })
      setPw({ current: '', next: '', confirm: '' })
      toast('Password changed', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setPwSaving(false)
    }
  }

  const pwMismatch = pw.confirm.length > 0 && pw.next !== pw.confirm

  return (
    <div>
      <h1 className="m-0 mb-6 text-[24px] font-semibold">Profile</h1>

      <SettingsSection title="Photo and name" description="Shown in the app and on PDF exports.">
        <div className="flex items-center gap-4 mb-5">
          <Avatar name={form.full_name} src={profile.avatar_url} size={64} />
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Spinner /> : <Camera size={14} />}Change photo</button>
            <p className="m-0 mt-1.5 text-[12px] text-muted">PNG, JPEG or WebP, up to 4 MB.</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => uploadPhoto(e.target.files?.[0])} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" error={!form.full_name.trim() ? 'Your name is required.' : undefined}>{p => <input {...p} className="input" value={form.full_name} onChange={set('full_name')} />}</Field>
          <Field label="Email" hint="Used to sign in; it cannot be changed here.">{p => <input {...p} className="input" value={profile.email} readOnly />}</Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Professional details" description="Appear on exported notes.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Title">{p => <input {...p} className="input" placeholder="e.g. Clinical psychologist" value={form.title} onChange={set('title')} />}</Field>
          <Field label="Organisation or department">{p => <input {...p} className="input" value={form.organisation} onChange={set('organisation')} />}</Field>
          <Field label="Licence or staff ID">{p => <input {...p} className="input" value={form.license_id} onChange={set('license_id')} />}</Field>
          <Field label="Specialisations" hint="Separate with commas.">{p => <input {...p} className="input" value={form.specialisations} onChange={set('specialisations')} />}</Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Contact" description="How clients and colleagues reach you.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone">{p => <input {...p} className="input" type="tel" value={form.phone} onChange={set('phone')} />}</Field>
          <Field label="Preferred contact">
            {p => (
              <select {...p} className="input" value={form.preferred_contact} onChange={set('preferred_contact')}>
                <option value="">Not set</option><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option>
              </select>
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Role" description="Decides which workspaces you see. Switching away hides a workspace but keeps its data.">
        <div role="radiogroup" aria-label="Role" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {ROLES.map(r => (
            <label key={r.id} className={`flex flex-col gap-0.5 rounded-[12px] border p-3 cursor-pointer transition-colors ${form.role === r.id ? 'border-accent bg-accent-tint' : 'border-border bg-raised hover:border-control'}`}>
              <input type="radio" name="role" value={r.id} checked={form.role === r.id} onChange={set('role')} className="sr-only" />
              <span className="font-medium">{r.label}</span>
              <span className="text-[12px] text-muted">{r.hint}</span>
            </label>
          ))}
        </div>
      </SettingsSection>

      <div className="flex justify-end gap-2 py-4 sticky bottom-0">
        <button className="btn btn-secondary" disabled={!dirty || saving} onClick={() => setForm(toForm(profile))}>Discard</button>
        <button className="btn btn-primary" disabled={!dirty || saving || !form.full_name.trim()} onClick={save}>{saving && <Spinner />}Save changes</button>
      </div>

      <SettingsSection title="Password" description="At least 8 characters.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Current password">{p => <input {...p} className="input" type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(s => ({ ...s, current: e.target.value }))} />}</Field>
          <Field label="New password">{p => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(s => ({ ...s, next: e.target.value }))} />}</Field>
          <Field label="Confirm new password" error={pwMismatch ? 'Passwords do not match.' : undefined}>{p => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(s => ({ ...s, confirm: e.target.value }))} />}</Field>
        </div>
        <div className="flex justify-end mt-4">
          <button className="btn btn-secondary" disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm || pwSaving} onClick={changePassword}>{pwSaving && <Spinner />}Change password</button>
        </div>
      </SettingsSection>
    </div>
  )
}

function toForm(p: Profile | undefined) {
  return {
    full_name: p?.full_name || '',
    title: p?.title || '',
    organisation: p?.organisation || '',
    license_id: p?.license_id || '',
    specialisations: (p?.specialisations || []).join(', '),
    phone: p?.phone || '',
    preferred_contact: p?.preferred_contact || '',
    role: p?.role || 'therapist',
  }
}
