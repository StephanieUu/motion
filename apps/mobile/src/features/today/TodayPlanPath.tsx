import { uiCopy } from '../../locales'
import type { CurrentPlanProgress } from './todayModel'

type PlanBranch = 'REPLACEMENT' | 'REST_EXTRA' | null

interface Point { x: number; y: number }

function pointsForDays(count: number, width: number): Point[] {
  if (count === 1) return [{ x: width / 2, y: 72 }]
  if (count === 3) return [{ x: 28, y: 76 }, { x: width * .38, y: 48 }, { x: width - 28, y: 76 }]
  return Array.from({ length: count }, (_, index) => {
    const position = index / (count - 1)
    return { x: 28 + position * (width - 56),
      y: 76 - 28 * Math.sin(Math.PI * position) + 5 * Math.sin(2 * Math.PI * position) }
  })
}

function growingPath(points: Point[]): string {
  if (points.length === 1) {
    const { x, y } = points[0]!
    return `M ${x} ${y} C ${x + 62} ${y - 44}, ${x + 62} ${y + 44}, ${x} ${y}
      C ${x - 62} ${y + 44}, ${x - 62} ${y - 44}, ${x} ${y}`
  }
  if (points.length === 2) {
    const [first, last] = points as [Point, Point]
    return `M ${first.x} ${first.y} Q ${(first.x + last.x) / 2} 25 ${last.x} ${last.y}`
  }
  return points.slice(0, -1).reduce((path, point, index) => {
    const before = points[Math.max(0, index - 1)]!
    const next = points[index + 1]!
    const after = points[Math.min(points.length - 1, index + 2)]!
    const c1x = point.x + (next.x - before.x) / 6
    const c1y = point.y + (next.y - before.y) / 6
    const c2x = next.x - (after.x - point.x) / 6
    const c2y = next.y - (after.y - point.y) / 6
    return `${path} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${next.x} ${next.y}`
  }, `M ${points[0]!.x} ${points[0]!.y}`)
}

export function TodayPlanPath({ progress, branch }: { progress: CurrentPlanProgress; branch: PlanBranch }) {
  const width = Math.max(320, 56 + (progress.segments.length - 1) * 44)
  const height = 142
  const points = pointsForDays(progress.segments.length, width)
  const currentIndex = progress.segments.findIndex((segment) => segment.current)
  const current = points[currentIndex]
  const direction = current && current.x > width * 0.72 ? -1 : 1
  const branchEnd = current && branch ? { x: current.x + direction * 35, y: current.y - 34 } : null

  return <div className="today-plan__path-scroll">
    <div className="today-plan__path" role="list" aria-label={uiCopy.execution.progress}
      style={{ minWidth: progress.segments.length > 7 ? `${width}px` : undefined }}>
      <svg className="today-plan__lines" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        aria-hidden="true" data-branch={branch ?? 'NONE'}>
        <g className="today-plan__orbit">
          <path d={`M 12 94 C 28 19, ${width - 35} 11, ${width - 12} 88
            C ${width - 34} 130, 54 139, 12 94Z`} />
          <path d={`M 17 101 C 70 127, ${width - 64} 124, ${width - 17} 96`} />
        </g>
        {points.length > 1 ? <path className="today-plan__return" d={`M ${points.at(-1)!.x} ${points.at(-1)!.y}
          C ${width - 9} 133, 9 133, ${points[0]!.x} ${points[0]!.y}`} /> : null}
        <path className="today-plan__growth" d={growingPath(points)} />
        <g className="today-plan__stars">
          <path d={`M ${width * .18} 25 l 2 8 8 2 -8 2 -2 8 -2 -8 -8 -2 8 -2Z`} />
          <path d={`M ${width * .79} 36 l 2 9 9 2 -9 2 -2 9 -2 -9 -9 -2 9 -2Z`} />
          <path d={`M ${width * .92} 114 l 1.5 6 6 1.5 -6 1.5 -1.5 6 -1.5 -6 -6 -1.5 6 -1.5Z`} />
        </g>
        {current ? <g className="today-plan__aura">{Array.from({ length: 16 }, (_, index) => {
          const angle = index * Math.PI / 8
          return <line key={index} x1={current.x + Math.cos(angle) * 20}
            y1={current.y + Math.sin(angle) * 20} x2={current.x + Math.cos(angle) * 27}
            y2={current.y + Math.sin(angle) * 27} />
        })}</g> : null}
        {branchEnd && current ? <g className="today-plan__branch" data-branch={branch}>
          <path d={`M ${current.x} ${current.y} Q ${current.x + direction * 5} ${current.y - 27},
            ${branchEnd.x} ${branchEnd.y}`} />
          <circle cx={branchEnd.x} cy={branchEnd.y} r="8" />
          <circle className="today-plan__branch-core" cx={branchEnd.x} cy={branchEnd.y} r="2.5" />
        </g> : null}
      </svg>
      {progress.segments.map((segment, index) => <span key={segment.id} className="today-plan__node"
        role="listitem" data-kind={segment.kind} data-current={segment.current}
        style={{ left: `${points[index]!.x / width * 100}%`, top: `${points[index]!.y / height * 100}%` }}
        aria-label={`${uiCopy.currentPlanProgress.day}${index + 1}${uiCopy.currentPlanProgress.dayUnit} · ${uiCopy.currentPlanProgress.segments[segment.kind]}${segment.current ? ` · ${uiCopy.navigation.today}` : ''}`}>
        <span className="today-plan__node-mark" aria-hidden="true" />
        <span className="today-plan__node-index" aria-hidden="true">{index + 1}</span>
      </span>)}
    </div>
  </div>
}
