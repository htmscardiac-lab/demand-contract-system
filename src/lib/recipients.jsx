// Who an email goes to. Each user keeps their own choices:
//   colleagues  – people added to every email the user sends (supervisor, manager …), each as To or CC
//   per vendor  – which vendor contacts are To / CC / left out, plus extra addresses for that vendor only
// Stored in user_prefs.data: { colleagues: [{ id, name, email, kind }], vendors: { [vendorId]: { sel: { key: kind }, extra: [{ email, kind }] } } }
import React, { useState } from 'react'
import { useApp } from '../App.jsx'
import { Btn, Icon } from '../ui.jsx'

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const lower = (s) => String(s || '').trim().toLowerCase()

// rows: every possible recipient with its current choice. to / cc: the addresses to use.
export function resolveRecipients(vendor, settings = {}, prefs = {}) {
  const mine = prefs.vendors?.[vendor?.id] || {}
  const sel = mine.sel || {}
  const rows = [
    ...(vendor?.vendor_contacts || []).filter(c => (c.email || '').trim()).map(c => ({
      key: `c:${c.id ?? lower(c.email)}`, group: 'vendor', name: c.name, sub: c.position || '', email: c.email.trim(), def: 'to' })),
    ...(prefs.colleagues || []).map(c => ({ key: `u:${c.id}`, group: 'colleague', name: c.name || c.email, sub: 'Every email', email: c.email, def: c.kind, id: c.id })),
    ...(settings.department_email ? [{ key: 'dept', group: 'department', name: 'Department mailbox', sub: '', email: settings.department_email.trim(), def: 'cc' }] : []),
    ...(mine.extra || []).map(x => ({ key: `x:${lower(x.email)}`, group: 'extra', name: x.email, sub: 'This vendor only', email: x.email, def: x.kind })),
  ].map(r => ({ ...r, kind: sel[r.key] || r.def }))
  const pick = (k) => [...new Map(rows.filter(r => r.kind === k).map(r => [lower(r.email), r.email])).values()]
  const to = pick('to')
  return { rows, to, cc: pick('cc').filter(e => !to.some(t => lower(t) === lower(e))) }
}

const KINDS = [['to', 'To'], ['cc', 'CC'], ['off', 'Skip']]
const Seg = ({ value, onChange, label }) => (
  <span role="group" aria-label={label} className="inline-flex rounded-lg border border-ink-300 overflow-hidden shrink-0">
    {KINDS.map(([k, t]) => (
      <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
        className={`h-8 px-3 text-[13px] font-medium border-l border-ink-300 first:border-l-0 transition-colors
          ${value === k ? (k === 'off' ? 'bg-ink-200 text-ink-700' : 'bg-ink-900 text-white') : 'bg-white text-ink-600 hover:bg-ink-50'}`}>{t}</button>
    ))}
  </span>
)

