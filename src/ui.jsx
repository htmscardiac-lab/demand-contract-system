import React from 'react'

export const Card = ({ children, className = '', ...p }) => (
  <div {...p} className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
)

export const Btn = ({ children, variant = 'primary', className = '', ...p }) => {
  const styles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    ghost: 'text-blue-700 hover:bg-blue-50',
  }
  return (
    <button {...p} className={`px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}>
      {children}
    </button>
  )
}

export const Input = ({ label, className = '', ...p }) => (
  <label className="block">
    {label && <span className="block text-sm font-medium text-slate-600 mb-1">{label}</span>}
    <input {...p} className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`} />
  </label>
)

export const Select = ({ label, children, className = '', ...p }) => (
  <label className="block">
    {label && <span className="block text-sm font-medium text-slate-600 mb-1">{label}</span>}
    <select {...p} className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}>
      {children}
    </select>
  </label>
)

export const Badge = ({ children, className = '' }) => (
  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>
)

export const Modal = ({ open, onClose, title, children, wide }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export const Spinner = () => (
  <div className="flex justify-center py-10">
    <div className="h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
  </div>
)

export const Empty = ({ text }) => (
  <div className="text-center py-10 text-slate-400 text-sm">{text}</div>
)

export const PageTitle = ({ children, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
    <h1 className="text-xl font-bold text-slate-800">{children}</h1>
    {right}
  </div>
)

export const Alert = ({ kind = 'error', children }) => (
  <div className={`rounded-lg px-4 py-3 text-sm mb-4 ${kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
    {children}
  </div>
)

// Responsive table: horizontal scroll on small screens
export const TableWrap = ({ children }) => (
  <div className="overflow-x-auto -mx-1 px-1">
    <table className="min-w-full text-sm">{children}</table>
  </div>
)
export const Th = ({ children, className = '' }) => (
  <th className={`text-left font-semibold text-slate-500 text-xs uppercase tracking-wide px-3 py-2 whitespace-nowrap ${className}`}>{children}</th>
)
export const Td = ({ children, className = '' }) => (
  <td className={`px-3 py-2.5 border-t border-slate-100 align-middle ${className}`}>{children}</td>
)
