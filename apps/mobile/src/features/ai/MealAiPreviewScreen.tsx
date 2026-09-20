import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { AiMealItem } from '@motion/domain'
import type { AiService, MealAiDraft } from './aiService'
import { openAiService } from './aiRuntime'
import { logger } from '../../app/logger'
import './ai.css'

const numeric = (value: string): number | null => {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
export function MealAiPreviewScreen({ suppliedService }: { suppliedService?: AiService }) {
  const location = useLocation(), navigate = useNavigate(), initial = (location.state as { draft?: MealAiDraft } | null)?.draft
  const [draft, setDraft] = useState<MealAiDraft | null>(initial ?? null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!draft) return <Navigate to="/food" replace />
  function update(index: number, changes: Partial<AiMealItem>) { setDraft((current) => current ? { ...current,
    estimate: { ...current.estimate, items: current.estimate.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) } } : current) }
  async function confirm() { if (busy || !draft) return; const activeDraft = draft; setBusy(true); setError('')
    try { const service = suppliedService ?? await openAiService(); await service.confirmMeal(activeDraft); navigate('/food', { replace: true }) }
    catch (cause) { logger.error('AI meal confirm failed', cause); setError('暂时无法保存，你仍可返回并使用普通记录。') }
    finally { setBusy(false) } }
  const totals = draft.estimate.items.reduce((sum, item) => ({ calories: sum.calories + (item.caloriesKcal ?? 0), protein: sum.protein + (item.proteinG ?? 0),
    carbs: sum.carbs + (item.carbsG ?? 0), fat: sum.fat + (item.fatG ?? 0) }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  return <main className="meal-ai-preview"><header><button type="button" onClick={() => navigate(-1)} aria-label="返回">‹</button>
    <div><h1>AI 饮食估算</h1><span>预览（可编辑）</span></div></header>
    {draft.image ? <figure><img src={draft.image.dataUrl} alt="待估算餐食" /></figure> : <p className="meal-ai-source">原始记录：{draft.originalText}</p>}
    <section aria-labelledby="recognized-title"><h2 id="recognized-title">识别结果（可编辑）</h2>
      <div className="meal-ai-items">{draft.estimate.items.map((item, index) => <article key={`${item.name}-${index}`}>
        <label>食物名称<input value={item.name} onChange={(event) => update(index, { name: event.target.value })} /></label>
        <label>份量说明<input value={item.portionDescription ?? ''} onChange={(event) => update(index, { portionDescription: event.target.value || null })} /></label>
        <div>{([['热量', 'caloriesKcal', 'kcal'], ['蛋白质', 'proteinG', 'g'], ['碳水', 'carbsG', 'g'], ['脂肪', 'fatG', 'g']] as const).map(([label,key,unit]) =>
          <label key={key}>{label}<span><input type="number" min="0" step="any" value={item[key] ?? ''}
            onChange={(event) => update(index, { [key]: numeric(event.target.value) })} /> {unit}</span></label>)}</div>
        <button type="button" onClick={() => setDraft({ ...draft, estimate: { ...draft.estimate,
          items: draft.estimate.items.filter((_, itemIndex) => itemIndex !== index) } })}>删除</button></article>)}</div>
      <button className="meal-ai-add" type="button" onClick={() => setDraft({ ...draft, estimate: { ...draft.estimate,
        items: [...draft.estimate.items, { name: '新增食物', portionDescription: null, caloriesKcal: null,
          proteinG: null, carbsG: null, fatG: null, confidence: 'LOW' }] } })}>＋ 添加食物项</button></section>
    <section className="meal-ai-summary"><header><h2>本餐估算</h2><span>{draft.estimate.confidence === 'HIGH' ? '较高可信度' : draft.estimate.confidence === 'MEDIUM' ? '中等可信度' : '较低可信度'}</span></header>
      <strong>约 {Math.round(totals.calories)} kcal</strong><div><span>蛋白质 {totals.protein.toFixed(1)} g</span><span>碳水 {totals.carbs.toFixed(1)} g</span><span>脂肪 {totals.fat.toFixed(1)} g</span></div></section>
    {draft.estimate.assumptions.length ? <section className="meal-ai-assumptions"><h2>估算说明</h2><ul>{draft.estimate.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    {error ? <p className="ai-error" role="alert">{error}</p> : null}<button className="ai-primary" type="button" disabled={busy || !draft.estimate.items.length}
      onClick={() => void confirm()}>确认并保存</button></main>
}
