import { useEffect, useRef } from 'react'
// Calls fn() on mount, every `ms`, and when the window/tab regains focus.
export function usePoll(fn, ms = 8000, deps = []) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    let alive = true
    const run = () => { if (alive) saved.current() }
    run()
    const t = setInterval(run, ms)
    const onFocus = () => run()
    const onVis = () => { if (!document.hidden) run() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
