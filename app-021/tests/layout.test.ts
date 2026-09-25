import { describe, expect, it } from 'vitest'
import {
  accessibleSeatIds,
  autoTagsFor,
  buildSeatIndex,
  buildSeats,
  layoutConstraintImpacts,
  middleColSet,
  normalizeSeats,
  positionScore,
  recalcSeats,
  tagSource,
  toggleManualTag,
} from '../src/lib/layout'
import type { LayoutConfig, SeatTag, Student } from '../src/types'

const layout: LayoutConfig = { rows: 3, cols: 6, aisles: [2], mode: 'rows', doorSide: 'right' }

function student(partial: Partial<Student> & { name: string }): Student {
  return { id: `x-${partial.name}`, vision: 'none', mustApartFrom: [], ...partial }
}

describe('座位布局', () => {
  it('生成行列齐全的座位并自动标注', () => {
    const seats = buildSeats(layout)
    expect(seats).toHaveLength(18)
    const r0c0 = seats.find((s) => s.id === 'r0c0')!
    expect(r0c0.tags).toContain('front')
    expect(r0c0.tags).toContain('window') // 门在右，窗在左
    const r2c5 = seats.find((s) => s.id === 'r2c5')!
    expect(r2c5.tags).toContain('back')
    expect(r2c5.tags).toContain('door')
    const r1c2 = seats.find((s) => s.id === 'r1c2')!
    expect(r1c2.tags).toContain('middle')
    expect(r1c2.tags).toContain('aisle') // 过道在 col2|col3 之间
    const r1c3 = seats.find((s) => s.id === 'r1c3')!
    expect(r1c3.tags).toContain('aisle')
  })

  it('位置分：越靠前、越靠中间分数越低', () => {
    const seats = buildSeats(layout)
    const byId = new Map(seats.map((s) => [s.id, s]))
    expect(positionScore(byId.get('r0c2')!, layout)).toBeLessThan(positionScore(byId.get('r2c0')!, layout))
    expect(positionScore(byId.get('r1c2')!, layout)).toBeLessThan(positionScore(byId.get('r1c0')!, layout))
    expect(positionScore(byId.get('r0c2')!, layout)).toBeCloseTo(positionScore(byId.get('r0c3')!, layout), 10)
  })

  it('中间列集合：居中连续块', () => {
    expect(middleColSet(layout)).toEqual(new Set([2, 3]))
    expect(middleColSet({ ...layout, cols: 5 })).toEqual(new Set([1, 2, 3]))
    expect(middleColSet({ ...layout, cols: 8 })).toEqual(new Set([2, 3, 4, 5]))
  })

  it('同桌 = 同排相邻且中间无过道', () => {
    const seats = buildSeats(layout)
    const idx = buildSeatIndex(seats, layout)
    const idOf = (r: number, c: number) => r * 6 + c
    // r1: c0-c1 相邻同桌；c1 与 c2 之间无过道（过道在 c2|c3）
    expect(idx.deskmates[idOf(1, 0)]).toContain(idOf(1, 1))
    expect(idx.deskmates[idOf(1, 1)]).toContain(idOf(1, 2))
    // 过道隔开 c2 与 c3
    expect(idx.deskmates[idOf(1, 2)]).not.toContain(idOf(1, 3))
    expect(idx.deskmates[idOf(1, 3)]).not.toContain(idOf(1, 2))
    // 前后不是同桌
    expect(idx.deskmates[idOf(1, 1)]).not.toContain(idOf(0, 1))
  })

  it('小组围坐模式：同组成员互为同桌', () => {
    const g: LayoutConfig = { rows: 2, cols: 4, aisles: [], mode: 'groups', doorSide: 'left' }
    const idx = buildSeatIndex(buildSeats(g), g)
    const g1 = idx.deskmates[0] // r0c0 → G1
    expect(g1).toHaveLength(3) // r0c1, r1c0, r1c1
  })
})

