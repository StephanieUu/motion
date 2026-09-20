import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BodyScreen } from './BodyScreen'
import type { BodyService } from './bodyService'

const { openAiService } = vi.hoisted(() => ({ openAiService: vi.fn() }))
vi.mock('../ai/aiRuntime', () => ({ openAiService }))

const service = { overview: vi.fn(async () => ({ snapshot:{weightKg:{value:65.8,measurementId:'w',measuredAt:'now',sourceType:'MANUAL'},
  bodyFatPercent:{value:21.8,measurementId:'f',measuredAt:'now',sourceType:'MANUAL'}},
  weightTrend:[],bodyFatTrend:[],yesterdaySummary:{localDate:'2026-09-15',steps:7842,activeCaloriesKcal:320,
    exerciseMinutes:42,sleepMinutes:438,restingHeartRate:56,averageHeartRate:68,sourceSummaryJson:null,lastSyncedAt:'now'},records:[{
      id:'manual-1',measuredAt:'2026-09-15T08:30:00.000Z',localDate:'2026-09-15',sourceType:'MANUAL',weightKg:65.8,
      bodyFatPercent:21.8,bmi:null,fatMassKg:null,muscleMassKg:null,skeletalMuscle:null,bodyWaterPercent:null,
      visceralFatLevel:null,boneMassKg:null,bmrKcal:null,bodyAge:null,rawDataJson:null,confidenceLevel:'HIGH',
      userVerified:true,externalRecordId:null,sourceApp:null,createdAt:'now',updatedAt:'now',
    }] })),
  availability:vi.fn(async()=>({status:'UNAVAILABLE'})),summary:vi.fn(async()=>null),trends:vi.fn(async()=>[]),
} as unknown as BodyService

describe('M9 Body presentation', () => {
  beforeEach(() => { openAiService.mockClear() })

  it('renders the approved factual Body overview hierarchy and access routes', async () => {
    render(<MemoryRouter><BodyScreen suppliedService={service}/></MemoryRouter>)
    expect(await screen.findByText('65.8')).toBeInTheDocument()
    expect(screen.getByText('21.8')).toBeInTheDocument()
    expect(screen.getByText(/7,842 步/)).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'＋ 记录身体数据'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'导入薄荷截图'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'连接 Health Connect'})).toBeInTheDocument()
    expect(openAiService).not.toHaveBeenCalled()
  })

  it('keeps core body fields visible and advanced metrics in the existing disclosure', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><BodyScreen view="entry" suppliedService={service}/></MemoryRouter>)
    expect(screen.getByText('记录身体数据')).toBeInTheDocument()
    expect(screen.getByText('体重 *')).toBeInTheDocument()
    expect(screen.getByText('体脂率（可选）')).toBeInTheDocument()
    expect(screen.getByText('肌肉量（可选）')).toBeInTheDocument()
    expect(screen.getByText('体水分（可选）')).toBeInTheDocument()
    expect(screen.queryByText('内脏脂肪等级（可选）')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:/更多指标/}))
    expect(screen.getByText('内脏脂肪等级（可选）')).toBeInTheDocument()
  })

  it('guards confirmation when OCR finds no savable body metric', async () => {
    const user = userEvent.setup(), confirmScreenshot = vi.fn()
    const emptyOcrService = { ...service,
      recognizeScreenshot: vi.fn(async () => ({ importId:'empty',rawText:'未识别',values:{} })), confirmScreenshot,
    } as unknown as BodyService
    render(<MemoryRouter><BodyScreen view="import" suppliedService={emptyOcrService}/></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '选择薄荷截图' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没有识别到可保存的身体数据，你可以重新选择截图或手动记录。')
    expect(screen.getByRole('button', { name: '确认并保存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '确认并保存' }))
    expect(confirmScreenshot).not.toHaveBeenCalled()
  })

  it('keeps successful local OCR local and does not open an AI provider', async () => {
    const user = userEvent.setup(), localOcrService = { ...service,
      recognizeScreenshot: vi.fn(async () => ({ importId:'local',rawText:'体重 64.35 公斤',
        values:{ weightKg:64.35 } })),
    } as unknown as BodyService
    render(<MemoryRouter><BodyScreen view="import" suppliedService={localOcrService}/></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '选择薄荷截图' }))
    expect(await screen.findByDisplayValue('64.35')).toBeInTheDocument()
    expect(openAiService).not.toHaveBeenCalled()
  })

  it('opens measurement history from the root tabs and keeps overview and trends reachable', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/body']}><Routes>
      <Route path="/body" element={<BodyScreen suppliedService={service}/>} />
      <Route path="/body/history" element={<BodyScreen view="history" suppliedService={service}/>} />
      <Route path="/body/trends" element={<BodyScreen view="trends" suppliedService={service}/>} />
    </Routes></MemoryRouter>)

    const history = await screen.findByRole('button', { name: '历史' })
    expect(history).toBeEnabled()
    await user.click(history)
    expect(await screen.findByRole('heading', { name: '历史记录' })).toBeInTheDocument()
    expect(await screen.findByText('2026-09-15')).toBeInTheDocument()
    expect(screen.getByText('65.8 kg · 体脂率 21.8%')).toBeInTheDocument()
    expect(screen.getByText('手动记录')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回' }))
    const overview = await screen.findByRole('button', { name: '概览' })
    expect(overview).toHaveAttribute('aria-current', 'page')
    await user.click(overview)
    expect(await screen.findByText('当前体重')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '趋势' }))
    expect(await screen.findByRole('heading', { name: '体重趋势' })).toBeInTheDocument()
  })
})
