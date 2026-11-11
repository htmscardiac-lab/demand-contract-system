import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, imgUrl } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Btn, Input, Select, Modal, Empty, PageTitle, BackLink, Alert, Badge, SearchInput, Icon } from '../ui.jsx'
import { money, statusLabel, vatFor, fmtQty } from '../lib/helpers'

const CONTRACT_SELECT = '*, vendors(name)'
let nextKey = 1
const newDevice = () => ({ key: nextKey++, htm: '', serial: '', wo: '', lines: [] })   // lines: { item, quantity, equip, model }
const deviceReady = (d) => d.htm.trim() && d.serial.trim() && d.wo.trim()
const deviceName = (d, i) => d.htm.trim() ? `HTM ${d.htm.trim()}` : `Device ${i + 1}`

// Quantity control: type a number, or step with the buttons. Zero removes the part.
function Stepper({ value, onChange, min = 0, label }) {
  const set = (v) => onChange(Math.max(min, Math.floor(Number(v)) || 0))
  return (
    <div className="inline-flex items-center h-9 rounded-lg border border-ink-300 bg-white overflow-hidden" role="group" aria-label={label}>
      <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label="Decrease quantity"
        className="w-9 h-full flex items-center justify-center text-ink-600 hover:bg-ink-100 disabled:opacity-35 disabled:pointer-events-none text-lg leading-none">−</button>
      <input type="number" min={min} inputMode="numeric" value={value} onChange={e => set(e.target.value)} onFocus={e => e.target.select()} aria-label="Quantity"
        className="num w-12 h-full text-center text-sm text-ink-900 border-x border-ink-200 focus:outline-none focus:bg-brand-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" onClick={() => set(value + 1)} aria-label="Increase quantity"
        className="w-9 h-full flex items-center justify-center text-ink-600 hover:bg-ink-100 text-lg leading-none">+</button>
    </div>
  )
}

