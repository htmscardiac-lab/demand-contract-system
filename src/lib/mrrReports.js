// MRR reports: lines awaiting an MRR, the MRRs recorded, and one MRR in detail.
// Each returns a report object for reportExport.js (PDF / Excel).
import { vatQtyFor } from './helpers'
import { unlinkedReceipts, poRelease } from './mrr.jsx'
import { fmtCell } from './reportExport'

const DAY = 86400000
const days = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / DAY))
const sum = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0)
const kpi = (label, raw, t, alert) => ({ label, raw: typeof raw === 'number' ? raw : undefined, t, value: t ? fmtCell(raw, t) : String(raw ?? '—'), alert: !!alert })
const count = (list, keyOf) => { const m = new Map(); for (const x of list) m.set(keyOf(x), (m.get(keyOf(x)) || 0) + 1); return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12) }
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const lineValue = (x) => Number(x.quantity) * Number(x.item.unit_price)

// One MRR with its request, receipts and the VAT quantity it carries.
export function mrrEntry(m, r) {
  const items = Object.fromEntries((r.request_items || []).map(i => [i.id, i]))
  const all = (r.request_receipts || []).filter(x => x.mrr_id === m.id && items[x.request_item_id]).map(x => ({ ...x, item: items[x.request_item_id] }))
    .sort((a, b) => (a.item.line_number ?? 0) - (b.item.line_number ?? 0) || a.id - b.id)
  const lines = all.filter(x => !x.item.is_vat), vatLine = (r.request_items || []).find(i => i.is_vat)
  const vatQty = vatLine ? vatQtyFor(lines, vatLine) : 0
  const value = sum(lines, lineValue), vat = vatLine ? vatQty * Number(vatLine.unit_price) : 0
  return { m, r, lines, vatLine, vatQty, value, vat, total: value + vat, vendor: r.contracts?.vendors?.name || '', po: r.contracts?.po_number ?? '', ref: poRelease(r) }
}
export const allMrrs = (reqs) => reqs.flatMap(r => (r.mrrs || []).map(m => mrrEntry(m, r))).sort((a, b) => new Date(b.m.mrr_date) - new Date(a.m.mrr_date) || b.m.id - a.m.id)

const LINE_COLS = [
  { h: 'Line', k: 'line', t: 'int' }, { h: 'Description', k: 'description', w: 40 }, { h: 'Part number', k: 'part', w: 18 }, { h: 'HTM number', k: 'htm', w: 14 },
  { h: 'Serial number', k: 'serial', w: 16 }, { h: 'Work order', k: 'wo', w: 14 }, { h: 'Qty received', k: 'qty', t: 'num', sum: true }, { h: 'Received on', k: 'received', t: 'date' },
]
const lineRow = (x) => ({ line: x.item.line_number, description: x.item.description, part: x.item.part_number, htm: x.item.htm_number, serial: x.item.serial_number,
  wo: x.item.work_order_number, qty: Number(x.quantity), received: x.received_at, value: lineValue(x) })

export function awaitingMrrReport(requests, scope) {
  const rows = requests.flatMap(r => unlinkedReceipts(r).filter(x => !x.item.is_vat).map(x => ({
    vendor: r.contracts?.vendors?.name || '', ref: poRelease(r), request: r.request_number, engineer: r.engineer?.full_name, ...lineRow(x), days: days(x.received_at) })))
  const buckets = [['0–7 days', 0, 7], ['8–14 days', 8, 14], ['15–30 days', 15, 30], ['31–60 days', 31, 60], ['Over 60 days', 61, Infinity]]
  const oldest = rows.reduce((d, x) => Math.max(d, x.days), 0)
  return {
    title: 'Received lines awaiting MRR', filename: 'awaiting-mrr', subtitle: `${scope} · parts received and not yet covered by an MRR, as of today`,
    kpis: [kpi('Requests awaiting MRR', new Set(rows.map(x => x.request)).size, 'int'), kpi('Received lines without MRR', rows.length, 'int'),
      kpi('Vendors concerned', new Set(rows.map(x => x.vendor)).size, 'int'), kpi('Value before VAT', sum(rows, x => x.value), 'money'),
      kpi('Longest wait (days)', oldest, 'int', oldest > 30), kpi('Average wait', rows.length ? sum(rows, x => x.days) / rows.length : null, 'days'),
      kpi('Waiting over 30 days', rows.filter(x => x.days > 30).length, 'int', rows.some(x => x.days > 30))],
    charts: [
      { title: 'Lines awaiting MRR by vendor', spec: { type: 'hbar', unit: 'Lines', rows: count(rows, x => x.vendor) } },
      { title: 'How long lines have waited', note: 'days since receipt', spec: { type: 'cols', unit: 'Lines', points: buckets.map(([label, a, b]) => ({ label, value: rows.filter(x => x.days >= a && x.days <= b).length })) } },
    ],
    tables: [{ title: 'Awaiting MRR', columns: [{ h: 'Vendor', k: 'vendor', w: 26 }, { h: 'P.O – Release', k: 'ref', w: 20 }, { h: 'Request', k: 'request', w: 18 }, { h: 'Engineer', k: 'engineer', w: 22 },
      ...LINE_COLS, { h: 'Value before VAT', k: 'value', t: 'money', sum: true }, { h: 'Days waiting', k: 'days', t: 'int' }], rows: rows.sort((a, b) => b.days - a.days) }],
  }
}

