import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, imgUrl } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { Card, SectionHead, Btn, Input, Select, Modal, Empty, PageTitle, BackLink, Alert, Badge, SearchInput, Icon } from '../ui.jsx'
import { money, statusLabel } from '../lib/helpers'

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

  const reset = () => { setStep('pick'); setCart([]); setContract(null); setDone(null); setContracts([]); setPoQuery(''); setVendorId(''); setSearch('') }
  const STEPS = [['pick', 'Contract'], ['browse', 'Parts'], ['review', 'Device details']]
  const stepIdx = STEPS.findIndex(x => x[0] === step)
  const Stepper = () => (
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
  const ContractBar = () => (
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
      <div className="num text-sm text-ink-500 mt-1 mb-4">Total {money(done.total)}</div>
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
      <Stepper />
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
                    <span className="block text-[13px] text-ink-500 mt-0.5">{c.vendors?.name} · <span className="num">PO {c.po_number}</span></span>
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

  if (step === 'browse') return (
    <div className="pb-24">
      <PageTitle back={<BackLink onClick={() => setStep('pick')}>Change contract</BackLink>}
        subtitle="Add every part you need. Device details come next.">Select parts</PageTitle>
      <Stepper />
      <ContractBar />
      {err && <Alert>{err}</Alert>}
      <SearchInput className="max-w-md mb-5" placeholder="Search by description or part number" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search parts" />
      {filtered.length === 0 ? <Card><Empty icon="search" title={items.length ? 'No parts match' : 'This contract has no line items yet'} hint={items.length ? 'Try a different description or part number.' : 'A supervisor needs to add the line items to the contract first.'} /></Card> : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map(it => {
            const inCart = cart.find(x => x.item.id === it.id)
            return (
              <Card key={it.id} className={`flex flex-col overflow-hidden transition-colors ${inCart ? 'border-ink-900' : ''}`}>
                {it.image_path
                  ? <img src={imgUrl(it.image_path)} alt="" className="w-full h-32 object-cover border-b border-ink-100" />
                  : <div className="w-full h-32 bg-ink-100 flex items-center justify-center text-ink-300 border-b border-ink-100"><Icon name="box" className="w-7 h-7" strokeWidth={1.3} /></div>}
                <div className="p-3.5 flex flex-col flex-1">
                  <div className="num text-[11px] text-ink-500">Line {it.line_number} · {it.part_number}</div>
                  <div className="text-sm font-medium text-ink-900 leading-snug mt-1 flex-1">{it.description}</div>
                  <div className="flex items-center justify-between gap-2 mt-3">
                    <span className="num text-sm font-medium text-ink-900">{money(it.unit_price)}</span>
                    {inCart && <Badge className="bg-ink-900 text-white num">× {inCart.quantity}</Badge>}
                  </div>
                  <Btn size="sm" className="mt-3 w-full" variant={inCart ? 'secondary' : 'dark'} icon="plus" onClick={() => addToCart(it)}>
                    {inCart ? 'Add one more' : 'Add to request'}
                  </Btn>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 lg:left-64 bg-ink-900 text-white z-30 shadow-pop">
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <div className="text-sm">
              <span className="num font-medium">{cart.reduce((n, x) => n + x.quantity, 0)}</span> part{cart.reduce((n, x) => n + x.quantity, 0) > 1 ? 's' : ''} on {cart.length} line{cart.length > 1 ? 's' : ''}
              <span className="text-ink-400"> · </span><span className="num font-medium">{money(total)}</span>
            </div>
            <Btn onClick={() => setStep('review')}>Continue to device details<Icon name="right" className="w-4 h-4" /></Btn>
          </div>
        </div>
      )}
    </div>
  )

  // review
  const over = bal && total > Number(bal.remaining)
  return (
    <div className="max-w-4xl pb-10">
      <PageTitle back={<BackLink onClick={() => setStep('browse')}>{editId ? 'Add more parts' : 'Back to parts'}</BackLink>}
        subtitle="Each line carries its own device, so one request can cover several devices.">{editId ? 'Edit request' : 'Device details'}</PageTitle>
      {!editId && <Stepper />}
      {err && <Alert>{err}</Alert>}
      {contract && <ContractBar />}
      <div className="space-y-4 mb-5">
        {cart.map((x, i) => (
          <Card key={x.item.id} className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-ink-100 bg-ink-50/60">
              <div className="min-w-0">
                <div className="num text-[11px] text-ink-500">Line {i + 1} of {cart.length} · {x.item.part_number}</div>
                <div className="text-sm font-medium text-ink-900 mt-0.5">{x.item.description}</div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <div className="num text-sm font-medium text-ink-900">{money(x.item.unit_price * x.quantity)}</div>
                  <div className="num text-[12px] text-ink-500">{money(x.item.unit_price)} each</div>
                </div>
                <button onClick={() => removeLine(x.item.id)} aria-label={`Remove ${x.item.part_number}`} title="Remove line"
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-700 hover:bg-brand-50"><Icon name="trash" className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
              <Input label="Quantity" type="number" min="1" value={x.quantity}
                onChange={e => setLine(x.item.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
              <Input label="HTM number" required value={x.htm} onChange={e => setLine(x.item.id, { htm: e.target.value })} />
              <Input label="Serial number" required value={x.serial} onChange={e => setLine(x.item.id, { serial: e.target.value })} />
              <Input label="Work order" required value={x.wo} onChange={e => setLine(x.item.id, { wo: e.target.value })} />
              <div className="col-span-2"><Input label="Equipment description (optional)" value={x.equip} onChange={e => setLine(x.item.id, { equip: e.target.value })} placeholder="Ventilators, Sub-Acute" /></div>
              <div className="col-span-2"><Input label="Model (optional)" value={x.model} onChange={e => setLine(x.item.id, { model: e.target.value })} placeholder="ASTRAL 150" /></div>
            </div>
          </Card>
        ))}
        {cart.length === 0 && <Card><Empty icon="box" title="No parts on this request" hint="Go back and add at least one part." /></Card>}
      </div>

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
          <div className="sm:text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Request total</div>
            <div className={`num text-[26px] leading-tight font-medium ${over ? 'text-brand-600' : 'text-ink-900'}`}>{money(total)}</div>
            <div className="text-[12px] text-ink-500">{over ? 'Exceeds' : 'Within'} the remaining balance of <span className="num">{money(bal?.remaining)}</span></div>
          </div>
        </div>
        <div className="flex justify-end mt-5 pt-5 border-t border-ink-100">
          <Btn size="lg" onClick={trySubmit} disabled={busy || cart.length === 0}>
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
