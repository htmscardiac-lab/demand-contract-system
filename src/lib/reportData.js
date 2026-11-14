// Builds report objects (KPIs, charts, tables) from contracts and requests.
// The same object is shown on screen and exported to PDF / Excel (see reportExport.js).
import { supabase } from './supabase'
import { statusLabel, isOverdue } from './helpers'
import { fmtCell } from './reportExport'

const DAY = 86400000
const COMMITTED = ['pending_clinical', 'in_process', 'approved', 'closed']
const LIVE = ['pending', 'returned', ...COMMITTED]
const sum = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0)
const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
const pctOf = (n, d) => d > 0 ? n / d * 100 : null
const mLabel = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const kpi = (label, raw, t, alert) => ({ label, raw: typeof raw === 'number' ? raw : undefined, t, value: t ? fmtCell(raw, t) : String(raw ?? '—'), alert: !!alert })

export async function loadReportData() {
  const res = await Promise.all([
    supabase.from('contracts').select('*, vendors(id, name)'),
    supabase.from('contract_balances').select('*'),
    supabase.from('contract_items').select('*'),
    supabase.from('requests').select(`*, request_items(*), request_receipts(*), mrrs(*),
      contracts(id, contract_number, po_number, vendor_id, vendors(name)),
      engineer:profiles!requests_engineer_id_fkey(id, full_name),
      supervisor:profiles!requests_supervisor_id_fkey(id, full_name)`),
    supabase.from('team_memberships').select('*'),
  ])
  const bad = res.find(x => x.error)
  if (bad) throw new Error(bad.error.message)
  const [contracts, bals, items, reqs, teams] = res.map(x => x.data || [])
  const balBy = Object.fromEntries(bals.map(b => [b.contract_id, b]))
  return {
    contracts: contracts.map(c => ({ ...c, bal: balBy[c.id] || { remaining: c.total_amount - c.previous_consumed_amount, approved_spend: 0 } }))
      .sort((a, b) => a.contract_number.localeCompare(b.contract_number)),
    items, teams, requests: reqs.map(enrich).sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)),
  }
}

function enrich(r) {
  const all = r.request_items || [], parts = all.filter(i => !i.is_vat), rc = r.request_receipts || []
  const last = rc.length ? rc.map(x => x.received_at).sort().pop() : null
  const complete = r.status === 'closed'
  return {
    ...r, parts, value: sum(all, i => i.unit_price * i.quantity), month: String(r.submitted_at).slice(0, 7),
    committed: COMMITTED.includes(r.status), live: LIVE.includes(r.status),
    approvalDays: r.decided_at ? Math.max(0, (new Date(r.decided_at) - new Date(r.submitted_at)) / DAY) : null,
    leadDays: complete && last ? Math.max(0, (new Date(last) - new Date(r.submitted_at)) / DAY) : null,
    onTime: complete && last && r.promise_date ? String(last).slice(0, 10) <= r.promise_date : null,
    overdue: !!isOverdue(r), wasReturned: !!r.returned_at, noMrr: rc.filter(x => !x.mrr_id).length,
    linesDone: parts.filter(i => Number(i.received_quantity || 0) >= Number(i.quantity)).length,
  }
}

export const inRange = (reqs, f) => reqs.filter(r => (!f.from || r.submitted_at.slice(0, 10) >= f.from) && (!f.to || r.submitted_at.slice(0, 10) <= f.to))
const period = (f) => f.from || f.to ? `Requests submitted ${f.from ? `from ${fmtCell(f.from, 'date')}` : ''}${f.to ? ` to ${fmtCell(f.to, 'date')}` : ''}`.replace('  ', ' ') : 'All requests to date'

// Requests the user may see performance figures for.
export function performanceScope(reqs, profile) {
  if (['admin', 'clinical_engineer'].includes(profile.role)) return reqs
  if (profile.role === 'supervisor') return reqs.filter(r => r.supervisor_id === profile.id || r.engineer_id === profile.id)
  return reqs.filter(r => r.engineer_id === profile.id)
}

