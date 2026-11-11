import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { money, fmtDate, statusLabel } from './helpers'

function header(doc, title, sub) {
  doc.setFontSize(15); doc.setTextColor(30); doc.text('Demand Contract System', 40, 40)
  doc.setFontSize(11); doc.setTextColor(90); doc.text(title, 40, 58)
  if (sub) { doc.setFontSize(9); doc.setTextColor(130); doc.text(sub, 40, 72) }
  doc.setDrawColor(220); doc.line(40, 80, 555, 80)
}
function footer(doc) {
  const n = doc.internal.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150)
    doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, 40, 812)
    doc.text(`Page ${i} of ${n}`, 505, 812)
  }
}

// Detailed report for a single contract: details, balance, line items, and its requests.
export function contractPdf({ contract, balance, items, requests }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  header(doc, `Contract report — ${contract.contract_number}`, `Vendor: ${contract.vendors?.name || ''}   ·   PO: ${contract.po_number}`)
  let y = 96
  doc.setFontSize(10); doc.setTextColor(40)
  const info = [
    ['Contract number', contract.contract_number, 'PO number', contract.po_number],
    ['Vendor', contract.vendors?.name || '', 'Vendor email', contract.vendors?.contact_email || '—'],
    ['Start date', fmtDate(contract.start_date), 'End date', fmtDate(contract.end_date)],
    ['Total amount', money(contract.total_amount), 'Previously consumed', money(contract.previous_consumed_amount)],
    ['Approved spend', money(balance?.approved_spend), 'Remaining balance', money(balance?.remaining)],
  ]
  autoTable(doc, { startY: y, theme: 'plain', styles: { fontSize: 9, cellPadding: 3 },
    body: info, columnStyles: { 0: { fontStyle: 'bold', textColor: 90 }, 2: { fontStyle: 'bold', textColor: 90 } } })
  y = doc.lastAutoTable.finalY + 16

  doc.setFontSize(11); doc.setTextColor(30); doc.text('Line items', 40, y); y += 6
  autoTable(doc, { startY: y, headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8, cellPadding: 4 },
    head: [['Line', 'Description', 'Part number', 'Unit price']],
    body: items.map(it => [it.line_number, it.description, it.part_number, money(it.unit_price)]) })
  y = doc.lastAutoTable.finalY + 16

  doc.setFontSize(11); doc.setTextColor(30); doc.text(`Requests against this contract (${requests.length})`, 40, y); y += 6
  if (requests.length) {
    autoTable(doc, { startY: y, headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8, cellPadding: 4 },
      head: [['Request', 'Engineer', 'Status', 'Release', 'Promise', 'Received', 'Total']],
      body: requests.map(r => {
        const tot = r.request_items.reduce((s, i) => s + i.quantity, 0)
        const got = r.request_items.reduce((s, i) => s + (i.received_quantity || 0), 0)
        return [r.request_number, r.engineer?.full_name || '', statusLabel(r.status), r.release_number || '—',
          fmtDate(r.promise_date), `${Number(got.toFixed(4))}/${Number(tot.toFixed(4))}`, money(r.request_items.reduce((s, i) => s + i.unit_price * i.quantity, 0))]
      }) })
  } else {
    doc.setFontSize(9); doc.setTextColor(140); doc.text('No requests yet.', 40, y + 14)
  }
  footer(doc)
  doc.save(`Contract-${contract.contract_number}.pdf`)
}

// Summary report across all contracts.
export function allContractsPdf({ contracts, balances, requests }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  header(doc, 'All contracts — summary report', `${contracts.length} contracts`)
  const balById = Object.fromEntries(balances.map(b => [b.contract_id, b]))
  const reqByC = {}
  for (const r of requests) { (reqByC[r.contract_id] = reqByC[r.contract_id] || []).push(r) }
  autoTable(doc, { startY: 96, headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8, cellPadding: 4 },
    head: [['Contract', 'Vendor', 'PO', 'End date', 'Total', 'Consumed', 'Approved spend', 'Remaining', 'Requests']],
    body: contracts.map(c => {
      const b = balById[c.id] || {}
      return [c.contract_number, c.vendors?.name || '', c.po_number, fmtDate(c.end_date), money(c.total_amount),
        money(c.previous_consumed_amount), money(b.approved_spend), money(b.remaining), (reqByC[c.id] || []).length]
    }) })
  let y = doc.lastAutoTable.finalY + 16
  const totals = balances.reduce((a, b) => ({ t: a.t + b.total_amount, s: a.s + b.approved_spend, r: a.r + b.remaining }), { t: 0, s: 0, r: 0 })
  doc.setFontSize(10); doc.setTextColor(40)
  doc.text(`Totals — value: ${money(totals.t)}    approved spend: ${money(totals.s)}    remaining: ${money(totals.r)}`, 40, y)
  footer(doc)
  doc.save('All-contracts-summary.pdf')
}