const MRR_COLS = [
  { h: 'MRR number', k: 'number', w: 18 }, { h: 'MRR date', k: 'date', t: 'date' }, { h: 'P.O', k: 'po', w: 12 }, { h: 'Release', k: 'release', w: 12 }, { h: 'Request', k: 'request', w: 18 },
  { h: 'Vendor', k: 'vendor', w: 26 }, { h: 'Lines', k: 'lines', t: 'int', sum: true }, { h: 'Value before VAT', k: 'value', t: 'money', sum: true },
  { h: 'VAT', k: 'vat', t: 'money', sum: true }, { h: 'Total incl. VAT', k: 'total', t: 'money', sum: true },
]
const mrrRow = (e) => ({ number: e.m.mrr_number, date: e.m.mrr_date, po: e.po, release: e.r.release_number || '', request: e.r.request_number, vendor: e.vendor,
  lines: e.lines.length, value: e.value, vat: e.vat, total: e.total })

export function recordedMrrReport(entries, scope) {
  const months = new Map()
  for (const e of [...entries].reverse()) { const k = String(e.m.mrr_date).slice(0, 7); months.set(k, (months.get(k) || 0) + 1) }
  const pos = [...new Set(entries.map(e => e.po))]
  return {
    title: 'Recorded MRRs', filename: 'recorded-mrrs', subtitle: `${scope} · ${entries.length} MRR${entries.length === 1 ? '' : 's'}`,
    kpis: [kpi('MRRs recorded', entries.length, 'int'), kpi('P.Os covered', pos.length, 'int'), kpi('Vendors', new Set(entries.map(e => e.vendor)).size, 'int'),
      kpi('Lines covered', sum(entries, e => e.lines.length), 'int'), kpi('Value before VAT', sum(entries, e => e.value), 'money'),
      kpi('VAT', sum(entries, e => e.vat), 'money'), kpi('Total incl. VAT', sum(entries, e => e.total), 'money')],
    charts: [
      { title: 'MRRs recorded per month', note: 'by MRR date', spec: { type: 'cols', unit: 'MRRs',
        points: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => ({ label: new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), value })) } },
      { title: 'MRR value by vendor', note: 'incl. VAT', spec: { type: 'hbar', unit: 'Value',
        rows: [...new Set(entries.map(e => e.vendor))].map(v => ({ label: v, value: sum(entries.filter(e => e.vendor === v), e => e.total) })).sort((a, b) => b.value - a.value).slice(0, 12) } },
    ],
    tables: [
      { title: 'MRRs', columns: MRR_COLS, rows: entries.map(mrrRow) },
      { title: 'By P.O', columns: [{ h: 'P.O', k: 'po', w: 12 }, { h: 'Vendor', k: 'vendor', w: 26 }, { h: 'MRRs', k: 'mrrs', t: 'int', sum: true }, { h: 'MRR numbers', k: 'numbers', w: 40 },
        { h: 'Lines', k: 'lines', t: 'int', sum: true }, { h: 'Value before VAT', k: 'value', t: 'money', sum: true }, { h: 'VAT', k: 'vat', t: 'money', sum: true }, { h: 'Total incl. VAT', k: 'total', t: 'money', sum: true }],
        rows: pos.map(po => { const l = entries.filter(e => e.po === po); return { po, vendor: l[0].vendor, mrrs: l.length, numbers: l.map(e => e.m.mrr_number).join(', '),
          lines: sum(l, e => e.lines.length), value: sum(l, e => e.value), vat: sum(l, e => e.vat), total: sum(l, e => e.total) } }) },
      { title: 'MRR lines', columns: [{ h: 'MRR number', k: 'number', w: 18 }, { h: 'MRR date', k: 'date', t: 'date' }, { h: 'P.O – Release', k: 'ref', w: 20 }, ...LINE_COLS, { h: 'Value before VAT', k: 'value', t: 'money', sum: true }],
        rows: entries.flatMap(e => e.lines.map(x => ({ number: e.m.mrr_number, date: e.m.mrr_date, ref: e.ref, ...lineRow(x) }))) },
    ],
  }
}

export function singleMrrReport(e) {
  const rows = e.lines.map(x => ({ ...lineRow(x), price: Number(x.item.unit_price), vatFlag: x.item.taxable ? 'Yes' : 'No' }))
  if (e.vatLine && e.vatQty > 0) rows.push({ line: e.vatLine.line_number, description: 'VAT 15% on the taxed parts of this MRR', part: 'VAT', qty: e.vatQty, price: Number(e.vatLine.unit_price), value: e.vat, vatFlag: '' })
  return {
    title: `MRR ${e.m.mrr_number}`, filename: `mrr-${slug(e.m.mrr_number)}`, subtitle: `${e.vendor} · P.O ${e.ref} · request ${e.r.request_number}`,
    kpis: [kpi('MRR number', e.m.mrr_number), kpi('MRR date', fmtCell(e.m.mrr_date, 'date')), kpi('P.O – Release', e.ref), kpi('Vendor', e.vendor), kpi('Request', e.r.request_number),
      kpi('Requested by', e.r.engineer?.full_name), kpi('Lines covered', e.lines.length, 'int'), kpi('Value before VAT', e.value, 'money'), kpi('VAT', e.vat, 'money'), kpi('Total incl. VAT', e.total, 'money')],
    charts: [],
    tables: [{ title: 'MRR lines', columns: [...LINE_COLS.slice(0, 6), { h: 'VAT', k: 'vatFlag', w: 8 }, { ...LINE_COLS[6], sum: false }, { h: 'Unit price', k: 'price', t: 'money' },
      { h: 'Value', k: 'value', t: 'money', sum: true }, LINE_COLS[7]], rows }],
  }
}
