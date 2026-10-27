import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, CloudUpload, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { SettingsSection } from './SettingsLayout'
import { EmptyState, ErrorState, Skel, Spinner, Switch, useToast } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { localKeys, maskKey, type LocalKey } from '../../lib/keys'
import { useProviders, useSyncedKeys } from '../../lib/queries'
import type { ComboTarget, ModelSettings as ModelSettingsT, SlotId } from '../../lib/types'

const KEY_FAMILIES = [
  { key: 'gemini', label: 'Google Gemini', example: 'gemini-3.5-flash', help: 'Create a key at aistudio.google.com' },
  { key: 'groq', label: 'Groq', example: 'openai/gpt-oss-120b', help: 'Create a key at console.groq.com' },
  { key: 'mistral', label: 'Mistral', example: 'mistral-small-latest', help: 'Create a key at console.mistral.ai' },
  { key: 'deepgram', label: 'Deepgram', example: 'nova-2', help: 'Speech-to-text and speaker separation only' },
]
const TASKS: SlotId[] = ['STT', 'ROLE_LABEL', 'NOTE_SYNTH', 'PROFILE_GEN', 'VERIFY']

function useLocalKeys() {
  const [keys, setKeys] = useState<LocalKey[]>(localKeys.list())
  useEffect(() => {
    const update = () => setKeys(localKeys.list())
    window.addEventListener('echoscribe:keys', update)
    return () => window.removeEventListener('echoscribe:keys', update)
  }, [])
  return keys
}

export default function ModelSettings() {
  const providers = useProviders()
  return (
    <div>
      <h1 className="m-0 mb-1 text-[24px] font-semibold">Models & API keys</h1>
      <p className="m-0 mb-6 text-muted">Every task tries its models in order and moves on when one fails. Several keys for one provider take turns, so their free quotas add up.</p>
      <SettingsSection id="keys" title="API keys" description={<>Kept in this browser unless you switch on <b>Sync to my account</b>, which stores the key encrypted so it works on your other devices.</>}>
        <div data-tour="models-keys" className="flex flex-col gap-5">
          {KEY_FAMILIES.map(f => <KeyFamily key={f.key} family={f} />)}
        </div>
      </SettingsSection>
      <SettingsSection title="Models for each task" description="Leave a task on the server default, or choose your own models and how they are picked.">
        {providers.isLoading ? <Skel h={200} /> : providers.error ? <ErrorState message="Couldn't load the model configuration." onRetry={() => providers.refetch()} /> : <TaskModels />}
      </SettingsSection>
    </div>
  )
}

