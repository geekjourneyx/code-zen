import { invoke } from '@tauri-apps/api/core'

export type NextDue = { activity_ms: number; eye_ms: number }

export async function checkAtBreakpoint(): Promise<void> {
  try {
    // 读取偏好，若命中免打扰或安静时段，或关闭断点提醒，则跳过
    const prefsAny: any = await invoke('health_get_prefs')
    const p = (prefsAny && (prefsAny as any).prefs) ? (prefsAny as any).prefs : {}

    // 断点提醒开关（默认开启）
    if (p?.context && p.context.breakpoints === false) return
    // DND
    if (p?.dnd) return
    // 安静时段（字符串或数组，仅取第一个）
    const q: string = Array.isArray(p?.quiet_hours) ? (p.quiet_hours[0] || '') : (p?.quiet_hours || '')
    if (withinQuietHours(q)) return

    // 到期判断
    const due = await invoke<NextDue>('health_next_due')
    const items: Array<{kind:'activity'|'eye'; ms:number}> = [
      { kind:'eye', ms: (due as any).eye_ms },
      { kind:'activity', ms: (due as any).activity_ms },
    ]
    const overdue = items.filter(i => (i.ms ?? 0) <= 0)
    const target = overdue.length > 0 ? overdue[0] : null
    if (target) {
      await invoke('health_record_action', { event: 'nudge', kind: target.kind, trigger_source: 'breakpoint' })
      window.dispatchEvent(new CustomEvent('health-nudge', { detail: { kind: target.kind } }))
      window.dispatchEvent(new CustomEvent('health-updated'))
    }
  } catch (e) {
    console.warn('health checkAtBreakpoint failed', e)
  }
}

function withinQuietHours(s: string): boolean {
  try {
    if (!s || !s.includes(':') || !s.includes('-')) return false
    const [start, end] = s.split('-').map((x) => x.trim())
    const parseH = (t: string) => parseInt(t.split(':')[0] || '0')
    const sh = parseH(start)
    const eh = parseH(end)
    const h = new Date().getHours()
    if (sh <= eh) return h >= sh && h < eh
    return h >= sh || h < eh
  } catch {
    return false
  }
}

export async function recordAction(event: 'done'|'snooze'|'skip', kind: 'activity'|'eye', value?: number, durationSec?: number) {
  await invoke('health_record_action', { event, kind, value, duration_sec: durationSec })
  window.dispatchEvent(new CustomEvent('health-updated'))
}
