import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Range = '7d' | '30d'
type DailySummary = {
  day: string
  activity_done: number
  eye_done: number
  compliance: number
  flow_avoided: number
  breakpoint_completion_rate: number
}

export default function HealthPanel() {
  const [range, setRange] = useState<Range>('7d')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [today, setToday] = useState<DailySummary | null>(null)
  const [trend, setTrend] = useState<Array<DailySummary>>([])

  const refresh = useCallback(async () => {
    try {
      setLoading(true); setError('')
      // Today summary
      const todaySummary = await invoke<any>('health_daily_summary') as DailySummary
      setToday(todaySummary)
      // Trend (including today)
      const now = new Date()
      const arr: Array<DailySummary> = []
      const days = range === '30d' ? 30 : 7
      for (let i=days-1; i>=0; i--) {
        const d = new Date(now)
        d.setDate(now.getDate()-i)
        const day = d.toISOString().slice(0,10)
        const s = await invoke<any>('health_daily_summary', { day }) as DailySummary
        arr.push(s)
      }
      setTrend(arr)
    } catch (e:any) {
      setError(String(e?.message||e))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(()=>{ refresh() }, [refresh])
  useEffect(() => {
    const onUpdated = () => { refresh() }
    window.addEventListener('health-updated', onUpdated as EventListener)
    return () => window.removeEventListener('health-updated', onUpdated as EventListener)
  }, [refresh])

  const maxDone = Math.max(1, ...trend.map(t => (t.activity_done + t.eye_done)))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">健康看板</h1>
          <p className="text-xs text-muted-foreground">今日数据与近7日趋势</p>
        </div>
        <div>
          <Tabs value={range} onValueChange={(v)=> setRange(v as Range)}>
            <TabsList className="h-8">
              <TabsTrigger value="7d" className="px-3 py-1">7 天</TabsTrigger>
              <TabsTrigger value="30d" className="px-3 py-1">30 天</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 四个核心指标 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">已完成休息</div>
          <div className="text-2xl font-semibold">
            {(today?.activity_done||0)}<span className="text-sm text-muted-foreground"> · 微活动</span>
          </div>
          <div className="text-2xl font-semibold">
            {(today?.eye_done||0)}<span className="text-sm text-muted-foreground"> · 眼睛</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1">
            <div className="text-xs text-muted-foreground">按时完成率</div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex"><Info size={14} className="opacity-60"/></span>
                </TooltipTrigger>
                <TooltipContent>提醒后 20 分钟内完成</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="text-2xl font-semibold">{today?.compliance ?? 0}%</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1">
            <div className="text-xs text-muted-foreground">断点提醒完成率</div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex"><Info size={14} className="opacity-60"/></span>
                </TooltipTrigger>
                <TooltipContent>在自然停顿点弹出的提醒，更容易完成</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="text-2xl font-semibold">{today?.breakpoint_completion_rate ?? 0}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">少打扰次数</div>
          <div className="text-2xl font-semibold">{today?.flow_avoided ?? 0}</div>
          <div className="text-xs text-muted-foreground">忙碌时自动延后提醒</div>
        </Card>
      </div>

      {/* 近 7 日完成趋势 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">近 7 日完成</div>
          <div className="text-xs text-muted-foreground">按天</div>
        </div>
        {trend.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无数据</div>
        ) : (
          <div className="flex items-end gap-2 h-28">
            {trend.map((d, idx) => {
              const act = d.activity_done || 0
              const eye = d.eye_done || 0
              const total = act + eye
              const h = Math.round((total / maxDone) * 100)
              const date = new Date(d.day + 'T00:00:00Z')
              const dateLabel = date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
              return (
                <TooltipProvider key={idx}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col items-center gap-1 w-6 cursor-default">
                        <div className="w-full bg-primary/80 rounded-t" style={{ height: `${h}%` }} />
                        <div className="text-[10px] text-muted-foreground">{dateLabel}</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex flex-col gap-0.5">
                        <div>{d.day}</div>
                        <div>总计 {total} 次</div>
                        <div>· 微活动 {act} 次</div>
                        <div>· 眼睛 {eye} 次</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            })}
          </div>
        )}
      </Card>

      {error && <div className="text-xs text-red-500">{error}</div>}
      {loading && <div className="text-xs text-muted-foreground">加载中…</div>}
    </div>
  )
}
