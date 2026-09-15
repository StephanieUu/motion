import { useEffect, useState } from 'react'
import type { ActivityLevel, NutritionGoal, NutritionSex } from '@motion/domain'
import { AppIcon } from '../../components/AppIcon'
import scenicArt from '../../assets/motion-art/today-interlude.png'
import welcomeScene from '../../assets/motion-art/onboarding-welcome-scene.png'
import type { DailyNutrition } from '../food/nutritionPresentation'
import { activityOptions, nutritionSetupFromDraft, type NutritionProfileDraft } from '../food/nutritionProfile'
import { EditorialDateField, EditorialNumberField } from '../food/EditorialProfileFields'
import '../food/editorialProfileFields.css'
import type { OnboardingService } from './onboardingService'
import './onboarding.css'

type Step = 'welcome' | 'goal' | 'about' | 'activity' | 'result'
const stepOrder: Step[] = ['welcome', 'goal', 'about', 'activity', 'result']

const emptyDraft: NutritionProfileDraft = { birthDate: '', sex: '', heightCm: '', weightKg: '',
  goal: 'MAINTENANCE', targetWeightKg: '', activityLevel: '' }

function PrimaryButton({ children, onClick, disabled = false }: { children: React.ReactNode;
  onClick: () => void; disabled?: boolean }) {
  return <button className="onboarding-primary" type="button" onClick={onClick} disabled={disabled}>
    <span>{children}</span><AppIcon name="arrow" /></button>
}