export function RecipientsPicker({ vendor }) {
  const { settings, prefs, savePrefs } = useApp()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState('cc')
  const [every, setEvery] = useState(false)
  const [err, setErr] = useState('')
  const { rows, to, cc } = resolveRecipients(vendor, settings, prefs)
  const vid = vendor?.id
  const mine = prefs.vendors?.[vid] || {}
  const save = async (patch) => { const e = await savePrefs(patch); setErr(e ? `Your choice applies now but could not be saved for next time: ${e}` : '') }
  const saveVendor = (next) => save({ vendors: { ...(prefs.vendors || {}), [vid]: { ...mine, ...next } } })
  const setRow = (r, k) => saveVendor({ sel: { ...(mine.sel || {}), [r.key]: k } })
  const remove = (r) => r.group === 'colleague'
    ? save({ colleagues: (prefs.colleagues || []).filter(c => c.id !== r.id) })
    : saveVendor({ extra: (mine.extra || []).filter(x => lower(x.email) !== lower(r.email)) })
  const add = () => {
    const e = email.trim()
    if (!EMAIL.test(e)) return setErr('Type a full email address, for example name@ngha.med.sa.')
    if (rows.some(r => lower(r.email) === lower(e))) return setErr('This address is already in the list.')
    if (every) save({ colleagues: [...(prefs.colleagues || []), { id: Date.now().toString(36), name: name.trim(), email: e, kind }] })
    else saveVendor({ extra: [...(mine.extra || []), { email: e, kind }] })
    setEmail(''); setName('')
  }
  const groups = [['vendor', `${vendor?.name || 'Vendor'} contacts`], ['colleague', 'My colleagues'], ['department', 'Department'], ['extra', 'Added for this vendor']]

  return (
    <section className="rounded-lg border border-ink-200 mb-4" aria-label="Recipients">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 bg-ink-50 border-b border-ink-200 rounded-t-lg">
        <h3 className="text-sm font-medium text-ink-900">Recipients</h3>
        <p className="text-[12px] text-ink-500"><span className="num">{to.length}</span> To · <span className="num">{cc.length}</span> CC · saved for you only</p>
      </header>
      {!rows.some(r => r.group === 'vendor') && <p className="px-4 py-3 text-sm text-amber-700 border-b border-ink-100">This vendor has no contact email in the vendor directory. Add an address below, or add contacts under Vendors.</p>}
      {groups.map(([g, title]) => {
        const list = rows.filter(r => r.group === g)
        if (!list.length) return null
        return (
          <div key={g} className="border-b border-ink-100 last:border-0">
            <div className="px-4 pt-2.5 text-[11px] font-medium uppercase tracking-[0.080em] text-ink-500">{title}</div>
            <ul>
              {list.map(r => (
                <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
                  <span className={`min-w-0 flex-1 basis-52 ${r.kind === 'off' ? 'opacity-55' : ''}`}>
                    <span className="block text-sm text-ink-900 truncate">{r.name}{r.sub && g === 'vendor' && <span className="text-ink-500"> · {r.sub}</span>}</span>
                    {r.name !== r.email && <span className="block num text-[12px] text-ink-500 truncate">{r.email}</span>}
                  </span>
                  <Seg value={r.kind} onChange={(k) => setRow(r, k)} label={`Send to ${r.name}`} />
                  {(g === 'colleague' || g === 'extra')
                    ? <button type="button" onClick={() => remove(r)} aria-label={`Remove ${r.name}`} title={g === 'colleague' ? 'Remove from every email' : 'Remove'}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-ink-400 hover:bg-brand-50 hover:text-brand-700"><Icon name="close" className="w-4 h-4" /></button>
                    : <span className="w-8" />}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <div className="px-4 py-3 bg-ink-50/60 border-t border-ink-200 rounded-b-lg">
        <div className="flex flex-wrap items-center gap-2">
          <input value={email} onChange={e => { setEmail(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            type="email" placeholder="Add an email address" aria-label="Email address to add"
            className="flex-1 basis-56 h-8 rounded-lg border border-ink-300 bg-white px-3 text-sm focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100" />
          {every && <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Colleague name"
            className="flex-1 basis-40 h-8 rounded-lg border border-ink-300 bg-white px-3 text-sm focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100" />}
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Add as"
            className="h-8 rounded-lg border border-ink-300 bg-white px-2 pr-7 text-[13px] focus:outline-none focus:border-brand-600"><option value="to">To</option><option value="cc">CC</option></select>
          <Btn size="sm" variant="secondary" onClick={add} disabled={!email.trim()}>Add</Btn>
        </div>
        <label className="flex items-center gap-2 mt-2 text-[13px] text-ink-600 cursor-pointer">
          <input type="checkbox" checked={every} onChange={e => setEvery(e.target.checked)} className="w-4 h-4 accent-brand-600" />
          A colleague to include in every email I send (supervisor, manager), for all vendors
        </label>
        {err && <p role="alert" className="text-[13px] text-brand-700 mt-2">{err}</p>}
      </div>
    </section>
  )
}
