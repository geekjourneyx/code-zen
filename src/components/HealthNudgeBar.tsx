import { useEffect, useRef, useState } from 'react'
import { recordAction } from '@/lib/health'
import { invoke } from '@tauri-apps/api/core'

type Kind = 'activity'|'eye'|'nightly'

export default function HealthNudgeBar() {
  const [kind, setKind] = useState<Kind | null>(null)
  const [strength, setStrength] = useState<'light'|'strong'>('light')
  const [showOverlay, setShowOverlay] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [progress, setProgress] = useState(0) // 0..1
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const endAtRef = useRef<number>(0)
  const overlayActiveRef = useRef<boolean>(false)
  const [mode] = useState<'alert'|'guide'>('alert')
  const highlightTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const handler = async (e: Event) => {
      const ce = e as CustomEvent
      if (ce?.detail?.kind) {
        // 如果 Overlay 正在显示，忽略新的 nudge，避免打断倒计时
        if (overlayActiveRef.current) return
        setKind(ce.detail.kind as Kind)
        // strength override for testing; otherwise read prefs
        if (ce.detail.strength === 'strong' || ce.detail.strength === 'light') {
          setStrength(ce.detail.strength)
        } else {
          try {
            const prefs: any = await invoke('health_get_prefs')
            const p = (prefs && prefs.prefs) ? prefs.prefs : {}
            setStrength(p.strength === 'strong' ? 'strong' : 'light')
          } catch { setStrength('light') }
        }
      }
    }
    window.addEventListener('health-nudge', handler as EventListener)
    return () => window.removeEventListener('health-nudge', handler as EventListener)
  }, [])

  // 倒计时与显示：强提醒显示 Overlay，弱提醒显示小倒计时
  useEffect(() => {
    const totalDur = (kind === 'eye') ? 20000 : 60000 // eye 20s, activity 60s
    if (kind && kind !== 'nightly') {
      const overlay = (strength === 'strong')
      setShowOverlay(overlay)
      setCountdown(totalDur / 1000)
      setProgress(0)
      const now = Date.now()
      startRef.current = now
      endAtRef.current = now + totalDur
      overlayActiveRef.current = overlay
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = window.setInterval(() => {
        const remain = Math.max(0, endAtRef.current - Date.now())
        const nextSec = Math.ceil(remain / 1000)
        setCountdown(nextSec)
        if (remain <= 0) {
            if (timerRef.current) window.clearInterval(timerRef.current)
            // 先让显示归零，再稍后关闭，确保用户可见“00:00”状态
            // 倒计时结束：自动完成
            const durationSec = Math.round(totalDur / 1000)
            if (kind === 'eye') {
              recordAction('done', 'eye', undefined, durationSec)
            } else {
              recordAction('done', 'activity', undefined, durationSec)
            }
            // 延迟关闭，保证 00:00 至少显示一帧
            window.setTimeout(() => closeAll(), 250)
        }
      }, 1000) as unknown as number
      // 仅 Overlay 时启用环形进度动画
      if (overlay) {
        const loop = () => {
          const elapsed = Date.now() - startRef.current
          const p = Math.min(1, elapsed / totalDur)
          setProgress(p)
          if (p < 1) { rafRef.current = window.requestAnimationFrame(loop) }
        }
        rafRef.current = window.requestAnimationFrame(loop)
      }
    } else {
      setShowOverlay(false)
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
      if (rafRef.current) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [kind, strength])

  const closeAll = () => {
    setKind(null);
    setShowOverlay(false);
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    if (highlightTimerRef.current) { window.clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null }
    if (rafRef.current) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
    overlayActiveRef.current = false
    
    // 清理测试模式状态（如果是测试模式触发的提醒）
    if (sessionStorage.getItem('health_test_mode') === 'true') {
      sessionStorage.removeItem('health_test_mode')
      sessionStorage.removeItem('health_test_end_time')
      sessionStorage.removeItem('health_test_triggered')
    }
  }

  if (!kind) return null
  const title = kind === 'activity' ? '起来活动一下（站立/喝水/颈肩）'
    : kind === 'eye' ? '眼部休息 20 秒'
    : '已经 21:00 了，准备收尾？'

  // color scheme by kind
  const base = kind === 'activity' ? '#22c55e' : kind === 'eye' ? '#8b5cf6' : '#f59e0b'
  const light = kind === 'activity' ? '#4ade80' : kind === 'eye' ? '#a78bfa' : '#fbbf24'

  if (showOverlay) {
    // Strong overlay with countdown
    const size = 200
    const stroke = 10
    const r = (size - stroke) / 2
    const C = 2 * Math.PI * r
    const headLen = C * 0.14 // 14% of ring as bright head
    const offset = C * progress
    return (
      <div className="fixed inset-0 z-[1000] bg-background/80 backdrop-blur-sm flex items-center justify-center">
        <div className="relative w-full max-w-md mx-auto p-8 rounded-2xl border border-border bg-popover text-popover-foreground text-center shadow-2xl">
          <div className="text-amber-400 text-sm font-semibold tracking-wide mb-3">Health • {mode === 'guide' ? '短休息' : '强提醒'}</div>
          <div className="text-xl font-bold mb-2">{title}</div>
          <div className="mx-auto my-4 relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              <defs>
                <linearGradient id="healthGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={base} />
                  <stop offset="100%" stopColor={light} />
                </linearGradient>
              </defs>
              {/* base ring */}
              <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
              {/* trailing soft path (slightly longer) */}
              <circle cx={size/2} cy={size/2} r={r} stroke="url(#healthGrad)" strokeLinecap="round" strokeWidth={stroke}
                opacity={0.35} fill="none" strokeDasharray={`${headLen * 1.6} ${C}`} strokeDashoffset={Math.max(0, offset - headLen*0.3)}
                className="transition-[stroke-dashoffset] duration-120 ease-linear" />
              {/* bright head arc */}
              <circle cx={size/2} cy={size/2} r={r} stroke="url(#healthGrad)" strokeLinecap="round" strokeWidth={stroke}
                fill="none" strokeDasharray={`${headLen} ${C}`} strokeDashoffset={offset}
                className="transition-[stroke-dashoffset] duration-120 ease-linear drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div>
                <div className="text-xs text-muted-foreground">{mode === 'guide' ? '剩余' : '休息将于'}</div>
                <div className="text-6xl font-extrabold mt-1 animate-pulse">{countdown}s</div>
              </div>
            </div>
            <div className="absolute -inset-6 rounded-full blur-2xl" style={{ backgroundColor: base+'1A' }} />
          </div>
          <div className="flex items-center justify-center gap-2 mt-2">
            <button onClick={async()=>{ await recordAction('snooze', kind as 'activity'|'eye', 10); closeAll(); }} className="px-4 py-2 rounded bg-secondary text-secondary-foreground hover:opacity-90">稍后提醒</button>
          </div>
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full blur-2xl" style={{ backgroundColor: light+'33' }} />
          <div className="absolute -bottom-12 right-10 w-24 h-24 rounded-full blur-2xl" style={{ backgroundColor: base+'1A' }} />
        </div>
      </div>
    )
  }

  const fmt = (n: number) => {
    const t = Math.max(0, n)
    const m = Math.floor(t/60)
    const s = t%60
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  return (
    <div className="fixed bottom-2 left-2 right-2 z-40 mx-auto max-w-4xl">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-popover text-popover-foreground backdrop-blur px-4 py-2 text-sm shadow-lg">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: base }} />
        <span className="font-medium">Health · {strength === 'strong' ? '强' : '温和'}</span>
        <span>{title}</span>
        {(kind === 'activity' || kind === 'eye') && (
          <span className="ml-2 font-mono tabular-nums text-muted-foreground">{fmt(countdown)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(kind === 'activity' || kind === 'eye') && (
            <button onClick={async()=>{ await recordAction('snooze', kind as 'activity'|'eye', 10); setKind(null) }} className="px-2 py-1 rounded bg-secondary text-secondary-foreground hover:opacity-90">稍后提醒</button>
          )}
          {kind === 'nightly' && (
            <>
              <button onClick={()=> setKind(null)} className="px-2 py-1 rounded bg-secondary text-secondary-foreground hover:opacity-90">好的</button>
              <button onClick={async()=>{ await recordAction('snooze', 'activity', 120); setKind(null) }} className="px-2 py-1 rounded bg-secondary text-secondary-foreground hover:opacity-90">稍后2小时</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
