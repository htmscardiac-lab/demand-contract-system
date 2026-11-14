// MRR (Material Receiving Report): shared pieces used by the request drawer and the MRR page.
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Btn, Input, Modal, Alert, Field } from '../ui.jsx'
import { fmtDate, fmtQty, downloadEml, escHtml, vatQtyFor } from './helpers'
import { useApp } from '../App.jsx'
import { RecipientsPicker, resolveRecipients } from './recipients.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000))
export const poRelease = (req) => `${req.contracts?.po_number ?? ''} – ${req.release_number || ''}`

// Receipts of a request that are not linked to an MRR yet, each with its request line.
export function unlinkedReceipts(req) {
  const items = Object.fromEntries((req.request_items || []).map(i => [i.id, i]))
  return (req.request_receipts || [])
    .filter(x => !x.mrr_id && items[x.request_item_id])
    .map(x => ({ ...x, item: items[x.request_item_id] }))
    .sort((a, b) => (a.item.is_vat ? 1 : 0) - (b.item.is_vat ? 1 : 0) || (a.item.line_number ?? 0) - (b.item.line_number ?? 0) || a.id - b.id)
}

// Flat rows for the summary exports and the reminder email.
export function pendingMrrRows(requests) {
  return requests.flatMap(req => unlinkedReceipts(req).map(x => ({
    vendor: req.contracts?.vendors?.name || '', request_number: req.request_number, ref: poRelease(req),
    line_number: x.item.line_number, description: x.item.description, part_number: x.item.part_number,
    qty: fmtQty(x.quantity), received_at: x.received_at, days: daysSince(x.received_at),
  })))
}

// Reminder to the vendor to complete MRR clearance. requests: one request, or all pending requests of one vendor.
export function buildMrrReminder(requests, settings = {}) {
  const deptEmail = settings.department_email || ''
  const deptName = settings.department_name || 'Healthcare Technology Management Services (HTMS)'
  const vendor = requests[0]?.contracts?.vendors
  const to = [...new Set((vendor?.vendor_contacts || []).map(c => (c.email || '').trim()).filter(Boolean))]
  const rows = pendingMrrRows(requests)
  const subject = requests.length === 1
    ? `Reminder: MRR Clearance, P.O: ${poRelease(requests[0])}`
    : `Reminder: MRR Clearance, ${vendor?.name || ''}`
  const intro = 'Kindly be reminded that the items listed below have been received and their MRR clearance is still pending.'
  const ask = 'You are kindly requested to complete the MRR clearance at your earliest convenience.'
  const body = [
    'Dear Engr. ______________,', 'Greetings.', '', intro, ask, '',
    'P.O – Release | Line | Line Description | Part Number | QTY Received | Received Date',
    ...rows.map(x => `${x.ref} | ${x.line_number ?? ''} | ${x.description} | ${x.part_number} | ${x.qty} | ${fmtDate(x.received_at)}`),
    '', 'Best regards,', deptName,
  ].join('\n')
  const html = `<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">
<p>Dear Engr. ______________,<br>Greetings.</p>
<p>${escHtml(intro)}<br>${escHtml(ask)}</p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:10pt">
<thead><tr style="background:#dbe5f1"><th>P.O – Release</th><th>Line</th><th>Line Description</th><th>Part Number</th><th>QTY Received</th><th>Received Date</th></tr></thead>
<tbody>${rows.map(x => `<tr><td>${escHtml(x.ref)}</td><td align="center">${escHtml(x.line_number)}</td><td>${escHtml(x.description)}</td><td>${escHtml(x.part_number)}</td><td align="center">${escHtml(x.qty)}</td><td align="center">${escHtml(fmtDate(x.received_at))}</td></tr>`).join('')}</tbody>
</table>
<p>Best regards,<br>${escHtml(deptName)}</p>
</body></html>`
  return { subject, body, html, to, cc: deptEmail, rows, vendorName: vendor?.name || '' }
}