describe('标记随布局重算（保留手动补标）', () => {
  it('门向翻转后 door/window 标记整体换到另一侧', () => {
    const seats = buildSeats(layout)
    const flipped: LayoutConfig = { ...layout, doorSide: 'left' }
    const next = recalcSeats(seats, flipped)
    const byId = new Map(next.map((s) => [s.id, s]))
    expect(byId.get('r0c0')!.tags).toContain('door') // 门改到左
    expect(byId.get('r0c0')!.tags).not.toContain('window')
    expect(byId.get('r0c5')!.tags).toContain('window') // 窗改到右
    expect(byId.get('r0c5')!.tags).not.toContain('door')
  })

  it('新增过道后，紧邻过道的座位补标 aisle；移除过道后 aisle 消失', () => {
    const noAisle: LayoutConfig = { ...layout, aisles: [] }
    let seats = buildSeats(noAisle)
    expect(seats.find((s) => s.id === 'r1c1')!.tags).not.toContain('aisle')
    // 在 c1|c2 之间加过道
    seats = recalcSeats(seats, { ...noAisle, aisles: [1] })
    expect(seats.find((s) => s.id === 'r1c1')!.tags).toContain('aisle')
    expect(seats.find((s) => s.id === 'r1c2')!.tags).toContain('aisle')
    // 再撤掉过道
    seats = recalcSeats(seats, noAisle)
    expect(seats.find((s) => s.id === 'r1c1')!.tags).not.toContain('aisle')
    expect(seats.find((s) => s.id === 'r1c2')!.tags).not.toContain('aisle')
  })

  it('行列数变化后 front/middle/back 重新划分，旧尺寸外座位丢弃', () => {
    const seats = buildSeats(layout) // 3 行
    const next = recalcSeats(seats, { ...layout, rows: 6 })
    expect(next).toHaveLength(36)
    const byId = new Map(next.map((s) => [s.id, s]))
    // 6 行时前 1/3 = 2 排：r1 仍 front，r2 变为 middle（3 行时 r2 是 back）
    expect(byId.get('r1c0')!.tags).toContain('front')
    expect(byId.get('r2c0')!.tags).toContain('middle')
    expect(byId.get('r5c0')!.tags).toContain('back')
  })

  it('手动补标（讲台侧）在重算后保留并标出来源为 manual', () => {
    let seats = buildSeats(layout)
    seats = toggleManualTag(layout, seats, 'r1c4', 'stage_side')
    expect(seats.find((s) => s.id === 'r1c4')!.manualTags).toEqual(['stage_side'])
    expect(tagSource(seats.find((s) => s.id === 'r1c4')!, 'stage_side')).toBe('manual')
    // 门向翻转、加过道后仍保留
    const next = recalcSeats(seats, { ...layout, doorSide: 'left', aisles: [1] })
    const seat = next.find((s) => s.id === 'r1c4')!
    expect(seat.tags).toContain('stage_side')
    expect(seat.manualTags).toEqual(['stage_side'])
    expect(tagSource(seat, 'stage_side')).toBe('manual')
  })

  it('手动补 aisle 后即使撤掉过道标记仍在（手动优先保留），取消手动后自动 aisle 恢复其本来面目', () => {
    let seats = buildSeats({ ...layout, aisles: [] })
    // r1c0 在无过道时不是自动 aisle；手动补 aisle
    seats = toggleManualTag({ ...layout, aisles: [] }, seats, 'r1c0', 'aisle')
    expect(seats.find((s) => s.id === 'r1c0')!.tags).toContain('aisle')
    // 重算（布局仍无过道）后手动 aisle 保留
    const recalculated = recalcSeats(seats, { ...layout, aisles: [] })
    expect(recalculated.find((s) => s.id === 'r1c0')!.tags).toContain('aisle')
    // 取消手动补标
    const undone = toggleManualTag({ ...layout, aisles: [] }, recalculated, 'r1c0', 'aisle')
    expect(undone.find((s) => s.id === 'r1c0')!.tags).not.toContain('aisle')
    expect(undone.find((s) => s.id === 'r1c0')!.manualTags).toBeUndefined()
  })

  it('取消自动 aisle 座位的「手动补标」后，自动 aisle 依然存在且来源恢复为 auto', () => {
    // 默认布局过道在 c2|c3：r1c2 本来就是自动 aisle
    let seats = buildSeats(layout)
    expect(seats.find((s) => s.id === 'r1c2')!.tags).toContain('aisle')
    seats = toggleManualTag(layout, seats, 'r1c2', 'aisle') // 再手动标一次
    expect(tagSource(seats.find((s) => s.id === 'r1c2')!, 'aisle')).toBe('manual')
    seats = toggleManualTag(layout, seats, 'r1c2', 'aisle') // 取消手动
    expect(seats.find((s) => s.id === 'r1c2')!.tags).toContain('aisle') // 自动标记仍在
    expect(tagSource(seats.find((s) => s.id === 'r1c2')!, 'aisle')).toBe('auto')
  })

  it('扩列时旧座位的手动补标按行列位置沿用', () => {
    let seats = buildSeats(layout)
    seats = toggleManualTag(layout, seats, 'r0c0', 'stage_side')
    const next = buildSeats({ ...layout, cols: 8 }, seats)
    expect(next.find((s) => s.id === 'r0c0')!.manualTags).toEqual(['stage_side'])
  })
})

