import type { LayoutConfig, ManualSeatTag, Seat, SeatTag, Student } from '../types'
import { MANUAL_SEAT_TAGS } from '../types'

// ============ 座位布局 ============

export function seatIdOf(row: number, col: number): string {
  return `r${row}c${col}`
}

// 单个座位由布局配置推出的「自动」标记（不含手动补标）
export function autoTagsFor(layout: LayoutConfig, row: number, col: number): SeatTag[] {
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
  if (layout.mode === 'groups') tags.push(`group:${groupOf(row, col, layout.cols)}` as SeatTag)
  return tags
}

// 自动标记 ∪ 手动标记（去重，自动在前）
export function mergeTags(auto: SeatTag[], manual: ManualSeatTag[]): SeatTag[] {
  const out: SeatTag[] = [...auto]
  for (const t of manual) if (!out.includes(t)) out.push(t)
  return out
}

function cleanManual(manual: ManualSeatTag[] | undefined): ManualSeatTag[] {
  return [...new Set((manual ?? []).filter((t) => (MANUAL_SEAT_TAGS as readonly string[]).includes(t)))]
}

// 根据布局配置生成全部座位（自动标注 + 沿用旧座位的手动补标）
export function buildSeats(layout: LayoutConfig, prevSeats?: Seat[]): Seat[] {
  const prevById = new Map((prevSeats ?? []).map((s) => [s.id, s]))
  const seats: Seat[] = []
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const id = seatIdOf(row, col)
      const manualTags = cleanManual(prevById.get(id)?.manualTags)
      const tags = mergeTags(autoTagsFor(layout, row, col), manualTags)
      seats.push({ id, row, col, tags, ...(manualTags.length ? { manualTags } : {}) })
    }
  }
  return seats
}

// 布局改动后重算全部座位标记：自动标记按新布局重算，手动补标按行列位置保留
export function recalcSeats(prevSeats: Seat[], layout: LayoutConfig): Seat[] {
  return buildSeats(layout, prevSeats)
}

// 读取旧数据时对账：自动标记按布局重推；老师手动补标按行列位置保留。
// 旧版本没有 manualTags 字段，手动补标（stage_side）混在 tags 里，这里迁移出来；
// 其余混在 tags 里、本应由布局推出的标记（aisle/window/door）一律以布局重算结果为准。
export function normalizeSeats(layout: LayoutConfig, seats: Seat[]): Seat[] {
  const expected = new Set(
    Array.from({ length: layout.rows }, (_, r) =>
      Array.from({ length: layout.cols }, (_, c) => seatIdOf(r, c)),
    ).flat(),
  )
  const prev: Seat[] = []
  for (const s of seats) {
    if (!expected.has(s.id)) continue
    const manual = s.manualTags
      ? cleanManual(s.manualTags)
      : s.tags.filter((t): t is ManualSeatTag => t === 'stage_side')
    prev.push({ ...s, manualTags: manual.length ? manual : undefined })
  }
  return buildSeats(layout, prev)
}

// 切换某个座位的手动补标，并重算该座位的合并标记（自动部分按布局重推，
// 因此取消手动补标时，若该标记本身也是自动标记（如本来就靠过道），自动标记仍在）
export function toggleManualTag(
  layout: LayoutConfig,
  seats: Seat[],
  seatId: string,
  tag: ManualSeatTag,
): Seat[] {
  return seats.map((s) => {
    if (s.id !== seatId) return s
    const set = new Set(cleanManual(s.manualTags))
    set.has(tag) ? set.delete(tag) : set.add(tag)
    const manualTags = MANUAL_SEAT_TAGS.filter((t) => set.has(t))
    return {
      ...s,
      manualTags: manualTags.length ? manualTags : undefined,
      tags: mergeTags(autoTagsFor(layout, s.row, s.col), manualTags),
    }
  })
}

