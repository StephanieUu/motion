import { useEffect, useState, type FormEvent } from 'react'
import { ageOnDate, type NutritionGoal, type NutritionSex } from '@motion/domain'
import { useNavigate } from 'react-router-dom'
import { AppIcon } from '../../components/AppIcon'
import { logger } from '../../app/logger'
import type { NutritionProfile } from '../../db/repositories/NutritionRepository'
import type { DailyNutrition } from './nutritionPresentation'
import { activityLabel, activityOptions, nutritionSetupFromDraft, profileDraft,
  type NutritionProfileDraft } from './nutritionProfile'
import { openNutritionService, type NutritionService } from './nutritionService'
import { EditorialDateField, EditorialNumberField } from './EditorialProfileFields'
import './nutritionReference.css'
import './editorialProfileFields.css'

interface ReferenceState { day: DailyNutrition; profile: NutritionProfile | null; weight: number | null }

function useReference(serviceInput?: NutritionService) {
  const [service, setService] = useState<NutritionService | null>(serviceInput ?? null)
  const [state, setState] = useState<ReferenceState | null>(null)
  const [error, setError] = useState('')
  async function load(current: NutritionService) {
    const [day, setup] = await Promise.all([current.daily(), current.setup()])
    setState({ day, profile: setup.profile, weight: setup.weight?.weight_kg ?? null })
  }
  useEffect(() => { let active = true; void (async () => {
    try { const current = serviceInput ?? await openNutritionService(); if (!active) return
      setService(current); await load(current) }
    catch (cause) { logger.error('Nutrition reference load failed', cause); if (active) setError('每日营养参考暂时无法打开。') }
  })(); return () => { active = false } }, [serviceInput])
  return { service, state, error, setError, load }
}

function BackButton() {
  const navigate = useNavigate()
  return <button className="nutrition-page__back" type="button" aria-label="返回" onClick={() => navigate(-1)}>‹</button>
}

export function NutritionReferenceScreen({ suppliedService }: { suppliedService?: NutritionService }) {
  const navigate = useNavigate()
  const { state, error } = useReference(suppliedService)
  const age = state?.profile?.birth_date ? ageOnDate(state.profile.birth_date, state.day.localDate) : null
  return <main className="nutrition-page nutrition-reference">
    <BackButton /><header><h1>每日营养参考</h1><p>基于你的个人资料</p></header>
    {error ? <p role="alert" className="nutrition-page__error">{error}</p> : null}
    {state?.day.target ? <section className="nutrition-reference__card" aria-label="每日营养参考范围">
      <strong>{state.day.target.calories_min.toLocaleString('zh-CN')}–{state.day.target.calories_max.toLocaleString('zh-CN')}</strong><span>kcal<br />每日能量参考范围</span><i />
      <strong>{Math.round(state.day.target.protein_min_g)}–{Math.round(state.day.target.protein_max_g)} g</strong><span>蛋白质</span></section>
      : state ? <section className="nutrition-reference__empty"><strong>{state.day.targetUnavailableReason === 'UNDER_19'
        ? '暂不生成成人参考' : '完善资料后生成参考'}</strong><p>{state.day.targetUnavailableReason === 'UNDER_19'
          ? '自动营养参考适用于 19 岁及以上成人，饮食记录仍可正常使用。' : '填写出生日期、身高、体重和日常节奏。'}</p></section> : null}
    {state ? <section className="nutrition-reference__basis"><span>基于</span>
      <p>{state.weight === null ? '体重尚未记录' : `${state.weight} kg`} · {state.profile?.height_cm ?? '—'} cm{age === null ? '' : ` · ${age} 岁`}<br />
        {activityLabel(state.profile?.activity_level)} · {state.profile?.goal_type === 'FAT_LOSS' ? '减脂' : '维持体重'}</p></section> : null}
    <p className="nutrition-reference__note">你可以随时调整个人资料，<br />以更新你的营养参考。</p>
    <div className="nutrition-page__action"><button type="button" onClick={() => navigate('/food/profile')}>
      <span>调整个人资料</span><AppIcon name="arrow" /></button></div>
  </main>
}

export function NutritionProfileScreen({ suppliedService }: { suppliedService?: NutritionService }) {
  const navigate = useNavigate()
  const { service, state, error, setError, load } = useReference(suppliedService)
  const [draft, setDraft] = useState<NutritionProfileDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const shownDraft = draft ?? (state ? profileDraft(state.profile, state.weight) : null)
  async function save(event: FormEvent) {
    event.preventDefault(); if (!service || !shownDraft) return
    setBusy(true); setError('')
    try { await service.saveSetup(nutritionSetupFromDraft(shownDraft)); await load(service); navigate('/food/reference', { replace: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存没有完成，请重试。') }
    finally { setBusy(false) }
  }
  return <main className="nutrition-page nutrition-profile">
    <BackButton /><header><h1>编辑个人资料</h1><p>让建议更适合你。</p></header>
    {shownDraft ? <form onSubmit={(event) => void save(event)}>
      <EditorialDateField value={shownDraft.birthDate}
        onChange={(birthDate) => setDraft({ ...shownDraft, birthDate })} />
      <fieldset><legend>生理性别</legend><div>{(['FEMALE', 'MALE'] as NutritionSex[]).map((sex) =>
        <button type="button" key={sex} aria-pressed={shownDraft.sex === sex}
          onClick={() => setDraft({ ...shownDraft, sex })}>{sex === 'FEMALE' ? '女性' : '男性'}</button>)}</div></fieldset>
      <EditorialNumberField label="身高" ariaLabel="身高" value={shownDraft.heightCm} unit="cm"
        scale={['150', '160', '170', '180', '190']} onChange={(heightCm) => setDraft({ ...shownDraft, heightCm })} />
      <EditorialNumberField label="当前体重" ariaLabel="当前体重" value={shownDraft.weightKg} unit="kg" step="0.1"
        scale={['50', '60', '70', '80', '90']} onChange={(weightKg) => setDraft({ ...shownDraft, weightKg })} />
      <fieldset><legend>目标</legend><div>{([{ value: 'MAINTENANCE', label: '维持体重' }, { value: 'FAT_LOSS', label: '减脂' }] as const).map((item) =>
        <button type="button" key={item.value} aria-pressed={shownDraft.goal === item.value}
          onClick={() => setDraft({ ...shownDraft, goal: item.value as NutritionGoal })}>{item.label}</button>)}</div></fieldset>
      {shownDraft.goal === 'FAT_LOSS' ? <EditorialNumberField label="目标体重（可选）" ariaLabel="目标体重"
        value={shownDraft.targetWeightKg} unit="kg" step="0.1" scale={['45', '55', '65', '75', '85']}
        onChange={(targetWeightKg) => setDraft({ ...shownDraft, targetWeightKg })} /> : null}
      <fieldset className="nutrition-profile__activity"><legend>日常节奏</legend>{activityOptions.map((item) =>
        <button type="button" key={item.value} aria-pressed={shownDraft.activityLevel === item.value}
          onClick={() => setDraft({ ...shownDraft, activityLevel: item.value })}>{item.title}</button>)}</fieldset>
      {error ? <p role="alert" className="nutrition-page__error">{error}</p> : null}
      <div className="nutrition-page__action"><button type="submit" disabled={busy}><span>保存并更新参考</span><AppIcon name="arrow" /></button></div>
    </form> : error ? <p role="alert" className="nutrition-page__error">{error}</p> : null}
  </main>
}
