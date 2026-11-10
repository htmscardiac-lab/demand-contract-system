export const money = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export const STATUS_LABEL = {
  pending: 'Pending — supervisor',
  pending_clinical: 'At clinical engineer',
  in_process: 'In process',
  approved: 'Approved',
  returned: 'Returned',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  closed: 'Closed',
}
export const STATUS_STYLE = {
  pending:          'bg-amber-100 text-amber-800',
  pending_clinical: 'bg-indigo-100 text-indigo-800',
  in_process:       'bg-blue-100 text-blue-800',
  approved:         'bg-emerald-100 text-emerald-800',
  returned:         'bg-orange-100 text-orange-800',
  rejected:         'bg-red-100 text-red-700',
  cancelled:        'bg-slate-200 text-slate-500',
  closed:           'bg-slate-200 text-slate-700',
}
export const statusLabel = (s) => STATUS_LABEL[s] || s
export const receiptLabel = (it) =>
  it.received_quantity >= it.quantity ? 'Received'
    : it.received_quantity > 0 ? `Partial ${it.received_quantity}/${it.quantity}`
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
    { key: 'clinical', label: 'At clinical engineer', at: null, desc: 'procurement processing' },
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
export function buildApprovalEmail(req, settings = {}) {
  const deptEmail = settings.department_email || ''
  const deptName = settings.department_name || 'Healthcare Technology Management Services (HTMS)'
  const c = req.contracts
  const items = req.request_items || []
  const total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0)
  const rel = req.release_number || ''
  const promised = req.promise_date
    ? new Date(req.promise_date).toLocaleDateString('en-GB').replace(/\//g, '-')  // dd-mm-yyyy
    : ''
  const subject = `Blanket Release ${rel} — Demand Contract ${c?.contract_number ?? ''}`.trim()

  const rowsText = items.map(it =>
    `${it.line_number ?? ''} | ${it.description} | ${it.quantity} | ${it.equipment_description || ''} | ${it.device_model || ''}`)
  const body = [
    'Dear Engr. ______________,',
    'Greetings.',
    '',
    `Be informed that a Blanket Release ${rel} has been approved under demand contract for the parts listed below.`,
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
<td align="center">${esc(it.quantity)}</td><td>${esc(it.equipment_description)}</td><td align="center">${esc(it.device_model)}</td></tr>`).join('')

  const html = `<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">
<p>Dear Engr. ______________,<br>Greetings.</p>
<p>Be informed that a <b>Blanket Release ${esc(rel)}</b> has been approved under demand contract for the parts listed below.<br>
<b>Promised Date:</b> ${esc(promised)}</p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:10pt">
<thead><tr style="background:#dbe5f1">
<th>Line</th><th>Line Description</th><th>QTY</th><th>Equipment Description</th><th>Model</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>Best regards,<br>${esc(deptName)}</p>
</body></html>`

  const mailto = `mailto:${deptEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return { subject, body, html, mailto, total, deptEmail, deptName }
}

export function downloadOutlookEmail(req, settings = {}) {
  const { subject, html, body, deptEmail } = buildApprovalEmail(req, settings)
  const boundary = '----=_DCS_' + Date.now()
  const eml = [
    `To: ${deptEmail}`, `Subject: ${subject}`, 'X-Unsent: 1', 'MIME-Version: 1.0',
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
