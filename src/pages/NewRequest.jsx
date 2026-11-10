import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, imgUrl } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, Btn, Input, Select, Modal, Spinner, Empty, PageTitle, Alert, Badge } from '../ui.jsx'
import { money } from '../lib/helpers'

export default function NewRequest() {
  const { profile } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const asSupervisor = profile.role === 'supervisor' || profile.role === 'admin'
  const [step, setStep] = useState('pick')          // pick -> browse -> review -> done
  const [vendors, setVendors] = useState([])
  const [contracts, setContracts] = useState([])
  const [poQuery, setPoQuery] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [contract, setContract] = useState(null)
  const [bal, setBal] = useState(null)
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])              // {item, quantity, htm, serial, wo}
  const [supervisors, setSupervisors] = useState([])
  const [supervisorId, setSupervisorId] = useState('')
  const [dups, setDups] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: v } = await supabase.from('vendors').select('*').order('name')
      setVendors(v || [])
      const { data: tm } = await supabase.from('team_memberships')
        .select('supervisor_id, supervisor:profiles!team_memberships_supervisor_id_fkey(id, full_name)')
        .eq('engineer_id', profile.id)
      const sups = (tm || []).map(t => t.supervisor).filter(Boolean)
      setSupervisors(sups)
      if (sups.length === 1) setSupervisorId(sups[0].id)
    })()
  }, [profile.id])

  // load an existing request when editing / amending a returned request
  useEffect(() => {
    if (!editId) return
    (async () => {
      const { data: req } = await supabase.from('requests')
        .select('*, request_items(*), contracts(*, vendors(name, contact_email))')
        .eq('id', editId).single()
      if (!req) return setErr('Request not found.')
      if (!['pending', 'returned'].includes(req.status)) return setErr('This request can no longer be edited.')
      const [{ data: b }, { data: ci }] = await Promise.all([
        supabase.from('contract_balances').select('*').eq('contract_id', req.contract_id).single(),
        supabase.from('contract_items').select('*').eq('contract_id', req.contract_id).order('line_number'),
      ])
      setContract(req.contracts); setBal(b); setItems(ci || [])
      setSupervisorId(req.supervisor_id)
      const byId = Object.fromEntries((ci || []).map(x => [x.id, x]))
      setCart((req.request_items || []).filter(it => byId[it.contract_item_id]).map(it => ({
        item: byId[it.contract_item_id], quantity: it.quantity,
        htm: it.htm_number, serial: it.serial_number, wo: it.work_order_number,
        equip: it.equipment_description || '', model: it.device_model || '',
      })))
      setStep('review')
    })()
  }, [editId])

  const searchPO = async () => {
    setErr('')
    const { data } = await supabase.from('contracts').select('*, vendors(name, contact_email)').ilike('po_number', `%${poQuery.trim()}%`)
    if (!data?.length) return setErr('No contract found with that PO number.')
    setContracts(data)
    if (data.length === 1) selectContract(data[0])
  }

  const byVendor = async (vid) => {
    setVendorId(vid); setErr('')
    if (!vid) { setContracts([]); return }
    const { data } = await supabase.from('contracts').select('*, vendors(name, contact_email)').eq('vendor_id', vid)
    setContracts(data || [])
    if (data?.length === 1) selectContract(data[0])
  }

  const selectContract = async (c) => {
    setContract(c); setErr('')
    const [{ data: b }, { data: ci }] = await Promise.all([
      supabase.from('contract_balances').select('*').eq('contract_id', c.id).single(),
      supabase.from('contract_items').select('*').eq('contract_id', c.id).order('line_number'),
    ])
    setBal(b); setItems(ci || []); setStep('browse')
  }

  const addToCart = (item) => {
    setCart(c => {
      const ex = c.find(x => x.item.id === item.id)
      if (ex) return c.map(x => x.item.id === item.id ? { ...x, quantity: x.quantity + 1 } : x)
      return [...c, { item, quantity: 1, htm: '', serial: '', wo: '', equip: '', model: '' }]
    })
  }
  const setLine = (id, patch) => setCart(c => c.map(x => x.item.id === id ? { ...x, ...patch } : x))
  const removeLine = (id) => setCart(c => c.filter(x => x.item.id !== id))
  const total = useMemo(() => cart.reduce((s, x) => s + x.item.unit_price * x.quantity, 0), [cart])

  const filtered = items.filter(i =>
    !search || i.description.toLowerCase().includes(search.toLowerCase()) || i.part_number.toLowerCase().includes(search.toLowerCase()))

  const validateReview = () => {
    if (!asSupervisor && !supervisorId) return 'Please select a supervisor to send the request to.'
    for (const x of cart) {
      if (!x.htm.trim() || !x.serial.trim() || !x.wo.trim())
        return `Line "${x.item.part_number}": HTM Number, Serial Number and Work Order Number are all required.`
      if (x.quantity < 1) return 'Quantities must be at least 1.'
    }
    if (bal && total > Number(bal.remaining)) return `Request total (${money(total)}) exceeds the remaining contract balance (${money(bal.remaining)}).`
    return null
  }

  const trySubmit = async () => {
    setErr('')
    const v = validateReview()
    if (v) return setErr(v)
    setBusy(true)
    if (editId) { setBusy(false); return submit() }
    const { data: d } = await supabase.rpc('check_duplicates', {
      p_items: cart.map(x => ({ part_number: x.item.part_number, serial_number: x.serial.trim() })),
    })
    setBusy(false)
    if (d?.length) setDups(d)
    else submit()
  }

  const submit = async () => {
    setDups(null); setBusy(true); setErr('')
    const payload = cart.map(x => ({
      contract_item_id: x.item.id, quantity: x.quantity,
      htm_number: x.htm.trim(), serial_number: x.serial.trim(), work_order_number: x.wo.trim(),
      equipment_description: x.equip.trim(), device_model: x.model.trim(),
    }))
    if (editId) {
      const { error } = await supabase.rpc('update_request', {
        p_request_id: Number(editId), p_items: payload, p_supervisor_id: supervisorId,
      })
      setBusy(false)
      if (error) return setErr(error.message)
      setSaved(true)
      return
    }
    const { data, error } = await supabase.rpc('submit_request', {
      p_contract_id: contract.id, p_supervisor_id: asSupervisor ? profile.id : supervisorId, p_items: payload,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setDone(data); setStep('done')
  }

  const resubmit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('resubmit_request', { p_request_id: Number(editId) })
    setBusy(false)
    if (error) return setErr(error.message)
    navigate('/requests')
  }

  if (saved) return (
    <Card className="p-8 max-w-md mx-auto text-center">
      <div className="text-4xl mb-3">💾</div>
      <h1 className="text-lg font-bold mb-2">Changes saved</h1>
      <p className="text-sm text-slate-500 mb-6">The request has been updated. If it was returned to you, resubmit it so your supervisor can review it again.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Btn variant="secondary" onClick={() => navigate('/requests')}>Back to requests</Btn>
        <Btn variant="success" onClick={resubmit} disabled={busy}>Resubmit to supervisor</Btn>
      </div>
    </Card>
  )

  if (done) return (
    <Card className="p-8 max-w-md mx-auto text-center">
      <div className="text-4xl mb-3">✅</div>
      <h1 className="text-lg font-bold mb-1">Request submitted</h1>
      <p className="text-sm text-slate-500 mb-1">Request number</p>
      <div className="text-xl font-mono font-bold text-blue-700 mb-4">{done.request_number}</div>
      <p className="text-sm text-slate-500 mb-6">Total {money(done.total)} — remaining balance after approval would be {money(done.remaining_after)}. Your supervisor has been notified.</p>
      <div className="flex justify-center gap-2">
        <Btn variant="secondary" onClick={() => navigate('/requests')}>Track requests</Btn>
        <Btn onClick={() => { setStep('pick'); setCart([]); setContract(null); setDone(null); setContracts([]); setPoQuery(''); setVendorId('') }}>New request</Btn>
      </div>
    </Card>
  )

  if (step === 'pick') return (
    <div className="max-w-2xl mx-auto">
      <PageTitle>New parts request</PageTitle>
      {!asSupervisor && supervisors.length === 0 && (
        <Alert>You are not assigned to any supervisor yet. Ask your administrator to add you to a team before submitting requests.</Alert>
      )}
      {err && <Alert>{err}</Alert>}
      <Card className="p-5 mb-4">
        <h2 className="font-semibold mb-3">Find contract by PO number</h2>
        <div className="flex gap-2">
          <Input placeholder="e.g. PO-12345" value={poQuery} onChange={e => setPoQuery(e.target.value)} className="flex-1" />
          <Btn onClick={searchPO} disabled={!poQuery.trim()}>Search</Btn>
        </div>
      </Card>
      <Card className="p-5 mb-4">
        <h2 className="font-semibold mb-3">…or browse by vendor</h2>
        <Select value={vendorId} onChange={e => byVendor(e.target.value)}>
          <option value="">Select vendor…</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Card>
      {contracts.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Select the contract</h2>
          <div className="space-y-2">
            {contracts.map(c => (
              <button key={c.id} onClick={() => selectContract(c)}
                className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition">
                <div className="font-medium">{c.contract_number}</div>
                <div className="text-xs text-slate-500">PO {c.po_number} · {c.vendors?.name}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )

  if (step === 'browse') return (
    <div>
      <button onClick={() => setStep('pick')} className="text-sm text-blue-600 hover:underline mb-3">← Change contract</button>
      <Card className="p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold">{contract.contract_number} <span className="font-normal text-slate-500">· {contract.vendors?.name}</span></div>
          <div className="text-xs text-slate-500">PO {contract.po_number}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Remaining balance</div>
          <div className="font-bold text-emerald-700">{money(bal?.remaining)}</div>
        </div>
      </Card>
      {err && <Alert>{err}</Alert>}
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search parts by description or part number…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />
      </div>
      {filtered.length === 0 ? <Card className="p-6"><Empty text="No parts match." /></Card> : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 pb-24">
          {filtered.map(it => {
            const inCart = cart.find(x => x.item.id === it.id)
            return (
              <Card key={it.id} className="p-3 flex flex-col">
                {it.image_path
                  ? <img src={imgUrl(it.image_path)} alt="" className="w-full h-28 object-cover rounded-lg mb-2 border border-slate-100" />
                  : <div className="w-full h-28 rounded-lg bg-slate-100 mb-2 flex items-center justify-center text-slate-300 text-xs">No image</div>}
                <div className="text-xs text-slate-400">Line {it.line_number}</div>
                <div className="text-sm font-medium leading-snug flex-1">{it.description}</div>
                <div className="font-mono text-[11px] text-slate-500 mt-1">{it.part_number}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-bold text-sm">{money(it.unit_price)}</span>
                  {inCart
                    ? <Badge className="bg-emerald-100 text-emerald-800">×{inCart.quantity} added</Badge>
                    : null}
                </div>
                <Btn className="mt-2 w-full" variant={inCart ? 'secondary' : 'primary'} onClick={() => addToCart(it)}>
                  {inCart ? '+1' : 'Add to request'}
                </Btn>
              </Card>
            )
          })}
        </div>
      )}
      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 z-30">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <div className="text-sm"><b>{cart.length}</b> part{cart.length > 1 ? 's' : ''} · total <b>{money(total)}</b></div>
            <Btn onClick={() => setStep('review')}>Review request →</Btn>
          </div>
        </div>
      )}
    </div>
  )

  // review
  return (
    <div className="max-w-3xl mx-auto pb-10">
      <button onClick={() => setStep('browse')} className="text-sm text-blue-600 hover:underline mb-3">← {editId ? 'Add more parts' : 'Back to parts'}</button>
      <PageTitle>{editId ? 'Edit request' : 'Review request'}</PageTitle>
      <p className="text-sm text-slate-500 -mt-3 mb-4">Enter the device details for <b>each line</b>. A single request can cover parts for more than one device.</p>
      {err && <Alert>{err}</Alert>}
      <div className="space-y-3 mb-5">
        {cart.map(x => (
          <Card key={x.item.id} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="font-medium text-sm">{x.item.description}</div>
                <div className="font-mono text-[11px] text-slate-500">{x.item.part_number} · {money(x.item.unit_price)} each</div>
              </div>
              <button onClick={() => removeLine(x.item.id)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Quantity" type="number" min="1" value={x.quantity}
                onChange={e => setLine(x.item.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
              <Input label="HTM number *" value={x.htm} onChange={e => setLine(x.item.id, { htm: e.target.value })} placeholder="Device HTM no." />
              <Input label="Serial number *" value={x.serial} onChange={e => setLine(x.item.id, { serial: e.target.value })} placeholder="Device serial" />
              <Input label="Work order (W.O) *" value={x.wo} onChange={e => setLine(x.item.id, { wo: e.target.value })} placeholder="W.O number" />
              <Input label="Equipment description" value={x.equip} onChange={e => setLine(x.item.id, { equip: e.target.value })} placeholder="e.g. Ventilators, Sub-Acute" />
              <Input label="Model" value={x.model} onChange={e => setLine(x.item.id, { model: e.target.value })} placeholder="e.g. ASTRAL 150" />
            </div>
            <div className="text-right text-sm mt-2 text-slate-600">Line total: <b>{money(x.item.unit_price * x.quantity)}</b></div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <div className="grid sm:grid-cols-2 gap-4 items-end">
          {asSupervisor ? (
            <div className="text-sm bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-indigo-800">
              As a supervisor, this request goes straight to the clinical engineers — no supervisor approval needed.
            </div>
          ) : (
            <Select label="Send to supervisor *" value={supervisorId} onChange={e => setSupervisorId(e.target.value)}>
              <option value="">Select supervisor…</option>
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          )}
          <div className="text-right">
            <div className="text-sm text-slate-500">Request total</div>
            <div className="text-xl font-bold">{money(total)}</div>
            <div className="text-xs text-slate-400">Remaining balance: {money(bal?.remaining)}</div>
          </div>
        </div>
        <Btn className="w-full mt-4" onClick={trySubmit} disabled={busy || cart.length === 0}>
          {busy ? 'Saving…' : editId ? 'Save changes' : 'Submit request'}
        </Btn>
      </Card>
      <Modal open={!!dups} onClose={() => setDups(null)} title="Possible duplicate request">
        <p className="text-sm text-slate-600 mb-3">The same part was already requested for the same device (serial number) in a request that is not completed yet:</p>
        <div className="space-y-2 mb-4">
          {(dups || []).map((d, i) => (
            <div key={i} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <b>{d.part_number}</b> for serial <b>{d.serial_number}</b> — request {d.request_number} ({d.request_status}) by {d.engineer_name}
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-600 mb-4">Do you want to submit anyway?</p>
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setDups(null)}>Cancel</Btn>
          <Btn onClick={submit}>Submit anyway</Btn>
        </div>
      </Modal>
    </div>
  )
}
