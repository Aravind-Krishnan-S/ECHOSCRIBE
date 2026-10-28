import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, CloudUpload, ExternalLink, HardDrive, KeyRound, Plus, Server, Trash2, X } from 'lucide-react'
import { SettingsSection } from './SettingsLayout'
import { EmptyState, ErrorState, Skel, Spinner, Switch, useToast } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { localKeys, maskKey, type LocalKey } from '../../lib/keys'
import { useProviderModels, useProviders, useSyncedKeys } from '../../lib/queries'
import type { ComboTarget, ModelSettings as ModelSettingsT, ProviderFamily, SlotId } from '../../lib/types'

const TASKS: SlotId[] = ['STT', 'ROLE_LABEL', 'NOTE_SYNTH', 'PROFILE_GEN', 'VERIFY']
const CAP_TEXT: Record<string, string> = { chat: 'text', transcribe: 'speech-to-text', diarize: 'speakers' }

function useLocalKeys() {
  const [keys, setKeys] = useState<LocalKey[]>(localKeys.list())
  useEffect(() => {
    const update = () => setKeys(localKeys.list())
    window.addEventListener('echoscribe:keys', update)
    return () => window.removeEventListener('echoscribe:keys', update)
  }, [])
  return keys
}

/** Which providers can be called right now, and a stamp that changes whenever a key is added or removed. */
function useKeyAvailability() {
  const providers = useProviders()
  const locals = useLocalKeys()
  const synced = useSyncedKeys()
  return useMemo(() => {
    const families = (providers.data?.families || []).filter(f => f.key !== 'speechbrain')
    const count = (f: ProviderFamily) =>
      locals.filter(k => k.family === f.key).length + (synced.data?.keys || []).filter(k => k.family === f.key).length + (f.serverKeys || 0)
    const available = new Set(families.filter(f => !f.requiresKey || count(f) > 0).map(f => f.key))
    const stamp = `${locals.map(k => k.id).join(',')}|${(synced.data?.keys || []).map(k => k.id).join(',')}`
    return { families, available, count, stamp }
  }, [providers.data, locals, synced.data])
}

export default function ModelSettings() {
  const providers = useProviders()
  return (
    <div>
      <h1 className="m-0 mb-2 text-[32px] leading-9 font-bold tracking-[-0.03em]">Models & API keys</h1>
      <p className="m-0 mb-8 text-muted max-w-[640px]">Connect any of the providers below. Each task tries its models in order and moves on when one fails; several keys for one model take turns before the next model is tried.</p>
      {providers.isLoading ? <Skel h={240} /> : providers.error ? <ErrorState message="Couldn't load the provider list." onRetry={() => providers.refetch()} /> : (
        <>
          <SettingsSection id="keys" title="API keys" description={<>Kept in this browser unless you switch on <b>Sync to my account</b>, which stores the key encrypted so it works on your other devices.</>}>
            <div data-tour="models-keys"><AddKey /><ConnectedProviders /></div>
          </SettingsSection>
          <SettingsSection title="Models for each task" description="Leave a task on the server default, or pick providers and models yourself. Only providers you have connected, and only models able to do that task, are offered.">
            <TaskModels />
          </SettingsSection>
        </>
      )}
    </div>
  )
}

