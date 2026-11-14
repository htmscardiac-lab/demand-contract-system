// Small canvas chart kit. One drawing path serves the screen, the PDF and the Excel exports.
// Forms: hbar (ranked magnitudes), stack (parts of a whole per row), cols (values over time), line (running total).
import React, { useEffect, useRef, useState } from 'react'

export const C = {
  ink: '#14171c', text: '#454c58', muted: '#7b8494', grid: '#e5e8ec', track: '#e9ecf0', surface: '#ffffff',
  bar: '#2f679d',                                           // single-series hue
  series: ['#2f679d', '#b0142a', '#b8862e', '#3c7a37'],    // categorical, fixed order
}
const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace'

export const compact = (n) => {
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n * 10) / 10)
}
const full = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

function fit(ctx, text, max) {
  text = String(text ?? '')
  if (ctx.measureText(text).width <= max) return text
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1)
  return text + '…'
}
function bar(ctx, x, y, w, h, r, ends = 'right') {
  if (w <= 0 || h <= 0) return
  r = Math.min(r, w / 2, h / 2)
  const rad = ends === 'right' ? [0, r, r, 0] : ends === 'top' ? [r, r, 0, 0] : ends === 'all' ? r : 0
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h)
  ctx.fill()
}
function niceMax(v) {
  if (!(v > 0)) return 1
  if (v <= 20 && Number.isInteger(v)) return Math.max(4, Math.ceil(v / 4) * 4)   // whole-number ticks for small counts
  const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}
function empty(ctx, W, H) {
  ctx.fillStyle = C.muted; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('No data for this period', W / 2, H / 2)
}
function legend(ctx, items, x, y) {
  ctx.font = `12px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  for (const it of items) {
    ctx.fillStyle = it.color; bar(ctx, x, y - 5, 10, 10, 2, 'all')
    ctx.fillStyle = C.text; ctx.fillText(it.name, x + 15, y)
    x += 15 + ctx.measureText(it.name).width + 18
  }
}

// rows: [{ label, value, sub? }]
function hbar(ctx, W, H, s, hits) {
  const rows = s.rows || []
  if (!rows.length) return empty(ctx, W, H)
  const fmt = s.fmt || compact
  ctx.font = `12px ${SANS}`
  const labelW = Math.min(W * 0.36, Math.max(...rows.map(r => ctx.measureText(r.label).width)) + 4)
  ctx.font = `12px ${MONO}`
  const valueW = Math.max(...rows.map(r => ctx.measureText(fmt(r.value)).width)) + 10
  const x0 = labelW + 10, plot = Math.max(20, W - x0 - valueW)
  const max = Math.max(...rows.map(r => r.value), 0) || 1
  const rowH = Math.min(34, (H - 6) / rows.length), th = Math.min(16, rowH - 10)
  rows.forEach((r, i) => {
    const cy = 3 + i * rowH + rowH / 2, w = Math.max(r.value > 0 ? 2 : 0, r.value / max * plot)
    ctx.font = `12px ${SANS}`; ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, r.label, labelW), labelW, cy)
    ctx.fillStyle = C.track; bar(ctx, x0, cy - th / 2, plot, th, 4)
    ctx.fillStyle = s.color || C.bar; bar(ctx, x0, cy - th / 2, w, th, 4)
    ctx.font = `12px ${MONO}`; ctx.fillStyle = C.ink; ctx.textAlign = 'left'
    ctx.fillText(fmt(r.value), x0 + plot + 8, cy)
    hits.push({ x: 0, y: cy - rowH / 2, w: W, h: rowH, title: r.label, lines: [[s.unit || 'Value', full(r.value)], ...(r.sub ? [r.sub] : [])] })
  })
}

// rows: [{ label, parts: [n, n], of, note }], series: [{ name }], rest: name of the unfilled remainder
function stack(ctx, W, H, s, hits) {
  const rows = s.rows || []
  if (!rows.length) return empty(ctx, W, H)
  const series = s.series.map((x, i) => ({ ...x, color: C.series[i] }))
  legend(ctx, [...series, ...(s.rest ? [{ name: s.rest, color: C.track }] : [])], 0, 9)
  const top = 28
  ctx.font = `12px ${SANS}`
  const labelW = Math.min(W * 0.3, Math.max(...rows.map(r => ctx.measureText(r.label).width)) + 4)
  ctx.font = `12px ${MONO}`
  const noteW = Math.max(...rows.map(r => ctx.measureText(r.note || '').width)) + 10
  const x0 = labelW + 10, plot = Math.max(20, W - x0 - noteW)
  const rowH = Math.min(34, (H - top - 4) / rows.length), th = Math.min(16, rowH - 10)
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2, of = r.of > 0 ? r.of : 1
    ctx.font = `12px ${SANS}`; ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, r.label, labelW), labelW, cy)
    ctx.fillStyle = C.track; bar(ctx, x0, cy - th / 2, plot, th, 4)
    let x = x0
    r.parts.forEach((v, k) => {
      const w = Math.min(plot - (x - x0), Math.max(0, v) / of * plot)
      if (w > 0.5) {
        ctx.fillStyle = series[k].color
        bar(ctx, x, cy - th / 2, Math.max(1, w - (k < r.parts.length - 1 ? 2 : 0)), th, 4, k === r.parts.length - 1 || !r.parts.slice(k + 1).some(p => p > 0) ? 'right' : 'none')
      }
      x += w
    })
    ctx.font = `12px ${MONO}`; ctx.fillStyle = C.ink; ctx.textAlign = 'left'
    ctx.fillText(r.note || '', x0 + plot + 8, cy)
    hits.push({ x: 0, y: cy - rowH / 2, w: W, h: rowH, title: r.label,
      lines: [...series.map((se, k) => [se.name, full(r.parts[k] || 0)]), ...(s.rest ? [[s.rest, full(Math.max(0, of - r.parts.reduce((a, b) => a + b, 0)))]] : [])] })
  })
}

function axes(ctx, W, H, max, fmt, padL, padB, padT) {
  ctx.font = `11px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, y = H - padB - (H - padB - padT) * i / 4
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke()
    ctx.fillStyle = C.muted; ctx.fillText(fmt(v), padL - 8, y)
  }
}
function xLabels(ctx, pts, xOf, y, W) {
  ctx.font = `11px ${SANS}`; ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const maxW = Math.max(...pts.map(p => ctx.measureText(p.label).width)) + 10
  const every = Math.max(1, Math.ceil(maxW * pts.length / (W - 40)))
  pts.forEach((p, i) => { if (i % every === 0 || i === pts.length - 1 && (pts.length - 1) % every > every / 2) ctx.fillText(p.label, xOf(i), y) })
}

