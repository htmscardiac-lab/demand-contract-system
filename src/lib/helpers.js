export const money = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export const STATUS_LABEL = {
  pending: 'Awaiting supervisor',
  pending_clinical: 'Awaiting clinical engineer',
  in_process: 'In process',
  approved: 'Approved',
  returned: 'Returned for amendment',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  closed: 'Closed',
}
export const STATUS_STYLE = {
  pending:          'bg-amber-100 text-amber-700',
  pending_clinical: 'bg-gold-100 text-gold-700',
  in_process:       'bg-steel-100 text-steel-700',
  approved:         'bg-olive-100 text-olive-700',
  returned:         'bg-brand-100 text-brand-700',
  rejected:         'bg-brand-600 text-white',
  cancelled:        'bg-ink-100 text-ink-500',
  closed:           'bg-ink-900 text-white',
}
export const ACTIVE_STATUSES = ['pending', 'pending_clinical', 'in_process', 'approved', 'returned']
export const DONE_STATUSES = ['closed', 'rejected', 'cancelled']

// What the signed-in user has to do with a request right now (null = nothing).
export function actionFor(r, profile) {
  if (!r || !profile || r.archived) return null
  const admin = profile.role === 'admin'
  if (r.status === 'pending' && (admin || r.supervisor_id === profile.id)) return 'Review and decide'
  if (r.status === 'pending_clinical' && (admin || profile.role === 'clinical_engineer')) return 'Issue release'
  if (r.status === 'returned' && r.engineer_id === profile.id) return 'Amend and resubmit'
  return null
}
// VAT: prices on contract lines are before VAT. VAT is released against the contract's own
// VAT line: quantity = VAT amount / VAT line value (4 decimals). Mirrors _vat_for() in the database.
export const VAT_RATE = 0.15
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
export function vatFor(taxableSubtotal, vatLineValue) {
  const value = Number(vatLineValue)
  if (!(taxableSubtotal > 0) || !(value > 0)) return { qty: 0, amount: 0 }
  const qty = Math.round(r2(taxableSubtotal * VAT_RATE) / value * 10000) / 10000
  return { qty, amount: r2(qty * value) }
}
export const fmtQty = (n) => String(Number(Number(n ?? 0).toFixed(4)))
export const partsTotal = (r) => (r.request_items || []).filter(i => !i.is_vat).reduce((s, i) => s + i.unit_price * i.quantity, 0)
export const vatTotal = (r) => (r.request_items || []).filter(i => i.is_vat).reduce((s, i) => s + i.unit_price * i.quantity, 0)
// Devices on a request: lines that share HTM, serial and work order belong to one device.
export function groupByDevice(items = []) {
  const map = new Map()
  for (const it of items.filter(i => !i.is_vat)) {
    const key = [it.htm_number, it.serial_number, it.work_order_number].join('|')
    if (!map.has(key)) map.set(key, { key, htm: it.htm_number, serial: it.serial_number, wo: it.work_order_number, lines: [] })
    map.get(key).lines.push(it)
  }
  return [...map.values()]
}
// Parts on a request with the total across devices.
export function groupByPart(items = []) {
  const map = new Map()
  for (const it of items.filter(i => !i.is_vat)) {
    const key = `${it.contract_item_id ?? it.part_number}`
    if (!map.has(key)) map.set(key, { key, ...it, quantity: 0, received_quantity: 0, lines: [] })
    const g = map.get(key)
    g.quantity += Number(it.quantity); g.received_quantity += Number(it.received_quantity || 0); g.lines.push(it)
  }
  return [...map.values()]
}
export const requestTotal = (r) => (r.request_items || []).reduce((s, i) => s + i.unit_price * i.quantity, 0)
export const isOverdue = (r) => ['in_process', 'approved'].includes(r.status) && r.promise_date
  && new Date(r.promise_date) < new Date(new Date().toDateString())
  && (r.request_items || []).some(i => (i.received_quantity || 0) < i.quantity)
export const ROLE_LABEL = { engineer: 'Engineer', supervisor: 'Supervisor', clinical_engineer: 'Clinical engineer', admin: 'Administrator' }
export const statusLabel = (s) => STATUS_LABEL[s] || s
export const receiptLabel = (it) =>
  it.received_quantity >= it.quantity ? 'Received'
    : it.received_quantity > 0 ? `Partial ${fmtQty(it.received_quantity)}/${fmtQty(it.quantity)}`
    : 'Not received'

