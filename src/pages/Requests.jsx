import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { usePoll } from '../lib/poll.js'
import { Card, Btn, Input, Select, Badge, Modal, Spinner, Empty, PageTitle, Alert, TableWrap, Th, Td } from '../ui.jsx'
import { money, fmtDate, fmtDateTime, STATUS_STYLE, statusLabel, receiptLabel,
         buildTimeline, buildApprovalEmail, downloadOutlookEmail } from '../lib/helpers'

export const REQUEST_QUERY = `*, request_items(*),
  contracts(id, contract_number, po_number, vendors(name, contact_email)),
  engineer:profiles!requests_engineer_id_fkey(id, full_name),
  supervisor:profiles!requests_supervisor_id_fkey(id, full_name)`

export default function Requests() {
  const [reqs, setReqs] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sel, setSel] = useState(null)
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select(REQUEST_QUERY).order('submitted_at', { ascending: false })
    setReqs(data || [])
    return data || []
  }, [])
  usePoll(load, 8000, [])

  // deep-link: /requests?open=<id> opens that request (from a notification click)
  const openId = params.get('open')
  useEffect(() => {
    if (!openId || !reqs) return
    const r = reqs.find(x => String(x.id) === String(openId))
    if (r) setSel(r)
    params.delete('open'); setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, reqs])

  if (!reqs) return <Spinner />
  const filters = ['all', 'pending', 'pending_clinical', 'in_process', 'approved', 'returned', 'rejected', 'closed', 'cancelled', 'archived']
  const base = reqs.filter(r => filter === 'archived' ? r.archived : !r.archived)
  const shown = base.filter(r => (filter === 'all' || filter === 'archived') ? true : r.status === filter)

  return (
    <div>
      <PageTitle>Request tracking</PageTitle>
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {filters.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${filter === s ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {s === 'all' ? 'All' : statusLabel(s)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <Card className="p-6"><Empty text="No requests." /></Card> : (
        <Card className="p-2 sm:p-4">
          <TableWrap>
            <thead><tr><Th>Request</Th><Th>Engineer</Th><Th>Contract</Th><Th>Total</Th><Th>Status</Th><Th>Release</Th><Th>Received</Th><Th>Promise</Th></tr></thead>
            <tbody>
              {shown.map(r => {
                const tot = r.request_items.reduce((s, i) => s + i.quantity, 0)
                const got = r.request_items.reduce((s, i) => s + (i.received_quantity || 0), 0)
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(r)}>
                    <Td className="font-medium text-blue-700">{r.request_number}</Td>
                    <Td>{r.engineer?.full_name}</Td>
                    <Td>{r.contracts?.contract_number}</Td>
                    <Td>{money(r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0))}</Td>
                    <Td><Badge className={STATUS_STYLE[r.status]}>{statusLabel(r.status)}</Badge></Td>
                    <Td>{r.release_number || '—'}</Td>
                    <Td className={got === 0 ? 'text-slate-400' : got < tot ? 'text-amber-700 font-medium' : 'text-emerald-700 font-medium'}>
                      {['in_process', 'approved', 'closed'].includes(r.status) ? `${got}/${tot}` : '—'}
                    </Td>
                    <Td className={r.promise_date && new Date(r.promise_date) < new Date() && ['in_process', 'approved'].includes(r.status) ? 'text-red-600 font-semibold' : ''}>{fmtDate(r.promise_date)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
      {sel && <RequestDetail request={sel} onClose={() => { load(); setSel(null) }} />}
    </div>
  )
}

function Timeline({ request }) {
  const stages = buildTimeline(request)
  const dot = {
    done: 'bg-emerald-500 border-emerald-500 text-white',
    current: 'bg-blue-500 border-blue-500 text-white ring-4 ring-blue-100',
    returned: 'bg-orange-500 border-orange-500 text-white ring-4 ring-orange-100',
    rejected: 'bg-red-500 border-red-500 text-white',
    upcoming: 'bg-white border-slate-300 text-slate-400',
  }
  const line = (st) => st === 'done' ? 'bg-emerald-400' : 'bg-slate-200'
  return (
    <div className="overflow-x-auto">
      <div className="flex items-start min-w-max pb-1">
        {stages.map((st, i) => (
          <div key={st.key} className="flex items-start">
            <div className="flex flex-col items-center w-28 text-center">
              <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold ${dot[st.state]}`}>
                {st.state === 'done' ? '✓' : st.state === 'rejected' ? '✕' : i + 1}
              </div>
              <div className={`mt-1.5 text-[11px] font-medium leading-tight ${st.state === 'upcoming' ? 'text-slate-400' : 'text-slate-700'}`}>{st.label}</div>
              <div className="text-[10px] text-slate-400 leading-tight">{st.at ? fmtDateTime(st.at) : st.desc}</div>
            </div>
            {i < stages.length - 1 && <div className={`h-0.5 w-6 mt-3.5 rounded ${line(stages[i].state)}`} />}
          </div>
        ))}
      </div>
    </div>
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
  const [status, setStatus] = useState(r.status)
  const [reason, setReason] = useState('')
  const [modal, setModal] = useState(null)
  const [recvItem, setRecvItem] = useState(null)
  const [recvQty, setRecvQty] = useState(1)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const view = { ...r, request_items: items, status }
  const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
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

  return (
    <Modal open onClose={onClose} title={`Request ${r.request_number}`} wide>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
        <div><span className="text-slate-500">Engineer:</span> {r.engineer?.full_name}</div>
        <div><span className="text-slate-500">Supervisor:</span> {r.supervisor?.full_name}</div>
        <div><span className="text-slate-500">Contract:</span> {r.contracts?.contract_number} (PO {r.contracts?.po_number})</div>
        <div><span className="text-slate-500">Vendor:</span> {r.contracts?.vendors?.name}</div>
        <div><span className="text-slate-500">Status:</span> <Badge className={STATUS_STYLE[status]}>{statusLabel(status)}</Badge></div>
        {r.release_number && <div><span className="text-slate-500">Release:</span> {r.release_number} · promise {fmtDate(r.promise_date)}</div>}
        {status === 'rejected' && <div className="sm:col-span-2 text-red-700"><span className="text-slate-500">Rejection reason:</span> {r.rejection_reason}</div>}
        {r.return_reason && <div className="sm:col-span-2 text-orange-700"><span className="text-slate-500">Last return reason:</span> {r.return_reason}</div>}
      </div>

      <div className="mb-5">
        <h4 className="font-semibold text-sm mb-2">Progress</h4>
        <Timeline request={view} />
      </div>

      <div className="mb-4">
          <h4 className="font-semibold text-sm mb-2">Items — device details per line</h4>
          <TableWrap>
            <thead><tr><Th>Part</Th><Th>HTM</Th><Th>Serial</Th><Th>W.O</Th><Th>Qty</Th><Th>Total</Th><Th>Receipt</Th></tr></thead>
            <tbody>
              {items.map(it => {
                const outstanding = it.quantity - (it.received_quantity || 0)
                return (
                  <tr key={it.id}>
                    <Td><div className="font-mono text-xs">{it.part_number}</div><div className="text-xs text-slate-500 max-w-[150px]">{it.description}</div></Td>
                    <Td className="text-xs">{it.htm_number}</Td>
                    <Td className="text-xs">{it.serial_number}</Td>
                    <Td className="text-xs">{it.work_order_number}</Td>
                    <Td>{it.quantity}</Td>
                    <Td className="font-medium">{money(it.unit_price * it.quantity)}</Td>
                    <Td>
                      {!canTrack ? <span className="text-slate-400 text-xs">—</span>
                        : outstanding === 0 ? <Badge className="bg-emerald-100 text-emerald-800">Received</Badge>
                        : (
                          <div className="flex flex-col gap-1 items-start">
                            {it.received_quantity > 0 && <Badge className="bg-amber-100 text-amber-800">{receiptLabel(it)}</Badge>}
                            <div className="flex gap-1">
                              <Btn variant="secondary" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => { setRecvItem(it); setRecvQty(outstanding); setModal('receive') }}>Partial…</Btn>
                              <Btn variant="success" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => call('receive_items', { p_item_id: it.id, p_quantity: outstanding }, 'Line received in full.', refresh)}>All ({outstanding})</Btn>
                            </div>
                          </div>
                        )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
          <div className="flex flex-wrap justify-between items-center gap-2 mt-2">
            {canTrack && items.some(i => i.quantity > (i.received_quantity || 0)) && (
              <Btn variant="success" disabled={busy} onClick={() => call('receive_all', { p_request_id: r.id }, 'All outstanding items received.', refresh)}>Receive whole request</Btn>
            )}
            <div className="ml-auto font-bold">Total: {money(total)}</div>
          </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {canEdit && <Btn onClick={() => { onClose(); navigate(`/new-request?edit=${r.id}`) }}>Edit request</Btn>}
        {canResubmit && <Btn variant="success" disabled={busy} onClick={() => call('resubmit_request', { p_request_id: r.id }, 'Request resubmitted.', onClose)}>Resubmit</Btn>}
        {canEdit && <Btn variant="danger" onClick={() => setModal('cancel')}>Cancel request</Btn>}

        {canDecide && <>
          <Btn variant="danger" onClick={() => setModal('reject')} disabled={busy}>Reject</Btn>
          <Btn variant="secondary" onClick={() => setModal('return')} disabled={busy}>Return to engineer</Btn>
          <Btn variant="success" disabled={busy} onClick={() => call('decide_request', { p_request_id: r.id, p_decision: 'approved', p_reason: null }, 'Approved and sent to procurement.', onClose)}>Approve → clinical</Btn>
        </>}

        {canComplete && <>
          <Btn variant="secondary" onClick={() => setModal('return')} disabled={busy}>Return to engineer</Btn>
          <Btn variant="success" onClick={() => setModal('complete')} disabled={busy}>Complete (release + promise)</Btn>
        </>}

        {canFinalApprove && <Btn variant="success" disabled={busy} onClick={() => call('approve_final', { p_request_id: r.id }, 'Request marked approved.', refresh)}>Mark approved</Btn>}

        {showEmail && <Btn onClick={() => setModal('email')}>Release email</Btn>}
      </div>

      {canTrack && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="font-semibold text-sm">Release tracking</h4>
            <span className="text-[11px] text-slate-400">saves automatically</span>
            {savedFlash && <span className="text-[11px] text-emerald-600">✓ saved</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input label="Release number" value={track.release_number} onChange={e => setTrack(t => ({ ...t, release_number: e.target.value }))} onBlur={() => autoSaveTracking()} />
            <Select label="Release status" value={track.release_status} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, release_status: v })); autoSaveTracking({ ...track, release_status: v }) }}>
              <option value="in_process">In process</option>
              <option value="approved">Approved</option>
            </Select>
            <Input label="Promise date" type="date" value={track.promise_date} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, promise_date: v })); autoSaveTracking({ ...track, promise_date: v }) }} />
            <Input label="Last follow-up email" type="date" value={track.last_followup_date} onChange={e => { const v = e.target.value; setTrack(t => ({ ...t, last_followup_date: v })); autoSaveTracking({ ...track, last_followup_date: v }) }} />
          </div>
          <div className="flex justify-end mt-3">
            {status === 'closed'
              ? (r.archived
                  ? <Btn variant="secondary" disabled={busy} onClick={() => call('unarchive_request', { p_request_id: r.id }, 'Request unarchived.', () => { r.archived = 0; refresh() })}>
                      <span className="inline-flex items-center gap-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v4H4zM6 8v12h12V8M9 12h6"/></svg>Unarchive</span>
                    </Btn>
                  : <Btn variant="success" disabled={busy} onClick={() => call('archive_request', { p_request_id: r.id }, 'Request archived.', () => { r.archived = 1; if (onClose) onClose() })}>
                      <span className="inline-flex items-center gap-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v4H4zM6 8v12h12V8M9 12h6"/></svg>Archive</span>
                    </Btn>)
              : <Btn disabled={busy} onClick={() => call('update_tracking', {
                  p_request_id: r.id, p_release_number: track.release_number || null, p_release_status: track.release_status || null,
                  p_promise_date: track.promise_date || null, p_last_followup_date: track.last_followup_date || null,
                }, 'Tracking details saved.', refresh)}>
                  <span className="inline-flex items-center gap-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Save tracking</span>
                </Btn>}
          </div>
        </div>
      )}

      <Modal open={modal === 'reject'} onClose={() => setModal(null)} title="Reject request">
        <p className="text-sm text-slate-600 mb-3">A rejection reason is required.</p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Reason for rejection…" />
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
          <Btn variant="danger" disabled={!reason.trim() || busy} onClick={() => call('decide_request', { p_request_id: r.id, p_decision: 'rejected', p_reason: reason }, 'Request rejected.', onClose)}>Confirm rejection</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'return'} onClose={() => setModal(null)} title="Return request to engineer">
        <p className="text-sm text-slate-600 mb-3">The engineer will amend and resubmit. Explain what needs to change.</p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Reason for returning…" />
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
          <Btn disabled={!reason.trim() || busy} onClick={() => call('return_request', { p_request_id: r.id, p_reason: reason }, 'Request returned.', onClose)}>Return request</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel request">
        <p className="text-sm text-slate-600 mb-4">This will cancel request {r.request_number}. It cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={() => setModal(null)}>Keep it</Btn>
          <Btn variant="danger" disabled={busy} onClick={() => call('cancel_request', { p_request_id: r.id }, 'Request cancelled.', onClose)}>Cancel request</Btn>
        </div>
      </Modal>

      <Modal open={modal === 'complete'} onClose={() => setModal(null)} title="Complete request (procurement)">
        <p className="text-sm text-slate-600 mb-4">Enter the release number and the vendor's promise date. Both are required to move the request into process.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Release number *" value={complete.release_number} onChange={e => setComplete(c => ({ ...c, release_number: e.target.value }))} placeholder="e.g. REL-2026-045" />
          <Input label="Promise date *" type="date" value={complete.promise_date} onChange={e => setComplete(c => ({ ...c, promise_date: e.target.value }))} />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
          <Btn variant="success" disabled={busy || !complete.release_number.trim() || !complete.promise_date}
            onClick={() => call('complete_request', { p_request_id: r.id, p_release_number: complete.release_number.trim(), p_promise_date: complete.promise_date }, 'Request is now in process.', refresh)}>
            Confirm completion
          </Btn>
        </div>
      </Modal>

      <Modal open={modal === 'receive'} onClose={() => setModal(null)} title="Record partial receipt">
        {recvItem && (<>
          <div className="text-sm mb-3">
            <div className="font-medium">{recvItem.description}</div>
            <div className="font-mono text-xs text-slate-500">{recvItem.part_number} · device {recvItem.htm_number} / {recvItem.serial_number}</div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm mb-4">
            <div className="bg-slate-50 rounded-lg py-2"><div className="font-bold">{recvItem.quantity}</div><div className="text-xs text-slate-500">Requested</div></div>
            <div className="bg-slate-50 rounded-lg py-2"><div className="font-bold">{recvItem.received_quantity || 0}</div><div className="text-xs text-slate-500">Already received</div></div>
            <div className="bg-amber-50 rounded-lg py-2"><div className="font-bold text-amber-700">{recvItem.quantity - (recvItem.received_quantity || 0) - (Number(recvQty) || 0)}</div><div className="text-xs text-slate-500">Remaining after</div></div>
          </div>
          <Input label="Quantity received now" type="number" min="1" max={recvItem.quantity - (recvItem.received_quantity || 0)} value={recvQty} onChange={e => setRecvQty(e.target.value)} />
          <div className="flex justify-end gap-2 mt-4">
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn variant="success" disabled={busy || !recvQty || Number(recvQty) < 1} onClick={doReceive}>Record receipt</Btn>
          </div>
        </>)}
      </Modal>

      <Modal open={modal === 'email'} onClose={() => setModal(null)} title="Release email" wide>
        {!email.deptEmail && <Alert>No recipient email is set. You can still open it in Outlook and type the recipient, or set a default in Admin → Settings.</Alert>}
        <div className="text-sm mb-2"><span className="text-slate-500">To:</span> {email.deptEmail || '(type in Outlook)'}</div>
        <div className="text-sm mb-3"><span className="text-slate-500">Subject:</span> {email.subject}</div>
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap overflow-x-auto max-h-64">{email.body}</pre>
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <Btn variant="secondary" onClick={async () => { await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`); setOk('Copied.') }}>Copy text</Btn>
          <Btn onClick={() => downloadOutlookEmail(view, settings)}>Open in Outlook (.eml)</Btn>
        </div>
        <p className="text-xs text-slate-400 mt-3">The Outlook file opens as a ready-to-send message with a formatted table. Fill in the engineer's name after "Dear Engr." and press Send.</p>
      </Modal>
    </Modal>
  )
}
