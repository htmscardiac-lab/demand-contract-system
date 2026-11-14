// Turns a report object into a PDF or an Excel workbook.
// report: { title, subtitle, filename, kpis: [{ label, value }], charts: [{ title, note, spec }],
//           tables: [{ title, columns: [{ h, k, t, w, sum }], rows }] }
// Column types (t): text, money, num, int, pct, days, date.
import { money, fmtDate, fmtQty } from './helpers'
import { chartPng } from './charts.jsx'
import emblemUrl from '../assets/mngha-emblem.jpg'

const NUMERIC = ['money', 'num', 'int', 'pct', 'days']
export function fmtCell(v, t) {
  if (v === null || v === undefined || v === '') return '—'
  if (t === 'money') return money(v)
  if (t === 'pct') return `${Number(v).toFixed(1)}%`
  if (t === 'days') return `${Number(v).toFixed(1)} d`
  if (t === 'num') return fmtQty(v)
  if (t === 'int') return String(Math.round(v))
  if (t === 'date') return fmtDate(v)
  return String(v)
}
const stamp = () => new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fileBase = (r) => `${r.filename || 'report'}-${new Date().toISOString().slice(0, 10)}`

function imageData(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); resolve(c.toDataURL('image/png')) }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
function save(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

// ------------------------------------------------------------------ PDF
export async function exportReportPdf(report, meta = {}) {
  const [{ default: jsPDF }, { default: autoTable }, emblem] = await Promise.all([import('jspdf'), import('jspdf-autotable'), imageData(emblemUrl)])
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36
  const INK = [20, 23, 28], BRAND = [176, 20, 42], MUTED = [102, 112, 128]

  // cover band
  doc.setFillColor(...INK); doc.rect(0, 0, W, 78, 'F')
  doc.setFillColor(...BRAND); doc.rect(0, 78, W, 3, 'F')
  if (emblem) { doc.setFillColor(255, 255, 255); doc.roundedRect(M, 14, 50, 50, 6, 6, 'F'); doc.addImage(emblem, 'PNG', M + 3, 17, 44, 44) }
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text(report.title, M + 64, 37)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(200, 205, 212)
  if (report.subtitle) doc.text(doc.splitTextToSize(report.subtitle, W - 300)[0], M + 64, 54)
  doc.setFontSize(9); doc.setTextColor(255)
  doc.text('Demand Contract System', W - M, 33, { align: 'right' })
  doc.setTextColor(200, 205, 212)
  doc.text(meta.department || 'Healthcare Technology Management Services', W - M, 47, { align: 'right' })
  doc.text('Ministry of National Guard Health Affairs', W - M, 60, { align: 'right' })
  let y = 100
  const room = (h) => { if (y + h > H - 40) { doc.addPage(); y = 44 } }
  const heading = (t, note) => {
    room(30)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(t.toUpperCase(), M, y)
    if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(note, M + doc.getTextWidth(t.toUpperCase()) * 11 / 8.5 + 10, y) }
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.2); doc.line(M, y + 5, M + 26, y + 5)
    y += 18
  }

  // KPI tiles
  const kpis = report.kpis || []
  if (kpis.length) {
    const per = Math.min(5, Math.max(3, Math.ceil(kpis.length / Math.ceil(kpis.length / 5)))), gap = 8, tw = (W - M * 2 - gap * (per - 1)) / per, th = 46
    kpis.forEach((k, i) => {
      const col = i % per
      if (col === 0 && i) y += th + gap
      if (col === 0) room(th)
      const x = M + col * (tw + gap)
      doc.setFillColor(245, 246, 248); doc.setDrawColor(223, 227, 232); doc.setLineWidth(0.6); doc.roundedRect(x, y, tw, th, 4, 4, 'FD')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(String(k.label).toUpperCase(), x + 9, y + 15)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...(k.alert ? BRAND : INK)); doc.text(String(k.value), x + 9, y + 34)
    })
    y += th + 22
  }

  // charts, two per row
  const charts = (report.charts || []).filter(c => c.spec)
  const cw = (W - M * 2 - 16) / 2
  for (let i = 0; i < charts.length; i += 2) {
    const pair = charts.slice(i, i + 2).map(c => ({ c, img: chartPng(c.spec, 520) }))
    const rowH = Math.max(...pair.map(p => p.img.height * cw / p.img.width)) + 26
    room(rowH)
    pair.forEach((p, k) => {
      const x = M + k * (cw + 16), ih = p.img.height * cw / p.img.width
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(p.c.title, x, y + 8)
      if (p.c.note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(p.c.note, x + cw, y + 8, { align: 'right' }) }
      doc.addImage(p.img.dataUrl, 'PNG', x, y + 14, cw, ih)
    })
    y += rowH + 8
  }

  // tables
  for (const t of report.tables || []) {
    room(110)
    heading(t.title, `${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`)
    const sums = t.columns.some(c => c.sum) && t.rows.length > 1
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, top: 44, bottom: 40 },
      head: [t.columns.map(c => c.h)],
      body: t.rows.length ? t.rows.map(r => t.columns.map(c => fmtCell(r[c.k], c.t))) : [[{ content: 'No rows for this period', colSpan: t.columns.length, styles: { halign: 'center', textColor: MUTED } }]],
      foot: sums ? [t.columns.map((c, i) => c.sum ? fmtCell(t.rows.reduce((s, r) => s + Number(r[c.k] || 0), 0), c.t) : i === 0 ? 'Total' : '')] : undefined,
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: [42, 47, 56], lineColor: [223, 227, 232], lineWidth: 0.4, overflow: 'linebreak' },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      footStyles: { fillColor: [236, 238, 242], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { halign: NUMERIC.includes(c.t) ? 'right' : 'left' }])),
      didParseCell: (d) => { if (d.section !== 'body') { const c = t.columns[d.column.index]; if (c && NUMERIC.includes(c.t)) d.cell.styles.halign = 'right' } },
    })
    y = doc.lastAutoTable.finalY + 26
  }

  const n = doc.internal.getNumberOfPages(), when = stamp()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(223, 227, 232); doc.setLineWidth(0.5); doc.line(M, H - 28, W - M, H - 28)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text(`Generated ${when}${meta.by ? ` by ${meta.by}` : ''}`, M, H - 16)
    doc.text(report.title, W / 2, H - 16, { align: 'center' })
    doc.text(`Page ${i} of ${n}`, W - M, H - 16, { align: 'right' })
  }
  doc.save(`${fileBase(report)}.pdf`)
}