describe('布局变更对硬约束的影响', () => {
  it('门向翻转不影响任何硬约束范围（door/window 不参与硬约束）', () => {
    const seats = buildSeats(layout)
    const students = [
      student({ name: '近', vision: 'front_required' }),
      student({ name: '动', special: ['mobility'] }),
    ]
    const impacts = layoutConstraintImpacts(
      layout,
      { ...layout, doorSide: 'left' },
      seats,
      buildSeats({ ...layout, doorSide: 'left' }),
      students,
      1,
    )
    expect(impacts).toHaveLength(0)
  })

  it('加过道会扩大行动不便学生的可选座位，并列入影响名单与原因', () => {
    const noAisle: LayoutConfig = { ...layout, aisles: [] }
    const mob = student({ name: '行动', special: ['mobility'] })
    const before = accessibleSeatIds(noAisle, buildSeats(noAisle)).size // 仅两边列 = 3×2 = 6
    expect(before).toBe(6)
    const impacts = layoutConstraintImpacts(
      noAisle,
      { ...noAisle, aisles: [2] },
      buildSeats(noAisle),
      buildSeats({ ...noAisle, aisles: [2] }),
      [mob],
      1,
    )
    expect(impacts).toHaveLength(1)
    expect(impacts[0].student.name).toBe('行动')
    expect(impacts[0].reasons.join(' ')).toContain('行动不便需靠过道')
    expect(impacts[0].reasons.join(' ')).toContain('6 个变为 12 个')
  })

  it('减行影响近视与听力学生，且固定座位落在被删排时提示将清除', () => {
    const near = student({ name: '近视', vision: 'front_required' })
    const hear = student({ name: '听力', special: ['hearing'] })
    const fixed = student({ name: '固定', fixedSeatId: 'r2c0' })
    const tall: LayoutConfig = { ...layout, rows: 4 }
    // frontRows=3：4 行时前排 3 排（18 座）；缩成 2 行后前排在 min(3,2)=2 排（12 座）。
    // 听力前一半由前 2 排（12 座）变为前 1 排（6 座）；固定在 r2 的座位随第 3 排删除。
    const impacts = layoutConstraintImpacts(tall, { ...tall, rows: 2 }, buildSeats(tall), buildSeats({ ...tall, rows: 2 }), [
      near,
      hear,
      fixed,
    ], 3)
    const names = impacts.map((i) => i.student.name)
    expect(names).toContain('近视')
    expect(names).toContain('听力')
    expect(impacts.find((i) => i.student.name === '近视')!.reasons.join(' ')).toContain('18 个变为 12 个')
    expect(impacts.find((i) => i.student.name === '固定')!.reasons.join(' ')).toContain('固定座位在新布局中已不存在')
  })

  it('列数变化影响需中间列的学生', () => {
    const mid = student({ name: '中间', vision: 'middle_required' })
    const impacts = layoutConstraintImpacts(layout, { ...layout, cols: 8 }, buildSeats(layout), buildSeats({ ...layout, cols: 8 }), [mid], 1)
    expect(impacts.map((i) => i.student.name)).toContain('中间')
  })

  it('自动标记集合与合并结果一致（无手动补标时 tags === autoTagsFor）', () => {
    for (const l of [layout, { ...layout, doorSide: 'left' as const, aisles: [] }, { ...layout, rows: 5, cols: 8 }]) {
      for (const s of buildSeats(l)) {
        expect(s.tags.sort()).toEqual(autoTagsFor(l, s.row, s.col).sort())
      }
    }
  })

  it('读入旧数据：门向改过却没重算的脱节标记被按布局修正', () => {
    // layout 声明门在左，但旧 seats 仍按门在右标注（脱节数据）
    const left: LayoutConfig = { ...layout, doorSide: 'left' }
    const stale = buildSeats(layout).map((s) => ({ ...s }))
    expect(stale.find((s) => s.id === 'r0c0')!.tags).toContain('window')
    const fixed = normalizeSeats(left, stale)
    expect(fixed.find((s) => s.id === 'r0c0')!.tags).toContain('door')
    expect(fixed.find((s) => s.id === 'r0c0')!.tags).not.toContain('window')
    expect(fixed.find((s) => s.id === 'r0c5')!.tags).toContain('window')
  })

  it('读入旧数据：混在 tags 里的 stage_side 迁移为 manualTags，并在重算后保留', () => {
    const stale = buildSeats(layout).map((s) =>
      s.id === 'r1c1' ? { ...s, tags: [...s.tags, 'stage_side'] as SeatTag[] } : s,
    )
    const fixed = normalizeSeats(layout, stale)
    const seat = fixed.find((s) => s.id === 'r1c1')!
    expect(seat.manualTags).toEqual(['stage_side'])
    expect(seat.tags).toContain('stage_side')
    // 再重算一次（门向变了）仍保留
    expect(recalcSeats(fixed, { ...layout, doorSide: 'left' }).find((s) => s.id === 'r1c1')!.manualTags).toEqual([
      'stage_side',
    ])
  })

  it('读入旧数据：尺寸外座位丢弃，结构与当前布局一致', () => {
    const big = buildSeats({ ...layout, rows: 8, cols: 8 })
    const fixed = normalizeSeats(layout, big)
    expect(fixed).toHaveLength(18)
    expect(fixed.every((s) => s.row < 3 && s.col < 6)).toBe(true)
  })
})