// 标记来源：手动补标优先（重算保留），其余为布局自动
export function tagSource(seat: Seat, tag: SeatTag): 'auto' | 'manual' {
  return seat.manualTags?.includes(tag as ManualSeatTag) ? 'manual' : 'auto'
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

// ============ 布局变更对硬约束的影响 ============
// 布局（行数/列数/过道/门向）一改，front/middle/back、aisle/window/door 全部重算。
// 这里对比新旧布局下「个体硬约束可选座位集合」，列出受到影响的学生及原因，供老师确认。

export interface ConstraintImpact {
  student: Student
  reasons: string[]
}

// 行动不便「可接受座位」：靠过道标记，或本身就在最边上一列（进出不经他人）
export function accessibleSeatIds(layout: LayoutConfig, seats: Seat[]): Set<string> {
  const out = new Set<string>()
  for (const s of seats) {
    if (s.tags.includes('aisle') || s.col === 0 || s.col === layout.cols - 1) out.add(s.id)
  }
  return out
}

function frontSeatIds(layout: LayoutConfig, seats: Seat[], frontRows: number): Set<string> {
  const out = new Set<string>()
  for (const s of seats) if (s.row < Math.min(frontRows, layout.rows)) out.add(s.id)
  return out
}

function middleSeatIds(layout: LayoutConfig, seats: Seat[]): Set<string> {
  const mc = middleColSet(layout)
  const out = new Set<string>()
  for (const s of seats) if (mc.has(s.col)) out.add(s.id)
  return out
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

/**
 * 对比旧/新布局，列出硬约束可选座位发生变化的学生。
 * @param frontRows 约束配置中的「需前排 = 前 N 排」
 */
export function layoutConstraintImpacts(
  oldLayout: LayoutConfig,
  newLayout: LayoutConfig,
  oldSeats: Seat[],
  newSeats: Seat[],
  students: Student[],
  frontRows: number,
): ConstraintImpact[] {
  const oldFront = frontSeatIds(oldLayout, oldSeats, frontRows)
  const newFront = frontSeatIds(newLayout, newSeats, frontRows)
  const oldHearingRows = Math.ceil(oldLayout.rows / 2)
  const newHearingRows = Math.ceil(newLayout.rows / 2)
  const oldHear = frontSeatIds(oldLayout, oldSeats, oldHearingRows)
  const newHear = frontSeatIds(newLayout, newSeats, newHearingRows)
  const oldMiddle = middleSeatIds(oldLayout, oldSeats)
  const newMiddle = middleSeatIds(newLayout, newSeats)
  const oldAisle = accessibleSeatIds(oldLayout, oldSeats)
  const newAisle = accessibleSeatIds(newLayout, newSeats)
  const newSeatIds = new Set(newSeats.map((s) => s.id))

  const out: ConstraintImpact[] = []
  for (const student of students) {
    const reasons: string[] = []
    if (student.vision === 'front_required' && !sameSet(oldFront, newFront)) {
      reasons.push(`近视需前排（前 ${Math.min(frontRows, newLayout.rows)} 排），可选座位由 ${oldFront.size} 个变为 ${newFront.size} 个`)
    }
    if (student.special?.includes('hearing') && !sameSet(oldHear, newHear)) {
      reasons.push(`听力需前一半（前 ${newHearingRows} 排），可选座位由 ${oldHear.size} 个变为 ${newHear.size} 个`)
    }
    if (student.vision === 'middle_required' && !sameSet(oldMiddle, newMiddle)) {
      reasons.push(`视力需中间列，可选座位由 ${oldMiddle.size} 个变为 ${newMiddle.size} 个`)
    }
    if (student.special?.includes('mobility') && !sameSet(oldAisle, newAisle)) {
      reasons.push(`行动不便需靠过道，可进出的座位由 ${oldAisle.size} 个变为 ${newAisle.size} 个`)
    }
    if (student.fixedSeatId && !newSeatIds.has(student.fixedSeatId)) {
      reasons.push('固定座位在新布局中已不存在，固定设置将被清除')
    }
    if (reasons.length > 0) out.push({ student, reasons })
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