export function MrrReminderModal({ requests, settings, onClose }) {
  const [copied, setCopied] = useState(false)
  const { prefs } = useApp()
  if (!requests) return null
  const email = buildMrrReminder(requests, settings)
  const vendor = requests[0]?.contracts?.vendors
  const { to, cc } = resolveRecipients(vendor, settings, prefs)
  return (
    <Modal open onClose={onClose} title="MRR clearance reminder" wide>
      <RecipientsPicker vendor={vendor} />
      <dl className="grid gap-3 mb-4">
        <Field label="Subject">{email.subject}</Field>
      </dl>
      <pre className="num bg-ink-50 border border-ink-200 rounded-lg p-4 text-[12px] leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-72">{email.body}</pre>
      <p className="text-[13px] text-ink-500 mt-3">The Outlook file opens as a ready-to-send message with a formatted table. Add the name after "Dear Engr." before sending.</p>
      <div className="flex flex-wrap justify-end gap-2 mt-5">
        <Btn variant="secondary" onClick={async () => { await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`); setCopied(true) }}>{copied ? 'Copied' : 'Copy text'}</Btn>
        <Btn icon="download" onClick={() => downloadEml({ ...email, to, cc, filename: `mrr-reminder-${requests.length === 1 ? requests[0].request_number : email.vendorName.replace(/[^a-z0-9]+/gi, '-')}.eml` })}>Open in Outlook</Btn>
      </div>
    </Modal>
  )
}

// Link received lines of one request to an MRR number.
export function MrrModal({ request, onClose, onSaved }) {
  const lines = useMemo(() => (request ? unlinkedReceipts(request) : []), [request])
  const [picked, setPicked] = useState({})
  const [number, setNumber] = useState('')
  const [date, setDate] = useState(today())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // reset only when the dialog opens, so a re-render of the page behind it does not clear what was typed
  const openFor = request ? request.id : null
  useEffect(() => {
    if (openFor == null) return
    setPicked(Object.fromEntries(lines.map(x => [x.id, true]))); setNumber(''); setDate(today()); setErr('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFor])
  if (!request) return null
  const ids = lines.filter(x => picked[x.id]).map(x => x.id)
  const vatLine = (request.request_items || []).find(i => i.is_vat)
  const vatQty = vatQtyFor(lines.filter(x => picked[x.id]), vatLine)
  const save = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('create_mrr', { p_request_id: request.id, p_mrr_number: number.trim(), p_mrr_date: date, p_receipt_ids: ids })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved(number.trim())
  }
  return (
    <Modal open onClose={onClose} title={`Generate MRR · ${request.request_number}`} wide>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-ink-600 mb-4">These lines are received and not linked to an MRR yet. Untick any line this MRR does not cover.</p>
      <ul className="rounded-lg border border-ink-200 divide-y divide-ink-100 max-h-[40vh] overflow-y-auto mb-5">
        {lines.map(x => (
          <li key={x.id}>
            <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-ink-50">
              <input type="checkbox" checked={!!picked[x.id]} onChange={e => setPicked(p => ({ ...p, [x.id]: e.target.checked }))} className="w-4 h-4 accent-brand-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900">{x.item.is_vat ? 'VAT line' : x.item.description}</span>
                <span className="block text-[12px] text-ink-500 mt-0.5">
                  <span className="num">Line {x.item.line_number} · {x.item.part_number}</span>
                  {!x.item.is_vat && <> · <span className="num">HTM {x.item.htm_number}</span></>}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm text-ink-900">Received <span className="num font-medium">{fmtQty(x.quantity)}</span></span>
                <span className="block text-[12px] text-ink-500">{fmtDate(x.received_at)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {vatLine && (
        <p className="text-[13px] text-ink-600 bg-gold-100/50 border border-gold-200 rounded-lg px-4 py-2.5 mb-5">
          VAT line <span className="num">{vatLine.line_number}</span>: {vatQty > 0
            ? <>quantity <span className="num font-medium">{fmtQty(vatQty)}</span> is covered by this MRR, for the taxed parts selected.</>
            : 'none of the selected parts is taxed, so this MRR carries no VAT.'}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="MRR number" value={number} onChange={e => setNumber(e.target.value)} />
        <Input label="MRR date" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !number.trim() || !date || ids.length === 0}>{busy ? 'Saving…' : `Link ${ids.length} line${ids.length === 1 ? '' : 's'} to MRR`}</Btn>
      </div>
    </Modal>
  )
}
