export interface Movement {
  id: string
  name: string
  instructions: string
  seconds: number
  phase: 'WARM_UP' | 'MAIN' | 'COOL_DOWN'
}

// Small, equipment-free foundation. Each instruction is one clear action; the
// routine composer chooses a warm-up, a balanced middle, and a cool-down.
export const movements: readonly Movement[] = [
  { id: 'march', name: '原地踏步', instructions: '自然摆臂，轻轻交替抬脚。', seconds: 45, phase: 'WARM_UP' },
  { id: 'step-touch', name: '左右点步', instructions: '向侧面迈一步，另一脚轻点地面。', seconds: 45, phase: 'WARM_UP' },
  { id: 'shoulder-circles', name: '肩部绕环', instructions: '双肩缓慢向后绕圈，保持呼吸。', seconds: 40, phase: 'WARM_UP' },
  { id: 'arm-reach', name: '交替伸臂', instructions: '双臂轮流向上伸展，不要耸肩。', seconds: 40, phase: 'WARM_UP' },
  { id: 'ankle-circles', name: '脚踝绕环', instructions: '扶稳站立，双脚踝交替缓慢绕圈。', seconds: 40, phase: 'WARM_UP' },
  { id: 'side-step', name: '侧向迈步', instructions: '保持膝盖微屈，左右缓慢迈步。', seconds: 50, phase: 'WARM_UP' },
  { id: 'squat', name: '徒手深蹲', instructions: '脚与肩同宽，臀部向后坐，按舒适幅度下蹲。', seconds: 50, phase: 'MAIN' },
  { id: 'sit-stand', name: '坐下起立', instructions: '从稳固椅子坐下再起立，双脚踩稳。', seconds: 50, phase: 'MAIN' },
  { id: 'wall-push', name: '墙壁俯卧撑', instructions: '双手撑墙，身体保持一条直线，缓慢屈伸手肘。', seconds: 50, phase: 'MAIN' },
  { id: 'incline-push', name: '斜面俯卧撑', instructions: '双手撑稳固高台，缓慢屈伸手肘。', seconds: 50, phase: 'MAIN' },
  { id: 'glute-bridge', name: '臀桥', instructions: '仰卧屈膝，脚掌踩地，抬起臀部再缓慢放下。', seconds: 50, phase: 'MAIN' },
  { id: 'dead-bug', name: '死虫式', instructions: '仰卧，交替伸出对侧手脚，腰背保持稳定。', seconds: 50, phase: 'MAIN' },
  { id: 'bird-dog', name: '鸟狗式', instructions: '四点支撑，交替伸出对侧手脚，保持躯干稳定。', seconds: 50, phase: 'MAIN' },
  { id: 'calf-raise', name: '提踵', instructions: '扶稳站立，缓慢踮脚再落下。', seconds: 45, phase: 'MAIN' },
  { id: 'knee-raise', name: '站姿提膝', instructions: '扶稳站立，左右交替抬膝。', seconds: 45, phase: 'MAIN' },
  { id: 'hip-hinge', name: '髋部后移', instructions: '膝盖微屈，臀部向后推，背部保持自然。', seconds: 50, phase: 'MAIN' },
  { id: 'supported-lunge', name: '扶稳后撤步', instructions: '扶稳站立，一脚向后轻迈，再回到原位。', seconds: 50, phase: 'MAIN' },
  { id: 'side-leg', name: '站姿侧抬腿', instructions: '扶稳站立，腿缓慢向侧面抬起，左右交替。', seconds: 50, phase: 'MAIN' },
  { id: 'standing-rotation', name: '站姿胸椎转动', instructions: '双臂自然抬起，胸口缓慢左右转动。', seconds: 45, phase: 'MAIN' },
  { id: 'cat-cow', name: '猫牛式', instructions: '四点支撑，随呼吸缓慢拱背和舒展。', seconds: 45, phase: 'COOL_DOWN' },
  { id: 'child-pose', name: '婴儿式', instructions: '跪坐后轻轻向前伸展，按舒适幅度停留。', seconds: 45, phase: 'COOL_DOWN' },
  { id: 'hamstring', name: '腿后侧舒展', instructions: '坐姿伸出一腿，背部自然，轻轻向前倾。', seconds: 45, phase: 'COOL_DOWN' },
  { id: 'hip-flexor', name: '髋前侧舒展', instructions: '扶稳站立，一脚向后迈，轻轻伸展髋前侧。', seconds: 45, phase: 'COOL_DOWN' },
  { id: 'thoracic', name: '胸椎打开', instructions: '坐姿或站姿，双臂轻轻向两侧打开。', seconds: 40, phase: 'COOL_DOWN' },
]

export function composeMiniRoutine(variation = 0, targetMinutes = 5): readonly Movement[] {
  const index = Math.abs(Math.trunc(variation))
  const warm = movements.filter((item) => item.phase === 'WARM_UP')
  const main = movements.filter((item) => item.phase === 'MAIN')
  const cool = movements.filter((item) => item.phase === 'COOL_DOWN')
  const count = Math.max(4, Math.min(10, Math.round(targetMinutes)))
  const middleCount = count - 2
  const chosen: Movement[] = [warm[index % warm.length]!]
  // Alternate lower body, upper/core and balance choices rather than random picks.
  const groups = [main.slice(0, 2), main.slice(2, 4), main.slice(4, 7), main.slice(7)]
  for (let i = 0; i < middleCount; i++) {
    const group = groups[i % groups.length]!
    chosen.push(group[Math.floor(i / groups.length + index) % group.length]!)
  }
  chosen.push(cool[index % cool.length]!)
  return chosen
}
