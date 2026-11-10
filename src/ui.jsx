import React, { useEffect } from 'react'

/* ------------------------------------------------------------------ icons */
const PATHS = {
  overview: 'M4 5h7v6H4zM13 5h7v10h-7zM4 13h7v6H4zM13 17h7v2h-7z',
  requests: 'M8 4h8l3 3v13H5V4h3zm0 6h8M8 14h8M8 18h5',
  contracts: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  admin: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0',
  logout: 'M15 16l4-4-4-4M19 12H9M12 20H6a1 1 0 01-1-1V5a1 1 0 011-1h6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 110-14 7 7 0 010 14zm5-2l4 4',
  back: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 16V5m0 0L8 9m4-4l4 4M5 19h14',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  clock: 'M12 21a9 9 0 110-18 9 9 0 010 18zm0-14v5l3 2',
  alert: 'M12 4l9 16H3zM12 10v4m0 3v.010',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18 14.5a6 6 0 013.5 5.5',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5',
  edit: 'M5 19h4L19.5 8.5a2.100 2.100 0 00-3-3L6 16zM14.5 7.5l3 3',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5v.010',
  sort: 'M8 5v14m0 0l-3-3m3 3l3-3M16 19V5m0 0l-3 3m3-3l3 3',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5a3 3 0 006 0h5',
}
export const Icon = ({ name, className = 'w-5 h-5', strokeWidth = 1.7 }) => (
  <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name] || ''} />
  </svg>
)

/* ECG trace — the HTMS signature line. */
export const EcgTrace = ({ className = '', animate = false }) => (
  <svg className={className} viewBox="0 0 600 60" fill="none" preserveAspectRatio="none" aria-hidden="true">
    <path pathLength="1" strokeDasharray="1" className={animate ? 'animate-trace' : ''}
      d="M0 34h150l10-10 10 10h34l8 7 10-7h40l9-4 7-26 9 52 8-28 6 6h44l12-9 12 9h60l5 12 6-12 12-9 12 9h106"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>
)

/* --------------------------------------------------------------- surfaces */
export const Card = ({ children, className = '', ...p }) => (
  <div {...p} className={`bg-white rounded-xl border border-ink-200 shadow-card ${className}`}>{children}</div>
)

export const SectionHead = ({ title, hint, right, className = '' }) => (
  <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 border-b border-ink-100 ${className}`}>
    <div className="min-w-0">
      <h2 className="font-display font-semibold text-[15px] tracking-wide text-ink-900 uppercase">{title}</h2>
      {hint && <p className="text-[13px] text-ink-500 mt-0.5">{hint}</p>}
    </div>
    {right}
  </div>
)

/* ---------------------------------------------------------------- buttons */
const BTN = {
  primary: 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white shadow-sm',
  dark: 'bg-ink-900 hover:bg-ink-700 text-white shadow-sm',
  secondary: 'bg-white hover:bg-ink-50 text-ink-800 border border-ink-300',
  success: 'bg-olive-600 hover:bg-olive-700 text-white shadow-sm',
  danger: 'bg-white hover:bg-brand-50 text-brand-700 border border-brand-200',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
}
export const Btn = ({ children, variant = 'primary', size = 'md', icon, className = '', ...p }) => (
  <button {...p}
    className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors
      disabled:opacity-45 disabled:pointer-events-none
      ${size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9.5 px-4 text-sm'}
      ${BTN[variant] || BTN.primary} ${className}`}>
    {icon && <Icon name={icon} className="w-4 h-4" />}
    {children}
  </button>
)

/* ------------------------------------------------------------------ forms */
const FIELD = 'w-full h-9.5 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 transition-shadow focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-100 disabled:bg-ink-50'
const Label = ({ children }) => <span className="block text-[13px] font-medium text-ink-600 mb-1.5">{children}</span>

export const Input = ({ label, className = '', ...p }) => (
  <label className="block">
    {label && <Label>{label}</Label>}
    <input {...p} className={`${FIELD} ${className}`} />
  </label>
)
export const Select = ({ label, children, className = '', ...p }) => (
  <label className="block">
    {label && <Label>{label}</Label>}
    <select {...p} className={`${FIELD} pr-8 ${className}`}>{children}</select>
  </label>
)
export const Textarea = ({ label, className = '', ...p }) => (
  <label className="block">
    {label && <Label>{label}</Label>}
    <textarea {...p} className={`${FIELD} h-auto py-2 ${className}`} />
  </label>
)
export const SearchInput = ({ className = '', ...p }) => (
  <div className={`relative ${className}`}>
    <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
    <input {...p} className={`${FIELD} pl-9`} />
  </div>
)