// Detailed timeline for the engineer's tracking screen.
export function buildTimeline(r) {
  const supervisorMade = r.engineer?.id && r.supervisor?.id && r.engineer.id === r.supervisor.id
  const terminalReject = r.status === 'rejected'
  const cancelled = r.status === 'cancelled'
  const order = ['submitted', 'supervisor', 'clinical', 'in_process', 'approved', 'receiving', 'closed']
  const idx = {
    pending: 0, returned: 0, pending_clinical: 2, in_process: 3, approved: 4, closed: 6,
    rejected: 1, cancelled: 0,
  }[r.status] ?? 0
  const stages = [
    { key: 'submitted', label: 'Submitted', at: r.submitted_at, desc: `by ${r.engineer?.full_name || ''}` },
    ...(supervisorMade ? [] : [{ key: 'supervisor', label: 'Supervisor approval', at: r.decided_at, desc: r.supervisor?.full_name || '' }]),
    { key: 'clinical', label: 'Clinical engineer', at: null, desc: 'procurement processing' },
    { key: 'in_process', label: 'In process', at: null, desc: r.release_number ? `Release ${r.release_number}` : 'release issued' },
    { key: 'approved', label: 'Approved', at: null, desc: 'release approved' },
    { key: 'receiving', label: 'Receiving parts', at: null, desc: 'goods receipt' },
    { key: 'closed', label: 'Closed', at: null, desc: 'fully received' },
  ]
  return stages.map(st => {
    const pos = order.indexOf(st.key)
    let state = 'upcoming'
    if (terminalReject && st.key === 'supervisor') state = 'rejected'
    else if (cancelled && st.key === 'submitted') state = 'done'
    else if (pos < idx) state = 'done'
    else if (pos === idx) state = (r.status === 'closed' ? 'done' : r.status === 'returned' ? 'returned' : 'current')
    return { ...st, state }
  }).filter(st => !(terminalReject && ['clinical', 'in_process', 'approved', 'receiving', 'closed'].includes(st.key)))
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Vendor release email — matches the department's standard format (see sample).
// Lines of a request as the vendor needs them: one row per contract line (a part requested
// for several devices is summed), parts first, VAT line last.
export function releaseLines(items = []) {
  const map = new Map()
  for (const it of [...items].sort((x, y) => x.id - y.id)) {
    const key = it.is_vat ? 'vat' : `${it.contract_item_id ?? it.part_number}`
    const row = map.get(key)
    if (row) row.quantity += Number(it.quantity)
    else map.set(key, { ...it, quantity: Number(it.quantity) })
  }
  return [...map.values()].sort((x, y) => (x.is_vat ? 1 : 0) - (y.is_vat ? 1 : 0))
}

export function buildApprovalEmail(req, settings = {}) {
  const deptEmail = settings.department_email || ''
  const deptName = settings.department_name || 'Healthcare Technology Management Services (HTMS)'
  const c = req.contracts
  const contacts = (c?.vendors?.vendor_contacts || []).filter(x => (x.email || '').trim())
  const to = [...new Set(contacts.map(x => x.email.trim()))]
  const items = releaseLines(req.request_items)
  const total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0)
  const rel = req.release_number || ''
  const ref = `${c?.po_number ?? ''} – ${rel}`          // P.O number – release
  const promised = req.promise_date
    ? new Date(req.promise_date).toLocaleDateString('en-GB').replace(/\//g, '-')  // dd-mm-yyyy
    : ''
  const subject = `Request Under Demand Contract, P.O: ${ref}`

  const rowsText = items.map(it =>
    `${it.line_number ?? ''} | ${it.description} | ${fmtQty(it.quantity)} | ${it.equipment_description || ''} | ${it.device_model || ''}`)
  const body = [
    'Dear Engr. ______________,',
    'Greetings.',
    '',
    `Be informed that a Blanket Release ${ref} has been approved under demand contract for the parts listed below.`,
    `Promised Date: ${promised}`,
    '',
    'Line | Line Description | QTY | Equipment Description | Model',
    ...rowsText,
    '',
    'Best regards,',
    deptName,
  ].join('\n')

  const rowsHtml = items.map(it => `<tr>
<td align="center">${esc(it.line_number)}</td><td>${esc(it.description)}</td>
<td align="center">${esc(fmtQty(it.quantity))}</td><td>${esc(it.equipment_description)}</td><td align="center">${esc(it.device_model)}</td></tr>`).join('')

  const html = `<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">
<p>Dear Engr. ______________,<br>Greetings.</p>
<p>Be informed that a <b>Blanket Release ${esc(ref)}</b> has been approved under demand contract for the parts listed below.<br>
<b>Promised Date:</b> ${esc(promised)}</p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:10pt">
<thead><tr style="background:#dbe5f1">
<th>Line</th><th>Line Description</th><th>QTY</th><th>Equipment Description</th><th>Model</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>Best regards,<br>${esc(deptName)}</p>
</body></html>`

  const mailto = `mailto:${to.join(',')}?${deptEmail ? `cc=${encodeURIComponent(deptEmail)}&` : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return { subject, body, html, mailto, total, to, cc: deptEmail, deptEmail, deptName }
}

// RFC 2047 header value, so the dash in the subject survives in Outlook
const encHeader = (v) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(v))) + '?='

export function downloadOutlookEmail(req, settings = {}) {
  const { subject, html, body, to, cc } = buildApprovalEmail(req, settings)
  const boundary = '----=_DCS_' + Date.now()
  const eml = [
    `To: ${to.join(', ')}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${encHeader(subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: 8bit', '', body, '',
    `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: 8bit', '', html, '',
    `--${boundary}--`, '',
  ].join('\r\n')
  const blob = new Blob([eml], { type: 'message/rfc822' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${req.request_number}.eml`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
