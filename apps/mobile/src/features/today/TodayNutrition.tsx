import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { logger } from '../../app/logger'
import { openNutritionService, type NutritionService } from '../food/nutritionService'
import { todayNutritionCopy, type DailyNutrition } from '../food/nutritionPresentation'
import { compactPlanLabel } from '../food/nutritionPlanPresentation'

export function TodayNutrition({ suppliedService }: { suppliedService?: NutritionService }) {
  const [day, setDay] = useState<DailyNutrition | null>(null)
  const reload = useCallback(async (service: NutritionService) => {
    setDay(await service.daily())
  }, [])
  useEffect(() => {
    let active = true
    let service: NutritionService | null = null
    void (async () => {
      try {
        service = suppliedService ?? await openNutritionService()
        const snapshot = await service.daily()
        if (active) setDay(snapshot)
      } catch (cause) { logger.error('Today nutrition load failed', cause) }
    })()
    const visible = () => { if (document.visibilityState === 'visible' && service)
      void reload(service).catch((cause: unknown) => logger.error('Today nutrition refresh failed', cause)) }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; document.removeEventListener('visibilitychange', visible) }
  }, [suppliedService, reload])
  if (!day) return null
  const copy = todayNutritionCopy(day)
  return <section className="today-nutrition" aria-label="今日饮食">
    <header><span className="eyebrow">今日饮食</span><Link to="/food">去记录 →</Link></header>
    <strong className="today-nutrition__intake" data-empty={day.summary.entryCount === 0}>{copy.lead}</strong>
    <div className="today-nutrition__facts"><p>{copy.target}</p>
      {copy.protein ? <p>{copy.protein}</p> : null}</div>
    {copy.state ? <p className="today-nutrition__state">{copy.state}</p> : null}
    {copy.partial ? <p className="today-nutrition__partial">{copy.partial}</p> : null}
    {day.planRun ? <p className="today-nutrition__plan">{compactPlanLabel(day.planRun, day.target?.day_type)}</p> : null}
  </section>
}
