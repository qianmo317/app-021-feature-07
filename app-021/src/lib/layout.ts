import type { LayoutConfig, Seat, SeatTag, SeatTagSource, Student } from '../types'

// ============ 座位布局 ============

export function seatIdOf(row: number, col: number): string {
  return `r${row}c${col}`
}

// 随布局自动推导、重算时整体刷新的标记（不含小组组号 group:*，那个也总是重算）
// front/middle/back 与 aisle/window/door 全部由布局决定，布局一改就重算。
export const AUTO_TAGS: SeatTag[] = ['front', 'middle', 'back', 'aisle', 'window', 'door']
// 允许老师手工补标的标记；group:* 为内部组号，不开放手工
export const MANUAL_TAGS: SeatTag[] = ['stage_side', 'aisle', 'window', 'door']

export const TAG_LABELS: Record<SeatTag, string> = {
  front: '前排',
  middle: '中排',
  back: '后排',
  aisle: '靠过道',
  window: '靠窗',
  door: '靠门',
  stage_side: '讲台侧',
}

// 单个座位上某标记的来源：手工补标优先于自动推导（用于 UI 标出来源）
export function tagSourceOf(seat: Seat, tag: SeatTag): SeatTagSource | undefined {
  if (!seat.tags.includes(tag)) return undefined
  return seat.manualTags?.includes(tag) ? 'manual' : 'auto'
}

// 自动推导：某布局下指定座位应有的全部自动标记
export function autoTagsOf(layout: LayoutConfig, row: number, col: number): SeatTag[] {
  const tags: SeatTag[] = []
  const frontThird = Math.max(1, Math.ceil(layout.rows / 3))
  if (row < frontThird) tags.push('front')
  else if (row >= layout.rows - frontThird) tags.push('back')
  else tags.push('middle')
  if (isAisleSeat(layout, row, col)) tags.push('aisle')
  const doorCol = layout.doorSide === 'left' ? 0 : layout.cols - 1
  const windowCol = layout.doorSide === 'left' ? layout.cols - 1 : 0
  if (col === doorCol) tags.push('door')
  if (col === windowCol) tags.push('window')
  return tags
}

// 根据布局配置生成全部座位（含自动标注）。
// 布局修改后用新 layout + 旧 seats 调用：自动标记整体重算，
// 旧座位（id 相同）的手工补标原样保留，确保「标记随布局维护」。
export function buildSeats(layout: LayoutConfig, prevSeats: Seat[] = []): Seat[] {
  const prevById = new Map(prevSeats.map((s) => [s.id, s]))
  const seats: Seat[] = []
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const id = seatIdOf(row, col)
      const manualTags = dedupeTags(prevById.get(id)?.manualTags ?? [])
      const auto = autoTagsOf(layout, row, col)
      if (layout.mode === 'groups') auto.push(`group:${groupOf(row, col, layout.cols)}` as SeatTag)
      const tags = dedupeTags([...auto, ...manualTags])
      const seat: Seat = { id, row, col, tags }
      if (manualTags.length) seat.manualTags = manualTags
      seats.push(seat)
    }
  }
  return seats
}

// 手工增删一个座位的补标（自动标记不可手工取消，避免标记与布局脱节）
export function withSeatManualTag(seat: Seat, layout: LayoutConfig, tag: SeatTag, on: boolean): Seat {
  const cur = new Set(seat.manualTags ?? [])
  if (on) cur.add(tag)
  else cur.delete(tag)
  const manualTags = MANUAL_TAGS.filter((t) => cur.has(t))
  const auto = autoTagsOf(layout, seat.row, seat.col)
  if (layout.mode === 'groups') auto.push(`group:${groupOf(seat.row, seat.col, layout.cols)}` as SeatTag)
  const tags = dedupeTags([...auto, ...manualTags])
  const next: Seat = { ...seat, tags }
  if (manualTags.length) next.manualTags = manualTags
  else delete next.manualTags
  return next
}

function dedupeTags(tags: SeatTag[]): SeatTag[] {
  return [...new Set(tags)]
}

export function isAisleSeat(layout: LayoutConfig, row: number, col: number): boolean {
  void row
  // 靠过道：紧邻某条过道的座位
  for (const a of layout.aisles) {
    if (col === a || col === a + 1) return true
  }
  return false
}

