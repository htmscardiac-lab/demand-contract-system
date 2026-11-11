import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, Btn, Input, Modal, Spinner, Empty, PageTitle, Alert, SearchInput, Icon } from '../ui.jsx'

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

  const load = useCallback(async () => {
    const [{ data: v, error }, { data: c }] = await Promise.all([
      supabase.from('vendors').select('id, name, vendor_contacts(id, name, email, phone)').order('name'),
      supabase.from('contracts').select('vendor_id'),
    ])
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
  const shown = vendors.filter(v => !needle || [v.name, ...(v.vendor_contacts || []).flatMap(c => [c.name, c.email, c.phone])]
    .some(x => String(x || '').toLowerCase().includes(needle)))

  return (
    <div>
      <PageTitle subtitle="Every vendor and the people to contact there. Release emails go to these addresses."
        right={canEdit && <Btn icon="plus" onClick={() => setVendorModal({ vendor: null })}>Add vendor</Btn>}>Vendors</PageTitle>
      {err && <Alert>{err}</Alert>}
      <SearchInput className="max-w-md mb-5" placeholder="Search vendor, contact, email or mobile" value={q} onChange={e => setQ(e.target.value)} aria-label="Search vendors" />

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
                          <span className="block text-sm font-medium text-ink-900 truncate">{c.name}</span>
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

      <VendorModal state={vendorModal} vendors={vendors} onClose={() => setVendorModal(null)} onSaved={() => { setVendorModal(null); load() }} />
      <ContactModal state={contactModal} onClose={() => setContactModal(null)} onSaved={() => { setContactModal(null); load() }} />
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

function VendorModal({ state, vendors, onClose, onSaved }) {
  const vendor = state?.vendor
  const [f, setF] = useState({ name: '', cname: '', email: '', phone: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => { if (state) { setErr(''); setF({ name: vendor?.name || '', cname: '', email: '', phone: '' }) } }, [state, vendor])
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
        const { error: e2 } = await supabase.from('vendor_contacts').insert({ vendor_id: data.id, name: f.cname.trim(), email: clean(f.email), phone: clean(f.phone) })
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
        </>)}
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.name.trim() || taken || !contactOk}>{vendor ? 'Save name' : 'Add vendor'}</Btn>
      </div>
    </Modal>
  )
}

function ContactModal({ state, onClose, onSaved }) {
  const contact = state?.contact
  const [f, setF] = useState({ name: '', email: '', phone: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  useEffect(() => { if (state) { setErr(''); setF({ name: contact?.name || '', email: contact?.email || '', phone: contact?.phone || '' }) } }, [state, contact])
  const save = async () => {
    setErr(''); setBusy(true)
    const row = { name: f.name.trim(), email: clean(f.email), phone: clean(f.phone) }
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
      </div>
      <p className="text-[13px] text-ink-500 mt-4">Enter an email, a mobile number, or both.</p>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.name.trim() || !(f.email.trim() || f.phone.trim())}>{contact ? 'Save contact' : 'Add contact'}</Btn>
      </div>
    </Modal>
  )
}