function spanMonths(reqs, f) {
  if (!reqs.length) return 1
  const a = new Date(f.from || reqs[0].submitted_at), b = f.to ? new Date(f.to) : new Date()
  return Math.max(1, (b - a) / DAY / 30.44)
}
function monthSeries(reqs, valueOf) {
  if (!reqs.length) return []
  const keys = []; const [y0, m0] = reqs[0].month.split('-').map(Number); const end = reqs[reqs.length - 1].month
  for (let y = y0, m = m0; ; m++) { if (m > 12) { m = 1; y++ } const k = `${y}-${String(m).padStart(2, '0')}`; keys.push(k); if (k >= end || keys.length > 60) break }
  return keys.map(k => ({ label: mLabel(k), value: sum(reqs.filter(r => r.month === k), valueOf) }))
}
function groupBy(list, keyOf) {
  const m = new Map()
  for (const x of list) { const k = keyOf(x); if (k === null || k === undefined) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}
const top = (rows, n = 10) => [...rows].sort((a, b) => b.value - a.value).slice(0, n)

function partRows(reqs, itemsById = {}) {
  const lines = reqs.filter(r => r.live).flatMap(r => r.parts.map(i => ({ i, r })))
  const total = sum(lines, x => x.i.unit_price * x.i.quantity), months = Math.max(1, new Set(reqs.map(r => r.month)).size)
  return [...groupBy(lines, x => x.i.part_number)].map(([part, ls]) => {
    const value = sum(ls, x => x.i.unit_price * x.i.quantity), qty = sum(ls, x => x.i.quantity), rec = sum(ls, x => x.i.received_quantity)
    const f = ls[0].i
    return {
      part, description: f.description, model: f.device_model || itemsById[f.contract_item_id]?.device_model || '',
      contracts: new Set(ls.map(x => x.r.contracts?.contract_number)).size, times: new Set(ls.map(x => x.r.id)).size, qty, received: rec, outstanding: qty - rec,
      devices: new Set(ls.map(x => x.i.serial_number)).size, value, share: pctOf(value, total), perMonth: qty / months,
      last: ls.map(x => x.r.submitted_at).sort().pop(),
    }
  }).sort((a, b) => b.qty - a.qty)
}
const PART_COLS = [
  { h: 'Part number', k: 'part', w: 18 }, { h: 'Description', k: 'description', w: 40 }, { h: 'Model', k: 'model', w: 18 },
  { h: 'Requests', k: 'times', t: 'int' }, { h: 'Qty requested', k: 'qty', t: 'num', sum: true }, { h: 'Qty received', k: 'received', t: 'num', sum: true },
  { h: 'Outstanding', k: 'outstanding', t: 'num', sum: true }, { h: 'Devices', k: 'devices', t: 'int' }, { h: 'Value before VAT', k: 'value', t: 'money', sum: true },
  { h: 'Share of spend', k: 'share', t: 'pct' }, { h: 'Avg qty / month', k: 'perMonth', t: 'num' }, { h: 'Last requested', k: 'last', t: 'date' },
]
const requestRows = (reqs) => [...reqs].reverse().map(r => ({
  number: r.request_number, date: r.submitted_at, engineer: r.engineer?.full_name, supervisor: r.supervisor?.full_name,
  contract: r.contracts?.contract_number, po: r.contracts?.po_number, vendor: r.contracts?.vendors?.name, status: statusLabel(r.status) + (r.archived ? ' · Archived' : ''),
  lines: r.parts.length, value: r.value, release: r.release_number || '', promise: r.promise_date, received: `${r.linesDone} / ${r.parts.length}`,
  mrr: (r.mrrs || []).map(m => m.mrr_number).join(', '),
}))
const REQUEST_COLS = [
  { h: 'Request', k: 'number', w: 18 }, { h: 'Submitted', k: 'date', t: 'date' }, { h: 'Engineer', k: 'engineer', w: 22 }, { h: 'Supervisor', k: 'supervisor', w: 22 },
  { h: 'Contract', k: 'contract', w: 18 }, { h: 'P.O', k: 'po', w: 12 }, { h: 'Vendor', k: 'vendor', w: 24 }, { h: 'Status', k: 'status', w: 26 },
  { h: 'Lines', k: 'lines', t: 'int' }, { h: 'Value incl. VAT', k: 'value', t: 'money', sum: true }, { h: 'Release', k: 'release', w: 12 },
  { h: 'Promise date', k: 'promise', t: 'date' }, { h: 'Lines received', k: 'received', w: 14 }, { h: 'MRR', k: 'mrr', w: 22 },
]

function activityKpis(reqs, f) {
  const counted = reqs.filter(r => r.status !== 'cancelled'), com = reqs.filter(r => r.committed)
  const ot = reqs.filter(r => r.onTime !== null)
  return [
    kpi('Requests', counted.length, 'int'), kpi('Committed value incl. VAT', sum(com, r => r.value), 'money'),
    kpi('Average request value', com.length ? sum(com, r => r.value) / com.length : null, 'money'),
    kpi('Request rate per month', counted.length / spanMonths(reqs, f), 'num'),
    kpi('Avg supervisor decision time', avg(reqs.filter(r => r.approvalDays !== null).map(r => r.approvalDays)), 'days'),
    kpi('Avg time to full receipt', avg(reqs.filter(r => r.leadDays !== null).map(r => r.leadDays)), 'days'),
    kpi('Delivered by promise date', pctOf(ot.filter(r => r.onTime).length, ot.length), 'pct'),
    kpi('Returned for amendment', pctOf(counted.filter(r => r.wasReturned).length, counted.length), 'pct'),
    kpi('Rejected', pctOf(counted.filter(r => r.status === 'rejected').length, counted.length), 'pct'),
    kpi('Overdue deliveries', reqs.filter(r => r.overdue).length, 'int', reqs.some(r => r.overdue)),
  ]
}
const statusChart = (reqs) => ({ title: 'Requests by status', spec: { type: 'hbar', unit: 'Requests',
  rows: [...groupBy(reqs, r => statusLabel(r.status))].map(([label, l]) => ({ label, value: l.length })).sort((a, b) => b.value - a.value) } })
const monthCharts = (reqs) => [
  { title: 'Requests per month', spec: { type: 'cols', unit: 'Requests', points: monthSeries(reqs.filter(r => r.status !== 'cancelled'), () => 1) } },
  { title: 'Committed value per month', note: 'incl. VAT', spec: { type: 'cols', unit: 'Value', points: monthSeries(reqs.filter(r => r.committed), r => r.value) } },
]
const topPartCharts = (parts) => [
  { title: 'Most requested parts', note: 'by quantity', spec: { type: 'hbar', unit: 'Quantity', rows: top(parts.map(p => ({ label: p.description, value: p.qty, sub: ['Part', p.part] }))) } },
  { title: 'Highest spend parts', note: 'value before VAT', spec: { type: 'hbar', unit: 'Value', rows: top(parts.map(p => ({ label: p.description, value: p.value, sub: ['Part', p.part] }))) } },
]

function contractFigures(c, reqs) {
  const total = Number(c.total_amount), prev = Number(c.previous_consumed_amount), com = Number(c.bal.approved_spend || 0), rem = Number(c.bal.remaining)
  const mine = reqs.filter(r => r.contract_id === c.id), comReqs = mine.filter(r => r.committed)
  const start = new Date(c.start_date), end = new Date(c.end_date), now = new Date()
  const first = comReqs.length ? new Date(comReqs[0].submitted_at) : null
  const burn = first ? com / Math.max(1, (now - first) / DAY / 30.44) : 0
  const runOut = burn > 0 && rem > 0 ? new Date(now.getTime() + rem / burn * 30.44 * DAY) : null
  return { total, prev, com, rem, used: pctOf(prev + com, total), elapsed: Math.min(100, Math.max(0, pctOf(now - start, end - start) ?? 0)),
    daysLeft: Math.round((end - now) / DAY), mine, comReqs, burn, runOut, gap: runOut ? Math.round((runOut - end) / DAY) : null }
}

// ------------------------------------------------------------- reports
export function overviewReport(d, f) {
  const reqs = inRange(d.requests, f), cs = d.contracts.map(c => ({ c, x: contractFigures(c, d.requests) }))
  const total = sum(cs, a => a.x.total), prev = sum(cs, a => a.x.prev), com = sum(cs, a => a.x.com), rem = sum(cs, a => a.x.rem)
  const parts = partRows(reqs)
  return {
    title: 'Demand contracts report', subtitle: `${d.contracts.length} contracts · ${period(f)}. Balances are as of today.`, filename: 'contracts-report',
    kpis: [
      kpi('Contracts', d.contracts.length, 'int'), kpi('Total contract value', total, 'money'), kpi('Previously consumed', prev, 'money'),
      kpi('Committed in requests', com, 'money'), kpi('Remaining balance', rem, 'money'), kpi('Balance used', pctOf(prev + com, total), 'pct'),
      kpi('Contracts with 10% or less left', cs.filter(a => a.x.used >= 90).length, 'int', cs.some(a => a.x.used >= 90)),
      kpi('Contracts ending within 60 days', cs.filter(a => a.x.daysLeft >= 0 && a.x.daysLeft <= 60).length, 'int'),
      ...activityKpis(reqs, f), kpi('Received lines without MRR', sum(reqs, r => r.noMrr), 'int'),
    ],
    charts: [
      { title: 'Balance used by contract', note: 'share of each contract total', spec: { type: 'stack', series: [{ name: 'Previously consumed' }, { name: 'Committed in requests' }], rest: 'Remaining',
        rows: [...cs].sort((a, b) => (b.x.used || 0) - (a.x.used || 0)).slice(0, 14).map(a => ({ label: a.c.contract_number, parts: [a.x.prev, a.x.com], of: a.x.total, note: `${(a.x.used || 0).toFixed(0)}% used` })) } },
      { title: 'Committed spend by vendor', note: 'incl. VAT', spec: { type: 'hbar', unit: 'Value',
        rows: top([...groupBy(reqs.filter(r => r.committed), r => r.contracts?.vendors?.name || '—')].map(([label, l]) => ({ label, value: sum(l, r => r.value) }))) } },
      ...monthCharts(reqs), statusChart(reqs), topPartCharts(parts)[0],
    ],
    tables: [
      { title: 'Contracts', columns: [
        { h: 'Contract', k: 'contract', w: 18 }, { h: 'P.O', k: 'po', w: 12 }, { h: 'Vendor', k: 'vendor', w: 26 }, { h: 'Start', k: 'start', t: 'date' }, { h: 'End', k: 'end', t: 'date' },
        { h: 'Days left', k: 'daysLeft', t: 'int' }, { h: 'Total', k: 'total', t: 'money', sum: true }, { h: 'Previously consumed', k: 'prev', t: 'money', sum: true },
        { h: 'Committed', k: 'com', t: 'money', sum: true }, { h: 'Remaining', k: 'rem', t: 'money', sum: true }, { h: 'Used', k: 'used', t: 'pct' },
        { h: 'Requests', k: 'requests', t: 'int', sum: true }, { h: 'Spend / month', k: 'burn', t: 'money' }, { h: 'Balance lasts until', k: 'runOut', t: 'date' },
      ], rows: cs.map(({ c, x }) => ({ contract: c.contract_number, po: c.po_number, vendor: c.vendors?.name, start: c.start_date, end: c.end_date, daysLeft: x.daysLeft,
        total: x.total, prev: x.prev, com: x.com, rem: x.rem, used: x.used, requests: x.mine.filter(r => r.status !== 'cancelled').length, burn: x.burn || null, runOut: x.runOut })) },
      { title: 'Requests', columns: REQUEST_COLS, rows: requestRows(reqs) },
      { title: 'Parts', columns: PART_COLS, rows: parts },
    ],
  }
}

export function contractReport(d, f, contractId) {
  const c = d.contracts.find(x => String(x.id) === String(contractId))
  if (!c) return null
  const x = contractFigures(c, d.requests), reqs = inRange(x.mine, f), byId = Object.fromEntries(d.items.map(i => [i.id, i]))
  const parts = partRows(reqs, byId), usage = Object.fromEntries(parts.map(p => [p.part, p]))
  let run = x.prev
  const cum = monthSeries(x.comReqs, r => r.value).map(p => ({ label: p.label, value: (run += p.value) }))
  const outlook = !x.runOut ? 'No spend yet' : x.gap >= 0 ? `${x.gap} d past end date` : `${-x.gap} d before end date`
  return {
    title: `Contract report · ${c.contract_number}`, filename: `contract-${slug(c.contract_number)}`,
    subtitle: `${c.vendors?.name} · P.O ${c.po_number} · ${fmtCell(c.start_date, 'date')} to ${fmtCell(c.end_date, 'date')} · ${period(f)}`,
    kpis: [
      kpi('Contract total', x.total, 'money'), kpi('Previously consumed', x.prev, 'money'), kpi('Committed in requests', x.com, 'money'),
      kpi('Remaining balance', x.rem, 'money', x.used >= 90), kpi('Balance used', x.used, 'pct', x.used >= 90), kpi('Contract period elapsed', x.elapsed, 'pct'),
      kpi('Days left', x.daysLeft, 'int', x.daysLeft <= 30), kpi('Average spend per month', x.burn || null, 'money'),
      kpi('Balance lasts until', x.runOut ? fmtCell(x.runOut, 'date') : '—'), kpi('Balance runs out', outlook, undefined, x.gap !== null && x.gap < 0),
      ...activityKpis(reqs, f).filter(k => !['Committed value incl. VAT'].includes(k.label)),
    ],
    charts: [
      { title: 'Balance consumed over time', note: 'previously consumed plus committed requests', spec: { type: 'line', unit: 'Consumed', points: cum, ref: { value: x.total, label: 'Contract total' } } },
      monthCharts(reqs)[1], ...topPartCharts(parts),
      { title: 'Committed value by engineer', note: 'incl. VAT', spec: { type: 'hbar', unit: 'Value',
        rows: top([...groupBy(reqs.filter(r => r.committed), r => r.engineer?.full_name || '—')].map(([label, l]) => ({ label, value: sum(l, r => r.value) }))) } },
      statusChart(reqs),
    ],
    tables: [
      { title: 'Line items', columns: [
        { h: 'Line', k: 'line', t: 'int' }, { h: 'Description', k: 'description', w: 40 }, { h: 'Part number', k: 'part', w: 18 }, { h: 'Model', k: 'model', w: 18 }, { h: 'VAT', k: 'vat', w: 8 },
        { h: 'Unit price before VAT', k: 'price', t: 'money' }, { h: 'Requests', k: 'times', t: 'int' }, { h: 'Qty requested', k: 'qty', t: 'num', sum: true },
        { h: 'Qty received', k: 'received', t: 'num', sum: true }, { h: 'Value before VAT', k: 'value', t: 'money', sum: true }, { h: 'Share of spend', k: 'share', t: 'pct' },
      ], rows: d.items.filter(i => i.contract_id === c.id).sort((a, b) => a.line_number - b.line_number).map(i => { const u = usage[i.part_number] || {}; return {
        line: i.line_number, description: i.description, part: i.part_number, model: i.device_model || '', vat: i.taxable ? 'Yes' : 'No', price: i.unit_price,
        times: u.times || 0, qty: u.qty || 0, received: u.received || 0, value: u.value || 0, share: u.share ?? 0 } }) },
      { title: 'Requests', columns: REQUEST_COLS.filter(k => !['contract', 'po', 'vendor'].includes(k.k)), rows: requestRows(reqs) },
    ],
  }
}

function peopleRows(reqs, keyOf, nameOf, f, extra = () => ({})) {
  return [...groupBy(reqs, keyOf)].map(([id, l]) => {
    const counted = l.filter(r => r.status !== 'cancelled'), com = l.filter(r => r.committed), ot = l.filter(r => r.onTime !== null)
    return { id, name: nameOf(l[0]), requests: counted.length, lines: sum(counted, r => r.parts.length), value: sum(com, r => r.value),
      avgValue: com.length ? sum(com, r => r.value) / com.length : null, rate: counted.length / spanMonths(reqs, f),
      decision: avg(l.filter(r => r.approvalDays !== null).map(r => r.approvalDays)), lead: avg(l.filter(r => r.leadDays !== null).map(r => r.leadDays)),
      onTime: pctOf(ot.filter(r => r.onTime).length, ot.length), returned: pctOf(counted.filter(r => r.wasReturned).length, counted.length),
      rejected: pctOf(counted.filter(r => r.status === 'rejected').length, counted.length),
      open: l.filter(r => ['pending', 'returned', 'pending_clinical', 'in_process', 'approved'].includes(r.status)).length, overdue: l.filter(r => r.overdue).length, ...extra(id, l) }
  }).sort((a, b) => b.value - a.value)
}
const PEOPLE_COLS = [
  { h: 'Requests', k: 'requests', t: 'int', sum: true }, { h: 'Lines', k: 'lines', t: 'int', sum: true }, { h: 'Committed value incl. VAT', k: 'value', t: 'money', sum: true },
  { h: 'Avg request value', k: 'avgValue', t: 'money' }, { h: 'Requests / month', k: 'rate', t: 'num' }, { h: 'Avg decision time', k: 'decision', t: 'days' },
  { h: 'Avg time to receipt', k: 'lead', t: 'days' }, { h: 'By promise date', k: 'onTime', t: 'pct' }, { h: 'Returned', k: 'returned', t: 'pct' },
  { h: 'Rejected', k: 'rejected', t: 'pct' }, { h: 'Open', k: 'open', t: 'int', sum: true }, { h: 'Overdue', k: 'overdue', t: 'int', sum: true },
]
const rank = (rows, k, title, unit, note) => ({ title, note, spec: { type: 'hbar', unit, rows: top(rows.filter(r => r[k] > 0).map(r => ({ label: r.name, value: r[k] })), 12) } })

// One team or one engineer in detail.
function focusReport(title, filename, subtitle, reqs, f) {
  const parts = partRows(reqs)
  return { title, filename, subtitle: `${subtitle} · ${period(f)}`, kpis: activityKpis(reqs, f),
    charts: [...monthCharts(reqs), statusChart(reqs), ...topPartCharts(parts)],
    tables: [{ title: 'Requests', columns: REQUEST_COLS, rows: requestRows(reqs) }, { title: 'Parts', columns: PART_COLS, rows: parts }] }
}

export function teamsReport(d, f, scope, supervisorId) {
  const reqs = inRange(scope, f)
  if (supervisorId) {
    const mine = reqs.filter(r => r.supervisor_id === supervisorId), name = mine[0]?.supervisor?.full_name || 'Team'
    const rep = focusReport(`Team report · ${name}`, `team-${slug(name)}`, `Supervisor ${name}`, mine, f)
    const eng = peopleRows(mine, r => r.engineer_id, r => r.engineer?.full_name, f)
    rep.charts.unshift(rank(eng, 'value', 'Committed value by engineer', 'Value', 'incl. VAT'))
    rep.tables.unshift({ title: 'Engineers', columns: [{ h: 'Engineer', k: 'name', w: 26 }, ...PEOPLE_COLS], rows: eng })
    return rep
  }
  const rows = peopleRows(reqs, r => r.supervisor_id, r => r.supervisor?.full_name, f,
    (id, l) => ({ engineers: new Set([...d.teams.filter(t => t.supervisor_id === id).map(t => t.engineer_id), ...l.map(r => r.engineer_id)]).size }))
  return {
    title: 'Teams report', filename: 'teams-report', subtitle: `${rows.length} team${rows.length === 1 ? '' : 's'} · a team is a supervisor and the engineers who send requests to them · ${period(f)}`,
    kpis: [kpi('Teams', rows.length, 'int'), ...activityKpis(reqs, f)],
    charts: [rank(rows, 'value', 'Committed value by team', 'Value', 'incl. VAT'), rank(rows, 'requests', 'Requests by team', 'Requests'),
      rank(rows, 'decision', 'Average supervisor decision time', 'Days', 'days from submission to decision'), ...monthCharts(reqs)],
    tables: [
      { title: 'Teams', columns: [{ h: 'Team (supervisor)', k: 'name', w: 26 }, { h: 'Engineers', k: 'engineers', t: 'int' }, ...PEOPLE_COLS], rows },
      { title: 'Engineers by team', columns: [{ h: 'Team (supervisor)', k: 'team', w: 26 }, { h: 'Engineer', k: 'name', w: 26 }, ...PEOPLE_COLS],
        rows: [...groupBy(reqs, r => r.supervisor_id)].flatMap(([, l]) => peopleRows(l, r => r.engineer_id, r => r.engineer?.full_name, f).map(e => ({ ...e, team: l[0].supervisor?.full_name }))) },
    ],
  }
}

export function engineersReport(d, f, scope, engineerId) {
  const reqs = inRange(scope, f)
  if (engineerId) {
    const mine = reqs.filter(r => r.engineer_id === engineerId), name = mine[0]?.engineer?.full_name || scope.find(r => r.engineer_id === engineerId)?.engineer?.full_name || 'Engineer'
    return focusReport(`Engineer report · ${name}`, `engineer-${slug(name)}`, name, mine, f)
  }
  const rows = peopleRows(reqs, r => r.engineer_id, r => r.engineer?.full_name, f, (id, l) => ({ team: [...new Set(l.map(r => r.supervisor?.full_name))].join(', ') }))
  return {
    title: 'Engineers report', filename: 'engineers-report', subtitle: `${rows.length} engineer${rows.length === 1 ? '' : 's'} · ${period(f)}`,
    kpis: [kpi('Engineers', rows.length, 'int'), ...activityKpis(reqs, f)],
    charts: [rank(rows, 'value', 'Committed value by engineer', 'Value', 'incl. VAT'), rank(rows, 'requests', 'Requests by engineer', 'Requests'),
      rank(rows, 'lead', 'Average time to full receipt', 'Days', 'days from submission'), rank(rows, 'returned', 'Requests returned for amendment', '%', 'share of requests')],
    tables: [{ title: 'Engineers', columns: [{ h: 'Engineer', k: 'name', w: 26 }, { h: 'Team (supervisor)', k: 'team', w: 26 }, ...PEOPLE_COLS], rows }],
  }
}

export function partsReport(d, f, contractId, partNo) {
  const c = contractId ? d.contracts.find(x => String(x.id) === String(contractId)) : null
  const reqs = inRange(d.requests, f).filter(r => !c || r.contract_id === c.id), byId = Object.fromEntries(d.items.map(i => [i.id, i]))
  const parts = partRows(reqs, byId), where = c ? `Contract ${c.contract_number}` : 'All contracts'
  if (partNo) {
    const p = parts.find(x => x.part === partNo), lines = reqs.filter(r => r.live).flatMap(r => r.parts.filter(i => i.part_number === partNo).map(i => ({ i, r })))
    if (!p) return null
    return {
      title: `Part report · ${p.part}`, filename: `part-${slug(p.part)}`, subtitle: `${p.description} · ${where} · ${period(f)}`,
      kpis: [kpi('Requests', p.times, 'int'), kpi('Quantity requested', p.qty, 'num'), kpi('Quantity received', p.received, 'num'), kpi('Outstanding', p.outstanding, 'num', p.outstanding > 0),
        kpi('Devices', p.devices, 'int'), kpi('Value before VAT', p.value, 'money'), kpi('Share of spend', p.share, 'pct'), kpi('Average quantity per month', p.perMonth, 'num'), kpi('Last requested', fmtCell(p.last, 'date'))],
      charts: [
        { title: 'Quantity requested per month', spec: { type: 'cols', unit: 'Quantity', points: monthSeries(reqs.filter(r => r.live), r => sum(r.parts.filter(i => i.part_number === partNo), i => i.quantity)) } },
        { title: 'Quantity by engineer', spec: { type: 'hbar', unit: 'Quantity', rows: top([...groupBy(lines, x => x.r.engineer?.full_name || '—')].map(([label, l]) => ({ label, value: sum(l, x => x.i.quantity) }))) } },
      ],
      tables: [{ title: 'Request lines', columns: [
        { h: 'Request', k: 'number', w: 18 }, { h: 'Submitted', k: 'date', t: 'date' }, { h: 'Engineer', k: 'engineer', w: 22 }, { h: 'Contract', k: 'contract', w: 18 }, { h: 'Status', k: 'status', w: 26 },
        { h: 'HTM number', k: 'htm', w: 14 }, { h: 'Serial number', k: 'serial', w: 16 }, { h: 'Work order', k: 'wo', w: 14 }, { h: 'Qty', k: 'qty', t: 'num', sum: true },
        { h: 'Received', k: 'received', t: 'num', sum: true }, { h: 'Value before VAT', k: 'value', t: 'money', sum: true },
      ], rows: lines.reverse().map(({ i, r }) => ({ number: r.request_number, date: r.submitted_at, engineer: r.engineer?.full_name, contract: r.contracts?.contract_number, status: statusLabel(r.status),
        htm: i.htm_number, serial: i.serial_number, wo: i.work_order_number, qty: i.quantity, received: i.received_quantity, value: i.unit_price * i.quantity })) }],
    }
  }
  return {
    title: 'Parts report', filename: c ? `parts-${slug(c.contract_number)}` : 'parts-report', subtitle: `${where} · ${parts.length} parts requested · ${period(f)}`,
    kpis: [kpi('Parts requested', parts.length, 'int'), kpi('Quantity requested', sum(parts, p => p.qty), 'num'), kpi('Quantity received', sum(parts, p => p.received), 'num'),
      kpi('Outstanding', sum(parts, p => p.outstanding), 'num'), kpi('Value before VAT', sum(parts, p => p.value), 'money'),
      kpi('Top 5 parts share of spend', pctOf(sum(top(parts.map(p => ({ value: p.value })), 5), p => p.value), sum(parts, p => p.value)), 'pct')],
    charts: [...topPartCharts(parts),
      { title: 'Quantity requested per month', note: 'all parts', spec: { type: 'cols', unit: 'Quantity', points: monthSeries(reqs.filter(r => r.live), r => sum(r.parts, i => i.quantity)) } },
      { title: 'Parts used on the most devices', spec: { type: 'hbar', unit: 'Devices', rows: top(parts.map(p => ({ label: p.description, value: p.devices, sub: ['Part', p.part] }))) } }],
    tables: [{ title: 'Parts', columns: PART_COLS, rows: parts }],
  }
}
