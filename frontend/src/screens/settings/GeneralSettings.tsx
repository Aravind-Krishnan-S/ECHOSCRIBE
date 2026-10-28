import { useState } from 'react'
import { SettingsSection } from './SettingsLayout'
import { Dialog, Switch, useToast } from '../../components/ui'
import { download } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { localKeys } from '../../lib/keys'
import { useTour } from '../../tour/TourProvider'
import { LANGUAGES, WORKSPACES, workspacesFor } from '../../lib/workspace'
import type { Prefs } from '../../lib/types'

export default function GeneralSettings() {
  const { profile, updateProfile } = useAuth()
  const toast = useToast()
  const tour = useTour()
  const [confirmClear, setConfirmClear] = useState(false)
  if (!profile) return null
  const prefs = profile.prefs || {}
  const both = workspacesFor(profile.role).length > 1

  // Every control saves itself
  async function setPref(patch: Partial<Prefs>) {
    try {
      await updateProfile({ prefs: { ...prefs, ...patch } })
      toast('Saved', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div>
      <h1 className="m-0 mb-8 text-[32px] leading-9 font-bold tracking-[-0.03em]">General</h1>

      {both && (
        <SettingsSection title="Workspace on sign-in" description="Skip the workspace picker by opening one directly.">
          <select className="input max-w-[320px]" aria-label="Workspace on sign-in" value={prefs.default_workspace || 'ask'} onChange={e => setPref({ default_workspace: e.target.value as Prefs['default_workspace'] })}>
            <option value="ask">Ask me each time</option>
            {workspacesFor(profile.role).map(w => <option key={w} value={w}>{WORKSPACES[w].label}</option>)}
          </select>
        </SettingsSection>
      )}

      <SettingsSection title="Sessions" description="Defaults for new recordings.">
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 max-w-[320px]">
            <span className="field-label !mb-0">Session language</span>
            <select className="input" value={prefs.default_language || 'en'} onChange={e => setPref({ default_language: e.target.value })}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <Row title="Keep the audio with each session" description="Stores the recording alongside the note. Turn off to keep only the transcript and note.">
            <Switch checked={prefs.auto_save !== false} onChange={v => setPref({ auto_save: v })} label="Keep the audio with each session" />
          </Row>
        </div>
      </SettingsSection>

      <SettingsSection title="Display" description="Applies on this account everywhere you sign in.">
        <div className="flex flex-col gap-5">
          <Row title="Reduce motion" description="Turns off animated transitions and the tour's movement.">
            <Switch checked={!!prefs.reduce_motion} onChange={v => setPref({ reduce_motion: v })} label="Reduce motion" />
          </Row>
          <Row title="Show the getting-started tour again" description="Walks through models, clients, recording and notes.">
            <button className="btn btn-secondary btn-sm" onClick={() => tour.start()}>Start tour</button>
          </Row>
        </div>
      </SettingsSection>

      <SettingsSection title="Your data" description="Export everything, or remove the keys stored in this browser.">
        <div className="flex flex-col gap-5">
          <Row title="Export all sessions" description="Every note, transcript and analysis, as JSON.">
            <button className="btn btn-secondary btn-sm" onClick={() => download('/api/export/record', 'echoscribe-record.json').catch(e => toast(e.message, 'error'))}>Export</button>
          </Row>
          <Row title="Remove keys from this browser" description="Synced keys stay on your account; manage them in Models & API keys.">
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)} disabled={!localKeys.list().length}>Remove</button>
          </Row>
        </div>
      </SettingsSection>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Remove keys from this browser?"
        description={`${localKeys.list().length} key(s) stored only in this browser will be deleted. You can add them again later.`}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setConfirmClear(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { localKeys.clear(); setConfirmClear(false); toast('Browser keys removed', 'success') }}>Remove keys</button>
        </>} />
    </div>
  )
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-rule pt-4 first:border-t-0 first:pt-0">
      <div>
        <p className="m-0 font-semibold">{title}</p>
        <p className="m-0 text-[13px] text-muted">{description}</p>
      </div>
      {children}
    </div>
  )
}