// ---------------------------------------------------------------- Excel
const FMT = { money: '#,##0.00', num: '#,##0.####', int: '#,##0', pct: '0.0"%"', days: '0.0" d"', date: 'dd mmm yyyy' }
const INK_HEX = 'FF14171C', BRAND_HEX = 'FFB0142A'
const xlValue = (v, t) => v === null || v === undefined || v === '' ? null : t === 'date' ? new Date(v) : NUMERIC.includes(t) ? Number(v) : String(v)

export async function exportReportExcel(report, meta = {}) {
  const mod = await import('exceljs/dist/exceljs.min.js')
  const ExcelJS = mod.default?.Workbook ? mod.default : mod.Workbook ? mod : window.ExcelJS
  const wb = new ExcelJS.Workbook()
  wb.creator = meta.by || 'Demand Contract System'; wb.created = new Date()

  // summary sheet: title, KPIs, charts
  const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  ws.columns = [{ width: 34 }, { width: 22 }, ...Array.from({ length: 10 }, () => ({ width: 13 }))]
  ws.mergeCells('A1:L1'); ws.mergeCells('A2:L2'); ws.mergeCells('A3:L3')
  const head = (cell, text, font, fill) => { const c = ws.getCell(cell); c.value = text; c.font = font; c.alignment = { vertical: 'middle', indent: 1 }; if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } } }
  head('A1', report.title, { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }, INK_HEX); ws.getRow(1).height = 36
  head('A2', report.subtitle || '', { name: 'Calibri', size: 11, color: { argb: 'FFDFE3E8' } }, INK_HEX); ws.getRow(2).height = 20
  head('A3', `${meta.department || 'Healthcare Technology Management Services'} · Ministry of National Guard Health Affairs · Generated ${stamp()}${meta.by ? ` by ${meta.by}` : ''}`,
    { name: 'Calibri', size: 9, color: { argb: 'FFFFFFFF' } }, BRAND_HEX)
  let row = 5
  if (report.kpis?.length) {
    ws.getCell(`A${row}`).value = 'KEY FIGURES'; ws.getCell(`A${row}`).font = { bold: true, size: 11, color: { argb: INK_HEX } }; row++
    for (const k of report.kpis) {
      const a = ws.getCell(`A${row}`), b = ws.getCell(`B${row}`)
      a.value = k.label; b.value = typeof k.raw === 'number' ? k.raw : String(k.value)
      if (typeof k.raw === 'number' && k.t) b.numFmt = FMT[k.t]
      a.font = { size: 10, color: { argb: 'FF454C58' } }; b.font = { size: 11, bold: true, color: { argb: k.alert ? BRAND_HEX : INK_HEX } }; b.alignment = { horizontal: 'right' }
      for (const c of [a, b]) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F8' } }; c.border = { bottom: { style: 'thin', color: { argb: 'FFDFE3E8' } } } }
      row++
    }
    row++
  }
  for (const c of (report.charts || []).filter(x => x.spec)) {
    const img = chartPng(c.spec, 720), w = 640, h = Math.round(img.height * w / img.width)
    ws.getCell(`A${row}`).value = c.title.toUpperCase(); ws.getCell(`A${row}`).font = { bold: true, size: 11, color: { argb: INK_HEX } }
    if (c.note) { ws.getCell(`B${row}`).value = c.note; ws.getCell(`B${row}`).font = { size: 9, color: { argb: 'FF667080' } } }
    const id = wb.addImage({ base64: img.dataUrl, extension: 'png' })
    ws.addImage(id, { tl: { col: 0, row }, ext: { width: w, height: h } })
    row += Math.ceil(h / 20) + 3
  }

  // one sheet per table
  const used = new Set(['summary'])
  for (const t of report.tables || []) {
    let name = t.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim() || 'Data'
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 28)} ${i}`
    used.add(name.toLowerCase())
    const sh = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sh.columns = t.columns.map(c => ({ header: c.h, key: c.k, width: c.w || (c.t === 'text' || !c.t ? 24 : 16), style: { numFmt: FMT[c.t], alignment: { vertical: 'top', horizontal: NUMERIC.includes(c.t) ? 'right' : 'left', wrapText: (c.w || 0) >= 36 } } }))
    for (const r of t.rows) sh.addRow(Object.fromEntries(t.columns.map(c => [c.k, xlValue(r[c.k], c.t)])))
    const hr = sh.getRow(1); hr.height = 22
    hr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK_HEX } }; c.alignment = { vertical: 'middle', horizontal: c.alignment?.horizontal || 'left' } })
    sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } }
    sh.eachRow((r, i) => { if (i > 1 && i % 2 === 1) r.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } } }) })
    if (t.columns.some(c => c.sum) && t.rows.length > 1) {
      const last = t.rows.length + 1
      const tr = sh.addRow(Object.fromEntries(t.columns.map((c, i) => [c.k, c.sum ? { formula: `SUM(${sh.getColumn(i + 1).letter}2:${sh.getColumn(i + 1).letter}${last})`, result: t.rows.reduce((s, r) => s + Number(r[c.k] || 0), 0) } : i === 0 ? 'Total' : null])))
      tr.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEEF2' } }; c.border = { top: { style: 'thin', color: { argb: INK_HEX } } } })
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase(report)}.xlsx`)
}