// points: [{ label, value }]
function cols(ctx, W, H, s, hits) {
  const pts = s.points || []
  if (!pts.length) return empty(ctx, W, H)
  const fmt = s.fmt || compact, max = niceMax(Math.max(...pts.map(p => p.value)))
  ctx.font = `11px ${MONO}`
  const padL = ctx.measureText(fmt(max)).width + 14, padB = 24, padT = 10
  axes(ctx, W, H, max, fmt, padL, padB, padT)
  const slot = (W - padL) / pts.length, bw = Math.max(3, Math.min(28, slot - 6)), base = H - padB
  const xOf = (i) => padL + slot * i + slot / 2
  pts.forEach((p, i) => {
    const h = p.value / max * (base - padT)
    ctx.fillStyle = s.color || C.bar; bar(ctx, xOf(i) - bw / 2, base - h, bw, h, 4, 'top')
    hits.push({ x: padL + slot * i, y: 0, w: slot, h: H, title: p.label, lines: [[s.unit || 'Value', full(p.value)]] })
  })
  xLabels(ctx, pts, xOf, base + 7, W)
}

// points: [{ label, value }], ref: { value, label }
function line(ctx, W, H, s, hits) {
  const pts = s.points || []
  if (!pts.length) return empty(ctx, W, H)
  const fmt = s.fmt || compact, max = niceMax(Math.max(...pts.map(p => p.value), s.ref?.value || 0))
  ctx.font = `11px ${MONO}`
  const padL = ctx.measureText(fmt(max)).width + 14, padB = 24, padT = 16, padR = 16
  axes(ctx, W, H, max, fmt, padL, padB, padT)
  const base = H - padB, pw = W - padL - padR
  const xOf = (i) => padL + (pts.length === 1 ? pw / 2 : pw * i / (pts.length - 1)), yOf = (v) => base - v / max * (base - padT)
  if (s.ref) {
    const y = Math.round(yOf(s.ref.value)) + 0.5
    ctx.strokeStyle = C.series[1]; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([])
    ctx.font = `11px ${SANS}`; ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText(`${s.ref.label} ${fmt(s.ref.value)}`, W - 2, y - 3)
  }
  ctx.strokeStyle = C.bar; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath()
  pts.forEach((p, i) => { const x = xOf(i), y = yOf(p.value); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
  ctx.stroke()
  const last = pts.length - 1
  ctx.fillStyle = C.surface; ctx.beginPath(); ctx.arc(xOf(last), yOf(pts[last].value), 6, 0, 7); ctx.fill()
  ctx.fillStyle = C.bar; ctx.beginPath(); ctx.arc(xOf(last), yOf(pts[last].value), 4, 0, 7); ctx.fill()
  ctx.font = `12px ${MONO}`; ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillText(fmt(pts[last].value), xOf(last) + 12, yOf(pts[last].value) - 8)
  const slot = pw / Math.max(1, pts.length - 1)
  pts.forEach((p, i) => hits.push({ x: xOf(i) - slot / 2, y: 0, w: slot, h: H, title: p.label, lines: [[s.unit || 'Value', full(p.value)]], dot: [xOf(i), yOf(p.value)] }))
  xLabels(ctx, pts, xOf, base + 7, W)
}

const FORMS = { hbar, stack, cols, line }
export function chartHeight(spec) {
  if (spec.type === 'hbar') return Math.max(70, (spec.rows?.length || 1) * 30 + 6)
  if (spec.type === 'stack') return Math.max(90, (spec.rows?.length || 1) * 30 + 32)
  return 240
}
export function drawChart(ctx, W, H, spec) {
  const hits = []
  ctx.clearRect(0, 0, W, H)
  FORMS[spec.type](ctx, W, H, spec, hits)
  return hits
}
// PNG for the PDF and Excel exports.
export function chartPng(spec, width = 760) {
  const h = chartHeight(spec), k = 2, pad = 12
  const cv = document.createElement('canvas'); cv.width = (width + pad * 2) * k; cv.height = (h + pad * 2) * k
  const ctx = cv.getContext('2d'); ctx.scale(k, k)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width + pad * 2, h + pad * 2)
  ctx.translate(pad, pad); drawChart(ctx, width, h, spec)
  return { dataUrl: cv.toDataURL('image/png'), width: width + pad * 2, height: h + pad * 2 }
}

export function Chart({ spec, label }) {
  const box = useRef(null), cv = useRef(null), hits = useRef([])
  const [w, setW] = useState(0)
  const [tip, setTip] = useState(null)
  const h = chartHeight(spec)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(box.current); return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!w) return
    const paint = () => {
      const k = window.devicePixelRatio || 1, c = cv.current
      c.width = w * k; c.height = h * k
      const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0)
      hits.current = drawChart(ctx, w, h, spec)
    }
    paint()
    document.fonts?.ready.then(paint)   // repaint once the web fonts are in
  }, [w, h, spec])
  const move = (e) => {
    const r = cv.current.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
    const hit = hits.current.find(a => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h)
    setTip(hit ? { hit, x: Math.min(x + 14, w - 190), y: Math.max(0, y - 10) } : null)
  }
  return (
    <div ref={box} className="relative" onMouseMove={move} onMouseLeave={() => setTip(null)}>
      <canvas ref={cv} style={{ width: '100%', height: h, display: 'block' }} role="img" aria-label={label} />
      {tip && (
        <div className="absolute z-10 pointer-events-none bg-ink-900 text-white rounded-lg shadow-pop px-3 py-2 text-[12px] w-[180px]" style={{ left: Math.max(0, tip.x), top: tip.y }}>
          <div className="font-medium mb-1 break-words">{tip.hit.title}</div>
          {tip.hit.lines.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-ink-300">{k}</span><span className="num">{v}</span></div>)}
        </div>
      )}
    </div>
  )
}