function AddKey() {
  const toast = useToast()
  const qc = useQueryClient()
  const { families } = useKeyAvailability()
  const synced = useSyncedKeys()
  const [familyKey, setFamilyKey] = useState('gemini')
  const [value, setValue] = useState('')
  const [sync, setSync] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const family = families.find(f => f.key === familyKey)
  const groups = useMemo(() => {
    const out: Record<string, ProviderFamily[]> = {}
    families.forEach(f => { (out[f.group] = out[f.group] || []).push(f) })
    return Object.entries(out)
  }, [families])

  async function add() {
    if (!family) return
    const key = value.trim()
    if (family.requiresKey && !key) return
    setBusy(true)
    setTest(null)
    try {
      const r = await api<{ ok: boolean; latencyMs?: number; error?: string; reason?: string }>('/api/providers/test', {
        method: 'POST', json: { family: family.key, model: family.defaultModel || 'default', key: key || undefined },
      })
      if (!r.ok) { setTest({ ok: false, text: r.reason === 'auth' ? `${family.label} rejected this key.` : r.error || 'Test call failed.' }); return }
      if (!family.requiresKey) { setTest({ ok: true, text: `${family.label} answered in ${r.latencyMs} ms. It is ready to use in any task below.` }); return }
      if (sync) {
        await api('/api/providers/keys', { method: 'POST', json: { family: family.key, key } })
        qc.invalidateQueries({ queryKey: ['synced-keys'] })
      } else {
        localKeys.add(family.key, key)
      }
      setValue('')
      setTest({ ok: true, text: `${family.label} key works (${r.latencyMs} ms) and was ${sync ? 'synced to your account' : 'saved in this browser'}.` })
      qc.invalidateQueries({ queryKey: ['providers'] })
    } catch (e) {
      setTest({ ok: false, text: (e as Error).message })
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
        <label className="block">
          <span className="field-label">Provider</span>
          <select className="input" value={familyKey} onChange={e => { setFamilyKey(e.target.value); setTest(null) }}>
            {groups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">{family?.requiresKey === false ? 'No key needed' : 'API key'}</span>
          {family?.requiresKey === false
            ? <p className="m-0 h-[38px] flex items-center text-[13px] text-muted">Runs on this computer. Start {family.label.replace(/ \(.*\)/, '')}, then test the connection.</p>
            : <input className="input" type="password" autoComplete="off" placeholder={`Paste a ${family?.label || ''} key`} value={value}
                onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} aria-label={`${family?.label} API key`} />}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mt-3">
        <span className="text-[12px] text-muted flex flex-wrap gap-x-3 gap-y-1">
          {family && <span>Can do: {family.capabilities.map(c => CAP_TEXT[c] || c).join(', ')}</span>}
          {family?.keyUrl && <a className="link inline-flex items-center gap-1" href={`https://${family.keyUrl}`} target="_blank" rel="noreferrer">{family.requiresKey ? 'Get a key' : 'Download'}<ExternalLink size={11} /></a>}
        </span>
        <span className="flex-1" />
        {family?.requiresKey !== false && (
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={sync} onChange={setSync} label="Sync to my account" disabled={synced.data && !synced.data.syncAvailable} />
            Sync to my account
          </label>
        )}
        <button className="btn btn-primary" onClick={add} disabled={busy || (family?.requiresKey !== false && !value.trim())}>
          {busy ? <Spinner /> : <Plus size={14} />}{family?.requiresKey === false ? 'Test connection' : 'Test & add'}
        </button>
      </div>
      {test && <p role="status" className={`m-0 mt-3 text-[13px] flex items-center gap-1.5 ${test.ok ? 'text-positive' : 'text-negative'}`}>{test.ok ? <Check size={14} /> : <X size={14} />}{test.text}</p>}
    </div>
  )
}

function ConnectedProviders() {
  const toast = useToast()
  const qc = useQueryClient()
  const locals = useLocalKeys()
  const synced = useSyncedKeys()
  const { families, count } = useKeyAvailability()
  const connected = families.filter(f => f.requiresKey && count(f) > 0)
  const removeSynced = useMutation({
    mutationFn: (id: string) => api(`/api/providers/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synced-keys'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  })
  if (!connected.length) return <div className="mt-6"><EmptyState>No provider is connected yet. Add a key above.</EmptyState></div>
  return (
    <table className="table mt-7">
      <thead><tr><th scope="col">Connected</th><th scope="col">Keys</th></tr></thead>
      <tbody>
        {connected.map(f => (
          <tr key={f.key}>
            <td className="font-semibold align-top sm:w-[200px]">{f.label}</td>
            <td>
              <ul className="list-none m-0 p-0 flex flex-col gap-1">
                {locals.filter(k => k.family === f.key).map(k => (
                  <li key={k.id} className="flex items-center gap-2"><KeyRound size={13} className="text-muted" /><span className="num">{maskKey(k.key)}</span><span className="text-[12px] text-muted">this browser</span>
                    <button className="btn btn-ghost btn-icon btn-sm ml-auto" aria-label={`Remove ${f.label} key`} onClick={() => localKeys.remove(k.id)}><X size={14} /></button></li>
                ))}
                {(synced.data?.keys || []).filter(k => k.family === f.key).map(k => (
                  <li key={k.id} className="flex items-center gap-2"><CloudUpload size={13} className="text-muted" /><span className="num">••••{k.last4}</span><span className="text-[12px] text-muted">synced</span>
                    <button className="btn btn-ghost btn-icon btn-sm ml-auto" aria-label={`Remove synced ${f.label} key`} onClick={() => removeSynced.mutate(k.id)}><X size={14} /></button></li>
                ))}
                {f.serverKeys > 0 && <li className="flex items-center gap-2 h-[30px] whitespace-nowrap"><Server size={13} className="text-muted" /><span className="num">{f.serverKeys} {f.serverKeys === 1 ? 'key' : 'keys'}</span><span className="text-[12px] text-muted">server .env</span></li>}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TaskModels() {
  const { profile, updateProfile } = useAuth()
  const providers = useProviders().data!
  const { families, available, stamp } = useKeyAvailability()
  const toast = useToast()
  const [settings, setSettings] = useState<ModelSettingsT>(() => structuredClone(profile?.model_settings || {}))
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(settings) !== JSON.stringify(profile?.model_settings || {})
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
    <div className="flex flex-col gap-8">
      {tasks.map(slot => {
        const def = providers.slots[slot]
        const combo = settings.combos?.[slot]
        const options = families.filter(f => f.capabilities.includes(def.capability) && available.has(f.key))
        return (
          <div key={slot} className="border-t border-ink pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-[15px] font-bold">{def.label}</h3>
              {combo ? (
                <label className="flex items-center gap-2 text-[13px] text-muted">Pick models by
                  <select className="input !h-8 !w-auto !py-0" value={combo.strategy || 'priority'} onChange={e => update(slot, c => ({ ...c!, strategy: e.target.value }))}>
                    {Object.keys(providers.strategies).map(s => <option key={s} value={s} title={providers.strategies[s]}>{s}</option>)}
                  </select>
                </label>
              ) : <span className="pill pill-neutral">Server default</span>}
            </div>
            <p className="m-0 mt-1 text-[12px] text-muted">
              Server default: {def.entries.length ? def.entries.map(e => e.model).join(' → ') : 'none configured'}
            </p>
            {combo ? (
              <ol className="list-none m-0 p-0 mt-3 flex flex-col gap-2">
                {combo.targets.map((t, i) => (
                  <TargetRow key={i} index={i} last={i === combo.targets.length - 1} target={t} capability={def.capability}
                    options={options} allFamilies={families} stamp={stamp}
                    onChange={next => update(slot, c => { c!.targets[i] = next; return c })}
                    onMove={dir => update(slot, c => { const j = i + dir; [c!.targets[j], c!.targets[i]] = [c!.targets[i], c!.targets[j]]; return c })}
                    onRemove={() => update(slot, c => { c!.targets.splice(i, 1); return c })} />
                ))}
              </ol>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn btn-secondary btn-sm" disabled={!options.length}
                onClick={() => update(slot, c => ({ ...c!, targets: [...c!.targets, { family: options[0].key, model: '' }] }))}>
                <Plus size={14} />Add a model
              </button>
              {combo && <button className="btn btn-ghost btn-sm" onClick={() => update(slot, () => null)}>Use server default</button>}
              {!options.length && <span className="text-[12px] text-muted self-center">Connect a provider that can do {CAP_TEXT[def.capability]} first.</span>}
            </div>
          </div>
        )
      })}
      {tasks.length === 0 && <EmptyState>No tasks can be configured on this server.</EmptyState>}
      <div className="flex justify-end gap-2 border-t border-border pt-5">
        <button className="btn btn-secondary" disabled={!dirty || saving} onClick={() => setSettings(structuredClone(profile?.model_settings || {}))}>Discard</button>
        <button className="btn btn-primary" disabled={!dirty || saving || hasEmptyModel(settings)} onClick={save}>{saving && <Spinner />}Save</button>
      </div>
    </div>
  )
}

function hasEmptyModel(s: ModelSettingsT) {
  return Object.values(s.combos || {}).some(c => c?.targets.some(t => !t.model.trim()))
}

const OTHER = '__other__'

/* One step of a task's chain: provider, then one of that provider's models able to do the task. */
function TargetRow({ index, last, target, capability, options, allFamilies, stamp, onChange, onMove, onRemove }: {
  index: number; last: boolean; target: ComboTarget; capability: string
  options: ProviderFamily[]; allFamilies: ProviderFamily[]; stamp: string
  onChange: (t: ComboTarget) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void
}) {
  const models = useProviderModels(target.family, stamp)
  const capable = (models.data?.models || []).filter(m => m.caps.includes(capability))
  const known = capable.some(m => m.id === target.model)
  const [custom, setCustom] = useState(false)
  const showCustom = custom || (!!target.model && !known && !models.isLoading)

  // A new row, or a provider change, starts on the provider's first capable model
  useEffect(() => {
    if (!target.model && capable.length) onChange({ ...target, model: capable[0].id })
  }, [target.model, capable.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const familyMissing = !options.some(f => f.key === target.family)
  const familyLabel = allFamilies.find(f => f.key === target.family)?.label || target.family
  return (
    <li className="grid grid-cols-[24px_minmax(0,180px)_minmax(0,1fr)_auto] items-center gap-2">
      <span className="num text-[12px] font-bold text-muted text-center">{index + 1}</span>
      <select className="input !h-9" value={target.family} aria-label="Provider"
        onChange={e => { setCustom(false); onChange({ family: e.target.value, model: '' }) }}>
        {familyMissing && <option value={target.family}>{familyLabel} (not connected)</option>}
        {options.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      {showCustom ? (
        <span className="flex gap-1">
          <input className="input !h-9" value={target.model} aria-label="Model ID" placeholder="Exact model ID" onChange={e => onChange({ ...target, model: e.target.value })} />
          {capable.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); onChange({ ...target, model: capable[0].id }) }}>List</button>}
        </span>
      ) : (
        <select className="input !h-9" aria-label="Model" disabled={models.isLoading}
          value={known ? target.model : ''}
          onChange={e => { if (e.target.value === OTHER) { setCustom(true); onChange({ ...target, model: '' }) } else onChange({ ...target, model: e.target.value }) }}>
          {models.isLoading && <option value="">Loading models…</option>}
          {!models.isLoading && !capable.length && <option value="">No {CAP_TEXT[capability]} models listed</option>}
          {capable.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          <option value={OTHER}>Other model ID…</option>
        </select>
      )}
      <span className="flex">
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move down" disabled={last} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove model" onClick={onRemove}><Trash2 size={14} /></button>
      </span>
      {models.data && !models.data.live && models.data.hasKey && models.data.error && (
        <p className="col-start-3 col-span-2 m-0 text-[11px] text-muted flex items-center gap-1"><HardDrive size={11} />Showing suggested models; the live list could not be fetched.</p>
      )}
    </li>
  )
}
