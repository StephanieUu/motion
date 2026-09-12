import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('M0 application shell', () => {
  it('renders the Today mock and all five primary destinations', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '早上好' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '全身舒展' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '连续运动 8 天' })).toBeVisible()

    for (const label of ['今天', '训练', '饮食', '身体', '我的']) {
      expect(screen.getByRole('link', { name: label })).toBeVisible()
    }
    expect(screen.getByRole('link', { name: '跳转到主要内容' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeVisible()
    expect(screen.getByLabelText('本周运动情况预览')).toBeVisible()
  })

  it('switches tabs and opens the global Coach placeholder', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('link', { name: '饮食' }))
    expect(screen.getByRole('heading', { name: '饮食记录' })).toBeVisible()
    expect(screen.getByText('暂未开放')).toBeVisible()

    await user.click(screen.getByRole('link', { name: '身体' }))
    expect(screen.getByRole('heading', { name: '身体数据' })).toBeVisible()

    await user.click(screen.getByRole('link', { name: '训练' }))
    expect(screen.getByRole('heading', { name: '训练计划' })).toBeVisible()

    await user.click(screen.getByRole('link', { name: '我的' }))
    expect(screen.getByRole('heading', { name: '个人资料与偏好' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Coach' }))
    const coachDialog = screen.getByRole('dialog', { name: 'Coach 暂未开放' })
    expect(coachDialog).toBeVisible()
    expect(coachDialog.textContent).toBe('Coach 暂未开放关闭')
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
