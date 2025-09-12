import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type NextDue = { activity_ms: number; eye_ms: number }

function msToMMSS(ms: number) {
  if (ms < 0) ms = 0
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function HealthCountdown() {
  const [due, setDue] = useState<NextDue>({ activity_ms: 0, eye_ms: 0 })
  const [dnd, setDnd] = useState<boolean>(false)
  const [quiet, setQuiet] = useState<boolean>(false)
  const [quietStr, setQuietStr] = useState<string>("")
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const withinQuietHours = (s: string) => {
      try {
        if (!s || !s.includes(':') || !s.includes('-')) return false
        const [start, end] = s.split('-').map((x) => x.trim())
        const parseH = (t: string) => parseInt(t.split(':')[0] || '0')
        const sh = parseH(start)
        const eh = parseH(end)
        const h = new Date().getHours()
        if (sh <= eh) return h >= sh && h < eh
        return h >= sh || h < eh
      } catch { return false }
    }

    const tick = async () => {
      try {
        const [prefsAny, next] = await Promise.all([
          invoke<any>('health_get_prefs'),
          invoke<NextDue>('health_next_due')
        ])
        const p = (prefsAny && prefsAny.prefs) ? prefsAny.prefs : {}
        const q = Array.isArray(p.quiet_hours) ? (p.quiet_hours[0] || '') : (p.quiet_hours || '')
        setQuietStr(q || '')
        setDnd(!!p.dnd)
        setQuiet(withinQuietHours(q || ''))
        setDue(next)
      } catch {}
    }

    tick()
    timerRef.current = window.setInterval(tick, 1000) as unknown as number
    return () => { if (timerRef.current) window.clearInterval(timerRef.current) }
  }, [])

  const nextEyeAt = new Date(Date.now() + Math.max(0, due.eye_ms))
  const nextActAt = new Date(Date.now() + Math.max(0, due.activity_ms))
  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="fixed bottom-24 right-4 sm:bottom-28 sm:right-10 md:right-28 z-50 select-none pointer-events-none max-w-[90vw]">
      <div className="flex flex-wrap items-center bg-background/95 backdrop-blur-md border rounded-lg sm:rounded-full shadow-lg overflow-hidden px-2 sm:px-3 py-1 text-[11px] sm:text-xs">
        {/* Eye */}
        <div className="flex items-center gap-1 pr-3">
          <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
          <span className="text-muted-foreground">眼睛</span>
          <span className="ml-2 font-mono tabular-nums">{msToMMSS(due.eye_ms)}</span>
          <span className="ml-2 text-[10px] text-muted-foreground"><span className="hidden sm:inline">下次提醒：</span>{fmtTime(nextEyeAt)}</span>
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        {/* Activity */}
        <div className="flex items-center gap-1 pl-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">微活动</span>
          <span className="ml-2 font-mono tabular-nums">{msToMMSS(due.activity_ms)}</span>
          <span className="ml-2 text-[10px] text-muted-foreground"><span className="hidden sm:inline">下次提醒：</span>{fmtTime(nextActAt)}</span>
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        {/* State */}
        <div className="pl-2 text-[10px] text-muted-foreground hidden md:block">
          免打扰：{dnd ? '开' : '关'} · 静默时段：{quiet ? '生效' : '未生效'}{quietStr ? `（${quietStr}）` : ''}
        </div>
      </div>
    </div>
  )
}
