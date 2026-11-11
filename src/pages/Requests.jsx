import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { usePoll } from '../lib/poll.js'
import { Card, Btn, Input, Select, Textarea, Badge, Modal, Drawer, Spinner, Empty, PageTitle, Alert, TableWrap, Th, Td, Row,
         Tabs, SearchInput, Field, Meter, Icon } from '../ui.jsx'
import { MrrModal, MrrReminderModal, unlinkedReceipts } from '../lib/mrr.jsx'
import { money, fmtDate, fmtDateTime, STATUS_STYLE, statusLabel, receiptLabel, actionFor, requestTotal, isOverdue, fmtQty, groupByDevice, groupByPart,
         ACTIVE_STATUSES, DONE_STATUSES, buildTimeline, buildApprovalEmail, downloadOutlookEmail } from '../lib/helpers'

export const REQUEST_QUERY = `*, request_items(*), request_receipts(*), mrrs(*),
  contracts(id, contract_number, po_number, vendors(name, vendor_contacts(name, email, phone))),
  engineer:profiles!requests_engineer_id_fkey(id, full_name),
  supervisor:profiles!requests_supervisor_id_fkey(id, full_name)`

const VIEWS = ['action', 'open', 'done', 'archived']

export default function Requests() {
  const { profile } = useApp()
  const navigate = useNavigate()
  const [reqs, setReqs] = useState(null)
  const [sel, setSel] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState(VIEWS.includes(params.get('view')) ? params.get('view') : null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select(REQUEST_QUERY).order('submitted_at', { ascending: false })
    setReqs(data || [])
    return data || []
  }, [])
  usePoll(load, 8000, [])

  // deep-link: /requests?open=<id> opens that request (from a notification or the overview)
  const openId = params.get('open')
  useEffect(() => {
    if (!openId || !reqs) return
    const r = reqs.find(x => String(x.id) === String(openId))
    if (r) setSel(r)
    params.delete('open'); setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, reqs])

  if (!reqs) return <Spinner />
  const live = reqs.filter(r => !r.archived)
  const groups = {
    action: live.filter(r => actionFor(r, profile)),
    open: live.filter(r => ACTIVE_STATUSES.includes(r.status)),
    done: live.filter(r => DONE_STATUSES.includes(r.status)),
    archived: reqs.filter(r => r.archived),
  }
  // default tab: your queue if it has anything, otherwise everything that is open
  const tab = view || (groups.action.length ? 'action' : 'open')
  const needle = q.trim().toLowerCase()
  const shown = groups[tab]
    .filter(r => !status || r.status === status)
    .filter(r => !needle || [r.request_number, r.engineer?.full_name, r.supervisor?.full_name, r.contracts?.contract_number,
      r.contracts?.po_number, r.contracts?.vendors?.name, r.release_number]
      .some(x => String(x || '').toLowerCase().includes(needle)))
  const statusOptions = [...new Set(groups[tab].map(r => r.status))]
  const canRequest = ['engineer', 'supervisor', 'admin'].includes(profile.role)
  const emptyText = {
    action: ['Nothing is waiting on you', 'Requests that need your decision, release or amendment appear here.'],
    open: ['No open requests', 'Requests appear here from submission until every part is received.'],
    done: ['No completed requests yet', 'Closed, rejected and cancelled requests are listed here.'],
    archived: ['The archive is empty', 'Archive a closed request to move it out of the working lists.'],
  }[tab]

  return (
    <div>
      <PageTitle subtitle="Every request from submission to receipt, in one place."
        right={canRequest && <Btn icon="plus" onClick={() => navigate('/new-request')}>New request</Btn>}>Requests</PageTitle>

      <Card className="overflow-hidden">
        <Tabs className="px-2" value={tab} onChange={(k) => { setView(k); setStatus('') }} tabs={[
          { key: 'action', label: 'Needs my action', count: groups.action.length, alert: true },
          { key: 'open', label: 'Open', count: groups.open.length },
          { key: 'done', label: 'Completed', count: groups.done.length },
          { key: 'archived', label: 'Archived', count: groups.archived.length },
        ]} />
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-ink-100">
          <SearchInput className="flex-1 min-w-[220px] max-w-md" placeholder="Search request, engineer, contract, PO or release" value={q} onChange={e => setQ(e.target.value)} aria-label="Search requests" />
          {statusOptions.length > 1 && (
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"
              className="h-9.5 rounded-lg border border-ink-300 bg-white px-3 pr-8 text-sm text-ink-800 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100">
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          )}
          <span className="text-[13px] text-ink-500 ml-auto">{shown.length} of {groups[tab].length}</span>
        </div>
        {shown.length === 0 ? (
          groups[tab].length === 0 ? <Empty title={emptyText[0]} hint={emptyText[1]} /> : <Empty icon="search" title="No requests match" hint="Clear the search or the status filter to see the full list." />
        ) : (
          <>
          <ul className="md:hidden">
            {shown.map(r => {
              const late = isOverdue(r)
              return (
                <li key={r.id}>
                  <button onClick={() => setSel(r)} className="w-full text-left px-5 py-4 border-b border-ink-100 last:border-0 active:bg-ink-50">
                    <span className="flex items-start justify-between gap-3">
                      <span className="num text-sm font-medium text-ink-900">{r.request_number}</span>
                      <span className="num text-sm text-ink-900">{money(requestTotal(r))}</span>
                    </span>
                    <span className="block text-[13px] text-ink-500 mt-1">{r.engineer?.full_name} · {r.contracts?.contract_number}</span>
                    <span className="flex flex-wrap items-center gap-2 mt-2.5">
                      <Badge className={STATUS_STYLE[r.status]}>{statusLabel(r.status)}</Badge>
                      {r.promise_date && <span className={`text-[12px] ${late ? 'text-brand-700 font-medium' : 'text-ink-500'}`}>{late ? 'Overdue · ' : 'Promise '}{fmtDate(r.promise_date)}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <TableWrap className="hidden md:block">
            <thead><tr><Th>Request</Th><Th>Requested by</Th><Th>Contract</Th><Th right>Total</Th><Th>Status</Th><Th>Release</Th><Th>Promise date</Th><Th>Lines received</Th></tr></thead>
            <tbody>
              {shown.map(r => {
                // counted in lines, so the fractional VAT line reads the same as a part line
                const tot = r.request_items.length
                const got = r.request_items.filter(i => (i.received_quantity || 0) >= i.quantity).length
                const tracked = ['in_process', 'approved', 'closed'].includes(r.status)
                const late = isOverdue(r)
                return (
                  <Row key={r.id} onClick={() => setSel(r)}>
                    <Td className="whitespace-nowrap"><div className="num font-medium text-ink-900">{r.request_number}</div><div className="text-[12px] text-ink-500 mt-0.5">{fmtDate(r.submitted_at)}</div></Td>
                    <Td><div className="text-ink-900">{r.engineer?.full_name}</div>{r.supervisor?.id !== r.engineer?.id && <div className="text-[12px] text-ink-500 mt-0.5">to {r.supervisor?.full_name}</div>}</Td>
                    <Td><div className="text-ink-900">{r.contracts?.contract_number}</div><div className="text-[12px] text-ink-500 mt-0.5">{r.contracts?.vendors?.name}</div></Td>
                    <Td right className="num text-ink-900">{money(requestTotal(r))}</Td>
                    <Td><Badge className={STATUS_STYLE[r.status]}>{statusLabel(r.status)}</Badge></Td>
                    <Td className="num text-[13px] whitespace-nowrap">{r.release_number || <span className="text-ink-300">—</span>}</Td>
                    <Td className={late ? 'text-brand-700 font-medium' : ''}>{r.promise_date ? fmtDate(r.promise_date) : <span className="text-ink-300">—</span>}{late && <div className="text-[12px] font-normal">Overdue</div>}</Td>
                    <Td>{tracked ? (
                      <div className="w-24"><div className="num text-[12px] text-ink-600 mb-1">{got} / {tot} lines</div><Meter pct={tot ? got / tot * 100 : 0} /></div>
                    ) : <span className="text-ink-300">—</span>}</Td>
                  </Row>
                )
              })}
            </tbody>
          </TableWrap>
          </>
        )}
      </Card>
      {sel && <RequestDetail request={sel} onClose={() => { load(); setSel(null) }} />}
    </div>
  )
}

function Timeline({ request }) {
  const stages = buildTimeline(request)
  const dot = {
    done: 'bg-olive-600 border-olive-600 text-white',
    current: 'bg-white border-brand-600 text-brand-700 ring-4 ring-brand-100',
    returned: 'bg-brand-600 border-brand-600 text-white ring-4 ring-brand-100',
    rejected: 'bg-brand-600 border-brand-600 text-white',
    upcoming: 'bg-white border-ink-200 text-ink-400',
  }
  return (
    <ol className="flex overflow-x-auto pb-1">
      {stages.map((st, i) => (
        <li key={st.key} className="relative flex-1 min-w-[84px] text-center px-1">
          {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2 ${stages[i - 1].state === 'done' ? 'bg-olive-500' : 'bg-ink-200'}`} />}
          <span className={`relative z-[1] mx-auto w-7 h-7 rounded-full border-2 flex items-center justify-center num text-[11px] font-medium ${dot[st.state]}`}>
            {st.state === 'done' ? <Icon name="check" className="w-3.5 h-3.5" strokeWidth={2.6} /> : st.state === 'rejected' ? <Icon name="close" className="w-3.5 h-3.5" strokeWidth={2.6} /> : i + 1}
          </span>
          <span className={`block mt-2 text-[12px] font-medium leading-tight ${st.state === 'upcoming' ? 'text-ink-400' : 'text-ink-900'}`}>{st.label}</span>
          <span className="block text-[11px] text-ink-500 leading-tight mt-0.5">{st.at ? fmtDateTime(st.at) : st.desc}</span>
        </li>
      ))}
    </ol>
  )
}

export function RequestDetail({ request: r, onClose, decideMode = false }) {
  const { profile, settings } = useApp()
  const navigate = useNavigate()
  const [track, setTrack] = useState({
    release_number: r.release_number || '', release_status: r.release_status || 'in_process',
    promise_date: r.promise_date || '', last_followup_date: r.last_followup_date || '',
  })
  const [complete, setComplete] = useState({ release_number: r.release_number || '', promise_date: r.promise_date || '' })
  const [items, setItems] = useState(r.request_items)
  const [receipts, setReceipts] = useState(r.request_receipts || [])
  const [mrrs, setMrrs] = useState(r.mrrs || [])
  const [mrrOpen, setMrrOpen] = useState(false)
  const [remind, setRemind] = useState(false)
  const [status, setStatus] = useState(r.status)
  const [reason, setReason] = useState('')
  const [modal, setModal] = useState(null)
  const [by, setBy] = useState('device')   // how the parts are grouped: by device or by part
  const [recvItem, setRecvItem] = useState(null)
  const [recvQty, setRecvQty] = useState(1)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const view = { ...r, request_items: items, request_receipts: receipts, mrrs, status }
  const noMrr = unlinkedReceipts(view)
  const canMrr = profile.role === 'clinical_engineer' || profile.role === 'admin'
  const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const parts = items.filter(i => !i.is_vat)
  const vatLine = items.find(i => i.is_vat)
  const partsSum = parts.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const deviceGroups = groupByDevice(items)
  const partGroups = groupByPart(items)
  const partOf = (it) => partGroups.find(g => g.lines.some(l => l.id === it.id))
  // receipt status and buttons of one request line
  const receipt = (it) => {
    if (!canTrack) return null
    const outstanding = it.quantity - (it.received_quantity || 0)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        {outstanding === 0
          ? <Badge className="bg-olive-100 text-olive-700"><Icon name="check" className="w-3 h-3" strokeWidth={2.6} />Received</Badge>
          : <Badge className={it.received_quantity > 0 ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-600'}>{receiptLabel(it)}</Badge>}
        {outstanding > 0 && (
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" disabled={busy} onClick={() => { setRecvItem(it); setRecvQty(outstanding); setModal('receive') }}>Receive some</Btn>
            <Btn size="sm" variant="success" disabled={busy} onClick={() => call('receive_items', { p_item_id: it.id, p_quantity: outstanding }, 'Line received in full.', refresh)}>Receive all {fmtQty(outstanding)}</Btn>
          </div>
        )}
      </div>
    )
  }
  const isOwner = r.engineer?.id === profile.id
  const isSup = r.supervisor?.id === profile.id
  const admin = profile.role === 'admin'
  const clinical = profile.role === 'clinical_engineer'
  const canDecide = status === 'pending' && (admin || isSup)
  const canEdit = ['pending', 'returned'].includes(status) && (admin || isOwner)
  const canResubmit = status === 'returned' && (admin || isOwner)
  const canComplete = status === 'pending_clinical' && (admin || clinical)
  const canFinalApprove = status === 'in_process'
  const canTrack = ['in_process', 'approved', 'closed'].includes(status)
  const showEmail = ['approved', 'closed'].includes(status)
  const email = buildApprovalEmail(view, settings)

  const refresh = async () => {
    const { data } = await supabase.from('request_items').select('*').eq('request_id', r.id).order('id')
    if (data) setItems(data)
    const [{ data: rc }, { data: mr }] = await Promise.all([
      supabase.from('request_receipts').select('*').eq('request_id', r.id).order('id'),
      supabase.from('mrrs').select('*').eq('request_id', r.id).order('id'),
    ])
    if (rc) setReceipts(rc)
    if (mr) setMrrs(mr)
    const { data: rq } = await supabase.from('requests').select('status, release_number, promise_date').eq('id', r.id).single()
    if (rq) { setStatus(rq.status); r.release_number = rq.release_number; r.promise_date = rq.promise_date }
  }

  const call = async (fn, args, okMsg, after) => {
    setErr(''); setOk(''); setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setErr(error.message)
    setModal(null); setOk(okMsg)
    if (after) after()
  }

  // Persist tracking fields immediately (on blur) so nothing is lost on logout.
  const [savedFlash, setSavedFlash] = useState(false)
  const autoSaveTracking = async (next) => {
    const t = next || track
    if (!['in_process', 'approved', 'closed'].includes(status)) return
    const { error } = await supabase.rpc('update_tracking', {
      p_request_id: r.id, p_release_number: t.release_number || null, p_release_status: t.release_status || null,
      p_promise_date: t.promise_date || null, p_last_followup_date: t.last_followup_date || null,
    })
    if (!error) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500) }
  }

  const doReceive = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('receive_items', { p_item_id: recvItem.id, p_quantity: Number(recvQty) })
    setBusy(false)
    if (error) return setErr(error.message)
    setModal(null); setOk('Receipt recorded.'); refresh()
  }

  const footer = (canEdit || canResubmit || canDecide || canComplete || canFinalApprove || showEmail) && (<>
    {canEdit && <Btn variant="danger" className="mr-auto" onClick={() => setModal('cancel')}>Cancel request</Btn>}
    {canEdit && <Btn variant="secondary" icon="edit" onClick={() => { onClose(); navigate(`/new-request?edit=${r.id}`) }}>Edit</Btn>}
    {canResubmit && <Btn disabled={busy} onClick={() => call('resubmit_request', { p_request_id: r.id }, 'Request resubmitted.', onClose)}>Resubmit</Btn>}
    {canDecide && <>
      <Btn variant="danger" className="mr-auto" onClick={() => setModal('reject')} disabled={busy}>Reject</Btn>
      <Btn variant="secondary" onClick={() => setModal('return')} disabled={busy}>Return to engineer</Btn>
      <Btn variant="success" icon="check" disabled={busy} onClick={() => call('decide_request', { p_request_id: r.id, p_decision: 'approved', p_reason: null }, 'Approved and sent to the clinical engineer.', onClose)}>Approve</Btn>
    </>}
    {canComplete && <>
      <Btn variant="secondary" onClick={() => setModal('return')} disabled={busy}>Return to engineer</Btn>
      <Btn onClick={() => setModal('complete')} disabled={busy}>Issue release</Btn>
    </>}
    {showEmail && <Btn variant="secondary" icon="mail" onClick={() => setModal('email')}>Release email</Btn>}
    {canFinalApprove && <Btn variant="success" icon="check" disabled={busy} onClick={() => call('approve_final', { p_request_id: r.id }, 'Request marked approved.', refresh)}>Mark approved</Btn>}
  </>)

  return (
    <Drawer open onClose={onClose} title={r.request_number}
      subtitle={`Submitted ${fmtDateTime(r.submitted_at)}`}
      badge={<Badge className={STATUS_STYLE[status]}>{statusLabel(status)}</Badge>} footer={footer}>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}
      {status === 'rejected' && r.rejection_reason && <Alert><b className="font-medium">Rejected.</b> {r.rejection_reason}</Alert>}
      {status === 'returned' && r.return_reason && <Alert kind="warn"><b className="font-medium">Returned for amendment.</b> {r.return_reason}</Alert>}

      <Card className="p-5">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <Field label="Requested by">{r.engineer?.full_name}</Field>
          <Field label="Supervisor">{r.supervisor?.full_name}</Field>
          <Field label="Vendor">{r.contracts?.vendors?.name}</Field>
          <Field label="Contract">{r.contracts?.contract_number}</Field>
          <Field label="PO number"><span className="num">{r.contracts?.po_number}</span></Field>
          <Field label={vatLine ? 'Total, including VAT' : 'Request total'}><span className="num font-medium">{money(total)}</span></Field>
          {vatLine && <Field label="Parts, before VAT"><span className="num">{money(partsSum)}</span></Field>}
          {vatLine && <Field label="VAT 15%"><span className="num">{money(vatLine.unit_price * vatLine.quantity)}</span></Field>}
          {r.release_number && <Field label="Release"><span className="num">{r.release_number}</span></Field>}
          {r.promise_date && <Field label="Promise date">{fmtDate(r.promise_date)}</Field>}
        </dl>
      </Card>

      <Card className="p-5">
        <h4 className="font-display font-semibold text-[13px] tracking-[0.08em] uppercase text-ink-500 mb-4">Progress</h4>
        <Timeline request={view} />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-ink-100">
          <h4 className="font-display font-semibold text-[13px] tracking-[0.08em] uppercase text-ink-500">Parts · {partGroups.length} for {deviceGroups.length} device{deviceGroups.length === 1 ? '' : 's'}</h4>
          <div className="inline-flex rounded-lg border border-ink-300 overflow-hidden text-[13px] font-medium" role="group" aria-label="Group parts">
            {[['device', 'By device'], ['part', 'By part']].map(([k, label]) => (
              <button key={k} onClick={() => setBy(k)} aria-pressed={by === k}
                className={`h-8 px-3 transition-colors ${by === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 hover:bg-ink-50'}`}>{label}</button>
            ))}
          </div>
          {canTrack && items.some(i => i.quantity > (i.received_quantity || 0)) && (
            <Btn size="sm" variant="secondary" icon="box" disabled={busy} onClick={() => call('receive_all', { p_request_id: r.id }, 'All outstanding parts received.', refresh)}>Receive all outstanding</Btn>
          )}
        </div>
        <ul>
          {by === 'device' && deviceGroups.map((d, di) => (
            <li key={d.key} className="border-b border-ink-100 last:border-0">
              <dl className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-3 bg-ink-50">
                <Field label={`Device ${di + 1} · HTM`}><span className="num text-[13px] font-medium">{d.htm}</span></Field>
                <Field label="Serial"><span className="num text-[13px] font-medium">{d.serial}</span></Field>
                <Field label="Work order"><span className="num text-[13px] font-medium">{d.wo}</span></Field>
              </dl>
              <ul>
                {d.lines.map(it => {
                  const g = partOf(it)
                  return (
                    <li key={it.id} className="px-5 py-3.5 border-t border-ink-100">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink-900">{it.description}</div>
                          <div className="text-[12px] text-ink-500 mt-0.5">
                            <span className="num">{it.line_number ? `Line ${it.line_number} · ` : ''}{it.part_number}</span>
                            {(it.equipment_description || it.device_model) && <> · {[it.equipment_description, it.device_model].filter(Boolean).join(', ')}</>}
                            {!!it.taxable && <Badge className="bg-gold-100 text-gold-700 ml-2">VAT</Badge>}
                          </div>
                          {g && g.lines.length > 1 && (
                            <div className="text-[12px] text-steel-700 mt-1">Request total for this part: <span className="num font-medium">{fmtQty(g.quantity)}</span> across {g.lines.length} devices</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="num text-sm font-medium text-ink-900">{money(it.unit_price * it.quantity)}</div>
                          <div className="text-[12px] text-ink-500 mt-0.5"><span className="num">{fmtQty(it.quantity)} × {money(it.unit_price)}</span> before VAT</div>
                        </div>
                      </div>
                      {receipt(it)}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
          {by === 'part' && partGroups.map(g => (
            <li key={g.key} className="px-5 py-4 border-b border-ink-100 last:border-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900">{g.description}</div>
                  <div className="text-[12px] text-ink-500 mt-0.5">
                    <span className="num">{g.line_number ? `Line ${g.line_number} · ` : ''}{g.part_number}</span>
                    {(g.equipment_description || g.device_model) && <> · {[g.equipment_description, g.device_model].filter(Boolean).join(', ')}</>}
                    {!!g.taxable && <Badge className="bg-gold-100 text-gold-700 ml-2">VAT</Badge>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num text-sm font-medium text-ink-900">{money(g.unit_price * g.quantity)}</div>
                  <div className="text-[12px] text-ink-500 mt-0.5">Total <span className="num font-medium text-ink-900">{fmtQty(g.quantity)}</span> × <span className="num">{money(g.unit_price)}</span>{g.lines.length > 1 && <> · {g.lines.length} devices</>}</div>
                </div>
              </div>
              <ul className="mt-3 rounded-lg bg-ink-50 divide-y divide-ink-200">
                {g.lines.map(it => (
                  <li key={it.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[13px]">
                      <span className="num text-ink-700">HTM {it.htm_number} · SN {it.serial_number} · W.O {it.work_order_number}</span>
                      <span className="text-ink-900">Quantity <span className="num font-medium">{fmtQty(it.quantity)}</span></span>
                    </div>
                    {receipt(it)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {vatLine && (
            <li className="px-5 py-4 bg-gold-100/40 border-t border-gold-200">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900">VAT line</div>
                  <div className="text-[12px] text-ink-600 mt-0.5">
                    Line <span className="num">{vatLine.line_number}</span> · 15% of the taxed parts · quantity <span className="num">{fmtQty(vatLine.quantity)}</span> × <span className="num">{money(vatLine.unit_price)}</span>
                  </div>
                </div>
                <div className="num text-sm font-medium text-ink-900 shrink-0">{money(vatLine.unit_price * vatLine.quantity)}</div>
              </div>
              {canTrack && (
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                  {vatLine.received_quantity >= vatLine.quantity
                    ? <Badge className="bg-olive-100 text-olive-700"><Icon name="check" className="w-3 h-3" strokeWidth={2.6} />Received</Badge>
                    : <>
                        <Badge className="bg-ink-100 text-ink-600">Not received</Badge>
                        <Btn size="sm" variant="success" disabled={busy} onClick={() => call('receive_items', { p_item_id: vatLine.id, p_quantity: vatLine.quantity - (vatLine.received_quantity || 0) }, 'VAT line received.', refresh)}>Receive VAT line</Btn>
                      </>}
                </div>
              )}
            </li>
          )}
        </ul>
      </Card>

      {canTrack && receipts.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-ink-100">
            <div>
              <h4 className="font-display font-semibold text-[13px] tracking-[0.08em] uppercase text-ink-500">MRR</h4>
              <p className={`text-[13px] mt-0.5 ${noMrr.length ? 'text-brand-700 font-medium' : 'text-ink-500'}`}>
                {noMrr.length ? `${noMrr.length} received line${noMrr.length === 1 ? '' : 's'} without an MRR` : 'Every received line has an MRR'}
                {status !== 'closed' && <span className="block font-normal text-ink-500">The request closes when every line is received and covered by an MRR.</span>}
              </p>
            </div>
            {canMrr && noMrr.length > 0 && (
              <div className="flex gap-2">
                <Btn size="sm" variant="secondary" icon="mail" onClick={() => setRemind(true)}>Reminder email</Btn>
                <Btn size="sm" onClick={() => setMrrOpen(true)}>Generate MRR</Btn>
              </div>
            )}
          </div>
          {mrrs.length === 0 ? <p className="px-5 py-4 text-[13px] text-ink-500">No MRR recorded yet.</p> : (
            <ul>
              {mrrs.map(m => {
                const mine = receipts.filter(x => x.mrr_id === m.id)
                const byId = Object.fromEntries(items.map(i => [i.id, i]))
                return (
                  <li key={m.id} className="px-5 py-3.5 border-b border-ink-100 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm"><span className="num font-medium text-ink-900">{m.mrr_number}</span><span className="text-ink-500"> · {fmtDate(m.mrr_date)} · {mine.length} line{mine.length === 1 ? '' : 's'}</span></div>
                      {canMrr && <button onClick={() => call('delete_mrr', { p_mrr_id: m.id }, `MRR ${m.mrr_number} removed. Its lines are back to no MRR.`, refresh)} disabled={busy}
                        className="text-[13px] font-medium text-ink-500 hover:text-brand-700 hover:underline">Remove MRR</button>}
                    </div>
                    <ul className="mt-2 text-[13px] text-ink-600 space-y-0.5">
                      {mine.map(x => { const it = byId[x.request_item_id]; return it && (
                        <li key={x.id} className="flex justify-between gap-4">
                          <span className="truncate">{it.is_vat ? 'VAT line' : it.description} <span className="num text-ink-400">· Line {it.line_number}</span></span>
                          <span className="num shrink-0">{fmtQty(x.quantity)}</span>
                        </li>
                      ) })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      {canTrack && (
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <h4 className="font-display font-semibold text-[13px] tracking-[0.08em] uppercase text-ink-500">Release tracking</h4>
            <span className={`text-[12px] ${savedFlash ? 'text-olive-600' : 'text-ink-400'}`}>{savedFlash ? 'Saved' : 'Changes save automatically'}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Release number" value={track.release_number} onChange={e => setTrack(t => ({ ...t, release_number: e.target.value }))} onBlur={() => autoSaveTracking()} />
            <Select label="Release status" value={track.release_status} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, release_status: v })); autoSaveTracking({ ...track, release_status: v }) }}>
              <option value="in_process">In process</option>
              <option value="approved">Approved</option>
            </Select>
            <Input label="Promise date" type="date" value={track.promise_date} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, promise_date: v })); autoSaveTracking({ ...track, promise_date: v }) }} />
            <Input label="Last follow-up with vendor" type="date" value={track.last_followup_date} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, last_followup_date: v })); autoSaveTracking({ ...track, last_followup_date: v }) }} />
          </div>
          {status === 'closed' && (
            <div className="flex justify-end mt-4">
              {r.archived
                ? <Btn variant="secondary" icon="archive" disabled={busy} onClick={() => call('unarchive_request', { p_request_id: r.id }, 'Request restored from the archive.', () => { r.archived = false; refresh() })}>Restore from archive</Btn>
                : <Btn variant="dark" icon="archive" disabled={busy} onClick={() => call('archive_request', { p_request_id: r.id }, 'Request archived.', () => { r.archived = true; if (onClose) onClose() })}>Archive</Btn>}
            </div>
          )}
        </Card>
      )}

      <MrrModal request={mrrOpen ? view : null} onClose={() => setMrrOpen(false)}
        onSaved={(n) => { setMrrOpen(false); setOk(`MRR ${n} recorded.`); refresh() }} />
      <MrrReminderModal requests={remind ? [view] : null} settings={settings} onClose={() => setRemind(false)} />

      <Modal open={modal === 'reject'} onClose={() => setModal(null)} title="Reject request">
        <Textarea label="Reason for rejection" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="The engineer sees this reason." />
        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="secondary" onClick={() => setModal(null)}>Keep request</Btn>
          <Btn disabled={!reason.trim() || busy} onClick={() => call('decide_request', { p_request_id: r.id, p_decision: 'rejected', p_reason: reason }, 'Request rejected.', onClose)}>Reject request</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'return'} onClose={() => setModal(null)} title="Return to engineer">
        <Textarea label="What needs to change" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="The engineer amends the request and resubmits it." />
        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="secondary" onClick={() => setModal(null)}>Keep request</Btn>
          <Btn disabled={!reason.trim() || busy} onClick={() => call('return_request', { p_request_id: r.id, p_reason: reason }, 'Request returned.', onClose)}>Return request</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel request">
        <p className="text-sm text-ink-600">Request <span className="num">{r.request_number}</span> will be cancelled. This cannot be undone.</p>
        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="secondary" onClick={() => setModal(null)}>Keep request</Btn>
          <Btn disabled={busy} onClick={() => call('cancel_request', { p_request_id: r.id }, 'Request cancelled.', onClose)}>Cancel request</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'complete'} onClose={() => setModal(null)} title="Issue release">
        <p className="text-sm text-ink-600 mb-4">Enter the release number and the vendor's promise date. The request then moves to In process.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Release number" value={complete.release_number} onChange={e => setComplete(c => ({ ...c, release_number: e.target.value }))} placeholder="REL-2026-045" />
          <Input label="Promise date" type="date" value={complete.promise_date} onChange={e => setComplete(c => ({ ...c, promise_date: e.target.value }))} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
          <Btn disabled={busy || !complete.release_number.trim() || !complete.promise_date}
            onClick={() => call('complete_request', { p_request_id: r.id, p_release_number: complete.release_number.trim(), p_promise_date: complete.promise_date }, 'Release issued. The request is in process.', refresh)}>
            Issue release
          </Btn>
        </div>
      </Modal>

      <Modal open={modal === 'receive'} onClose={() => setModal(null)} title="Receive part">
        {recvItem && (<>
          <div className="text-sm font-medium text-ink-900">{recvItem.description}</div>
          <div className="num text-[12px] text-ink-500 mt-0.5 mb-4">{recvItem.part_number} · HTM {recvItem.htm_number} · SN {recvItem.serial_number}</div>
          <dl className="grid grid-cols-3 gap-3 mb-4">
            {[['Requested', recvItem.quantity], ['Received so far', recvItem.received_quantity || 0],
              ['Left after this', recvItem.quantity - (recvItem.received_quantity || 0) - (Number(recvQty) || 0)]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-ink-50 px-3 py-2.5"><dd className="num text-lg font-medium text-ink-900">{v}</dd><dt className="text-[12px] text-ink-500">{l}</dt></div>
            ))}
          </dl>
          <Input label="Quantity received now" type="number" min="1" max={recvItem.quantity - (recvItem.received_quantity || 0)} value={recvQty} onChange={e => setRecvQty(e.target.value)} />
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn variant="success" disabled={busy || !recvQty || Number(recvQty) < 1} onClick={doReceive}>Record receipt</Btn>
          </div>
        </>)}
      </Modal>

      <Modal open={modal === 'email'} onClose={() => setModal(null)} title="Release email" wide>
        {email.to.length === 0 && <Alert kind="warn">{r.contracts?.vendors?.name} has no contact email in the vendor directory. Add one under Vendors, or type the recipient in Outlook.</Alert>}
        <dl className="grid gap-3 mb-4">
          <Field label="To (vendor contacts)">{email.to.length ? email.to.join(', ') : 'Add in Outlook'}</Field>
          <Field label="CC (department)">{email.cc || 'Not set. Add it under Administration → Settings.'}</Field>
          <Field label="Subject">{email.subject}</Field>
        </dl>
        <pre className="num bg-ink-50 border border-ink-200 rounded-lg p-4 text-[12px] leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-72">{email.body}</pre>
        <p className="text-[13px] text-ink-500 mt-3">The Outlook file opens as a ready-to-send message with a formatted table. Add the engineer's name after "Dear Engr." before sending.</p>
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <Btn variant="secondary" onClick={async () => { await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`); setOk('Email text copied.') }}>Copy text</Btn>
          <Btn icon="download" onClick={() => downloadOutlookEmail(view, settings)}>Open in Outlook</Btn>
        </div>
      </Modal>
    </Drawer>
  )
}