export default function NewRequest() {
  const { profile } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const asSupervisor = profile.role === 'supervisor' || profile.role === 'admin'
  const [step, setStep] = useState('pick')          // pick -> parts -> review
  const [vendors, setVendors] = useState([])
  const [contracts, setContracts] = useState([])
  const [poQuery, setPoQuery] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [contract, setContract] = useState(null)
  const [bal, setBal] = useState(null)
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [devices, setDevices] = useState(() => [newDevice()])
  const [active, setActive] = useState(0)
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
        .select(`*, request_items(*), contracts(${CONTRACT_SELECT})`)
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
      const groups = new Map()
      for (const it of [...(req.request_items || [])].sort((a, b) => a.id - b.id)) {
        if (it.is_vat || !byId[it.contract_item_id]) continue      // the VAT line is recalculated on save
        const k = [it.htm_number, it.serial_number, it.work_order_number].join('|')
        if (!groups.has(k)) groups.set(k, { ...newDevice(), htm: it.htm_number, serial: it.serial_number, wo: it.work_order_number })
        groups.get(k).lines.push({ item: byId[it.contract_item_id], quantity: Number(it.quantity), equip: it.equipment_description || '', model: it.device_model || '' })
      }
      setDevices(groups.size ? [...groups.values()] : [newDevice()])
      setActive(0); setStep('review')
    })()
  }, [editId])

  const searchPO = async () => {
    setErr('')
    const { data } = await supabase.from('contracts').select(CONTRACT_SELECT).ilike('po_number', `%${poQuery.trim()}%`)
    if (!data?.length) return setErr('No contract found with that PO number.')
    setContracts(data)
    if (data.length === 1) selectContract(data[0])
  }

  const byVendor = async (vid) => {
    setVendorId(vid); setErr('')
    if (!vid) { setContracts([]); return }
    const { data } = await supabase.from('contracts').select(CONTRACT_SELECT).eq('vendor_id', vid)
    setContracts(data || [])
    if (data?.length === 1) selectContract(data[0])
  }

  const selectContract = async (c) => {
    setContract(c); setErr('')
    const [{ data: b }, { data: ci }] = await Promise.all([
      supabase.from('contract_balances').select('*').eq('contract_id', c.id).single(),
      supabase.from('contract_items').select('*').eq('contract_id', c.id).order('line_number'),
    ])
    setBal(b); setItems(ci || []); setDevices([newDevice()]); setActive(0); setStep('parts')
  }

  // ---- devices and their parts
  const patchDevice = (i, patch) => setDevices(ds => ds.map((d, j) => j === i ? { ...d, ...patch } : d))
  const setQty = (i, item, quantity) => setDevices(ds => ds.map((d, j) => {
    if (j !== i) return d
    if (quantity <= 0) return { ...d, lines: d.lines.filter(l => l.item.id !== item.id) }
    return d.lines.some(l => l.item.id === item.id)
      ? { ...d, lines: d.lines.map(l => l.item.id === item.id ? { ...l, quantity } : l) }
      : { ...d, lines: [...d.lines, { item, quantity, equip: '', model: '' }] }
  }))
  const addDevice = () => { setDevices(ds => [...ds, newDevice()]); setActive(devices.length); setErr('') }
  const removeDevice = (i) => { setDevices(ds => ds.length > 1 ? ds.filter((_, j) => j !== i) : [newDevice()]); setActive(a => Math.max(0, a >= i ? a - 1 : a)) }

  const allLines = useMemo(() => devices.flatMap(d => d.lines.map(l => ({ ...l, device: d }))), [devices])
  const total = useMemo(() => allLines.reduce((s, l) => s + l.item.unit_price * l.quantity, 0), [allLines])
  const units = allLines.reduce((n, l) => n + l.quantity, 0)
  // totals per part across devices, for the summary the reviewers read
  const partTotals = useMemo(() => {
    const map = new Map()
    devices.forEach((d, i) => d.lines.forEach(l => {
      if (!map.has(l.item.id)) map.set(l.item.id, { item: l.item, quantity: 0, on: [] })
      const g = map.get(l.item.id); g.quantity += l.quantity; g.on.push({ name: deviceName(d, i), quantity: l.quantity })
    }))
    return [...map.values()].sort((a, b) => a.item.line_number - b.item.line_number)
  }, [devices])

  // VAT is added as its own line: 15% of the taxed parts, as a quantity of the contract's VAT line
  const taxable = useMemo(() => allLines.filter(l => l.item.taxable).reduce((s, l) => s + l.item.unit_price * l.quantity, 0), [allLines])
  const vatMissing = taxable > 0 && !(Number(contract?.vat_line_value) > 0 && contract?.vat_line_number)
  const vat = vatFor(taxable, contract?.vat_line_value)
  const grandTotal = total + vat.amount

  const filtered = items.filter(i =>
    !search || i.description.toLowerCase().includes(search.toLowerCase()) || i.part_number.toLowerCase().includes(search.toLowerCase()))

  // first problem with the devices, and which device it is on
  const deviceProblem = () => {
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i]
      if (!deviceReady(d)) return { i, msg: `Device ${i + 1}: HTM number, serial number and work order are all required.` }
      if (d.lines.length === 0) return { i, msg: `Device ${i + 1} has no parts. Add a part or remove the device.` }
      const twin = devices.findIndex((o, j) => j < i && o.htm.trim() === d.htm.trim() && o.serial.trim() === d.serial.trim() && o.wo.trim() === d.wo.trim())
      if (twin >= 0) return { i, msg: `Device ${i + 1} repeats Device ${twin + 1}. Put all of its parts under one device.` }
    }
    return null
  }
  const toReview = () => {
    const p = deviceProblem()
    if (p) { setActive(p.i); return setErr(p.msg) }
    setErr(''); setStep('review'); window.scrollTo(0, 0)
  }

  const validateReview = () => {
    const p = deviceProblem()
    if (p) return p.msg
    if (!asSupervisor && !supervisorId) return 'Select the supervisor to send the request to.'
    if (vatMissing) return 'This request has parts with VAT, but the contract has no VAT line. Ask a supervisor to set the VAT line on the contract first.'
    if (bal && grandTotal > Number(bal.remaining)) return `Request total including VAT (${money(grandTotal)}) exceeds the remaining contract balance (${money(bal.remaining)}).`
    return null
  }

  const trySubmit = async () => {
    setErr('')
    const v = validateReview()
    if (v) return setErr(v)
    if (editId) return submit()
    setBusy(true)
    const { data: d } = await supabase.rpc('check_duplicates', {
      p_items: allLines.map(l => ({ part_number: l.item.part_number, serial_number: l.device.serial.trim() })),
    })
    setBusy(false)
    if (d?.length) setDups(d)
    else submit()
  }

  const submit = async () => {
    setDups(null); setBusy(true); setErr('')
    const payload = allLines.map(l => ({
      contract_item_id: l.item.id, quantity: l.quantity,
      htm_number: l.device.htm.trim(), serial_number: l.device.serial.trim(), work_order_number: l.device.wo.trim(),
      equipment_description: (l.item.equipment_description || l.equip || '').trim(),
      device_model: (l.item.device_model || l.model || '').trim(),
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
    setDone(data)
  }

  const resubmit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('resubmit_request', { p_request_id: Number(editId) })
    setBusy(false)
    if (error) return setErr(error.message)
    navigate('/requests')
  }

  const reset = () => { setStep('pick'); setDevices([newDevice()]); setActive(0); setContract(null); setDone(null); setContracts([]); setPoQuery(''); setVendorId(''); setSearch('') }
  const STEPS = [['pick', 'Contract'], ['parts', 'Devices and parts'], ['review', 'Review']]
  const stepIdx = STEPS.findIndex(x => x[0] === step)
  const stepper = (
    <ol className="flex items-center gap-2 sm:gap-3 mb-6 text-[13px]">
      {STEPS.map(([k, label], i) => (
        <li key={k} className="flex items-center gap-2 sm:gap-3">
          {i > 0 && <span className={`w-6 sm:w-10 h-px ${i <= stepIdx ? 'bg-ink-900' : 'bg-ink-300'}`} />}
          <span className={`num w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium
            ${i < stepIdx ? 'bg-ink-900 text-white' : i === stepIdx ? 'bg-brand-600 text-white' : 'bg-white border border-ink-300 text-ink-500'}`}>
            {i < stepIdx ? <Icon name="check" className="w-3.5 h-3.5" strokeWidth={2.6} /> : i + 1}
          </span>
          <span className={i === stepIdx ? 'font-medium text-ink-900' : 'text-ink-500'}>{label}</span>
        </li>
      ))}
    </ol>
  )
  const contractBar = contract && (
    <Card className="px-5 py-4 mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Contract</div>
        <div className="text-[15px] font-medium text-ink-900 mt-0.5">{contract.contract_number}</div>
        <div className="text-[13px] text-ink-500">{contract.vendors?.name} · PO <span className="num">{contract.po_number}</span></div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Remaining balance</div>
        <div className="num text-[22px] font-medium text-olive-700 mt-0.5">{money(bal?.remaining)}</div>
      </div>
    </Card>
  )

  if (saved) return (
    <Card className="p-8 max-w-md mx-auto text-center mt-6">
      <div className="w-12 h-12 rounded-full bg-olive-100 text-olive-700 flex items-center justify-center mx-auto mb-4"><Icon name="check" /></div>
      <h1 className="font-display font-semibold text-xl tracking-wide uppercase mb-2">Changes saved</h1>
      <p className="text-sm text-ink-500 mb-6">The request is updated. If it was returned to you, resubmit it so it goes back for review.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Btn variant="secondary" onClick={() => navigate('/requests')}>Back to requests</Btn>
        <Btn onClick={resubmit} disabled={busy}>Resubmit</Btn>
      </div>
    </Card>
  )

  if (done) return (
    <Card className="p-8 max-w-md mx-auto text-center mt-6">
      <div className="w-12 h-12 rounded-full bg-olive-100 text-olive-700 flex items-center justify-center mx-auto mb-4"><Icon name="check" /></div>
      <h1 className="font-display font-semibold text-xl tracking-wide uppercase">Request submitted</h1>
      <div className="num text-2xl font-medium text-ink-900 mt-4">{done.request_number}</div>
      <div className="text-sm text-ink-500 mt-1 mb-4">Total <span className="num">{money(done.total)}</span>{Number(done.vat) > 0 && <> including VAT <span className="num">{money(done.vat)}</span></>}</div>
      <p className="text-sm text-ink-500 mb-6">
        {done.status === 'pending_clinical' ? 'The clinical engineers have been notified.' : 'Your supervisor has been notified.'}
      </p>
      <div className="flex justify-center gap-2">
        <Btn variant="secondary" onClick={() => navigate(`/requests?open=${done.request_id}`)}>View request</Btn>
        <Btn icon="plus" onClick={reset}>New request</Btn>
      </div>
    </Card>
  )

  if (step === 'pick') return (
    <div className="max-w-4xl">
      <PageTitle subtitle="Choose the demand contract the parts will be released against.">New request</PageTitle>
      {stepper}
      {!asSupervisor && supervisors.length === 0 && (
        <Alert kind="warn">You are not on a supervisor's team yet. Ask an administrator to add you before you submit a request.</Alert>
      )}
      {err && <Alert>{err}</Alert>}
      <div className="grid md:grid-cols-2 gap-5">
        <Card className="p-5">
          <h2 className="font-display font-semibold text-[15px] tracking-wide uppercase text-ink-900">Find by PO number</h2>
          <p className="text-[13px] text-ink-500 mt-1 mb-4">Enter all or part of the purchase order number.</p>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (poQuery.trim()) searchPO() }}>
            <div className="flex-1"><Input placeholder="PO-12345" value={poQuery} onChange={e => setPoQuery(e.target.value)} aria-label="PO number" /></div>
            <Btn variant="dark" icon="search" disabled={!poQuery.trim()}>Find</Btn>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="font-display font-semibold text-[15px] tracking-wide uppercase text-ink-900">Browse by vendor</h2>
          <p className="text-[13px] text-ink-500 mt-1 mb-4">Lists every contract held with the vendor.</p>
          <Select value={vendorId} onChange={e => byVendor(e.target.value)} aria-label="Vendor">
            <option value="">Select a vendor</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Card>
      </div>
      {contracts.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <SectionHead title={`Matching contracts · ${contracts.length}`} />
          <ul>
            {contracts.map(c => (
              <li key={c.id}>
                <button onClick={() => selectContract(c)} className="w-full flex items-center justify-between gap-4 px-5 py-3.5 border-b border-ink-100 last:border-0 text-left hover:bg-ink-50 transition-colors">
                  <span>
                    <span className="block text-sm font-medium text-ink-900">{c.contract_number}</span>
                    <span className="block text-[13px] text-ink-500 mt-0.5">{c.vendors?.name} · PO <span className="num">{c.po_number}</span></span>
                  </span>
                  <Icon name="right" className="w-4 h-4 text-ink-300" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )

  // tabs to move between the devices of the request
  const deviceTabs = (
    <div className="flex flex-wrap items-center gap-2 mb-4" role="tablist" aria-label="Devices">
      {devices.map((d, i) => (
        <button key={d.key} role="tab" aria-selected={i === active} onClick={() => { setActive(i); setErr('') }}
          className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium border transition-colors
            ${i === active ? 'bg-ink-900 border-ink-900 text-white' : 'bg-white border-ink-300 text-ink-700 hover:border-ink-500'}`}>
          {deviceName(d, i)}
          <span className={`num text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center ${i === active ? 'bg-white/20' : 'bg-ink-100 text-ink-600'}`}>
            {d.lines.reduce((n, l) => n + l.quantity, 0)}
          </span>
        </button>
      ))}
      <Btn variant="ghost" size="sm" icon="plus" className="h-9" onClick={addDevice}>Add another device</Btn>
    </div>
  )

  if (step === 'parts') {
    const d = devices[active] || devices[0]
    return (
      <div className="pb-24">
        <PageTitle back={!editId && <BackLink onClick={() => setStep('pick')}>Change contract</BackLink>}
          subtitle="Enter a device once, then pick its parts. Add another device if the request covers more than one.">Devices and parts</PageTitle>
        {!editId && stepper}
        {contractBar}
        {err && <Alert>{err}</Alert>}
        {deviceTabs}

        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-display font-semibold text-[15px] tracking-wide uppercase text-ink-900">Device {active + 1} of {devices.length}</h2>
            {devices.length > 1 && <Btn variant="ghost" size="sm" icon="trash" onClick={() => removeDevice(active)}>Remove device</Btn>}
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="HTM number" value={d.htm} onChange={e => patchDevice(active, { htm: e.target.value })} />
            <Input label="Serial number" value={d.serial} onChange={e => patchDevice(active, { serial: e.target.value })} />
            <Input label="Work order (W.O)" value={d.wo} onChange={e => patchDevice(active, { wo: e.target.value })} />
          </div>
          <p className="text-[13px] text-ink-500 mt-3">These three apply to every part you add below for this device.</p>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display font-semibold text-[15px] tracking-wide uppercase text-ink-900">Parts for {deviceName(d, active)}</h2>
          <SearchInput className="w-full sm:w-80" placeholder="Search by description or part number" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search parts" />
        </div>
        {filtered.length === 0 ? <Card><Empty icon="search" title={items.length ? 'No parts match' : 'This contract has no line items yet'} hint={items.length ? 'Try a different description or part number.' : 'A supervisor needs to add the line items to the contract first.'} /></Card> : (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map(it => {
              const qty = d.lines.find(l => l.item.id === it.id)?.quantity || 0
              const elsewhere = partTotals.find(p => p.item.id === it.id)?.quantity - qty || 0
              return (
                <Card key={it.id} className={`flex flex-col overflow-hidden transition-colors ${qty ? 'border-ink-900' : ''}`}>
                  {it.image_path
                    ? <img src={imgUrl(it.image_path)} alt="" className="w-full h-32 object-cover border-b border-ink-100" />
                    : <div className="w-full h-32 bg-ink-100 flex items-center justify-center text-ink-300 border-b border-ink-100"><Icon name="box" className="w-7 h-7" strokeWidth={1.3} /></div>}
                  <div className="p-3.5 flex flex-col flex-1">
                    <div className="num text-[11px] text-ink-500">Line {it.line_number} · {it.part_number}</div>
                    <div className="text-sm font-medium text-ink-900 leading-snug mt-1">{it.description}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-500 mt-1 flex-1 content-start">
                      {it.device_model && <span>{it.device_model}</span>}
                      {!!it.taxable && <Badge className="bg-gold-100 text-gold-700">VAT</Badge>}
                    </div>
                    <div className="mt-3"><span className="num text-sm font-medium text-ink-900">{money(it.unit_price)}</span> <span className="text-[11px] text-ink-500">before VAT</span></div>
                    <div className="flex items-center justify-between gap-2 mt-3">
                      {qty > 0
                        ? <Stepper value={qty} onChange={v => setQty(active, it, v)} label={`Quantity of ${it.part_number}`} />
                        : <Btn size="sm" variant="dark" icon="plus" className="h-9" onClick={() => setQty(active, it, 1)}>Add</Btn>}
                      {qty > 0 && <button onClick={() => setQty(active, it, 0)} aria-label={`Remove ${it.part_number}`} title="Remove from this device"
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-700 hover:bg-brand-50"><Icon name="trash" className="w-4 h-4" /></button>}
                    </div>
                    {elsewhere > 0 && <div className="text-[12px] text-steel-700 mt-2">Also <span className="num">{elsewhere}</span> on other devices</div>}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
        <div className="fixed bottom-0 inset-x-0 lg:left-64 bg-ink-900 text-white z-30 shadow-pop">
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <div className="text-sm">
              <span className="num font-medium">{devices.length}</span> device{devices.length > 1 ? 's' : ''}
              <span className="text-ink-400"> · </span><span className="num font-medium">{units}</span> part{units === 1 ? '' : 's'}
              <span className="text-ink-400"> · </span><span className="num font-medium">{money(total)}</span> <span className="text-ink-400">before VAT</span>
            </div>
            <Btn onClick={toReview} disabled={units === 0}>Review request<Icon name="right" className="w-4 h-4" /></Btn>
          </div>
        </div>
      </div>
    )
  }

  // review
  const over = bal && grandTotal > Number(bal.remaining)
  const shared = partTotals.filter(p => p.on.length > 1)
  const noModel = partTotals.filter(p => !p.item.device_model || !p.item.equipment_description).length
  return (
    <div className="max-w-4xl pb-10">
      <PageTitle back={<BackLink onClick={() => { setStep('parts'); setErr('') }}>{editId ? 'Change devices and parts' : 'Back to devices and parts'}</BackLink>}
        subtitle="Check each device and its parts before you send the request.">{editId ? 'Edit request' : 'Review request'}</PageTitle>
      {!editId && stepper}
      {err && <Alert>{err}</Alert>}
      {contractBar}
      {noModel > 0 && <Alert kind="warn">{noModel} part{noModel === 1 ? ' has' : 's have'} no model or equipment description on the contract, so {noModel === 1 ? 'that column stays' : 'those columns stay'} empty in the release email. A supervisor can add them on the contract line.</Alert>}
      {vatMissing && <Alert>This request has parts with VAT, but contract {contract.contract_number} has no VAT line. A supervisor needs to set the VAT line on the contract before the request can be submitted.</Alert>}

      <div className="space-y-4 mb-5">
        {devices.map((d, i) => (
          <Card key={d.key} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 border-b border-ink-100 bg-ink-50/60">
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Device {i + 1} · HTM</dt><dd className="num text-sm font-medium text-ink-900 mt-0.5">{d.htm || '—'}</dd></div>
                <div><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Serial</dt><dd className="num text-sm font-medium text-ink-900 mt-0.5">{d.serial || '—'}</dd></div>
                <div><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Work order</dt><dd className="num text-sm font-medium text-ink-900 mt-0.5">{d.wo || '—'}</dd></div>
              </dl>
              <Btn size="sm" variant="secondary" icon="edit" onClick={() => { setActive(i); setStep('parts'); setErr('') }}>Edit device</Btn>
            </div>
            {d.lines.length === 0 ? <p className="px-5 py-4 text-[13px] text-brand-700">No parts on this device.</p> : (
              <ul>
                {d.lines.map(l => (
                  <li key={l.item.id} className="px-5 py-3.5 border-b border-ink-100 last:border-0">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="text-sm font-medium text-ink-900">{l.item.description}</div>
                        <div className="text-[12px] text-ink-500 mt-0.5">
                          <span className="num">Line {l.item.line_number} · {l.item.part_number}</span>
                          {(l.item.device_model || l.item.equipment_description) && <> · {[l.item.equipment_description, l.item.device_model].filter(Boolean).join(', ')}</>}
                          {!!l.item.taxable && <Badge className="bg-gold-100 text-gold-700 ml-2">VAT</Badge>}
                        </div>
                      </div>
                      <Stepper min={1} value={l.quantity} onChange={v => setQty(i, l.item, v)} label={`Quantity of ${l.item.part_number}`} />
                      <div className="text-right w-32">
                        <div className="num text-sm font-medium text-ink-900">{money(l.item.unit_price * l.quantity)}</div>
                        <div className="text-[12px] text-ink-500"><span className="num">{money(l.item.unit_price)}</span> each</div>
                      </div>
                      <button onClick={() => setQty(i, l.item, 0)} aria-label={`Remove ${l.item.part_number}`} title="Remove from request"
                        className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-700 hover:bg-brand-50"><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {shared.length > 0 && (
        <Card className="overflow-hidden mb-5">
          <SectionHead title="Parts requested for more than one device" hint="Totals across the whole request" />
          <ul>
            {shared.map(p => (
              <li key={p.item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-ink-100 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900">{p.item.description}</div>
                  <div className="text-[12px] text-ink-500 mt-0.5">{p.on.map(o => `${o.name} × ${o.quantity}`).join(' · ')}</div>
                </div>
                <div className="text-sm text-ink-900">Total <span className="num font-medium">{p.quantity}</span> for {p.on.length} devices</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-5 items-end">
          {asSupervisor ? (
            <div className="text-[13px] text-ink-600 bg-ink-50 border border-ink-200 rounded-lg px-4 py-3">
              Your requests skip supervisor approval and go straight to the clinical engineers.
            </div>
          ) : (
            <div className="max-w-sm"><Select label="Send to supervisor" value={supervisorId} onChange={e => setSupervisorId(e.target.value)}>
              <option value="">Select a supervisor</option>
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select></div>
          )}
          <div className="sm:text-right sm:min-w-[300px]">
            <dl className="text-sm space-y-1.5 mb-3 pb-3 border-b border-ink-100">
              <div className="flex justify-between gap-6"><dt className="text-ink-500">Parts, before VAT</dt><dd className="num text-ink-900">{money(total)}</dd></div>
              <div className="flex justify-between gap-6">
                <dt className="text-ink-500 text-left">VAT 15%{vat.qty > 0 && <span className="block text-[12px]">Line <span className="num">{contract.vat_line_number}</span> · quantity <span className="num">{fmtQty(vat.qty)}</span> × <span className="num">{money(contract.vat_line_value)}</span></span>}
                  {taxable === 0 && <span className="block text-[12px]">No taxed parts on this request</span>}</dt>
                <dd className="num text-ink-900">{vatMissing ? '—' : money(vat.amount)}</dd>
              </div>
            </dl>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Request total, including VAT</div>
            <div className={`num text-[26px] leading-tight font-medium ${over ? 'text-brand-600' : 'text-ink-900'}`}>{money(grandTotal)}</div>
            <div className="text-[12px] text-ink-500">{over ? 'Exceeds' : 'Within'} the remaining balance of <span className="num">{money(bal?.remaining)}</span></div>
          </div>
        </div>
        <div className="flex justify-end mt-5 pt-5 border-t border-ink-100">
          <Btn size="lg" onClick={trySubmit} disabled={busy || units === 0 || vatMissing}>
            {busy ? 'Saving…' : editId ? 'Save changes' : 'Submit request'}
          </Btn>
        </div>
      </Card>

      <Modal open={!!dups} onClose={() => setDups(null)} title="Possible duplicate">
        <p className="text-sm text-ink-600 mb-4">The same part is already on an open request for the same device serial number.</p>
        <ul className="space-y-2 mb-4">
          {(dups || []).map((d, i) => (
            <li key={i} className="text-[13px] bg-amber-100/60 border border-gold-200 rounded-lg px-3.5 py-2.5 text-ink-800">
              <span className="num font-medium">{d.part_number}</span> for serial <span className="num font-medium">{d.serial_number}</span>
              <div className="text-ink-600 mt-0.5"><span className="num">{d.request_number}</span> · {statusLabel(d.status)} · {d.engineer_name}</div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 mt-6">
          <Btn variant="secondary" onClick={() => setDups(null)}>Go back</Btn>
          <Btn onClick={submit}>Submit anyway</Btn>
        </div>
      </Modal>
    </div>
  )
}