// 小组围坐：每 4 人（2×2）一组
export function groupOf(row: number, col: number, cols: number): string {
  const gRow = Math.floor(row / 2)
  const gCol = Math.floor(col / 2)
  const perRow = Math.ceil(cols / 2)
  return `G${gRow * perRow + gCol + 1}`
}

// ============ 位置分（写进 UI 说明，便于向家长解释） ============
// positionScore(seat) = rowWeight + middleWeight，分数越低位置越好：
//   rowWeight    ∈ [0,2]：0 = 第 1 排（最靠讲台），2 = 最后一排
//   middleWeight ∈ [0,1]：0 = 正中一列，1 = 最边上一列
export function positionScore(seat: Seat, layout: LayoutConfig): number {
  const rowWeight = layout.rows > 1 ? (seat.row / (layout.rows - 1)) * 2 : 0
  const half = (layout.cols - 1) / 2
  const middleWeight = half > 0 ? Math.abs(seat.col - half) / half : 0
  return rowWeight + middleWeight
}

// 「中间列」集合：到中轴距离 ≤ 列宽一半的一半（居中连续块）。
// 视力「需中间」学生的硬约束范围，也是公平性统计的「中间列次数」。
export function middleColSet(layout: LayoutConfig): Set<number> {
  const half = (layout.cols - 1) / 2
  const out = new Set<number>()
  for (let c = 0; c < layout.cols; c++) {
    if (Math.abs(c - half) <= half / 2 + 1e-9) out.add(c)
  }
  return out
}

// ============ 预计算索引（引擎性能关键） ============
export interface SeatIndex {
  layout: LayoutConfig
  seats: Seat[]
  byId: Map<string, Seat>
  posScore: Float64Array // 按座位下标
  deskmates: number[][] // 同桌（行列模式：同排左右相邻且无过道；小组模式：同组全部成员）
  vertical: { up: number; down: number }[] // 同列前后（身高排序用）
  isFrontRows: (row: number, n: number) => boolean
}

export function buildSeatIndex(seats: Seat[], layout: LayoutConfig): SeatIndex {
  const byId = new Map(seats.map((s) => [s.id, s]))
  const idxOf = (s: Seat) => s.row * layout.cols + s.col
  const n = seats.length
  const posScore = new Float64Array(n)
  const deskmates: number[][] = Array.from({ length: n }, () => [])
  const vertical: { up: number; down: number }[] = Array.from({ length: n }, () => ({ up: -1, down: -1 }))

  for (const s of seats) posScore[idxOf(s)] = positionScore(s, layout)

  if (layout.mode === 'groups') {
    const byGroup = new Map<string, Seat[]>()
    for (const s of seats) {
      const g = s.tags.find((t) => t.startsWith('group:'))
      if (!g) continue
      const list = byGroup.get(g) ?? []
      list.push(s)
      byGroup.set(g, list)
    }
    for (const s of seats) {
      const g = s.tags.find((t) => t.startsWith('group:'))
      if (!g) continue
      deskmates[idxOf(s)] = (byGroup.get(g) ?? []).filter((o) => o.id !== s.id).map(idxOf)
    }
  } else {
    for (const s of seats) {
      const list = deskmates[idxOf(s)]
      const left = byId.get(seatIdOf(s.row, s.col - 1))
      const right = byId.get(seatIdOf(s.row, s.col + 1))
      const gapLeft = layout.aisles.includes(s.col - 1)
      const gapRight = layout.aisles.includes(s.col)
      if (left && !gapLeft) list.push(idxOf(left))
      if (right && !gapRight) list.push(idxOf(right))
    }
  }

  for (const s of seats) {
    const up = byId.get(seatIdOf(s.row - 1, s.col))
    const down = byId.get(seatIdOf(s.row + 1, s.col))
    vertical[idxOf(s)] = { up: up ? idxOf(up) : -1, down: down ? idxOf(down) : -1 }
  }

  return {
    layout,
    seats,
    byId,
    posScore,
    deskmates,
    vertical,
    isFrontRows: (row, frontRows) => row < frontRows,
  }
}

// 学生展示用的标记描述（图标 + 文字，不能只用颜色）
export function visionLabel(v: Student['vision']): string {
  if (v === 'front_required') return '近视·需前排'
  if (v === 'middle_required') return '需中间'
  return ''
}

export function specialLabel(s: Student['special']): string {
  const out: string[] = []
  if (s?.includes('hearing')) out.push('听力')
  if (s?.includes('mobility')) out.push('行动不便')
  return out.join('、')
}