export function OnboardingFlow({ service, onExit }: { service: OnboardingService; onExit: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [draft, setDraft] = useState<NutritionProfileDraft>(emptyDraft)
  const [result, setResult] = useState<DailyNutrition | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const go = (next: Step) => { window.history.pushState({ motionOnboardingStep: next }, ''); setStep(next); setError('') }
  const back = () => {
    const position = stepOrder.indexOf(step)
    if (position > 0) { setStep(stepOrder[position - 1]!); setError('') }
  }
  useEffect(() => {
    const handleBack = () => back()
    window.addEventListener('popstate', handleBack)
    return () => window.removeEventListener('popstate', handleBack)
  })

  async function generate() {
    setBusy(true); setError('')
    try { await service.saveSetup(nutritionSetupFromDraft(draft)); setResult(await service.daily()); go('result') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法生成参考，请重试。') }
    finally { setBusy(false) }
  }

  if (step === 'welcome') return <main className="onboarding onboarding--welcome">
    <header className="onboarding-brand"><strong>Motion</strong><span>EAT WELL. LIVE BRIGHTER.</span></header>
    <div className="onboarding-welcome__copy"><h1>欢迎来到<br />更好的自己。</h1>
      <p>在这里，饮食、运动与日常生活<br />温柔地连接在一起。</p><p>从一个简单的开始，<br />走向更长久的改变。</p></div>
    <div className="onboarding-welcome__scene" aria-hidden="true"><img src={welcomeScene} alt="" /></div>
    <div className="onboarding-actions"><PrimaryButton onClick={() => go('goal')}>开始设置</PrimaryButton>
      <button className="onboarding-skip" type="button" onClick={() => void service.skip().then(onExit)}>以后再说</button></div>
  </main>

  const number = stepOrder.indexOf(step)
  return <main className={`onboarding onboarding--${step}`}>
    <header className="onboarding-progress"><button type="button" aria-label="返回" onClick={back}>‹</button>
      <span>{number}/4</span></header>
    {step === 'goal' ? <section className="onboarding-step">
      <p className="onboarding-kicker">先从一个方向开始。</p><h1>你希望通过 Motion<br />达到什么目标？</h1>
      <div className="onboarding-goals">
        {([{ value: 'FAT_LOSS', title: '减脂', detail: '建立可持续的热量缺口，拥有更轻盈的身体。', art: '❧' },
          { value: 'MAINTENANCE', title: '维持体重', detail: '保持目前的体重和健康的生活方式。', art: '☾' }] as const).map((item) =>
          <button type="button" key={item.value} aria-pressed={draft.goal === item.value}
            onClick={() => setDraft((old) => ({ ...old, goal: item.value as NutritionGoal }))}>
            <span aria-hidden="true">{item.art}</span><strong>{item.title}</strong><small>{item.detail}</small></button>)}</div>
      <div className="onboarding-step__action"><PrimaryButton onClick={() => go('about')}>下一步</PrimaryButton></div>
    </section> : null}
    {step === 'about' ? <section className="onboarding-step">
      <p className="onboarding-kicker">这些信息用于生成你的每日营养参考。</p><h1>关于你</h1>
      <div className="onboarding-about">
        <EditorialDateField value={draft.birthDate}
          onChange={(birthDate) => setDraft((old) => ({ ...old, birthDate }))} />
        <fieldset><legend>生理性别</legend><div>{(['FEMALE', 'MALE'] as NutritionSex[]).map((sex) =>
          <button type="button" key={sex} aria-pressed={draft.sex === sex}
            onClick={() => setDraft((old) => ({ ...old, sex }))}>{sex === 'FEMALE' ? '女性' : '男性'}</button>)}</div></fieldset>
        <EditorialNumberField label="身高" ariaLabel="身高" value={draft.heightCm} unit="cm"
          scale={['150', '160', '170', '180', '190']} onChange={(heightCm) => setDraft((old) => ({ ...old, heightCm }))} />
        <EditorialNumberField label="当前体重" ariaLabel="当前体重" value={draft.weightKg} unit="kg" step="0.1"
          scale={['50', '60', '70', '80', '90']} onChange={(weightKg) => setDraft((old) => ({ ...old, weightKg }))} />
        {draft.goal === 'FAT_LOSS' ? <EditorialNumberField label="目标体重（可选）" ariaLabel="目标体重"
          value={draft.targetWeightKg} unit="kg" step="0.1" scale={['45', '55', '65', '75', '85']}
          onChange={(targetWeightKg) => setDraft((old) => ({ ...old, targetWeightKg }))} /> : null}
      </div>{error ? <p className="onboarding-error" role="alert">{error}</p> : null}
      <div className="onboarding-step__action"><PrimaryButton onClick={() => {
        try { const partial = { ...draft, activityLevel: 'INACTIVE' as ActivityLevel }; nutritionSetupFromDraft(partial); go('activity') }
        catch (cause) { setError(cause instanceof Error ? cause.message : '请检查填写内容。') }
      }}>下一步</PrimaryButton></div>
    </section> : null}
    {step === 'activity' ? <section className="onboarding-step">
      <p className="onboarding-kicker">这有助于我们更准确地估算你的每日能量需求。</p><h1>你的日常节奏是？</h1>
      <div className="onboarding-activity">{activityOptions.map((item) => <button type="button" key={item.value}
        aria-pressed={draft.activityLevel === item.value} onClick={() => setDraft((old) => ({ ...old, activityLevel: item.value }))}>
        <span aria-hidden="true">{item.symbol}</span><strong>{item.title}</strong><small>{item.detail}</small></button>)}</div>
      {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
      <div className="onboarding-step__action"><PrimaryButton disabled={busy} onClick={() => void generate()}>下一步</PrimaryButton></div>
    </section> : null}
    {step === 'result' ? <section className="onboarding-step onboarding-result">
      <p className="onboarding-kicker">这是你的起点，不是终点。</p><h1>你的每日参考</h1>
      {result?.target ? <><div className="onboarding-result__numbers"><strong>{result.target.calories_min.toLocaleString('zh-CN')}–{result.target.calories_max.toLocaleString('zh-CN')}</strong><span>kcal<br />每日能量参考范围</span>
        <i /><strong>{Math.round(result.target.protein_min_g)}–{Math.round(result.target.protein_max_g)} g</strong><span>蛋白质</span></div>
        <p className="onboarding-result__basis">基于 {draft.weightKg} kg · {activityOptions.find((item) => item.value === draft.activityLevel)?.title} · {draft.goal === 'FAT_LOSS' ? '减脂' : '维持体重'}</p></>
        : <div className="onboarding-result__empty"><span>资料已保存</span><strong>暂不生成成人营养参考</strong><p>{result?.targetUnavailableReason === 'UNDER_19'
          ? '成人自动营养参考适用于 19 岁及以上用户。你仍然可以正常记录饮食和使用 Motion。'
          : '资料还不足以生成参考，你可以稍后在饮食页继续完善。'}</p></div>}
      <p className="onboarding-result__message">这是一个起点，<br />不需要每天精确命中。<br />Motion 更关注长期的节奏，<br />而不是短期的完美。</p>
      <div className="onboarding-result__scene" aria-hidden="true"><span /><img src={scenicArt} alt="" /></div>
      <div className="onboarding-step__action"><PrimaryButton onClick={() => void service.complete().then(onExit)}>开始使用 Motion</PrimaryButton></div>
    </section> : null}
  </main>
}
