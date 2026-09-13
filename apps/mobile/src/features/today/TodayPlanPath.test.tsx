import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { uiCopy } from '../../locales'
import { TodayPlanPath } from './TodayPlanPath'
import type { CurrentPlanProgress, ProgressSegmentKind } from './todayModel'

function progress(kinds: ProgressSegmentKind[]): CurrentPlanProgress {
  return { planId: 'plan', position: 3, totalDays: kinds.length, completedTraining: 1,
    totalTraining: kinds.length - 1, segments: kinds.map((kind, index) => ({
      id: `day-${index + 1}`, kind, current: index === 2 })) }
}

describe('Today plan path', () => {
  it('keeps each plan state as an identifiable node along the organic path', () => {
    const kinds: ProgressSegmentKind[] = ['COMPLETED', 'REST', 'PENDING', 'PARTIAL', 'SKIPPED',
      'IN_PROGRESS', 'REST_DONE']
    render(<TodayPlanPath progress={progress(kinds)} branch={null} />)
    const path = screen.getByRole('list', { name: uiCopy.execution.progress })
    const nodes = within(path).getAllByRole('listitem')
    expect(nodes.map((node) => node.dataset.kind)).toEqual(kinds)
    expect(nodes[2]).toHaveAttribute('data-current', 'true')
    expect(nodes[2]?.getAttribute('aria-label')).toContain(uiCopy.navigation.today)
    expect(path.querySelector('.today-plan__growth')).toBeInTheDocument()
    expect(path.querySelector('.today-plan__return')).toBeInTheDocument()
    expect(path.querySelector('.today-plan__branch')).not.toBeInTheDocument()
  })

  it('preserves every node in a longer scrollable plan', () => {
    render(<TodayPlanPath progress={progress(Array(12).fill('PENDING') as ProgressSegmentKind[])}
      branch="REST_EXTRA" />)
    const path = screen.getByRole('list', { name: uiCopy.execution.progress })
    expect(within(path).getAllByRole('listitem')).toHaveLength(12)
    expect(path).toHaveStyle({ minWidth: '540px' })
    expect(path.querySelector('.today-plan__branch[data-branch="REST_EXTRA"]')).toBeInTheDocument()
  })
})