function KeyFamily({ family }: { family: typeof KEY_FAMILIES[number] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const locals = useLocalKeys().filter(k => k.family === family.key)
  const synced = useSyncedKeys()
  const syncedHere = (synced.data?.keys || []).filter(k => k.family === family.key)
  const [value, setValue] = useState('')
  const [sync, setSync] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    const key = value.trim()
    if (!key) return
    setBusy(true)
    setTest(null)
    try {
      const r = await api<{ ok: boolean; latencyMs?: number; error?: string; reason?: string }>('/api/providers/test', { method: 'POST', json: { family: family.key, model: family.example, key } })
      if (!r.ok) { setTest({ ok: false, text: r.reason === 'auth' ? 'The provider rejected this key.' : r.error || 'Test call failed.' }); return }
      if (sync) {
        await api('/api/providers/keys', { method: 'POST', json: { family: family.key, key } })
        qc.invalidateQueries({ queryKey: ['synced-keys'] })
      } else {
        localKeys.add(family.key, key)
      }
      setValue('')
      setTest({ ok: true, text: `Key works (${r.latencyMs} ms) and was ${sync ? 'synced to your account' : 'saved in this browser'}.` })
      qc.invalidateQueries({ queryKey: ['providers'] })
    } catch (e) {
      setTest({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const removeSynced = useMutation({
    mutationFn: (id: string) => api(`/api/providers/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synced-keys'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  })

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="m-0 text-[14px] font-semibold">{family.label}</h3>
        <span className="text-[12px] text-muted">{family.help}</span>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5 mb-2">
        {locals.map(k => (
          <li key={k.id} className="flex items-center gap-2 rounded-[10px] bg-raised border border-border px-3 h-10">
            <KeyRound size={14} className="text-muted" /><span className="num flex-1">{maskKey(k.key)}</span>
            <span className="text-[12px] text-muted">This browser</span>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove key" onClick={() => localKeys.remove(k.id)}><X size={14} /></button>
          </li>
        ))}
        {syncedHere.map(k => (
          <li key={k.id} className="flex items-center gap-2 rounded-[10px] bg-raised border border-border px-3 h-10">
            <CloudUpload size={14} className="text-muted" /><span className="num flex-1">••••{k.last4}</span>
            <span className="text-[12px] text-muted">Synced</span>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove synced key" onClick={() => removeSynced.mutate(k.id)}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 min-w-[220px]" type="password" autoComplete="off" placeholder={`Paste a ${family.label} key`} value={value} onChange={e => setValue(e.target.value)} aria-label={`${family.label} API key`} />
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={sync} onChange={setSync} label="Sync to my account" disabled={synced.data && !synced.data.syncAvailable} />
          Sync to my account
        </label>
        <button className="btn btn-secondary" onClick={add} disabled={!value.trim() || busy}>{busy ? <Spinner /> : <Plus size={14} />}Test & add</button>
      </div>
      {test && <p className={`m-0 mt-2 text-[13px] flex items-center gap-1.5 ${test.ok ? 'text-positive' : 'text-negative'}`}>{test.ok ? <Check size={14} /> : <X size={14} />}{test.text}</p>}
    </div>
  )
}

function TaskModels() {
  const { profile, updateProfile } = useAuth()
  const providers = useProviders().data!
  const toast = useToast()
  const [settings, setSettings] = useState<ModelSettingsT>(() => structuredClone(profile?.model_settings || {}))
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(settings) !== JSON.stringify(profile?.model_settings || {})
  const families = providers.families

  const tasks = useMemo(() => TASKS.filter(t => providers.slots[t]?.userConfigurable), [providers])

  function update(slot: SlotId, fn: (c: { strategy?: string; targets: ComboTarget[] }) => { strategy?: string; targets: ComboTarget[] } | null) {
    setSettings(s => {
      const combos = { ...(s.combos || {}) }
      const next = fn(combos[slot] ? structuredClone(combos[slot]!) : { strategy: 'priority', targets: [] })
      if (next && next.targets.length) combos[slot] = next
      else delete combos[slot]
      return { ...s, combos }
    })
  }

  async function save() {
    setSaving(true)
    try {
      await updateProfile({ model_settings: { ...settings } })
      toast('Model settings saved; they apply from your next request', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {tasks.map(slot => {
        const def = providers.slots[slot]
        const combo = settings.combos?.[slot]
        const options = families.filter(f => f.capabilities.includes(def.capability) && f.requiresKey)
        return (
          <div key={slot}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-[14px] font-semibold">{def.label}</h3>
              {combo ? (
                <label className="flex items-center gap-2 text-[13px]">Picked by
                  <select className="input !h-8 !w-auto !py-0" value={combo.strategy || 'priority'} onChange={e => update(slot, c => ({ ...c!, strategy: e.target.value }))}>
                    {Object.keys(providers.strategies).map(s => <option key={s} value={s} title={providers.strategies[s]}>{s}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <p className="m-0 mt-1 text-[12px] text-muted">
              Server default: {def.entries.length ? def.entries.map(e => e.model).join(' → ') : 'none configured'}
            </p>
            {combo ? (
              <ol className="list-none m-0 p-0 mt-2 flex flex-col gap-1.5">
                {combo.targets.map((t, i) => (
                  <li key={i} className="grid grid-cols-[22px_150px_1fr_auto] items-center gap-2">
                    <span className="num text-[12px] text-muted text-center">{i + 1}</span>
                    <select className="input !h-9" value={t.family} aria-label="Provider" onChange={e => update(slot, c => { c!.targets[i].family = e.target.value; return c })}>
                      {options.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <input className="input !h-9" value={t.model} aria-label="Model" placeholder="Model name" onChange={e => update(slot, c => { c!.targets[i].model = e.target.value; return c })} />
                    <span className="flex">
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => update(slot, c => { [c!.targets[i - 1], c!.targets[i]] = [c!.targets[i], c!.targets[i - 1]]; return c })}><ArrowUp size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move down" disabled={i === combo.targets.length - 1} onClick={() => update(slot, c => { [c!.targets[i + 1], c!.targets[i]] = [c!.targets[i], c!.targets[i + 1]]; return c })}><ArrowDown size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove model" onClick={() => update(slot, c => { c!.targets.splice(i, 1); return c })}><Trash2 size={14} /></button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="flex gap-2 mt-2">
              <button className="btn btn-ghost btn-sm" onClick={() => update(slot, c => ({ ...c!, targets: [...c!.targets, { family: options[0]?.key || 'gemini', model: KEY_FAMILIES.find(f => f.key === options[0]?.key)?.example || '' }] }))}><Plus size={14} />Add a model</button>
              {combo && <button className="btn btn-ghost btn-sm" onClick={() => update(slot, () => null)}>Use server default</button>}
            </div>
          </div>
        )
      })}
      {tasks.length === 0 && <EmptyState>No tasks can be configured on this server.</EmptyState>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-secondary" disabled={!dirty || saving} onClick={() => setSettings(structuredClone(profile?.model_settings || {}))}>Discard</button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving && <Spinner />}Save</button>
      </div>
    </div>
  )
}
