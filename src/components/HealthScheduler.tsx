import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export default function HealthScheduler() {
  const [nightlyHour, setNightlyHour] = useState<number>(21)
  const shownRef = useRef<string>('')
  const lastPeriodicRef = useRef<{activity?: number; eye?: number}>({})
  const prefsRef = useRef<any>(null)
  const lastPruneRef = useRef<string>('')

  useEffect(() => {
    (async () => {
      try {
        const prefs: any = await invoke('health_get_prefs')
        const p = (prefs && prefs.prefs) ? prefs.prefs : {}
        const nh = parseInt(p.nightly_hour) || 21
        setNightlyHour(nh)
        prefsRef.current = p
      } catch {}
    })()
  }, [])

  useEffect(() => {
    const tick = async () => {
      try {
        const now = new Date()
        const todayKey = now.toISOString().slice(0,10) // YYYY-MM-DD
        if (shownRef.current === '') {
          shownRef.current = localStorage.getItem('health-nightly-date') || ''
        }
        if (shownRef.current === todayKey) return
        if (now.getHours() >= nightlyHour) {
          // Record once per day and notify UI
          await invoke('health_record_action', { event: 'notice', kind: 'nightly', trigger_source: 'nightly' })
          localStorage.setItem('health-nightly-date', todayKey)
          shownRef.current = todayKey
          window.dispatchEvent(new CustomEvent('health-nudge', { detail: { kind: 'nightly' } }))
          window.dispatchEvent(new CustomEvent('health-updated'))
        }
      } catch {}
    }
    const id = window.setInterval(tick, 60 * 1000)
    tick()
    return () => window.clearInterval(id)
  }, [nightlyHour])

  // Periodic due checking to complement natural breakpoints
  useEffect(() => {
    const withinQuietHours = (p: any) => {
      try {
        const q = p?.quiet_hours
        const s = Array.isArray(q) ? (q[0] || '') : (q || '')
        if (!s || !s.includes(':') || !s.includes('-')) return false
        const [start, end] = s.split('-').map((x: string)=> x.trim())
        const parseHour = (t: string) => parseInt(t.split(':')[0]||'0')
        const sh = parseHour(start)
        const eh = parseHour(end)
        const h = new Date().getHours()
        if (sh <= eh) { return h >= sh && h < eh } else { return h >= sh || h < eh }
      } catch { return false }
    }

    const poll = async () => {
      try {
        if (!prefsRef.current) {
          const prefs: any = await invoke('health_get_prefs')
          prefsRef.current = (prefs && prefs.prefs) ? prefs.prefs : {}
        }
        const p = prefsRef.current || {}
        if (p.dnd) return
        if (withinQuietHours(p)) return

        const due = await invoke<{activity_ms:number; eye_ms:number}>('health_next_due')
        const now = Date.now()

        const throttleMs = 10 * 60 * 1000
        if (due.eye_ms <= 0) {
          const last = lastPeriodicRef.current.eye || 0
          if (now - last > throttleMs) {
            await invoke('health_record_action', { event: 'nudge', kind: 'eye', trigger_source: 'periodic' })
            window.dispatchEvent(new CustomEvent('health-nudge', { detail: { kind: 'eye', strength: p?.alerts?.strength || 'light' } }))
            window.dispatchEvent(new CustomEvent('health-updated'))
            lastPeriodicRef.current.eye = now
            return
          }
        }
        if (due.activity_ms <= 0) {
          const last = lastPeriodicRef.current.activity || 0
          if (now - last > throttleMs) {
            await invoke('health_record_action', { event: 'nudge', kind: 'activity', trigger_source: 'periodic' })
            window.dispatchEvent(new CustomEvent('health-nudge', { detail: { kind: 'activity', strength: p?.alerts?.strength || 'light' } }))
            window.dispatchEvent(new CustomEvent('health-updated'))
            lastPeriodicRef.current.activity = now
          }
        }
      } catch {}
    }

    const id = window.setInterval(poll, 15 * 1000)
    poll()

    // Optionally refresh prefs on update, but do not reset throttle
    const onUpdated = () => {
      invoke('health_get_prefs')
        .then((prefs:any)=> { prefsRef.current = (prefs && prefs.prefs) ? prefs.prefs : {} })
        .catch(()=>{})
    }
    window.addEventListener('health-updated', onUpdated as EventListener)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('health-updated', onUpdated as EventListener)
    }
  }, [])

  // Daily prune: 保证数据留存策略生效（按天触发一次）
  useEffect(() => {
    const ensurePrefs = async () => {
      if (!prefsRef.current) {
        try {
          const prefs: any = await invoke('health_get_prefs')
          prefsRef.current = (prefs && prefs.prefs) ? prefs.prefs : {}
        } catch {}
      }
    }

    const tickPrune = async () => {
      try {
        await ensurePrefs()
        const p = prefsRef.current || {}
        const maxPerDay = parseInt(p?.retention?.max_per_day) || 200
        const ttlDays = parseInt(p?.retention?.ttl_days) || 90
        const todayKey = new Date().toISOString().slice(0,10)
        if (!lastPruneRef.current) {
          lastPruneRef.current = localStorage.getItem('health-prune-date') || ''
        }
        if (lastPruneRef.current !== todayKey) {
          await invoke('health_prune', { day: null, max_per_day: maxPerDay, ttl_days: ttlDays })
          localStorage.setItem('health-prune-date', todayKey)
          lastPruneRef.current = todayKey
        }
      } catch {}
    }

    // 每小时检查一次，也在挂载时跑一次
    const id = window.setInterval(tickPrune, 60 * 60 * 1000)
    tickPrune()
    return () => window.clearInterval(id)
  }, [])

  // nothing to render
  return null
}