/* ----------------------------------------------------------------- badges */
export const Badge = ({ children, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>
)

/* ------------------------------------------------------- modal and drawer */
function useOverlay(open, onClose) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

export const Modal = ({ open, onClose, title, children, wide }) => {
  useOverlay(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-950/50 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`animate-rise bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl shadow-pop`}>
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-ink-100 sticky top-0 bg-white z-10">
          <h3 className="font-display font-semibold text-base tracking-wide uppercase text-ink-900 truncate">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100"><Icon name="close" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export const Drawer = ({ open, onClose, title, subtitle, badge, children, footer }) => {
  useOverlay(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/45" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={e => e.stopPropagation()}
        className="animate-slide bg-ink-50 w-full sm:max-w-[760px] h-full flex flex-col shadow-pop">
        <header className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 bg-white border-b border-ink-200">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="num text-lg font-medium text-ink-900">{title}</h3>
              {badge}
            </div>
            {subtitle && <p className="text-[13px] text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100"><Icon name="close" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">{children}</div>
        {footer && <footer className="px-5 sm:px-6 py-3.5 bg-white border-t border-ink-200 flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
      </aside>
    </div>
  )
}

/* ---------------------------------------------------------- feedback bits */
export const Spinner = ({ label = 'Loading' }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-400" role="status" aria-label={label}>
    <div className="h-7 w-7 rounded-full border-[3px] border-ink-200 border-t-brand-600 animate-spin" />
  </div>
)

export const Empty = ({ text, title, hint, icon = 'inbox', action }) => (
  <div className="flex flex-col items-center text-center py-12 px-4">
    <div className="w-11 h-11 rounded-full bg-ink-100 text-ink-400 flex items-center justify-center mb-3"><Icon name={icon} /></div>
    <div className="text-sm font-medium text-ink-700">{title || text}</div>
    {hint && <div className="text-[13px] text-ink-500 mt-1 max-w-sm">{hint}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const PageTitle = ({ children, subtitle, right, back }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-6">
    <div className="min-w-0">
      {back}
      <h1 className="font-display font-semibold text-[26px] leading-tight tracking-wide uppercase text-ink-900">{children}</h1>
      {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
    </div>
    {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
  </div>
)

export const BackLink = ({ onClick, children }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-500 hover:text-brand-700 mb-2 -ml-1">
    <Icon name="back" className="w-4 h-4" />{children}
  </button>
)

export const Alert = ({ kind = 'error', children }) => {
  const tone = kind === 'error' ? 'bg-brand-50 text-brand-800 border-brand-200'
    : kind === 'warn' ? 'bg-amber-100/60 text-amber-700 border-gold-200'
    : kind === 'info' ? 'bg-steel-100/60 text-steel-700 border-steel-100'
    : 'bg-olive-50 text-olive-700 border-olive-100'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm mb-4 ${tone}`}>
      <Icon name={kind === 'error' || kind === 'warn' ? 'alert' : kind === 'info' ? 'clock' : 'check'} className="w-4 h-4 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ tabs */
export const Tabs = ({ tabs, value, onChange, className = '' }) => (
  <div className={`flex gap-1 overflow-x-auto border-b border-ink-200 ${className}`} role="tablist">
    {tabs.map(t => {
      const on = t.key === value
      return (
        <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange(t.key)}
          className={`relative flex items-center gap-2 px-3.5 h-11 text-sm font-medium whitespace-nowrap transition-colors
            ${on ? 'text-ink-900' : 'text-ink-500 hover:text-ink-800'}`}>
          {t.label}
          {t.count !== undefined && (
            <span className={`num text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center
              ${t.alert && t.count > 0 ? 'bg-brand-600 text-white' : on ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600'}`}>{t.count}</span>
          )}
          {on && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-brand-600 rounded-full" />}
        </button>
      )
    })}
  </div>
)

/* ---------------------------------------------------------------- tables */
export const TableWrap = ({ children, className = '' }) => (
  <div className={`overflow-x-auto ${className}`}>
    <table className="min-w-full text-sm">{children}</table>
  </div>
)
export const Th = ({ children, className = '', right }) => (
  <th className={`${right ? 'text-right' : 'text-left'} font-medium text-ink-500 text-[11px] uppercase tracking-[0.080em] px-4 h-10 bg-ink-50 border-b border-ink-200 whitespace-nowrap first:pl-5 last:pr-5 ${className}`}>{children}</th>
)
export const Td = ({ children, className = '', right, ...p }) => (
  <td {...p} className={`px-4 py-3 border-b border-ink-100 align-middle first:pl-5 last:pr-5 ${right ? 'text-right whitespace-nowrap' : ''} ${className}`}>{children}</td>
)
export const Row = ({ children, onClick, className = '' }) => (
  <tr onClick={onClick} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    className={`${onClick ? 'cursor-pointer hover:bg-ink-50 focus-visible:bg-ink-50' : ''} transition-colors ${className}`}>{children}</tr>
)

/* --------------------------------------------------------------- numbers */
export const Meter = ({ pct, className = '' }) => {
  const p = Math.max(0, Math.min(100, pct || 0))
  const tone = p < 15 ? 'bg-brand-600' : p < 40 ? 'bg-gold-500' : 'bg-olive-500'
  return (
    <div className={`h-1.5 rounded-full bg-ink-100 overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: p + '%' }} />
    </div>
  )
}

export const Stat = ({ label, value, hint, tone = 'ink', icon, onClick }) => {
  const tones = { ink: 'text-ink-900', brand: 'text-brand-600', gold: 'text-gold-600', olive: 'text-olive-600' }
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`text-left bg-white rounded-xl border border-ink-200 shadow-card p-4 sm:p-5 ${onClick ? 'hover:border-ink-400 transition-colors' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-ink-500">
        <span className="text-[12px] font-medium uppercase tracking-[0.080em]">{label}</span>
        {icon && <Icon name={icon} className="w-4 h-4 text-ink-400" />}
      </div>
      <div className={`num text-[32px] leading-none font-medium mt-3 ${tones[tone]}`}>{value}</div>
      {hint && <div className="text-[13px] text-ink-500 mt-2">{hint}</div>}
    </Tag>
  )
}

export const Field = ({ label, children, className = '' }) => (
  <div className={className}>
    <dt className="text-[11px] font-medium uppercase tracking-[0.080em] text-ink-500">{label}</dt>
    <dd className="text-sm text-ink-900 mt-0.5 break-words">{children}</dd>
  </div>
)
