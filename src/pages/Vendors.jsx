import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, Btn, Input, Select, Badge, Modal, Spinner, Empty, PageTitle, Alert, SearchInput, TableWrap, Th, Td, Icon } from '../ui.jsx'

const clean = (v) => String(v ?? '').trim() || null

export default function Vendors() {
  const { profile } = useApp()
  const canEdit = profile.role === 'admin' || profile.role === 'supervisor'
  const [vendors, setVendors] = useState(null)
  const [contractCount, setContractCount] = useState({})
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [vendorModal, setVendorModal] = useState(null)     // { vendor } or { vendor: null } for a new one
  const [contactModal, setContactModal] = useState(null)   // { vendor, contact }
  const [confirm, setConfirm] = useState(null)             // contact to delete
  const [lists, setLists] = useState({ positions: [], specialties: [] })
  const [showLists, setShowLists] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [specialty, setSpecialty] = useState('')

  const load = useCallback(async () => {
    const [{ data: v, error }, { data: c }, { data: ps }, { data: sp }] = await Promise.all([
      supabase.from('vendors').select('id, name, vendor_contacts(id, name, email, phone, position, specialties)').order('name'),
      supabase.from('contracts').select('vendor_id'),
      supabase.from('contact_positions').select('*').order('name'),
      supabase.from('contact_specialties').select('*').order('name'),
    ])
    setLists({ positions: ps || [], specialties: sp || [] })
    if (error) setErr(error.message)
    setVendors(v || [])
    const counts = {}
    for (const x of c || []) counts[x.vendor_id] = (counts[x.vendor_id] || 0) + 1
    setContractCount(counts)
  }, [])
  useEffect(() => { load() }, [load])

  const removeContact = async () => {
    const { error } = await supabase.from('vendor_contacts').delete().eq('id', confirm.id)
    setConfirm(null)
    if (error) return setErr(error.message)
    load()
  }

  if (!vendors) return <Spinner />
  const needle = q.trim().toLowerCase()
  const shown = vendors
    .filter(v => !specialty || (v.vendor_contacts || []).some(c => (c.specialties || []).includes(specialty)))
    .filter(v => !needle || [v.name, ...(v.vendor_contacts || []).flatMap(c => [c.name, c.email, c.phone, c.position, ...(c.specialties || [])])]
      .some(x => String(x || '').toLowerCase().includes(needle)))

  return (
    <div>
      <PageTitle subtitle="Every vendor and the people to contact there. Release emails go to these addresses."
        right={canEdit && <>
          <Btn variant="secondary" icon="settings" onClick={() => setShowLists(true)}>Positions and specialties</Btn>
          <Btn variant="secondary" icon="upload" onClick={() => setShowImport(true)}>Import from Excel</Btn>
          <Btn icon="plus" onClick={() => setVendorModal({ vendor: null })}>Add vendor</Btn>
        </>}>Vendors</PageTitle>
      {err && <Alert>{err}</Alert>}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SearchInput className="flex-1 min-w-[220px] max-w-md" placeholder="Search vendor, contact, position, specialty, email or mobile" value={q} onChange={e => setQ(e.target.value)} aria-label="Search vendors" />
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} aria-label="Filter by specialty"
          className="h-9.5 rounded-lg border border-ink-300 bg-white px-3 pr-8 text-sm text-ink-800 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100">
          <option value="">All specialties</option>
          {lists.specialties.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
        </select>
      </div>

      {vendors.length === 0 ? (
        <Card><Empty icon="users" title="No vendors yet" hint="Vendors are added here, or automatically when you create a contract."
          action={canEdit && <Btn icon="plus" onClick={() => setVendorModal({ vendor: null })}>Add vendor</Btn>} /></Card>
      ) : shown.length === 0 ? <Card><Empty icon="search" title="No vendors match" /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          {shown.map(v => {
            const contacts = [...(v.vendor_contacts || [])].sort((a, b) => a.id - b.id)
            return (
              <Card key={v.id} className="overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-ink-100">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-medium text-ink-900 truncate">{v.name}</h2>
                    <p className="text-[12px] text-ink-500 mt-0.5">
                      {contractCount[v.id] || 0} contract{contractCount[v.id] === 1 ? '' : 's'} · {contacts.length} contact{contacts.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 shrink-0">
                      <Btn size="sm" variant="ghost" icon="edit" onClick={() => setVendorModal({ vendor: v })}>Rename</Btn>
                      <Btn size="sm" variant="secondary" icon="plus" onClick={() => setContactModal({ vendor: v, contact: null })}>Add contact</Btn>
                    </div>
                  )}
                </div>
                {contacts.length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-ink-500">No contacts yet. Add one so the release email has a recipient.</p>
                ) : (
                  <ul>
                    {contacts.map(c => (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-3 border-b border-ink-100 last:border-0">
                        <span className="w-9 h-9 rounded-full bg-ink-100 text-ink-600 text-xs font-medium flex items-center justify-center shrink-0">
                          {c.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium text-ink-900">{c.name}</span>
                            {c.position && <span className="text-[13px] text-ink-500">· {c.position}</span>}
                          </span>
                          {(c.specialties || []).length > 0 && (
                            <span className="flex flex-wrap gap-1.5 my-1">
                              {c.specialties.map(x => <Badge key={x} className="bg-steel-100 text-steel-700">{x}</Badge>)}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-x-4 text-[13px] text-ink-600">
                            {c.email && <a href={`mailto:${c.email}`} className="hover:text-brand-700 hover:underline truncate">{c.email}</a>}
                            {c.phone && <a href={`tel:${c.phone}`} className="num hover:text-brand-700 hover:underline">{c.phone}</a>}
                          </span>
                        </span>
                        {canEdit && (
                          <span className="flex shrink-0">
                            <button onClick={() => setContactModal({ vendor: v, contact: c })} aria-label={`Edit ${c.name}`} title="Edit"
                              className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-900 hover:bg-ink-100"><Icon name="edit" className="w-4 h-4" /></button>
                            <button onClick={() => setConfirm(c)} aria-label={`Remove ${c.name}`} title="Remove"
                              className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-700 hover:bg-brand-50"><Icon name="trash" className="w-4 h-4" /></button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <VendorModal state={vendorModal} vendors={vendors} lists={lists} onClose={() => setVendorModal(null)} onSaved={() => { setVendorModal(null); load() }} />
      <ContactModal state={contactModal} lists={lists} onClose={() => setContactModal(null)} onSaved={() => { setContactModal(null); load() }} />
      <ListsModal open={showLists} lists={lists} reload={load} onClose={() => setShowLists(false)} />
      <ImportVendorsModal open={showImport} vendors={vendors} lists={lists} onClose={() => { setShowImport(false); load() }} />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remove contact">
        <p className="text-sm text-ink-600">{confirm?.name} will be removed from the vendor directory and will no longer receive release emails.</p>
        <div className="flex justify-end gap-2 mt-6">
          <Btn variant="secondary" onClick={() => setConfirm(null)}>Keep contact</Btn>
          <Btn onClick={removeContact}>Remove contact</Btn>
        </div>
      </Modal>
    </div>
  )
}

// Position (one) and specialties (any number) of a contact, chosen from the editable lists.
function RoleFields({ lists, position, specialties, onChange }) {
  const toggle = (name) => onChange({ specialties: specialties.includes(name) ? specialties.filter(x => x !== name) : [...specialties, name] })
  // keep a value that was removed from the list visible, so it is not lost silently
  const positions = [...new Set([...lists.positions.map(x => x.name), ...(position ? [position] : [])])]
  const options = [...new Set([...lists.specialties.map(x => x.name), ...specialties])]
  return (<>
    <Select label="Position" value={position} onChange={e => onChange({ position: e.target.value })}>
      <option value="">Not specified</option>
      {positions.map(x => <option key={x} value={x}>{x}</option>)}
    </Select>
    <div>
      <span className="block text-[13px] font-medium text-ink-600 mb-1.5">Specialty (one or more)</span>
      <div className="flex flex-wrap gap-2">
        {options.length === 0 && <span className="text-[13px] text-ink-500">No specialties in the list yet.</span>}
        {options.map(x => {
          const on = specialties.includes(x)
          return (
            <button key={x} type="button" onClick={() => toggle(x)} aria-pressed={on}
              className={`h-8 px-3 rounded-full border text-[13px] font-medium transition-colors ${on ? 'bg-ink-900 border-ink-900 text-white' : 'bg-white border-ink-300 text-ink-700 hover:border-ink-500'}`}>{x}</button>
          )
        })}
      </div>
    </div>
  </>)
}

function VendorModal({ state, vendors, lists, onClose, onSaved }) {
  const vendor = state?.vendor
  const [f, setF] = useState({ name: '', cname: '', email: '', phone: '', position: '', specialties: [] })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => { if (state) { setErr(''); setF({ name: vendor?.name || '', cname: '', email: '', phone: '', position: '', specialties: [] }) } }, [state, vendor])
  const taken = vendors.some(v => v.id !== vendor?.id && v.name.trim().toLowerCase() === f.name.trim().toLowerCase())
  const contactOk = vendor ? true : f.cname.trim() && (f.email.trim() || f.phone.trim())
  const save = async () => {
    setErr(''); setBusy(true)
    try {
      if (vendor) {
        const { error } = await supabase.from('vendors').update({ name: f.name.trim() }).eq('id', vendor.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('vendors').insert({ name: f.name.trim() }).select('id').single()
        if (error) throw error
        const { error: e2 } = await supabase.from('vendor_contacts').insert({ vendor_id: data.id, name: f.cname.trim(), email: clean(f.email), phone: clean(f.phone), position: clean(f.position), specialties: f.specialties })
        if (e2) throw e2
      }
      onSaved()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={!!state} onClose={onClose} title={vendor ? 'Rename vendor' : 'Add vendor'}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4">
        <Input label="Vendor name" value={f.name} onChange={set('name')} />
        {taken && <p className="text-[12px] text-brand-700 -mt-2">A vendor with this name already exists.</p>}
        {!vendor && (<>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500 mt-1">First contact</div>
          <Input label="Contact name" value={f.cname} onChange={set('cname')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email" type="email" value={f.email} onChange={set('email')} />
            <Input label="Mobile" type="tel" value={f.phone} onChange={set('phone')} />
          </div>
          <RoleFields lists={lists} position={f.position} specialties={f.specialties} onChange={(p) => setF(x => ({ ...x, ...p }))} />
        </>)}
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.name.trim() || taken || !contactOk}>{vendor ? 'Save name' : 'Add vendor'}</Btn>
      </div>
    </Modal>
  )
}

function ContactModal({ state, lists, onClose, onSaved }) {
  const contact = state?.contact
  const [f, setF] = useState({ name: '', email: '', phone: '', position: '', specialties: [] })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => { if (state) { setErr(''); setF({ name: contact?.name || '', email: contact?.email || '', phone: contact?.phone || '', position: contact?.position || '', specialties: contact?.specialties || [] }) } }, [state, contact])
  const save = async () => {
    setErr(''); setBusy(true)
    const row = { name: f.name.trim(), email: clean(f.email), phone: clean(f.phone), position: clean(f.position), specialties: f.specialties }
    const { error } = contact
      ? await supabase.from('vendor_contacts').update(row).eq('id', contact.id)
      : await supabase.from('vendor_contacts').insert({ ...row, vendor_id: state.vendor.id })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }
  return (
    <Modal open={!!state} onClose={onClose} title={contact ? 'Edit contact' : `Add contact · ${state?.vendor?.name || ''}`}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4">
        <Input label="Contact name" value={f.name} onChange={set('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" value={f.email} onChange={set('email')} />
          <Input label="Mobile" type="tel" value={f.phone} onChange={set('phone')} />
        </div>
        <RoleFields lists={lists} position={f.position} specialties={f.specialties} onChange={(p) => setF(x => ({ ...x, ...p }))} />
      </div>
      <p className="text-[13px] text-ink-500 mt-4">Enter an email, a mobile number, or both.</p>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.name.trim() || !(f.email.trim() || f.phone.trim())}>{contact ? 'Save contact' : 'Add contact'}</Btn>
      </div>
    </Modal>
  )
}

// Edit the two drop-down lists: positions and specialties.
function ListsModal({ open, lists, reload, onClose }) {
  const [err, setErr] = useState('')
  useEffect(() => { if (open) setErr('') }, [open])
  const table = { position: 'contact_positions', specialty: 'contact_specialties' }
  const add = async (kind, name) => {
    setErr('')
    const { error } = await supabase.from(table[kind]).insert({ name })
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? `"${name}" is already in the list.` : error.message)
    reload()
  }
  const rename = async (kind, row, name) => {
    setErr('')
    const { error } = await supabase.rpc('rename_contact_option', { p_kind: kind, p_old: row.name, p_new: name })
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? `"${name}" is already in the list.` : error.message)
    reload()
  }
  const remove = async (kind, row) => {
    setErr('')
    const { error } = await supabase.from(table[kind]).delete().eq('id', row.id)
    if (error) return setErr(error.message)
    reload()
  }
  return (
    <Modal open={open} onClose={onClose} title="Positions and specialties" wide>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-ink-600 mb-5">These are the choices offered when you add a contact. Renaming one updates every contact that uses it. Removing one takes it off the list; contacts that already have it keep it.</p>
      <div className="grid sm:grid-cols-2 gap-6">
        <OptionList title="Positions" placeholder="Service Manager" rows={lists.positions}
          onAdd={(n) => add('position', n)} onRename={(r, n) => rename('position', r, n)} onRemove={(r) => remove('position', r)} />
        <OptionList title="Specialties" placeholder="Patient Monitoring" rows={lists.specialties}
          onAdd={(n) => add('specialty', n)} onRename={(r, n) => rename('specialty', r, n)} onRemove={(r) => remove('specialty', r)} />
      </div>
      <div className="flex justify-end mt-6"><Btn variant="secondary" onClick={onClose}>Done</Btn></div>
    </Modal>
  )
}

function OptionList({ title, placeholder, rows, onAdd, onRename, onRemove }) {
  const [name, setName] = useState('')
  const [edit, setEdit] = useState(null)   // { id, name }
  return (
    <div>
      <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500 mb-2">{title}</h4>
      <form className="flex gap-2 mb-3" onSubmit={e => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName('') } }}>
        <div className="flex-1"><Input value={name} onChange={e => setName(e.target.value)} placeholder={placeholder} aria-label={`New ${title.toLowerCase()} name`} /></div>
        <Btn variant="dark" disabled={!name.trim()}>Add</Btn>
      </form>
      <ul className="rounded-lg border border-ink-200 divide-y divide-ink-100">
        {rows.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-500">The list is empty.</li>}
        {rows.map(r => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2">
            {edit?.id === r.id ? (
              <form className="flex gap-2 flex-1" onSubmit={e => { e.preventDefault(); if (edit.name.trim() && edit.name.trim() !== r.name) onRename(r, edit.name.trim()); setEdit(null) }}>
                <div className="flex-1"><Input autoFocus value={edit.name} onChange={e => setEdit({ id: r.id, name: e.target.value })} aria-label={`Rename ${r.name}`} /></div>
                <Btn size="sm" className="h-9.5">Save</Btn>
                <Btn size="sm" type="button" variant="secondary" className="h-9.5" onClick={() => setEdit(null)}>Cancel</Btn>
              </form>
            ) : (<>
              <span className="flex-1 text-sm text-ink-900 truncate">{r.name}</span>
              <button onClick={() => setEdit({ id: r.id, name: r.name })} aria-label={`Rename ${r.name}`} title="Rename"
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-900 hover:bg-ink-100"><Icon name="edit" className="w-4 h-4" /></button>
              <button onClick={() => onRemove(r)} aria-label={`Remove ${r.name}`} title="Remove from list"
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-700 hover:bg-brand-50"><Icon name="trash" className="w-4 h-4" /></button>
            </>)}
          </li>
        ))}
      </ul>
    </div>
  )
}

const VENDOR_COLS = ['Vendor Name', 'Contact Name', 'Position', 'Specialty', 'Email', 'Mobile']

// Import vendors with their staff, or staff for vendors that already exist. One person per row.
function ImportVendorsModal({ open, vendors, lists, onClose }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  useEffect(() => { if (open) { setRows(null); setErr(''); setDone(null) } }, [open])

  const template = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([VENDOR_COLS])
    sheet['!cols'] = [{ wch: 30 }, { wch: 28 }, { wch: 24 }, { wch: 30 }, { wch: 30 }, { wch: 18 }]
    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill the "Vendors" sheet'], [],
      ['Column', 'Required', 'What to enter', 'Example'],
      ['Vendor Name', 'Yes', 'A new name creates the vendor. An existing name adds the person to that vendor.', 'Draeger Arabia'],
      ['Contact Name', 'Yes', 'Name of the person.', 'Eng. Ahmed Ali'],
      ['Position', 'No', 'Job title. A title that is not in the list yet is added to it.', 'Maintenance Engineer'],
      ['Specialty', 'No', 'One or more, separated by commas. Use General for someone who covers everything.', 'Ventilators, Anesthesia'],
      ['Email', 'Email or mobile', 'Release and reminder emails go to this address.', 'ahmed@vendor.com'],
      ['Mobile', 'Email or mobile', 'Mobile number.', '0500000000'],
      [], ['One person per row. Repeat the vendor name on each row to add several people to one vendor.'],
      ['Keep the first row (the column titles). Start from row 2. Only the first sheet is read.'],
      [], ['Positions in the list now:', lists.positions.map(x => x.name).join(', ')],
      ['Specialties in the list now:', lists.specialties.map(x => x.name).join(', ')],
    ])
    help['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 84 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Vendors')
    XLSX.utils.book_append_sheet(wb, help, 'How to fill')
    XLSX.writeFile(wb, 'vendors-template.xlsx')
  }

  const onFile = async (e) => {
    setErr(''); setDone(null)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      let raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      raw = raw.filter(r => r.some(c => String(c).trim() !== ''))
      if (raw.length < 2) throw new Error('The sheet has no rows. Fill at least one row under the column titles.')
      const head = raw[0].map(h => String(h).toLowerCase())
      const find = (re) => head.findIndex(h => re.test(h))
      const col = { vendor: find(/vendor|company/), name: find(/contact|person|^name/), position: find(/position|title/), spec: find(/special/), email: find(/mail/), phone: find(/mobile|phone/) }
      const missing = Object.entries({ 'Vendor Name': col.vendor, 'Contact Name': col.name }).filter(([, i]) => i < 0).map(([n]) => n)
      if (missing.length) throw new Error(`Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. Use the Excel template.`)
      const text = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
      const byName = Object.fromEntries(vendors.map(v => [v.name.trim().toLowerCase(), v]))
      const known = { position: new Set(lists.positions.map(x => x.name.toLowerCase())), spec: new Set(lists.specialties.map(x => x.name.toLowerCase())) }
      const seen = new Set()
      setRows(raw.slice(1).map((r, i) => {
        const x = { row: i + 2, vendor: text(r, col.vendor), name: text(r, col.name), position: text(r, col.position),
          specialties: [...new Set(text(r, col.spec).split(/[,،;]/).map(v => v.trim()).filter(Boolean))], email: text(r, col.email), phone: text(r, col.phone) }
        const v = byName[x.vendor.toLowerCase()]
        const problems = []; let skip = ''
        if (!x.vendor) problems.push('vendor name missing')
        if (!x.name) problems.push('contact name missing')
        if (x.name && !x.email && !x.phone) problems.push('needs an email or a mobile number')
        const key = `${x.vendor}|${x.name}|${x.email}`.toLowerCase()
        if (seen.has(key)) skip = 'repeated in the file'
        seen.add(key)
        if (v && (v.vendor_contacts || []).some(c => c.name.trim().toLowerCase() === x.name.toLowerCase() && (c.email || '').toLowerCase() === x.email.toLowerCase())) skip = 'already in the directory'
        const fresh = [...(x.position && !known.position.has(x.position.toLowerCase()) ? [x.position] : []), ...x.specialties.filter(s => !known.spec.has(s.toLowerCase()))]
        return { ...x, newVendor: !!x.vendor && !v, problems, skip, fresh }
      }))
    } catch (ex) { setErr(ex.message); setRows(null) }
  }

  const run = async () => {
    setBusy(true); setErr('')
    const ids = Object.fromEntries(vendors.map(v => [v.name.trim().toLowerCase(), v.id]))
    // list values keep the spelling already in the list; new ones are added to it
    const canon = { position: Object.fromEntries(lists.positions.map(x => [x.name.toLowerCase(), x.name])), spec: Object.fromEntries(lists.specialties.map(x => [x.name.toLowerCase(), x.name])) }
    const failed = []; let people = 0, created = 0
    const option = async (kind, table, value) => {
      const k = value.toLowerCase()
      if (!canon[kind][k]) {
        const { error } = await supabase.from(table).insert({ name: value })
        if (error && !/duplicate|unique/i.test(error.message)) throw error
        canon[kind][k] = value
      }
      return canon[kind][k]
    }
    for (const x of rows.filter(r => r.problems.length === 0 && !r.skip)) {
      try {
        const key = x.vendor.toLowerCase()
        if (!ids[key]) {
          const { data, error } = await supabase.from('vendors').insert({ name: x.vendor }).select('id').single()
          if (error) throw error
          ids[key] = data.id; created++
        }
        const position = x.position ? await option('position', 'contact_positions', x.position) : null
        const specialties = []
        for (const sp of x.specialties) specialties.push(await option('spec', 'contact_specialties', sp))
        const { error } = await supabase.from('vendor_contacts').insert({ vendor_id: ids[key], name: x.name, email: x.email || null, phone: x.phone || null, position, specialties })
        if (error) throw error
        people++
      } catch (ex) { failed.push({ row: x.row, name: x.name, reason: ex.message }) }
    }
    setBusy(false); setDone({ people, created, failed }); setRows(null)
  }

  const good = rows ? rows.filter(r => r.problems.length === 0 && !r.skip).length : 0
  return (
    <Modal open={open} onClose={onClose} title="Import vendors from Excel" wide>
      {err && <Alert>{err}</Alert>}
      {done && (<>
        <Alert kind={done.people ? 'ok' : 'warn'}>{done.people} contact{done.people === 1 ? '' : 's'} imported{done.created ? `, ${done.created} new vendor${done.created === 1 ? '' : 's'} added` : ''}{done.failed.length ? `, ${done.failed.length} not imported` : ''}.</Alert>
        {done.failed.length > 0 && <ul className="text-[13px] text-ink-700 space-y-1 mb-4">{done.failed.map(f => <li key={f.row}>Row <span className="num">{f.row}</span> · {f.name}: {f.reason}</li>)}</ul>}
      </>)}
      {!rows && (
        <ol className="space-y-3">
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-4 py-3">
            <span className="text-sm text-ink-800"><span className="num text-ink-500 mr-2">1</span>Download the template and fill one person per row.</span>
            <Btn variant="secondary" icon="download" onClick={template}>Excel template</Btn>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-4 py-3">
            <span className="text-sm text-ink-800"><span className="num text-ink-500 mr-2">2</span>Upload the filled file. A new vendor name creates the vendor; an existing one gets the people added.</span>
            <label className="inline-flex items-center justify-center gap-2 h-9.5 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white cursor-pointer transition-colors">
              <Icon name="upload" className="w-4 h-4" />Choose file
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onFile} />
            </label>
          </li>
        </ol>
      )}
      {rows && (<>
        <p className="text-sm text-ink-600 mb-3">{good} of {rows.length} row{rows.length === 1 ? '' : 's'} ready to import.{good < rows.length ? ' The other rows are skipped.' : ''}</p>
        <TableWrap className="rounded-lg border border-ink-200 max-h-[46vh] overflow-y-auto">
          <thead><tr><Th>Row</Th><Th>Vendor</Th><Th>Contact</Th><Th>Position and specialty</Th><Th>Email and mobile</Th><Th>Check</Th></tr></thead>
          <tbody>
            {rows.map(x => (
              <tr key={x.row} className={x.problems.length ? 'bg-brand-50/60' : x.skip ? 'bg-ink-50' : ''}>
                <Td className="num text-ink-500">{x.row}</Td>
                <Td className="whitespace-nowrap"><div className="text-ink-900">{x.vendor || '—'}</div><div className={`text-[12px] ${x.newVendor ? 'text-steel-700' : 'text-ink-500'}`}>{x.newVendor ? 'New vendor' : x.vendor ? 'Existing vendor' : ''}</div></Td>
                <Td className="whitespace-nowrap text-ink-900">{x.name || '—'}</Td>
                <Td><div className="text-[13px]">{x.position || <span className="text-ink-300">—</span>}</div>{x.specialties.length > 0 && <div className="text-[12px] text-ink-500">{x.specialties.join(', ')}</div>}</Td>
                <Td className="text-[13px] whitespace-nowrap"><div>{x.email || <span className="text-ink-300">—</span>}</div>{x.phone && <div className="num text-[12px] text-ink-500">{x.phone}</div>}</Td>
                <Td className="text-[13px] min-w-[200px]">
                  {x.problems.length ? <span className="text-brand-700">{x.problems.join('; ')}</span>
                    : x.skip ? <span className="text-ink-500">Skipped: {x.skip}</span>
                    : <><Badge className="bg-olive-100 text-olive-700">Ready</Badge>{x.fresh.length > 0 && <div className="text-[12px] text-steel-700 mt-1">Adds to the lists: {x.fresh.join(', ')}</div>}</>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="flex justify-end gap-2 mt-6">
          <Btn variant="secondary" onClick={() => setRows(null)}>Choose another file</Btn>
          <Btn onClick={run} disabled={busy || good === 0}>{busy ? 'Importing…' : `Import ${good} contact${good === 1 ? '' : 's'}`}</Btn>
        </div>
      </>)}
    </Modal>
  )
}
