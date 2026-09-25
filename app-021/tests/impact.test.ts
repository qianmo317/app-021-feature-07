import { describe, expect, it } from 'vitest'
import { hardConstraintImpact } from '../src/lib/fairness'
import { buildSeats } from '../src/lib/layout'
import type { Assignment, ClassEntity, LayoutConfig, Student } from '../src/types'

function student(p: Partial<Student> & { id: string; name: string }): Student {
  return { vision: 'none', mustApartFrom: [], ...p }
}

function clsWith(layout: LayoutConfig, students: Student[], maps: Record<string, string>[] = []): ClassEntity {
  const seats = buildSeats(layout)
  const assignments: Assignment[] = maps.map((map, i) => ({
    week: i + 1,
    map,
    score: { fairness: 0, repeats: 0 },
  }))
  return {
    id: 'c1',
    name: '影响测试班',
    createdAt: 0,
    updatedAt: 0,
    layout,
    seats,
    students,
    constraints: { frontRows: 3, heightRule: true, mixTiers: true },
    weeks: maps.length,
    seed: 1,
    assignments,
  }
}

const BASE: LayoutConfig = { rows: 5, cols: 8, aisles: [3], mode: 'rows', doorSide: 'right' }

describe('布局变更硬约束影响评估', () => {
  it('仅翻转门方向：不影响任何硬约束', () => {
    const cls = clsWith(BASE, [
      student({ id: 's1', name: '甲', special: ['mobility'] }),
      student({ id: 's2', name: '乙', special: ['hearing'] }),
    ])
    const layout = { ...BASE, doorSide: 'left' as const }
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    expect(impact.changedCount).toBe(0)
    expect(impact.worseCount).toBe(0)
  })

  it('移除过道：原靠过道的行动不便学生变为违反', () => {
    const cls = clsWith(
      BASE,
      [student({ id: 's1', name: '轮椅同学', special: ['mobility'] })],
      [{ r2c3: 's1' }], // aisle[3] 时 c3 靠过道 → 满足
    )
    const layout = { ...BASE, aisles: [] }
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    expect(impact.worseCount).toBe(1)
    expect(impact.studentNames).toContain('轮椅同学')
    const e = impact.entries.find((x) => x.code === 'aisle')!
    expect(e.worse).toBe(true)
    expect(e.weeks).toEqual([1])
  })

  it('新增过道：原本违反的行动不便学生转为满足（改善也列出）', () => {
    const noAisle = { ...BASE, aisles: [] }
    const cls = clsWith(
      noAisle,
      [student({ id: 's1', name: '拐杖同学', special: ['mobility'] })],
      [{ r2c3: 's1' }], // 无过道、c3 非边列 → 违反
    )
    const layout = { ...BASE, aisles: [3] }
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    expect(impact.worseCount).toBe(0)
    const e = impact.entries.find((x) => x.code === 'aisle')!
    expect(e.worse).toBe(false)
    expect(impact.studentNames).toContain('拐杖同学')
  })

  it('行数缩小：听力学生被挤出前一半排', () => {
    const cls = clsWith(
      BASE, // 5 排，前一半 = 3 排（0/1/2）
      [student({ id: 's1', name: '听力同学', special: ['hearing'] })],
      [{ r2c1: 's1' }],
    )
    const layout = { ...BASE, rows: 4 } // 前一半 = 2 排（0/1），r2 违反
    const seats = buildSeats(layout, cls.seats)
    const impact = hardConstraintImpact(cls, layout, seats)
    expect(impact.entries.some((e) => e.code === 'hearing' && e.worse)).toBe(true)
  })

  it('列数缩小：需中间列的学生落到边列', () => {
    const cls = clsWith(
      BASE, // 8 列中间列 {3,4}
      [student({ id: 's1', name: '视力同学', vision: 'middle_required' })],
      [{ r1c4: 's1' }],
    )
    const layout = { ...BASE, cols: 6 } // 中间列 {2,3}，c4 违反
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    expect(impact.entries.some((e) => e.code === 'middle' && e.worse)).toBe(true)
  })

  it('缩小行数：固定座位指向被删座位时列为恶化', () => {
    const cls = clsWith(BASE, [student({ id: 's1', name: '固定同学', fixedSeatId: 'r4c0' })])
    const layout = { ...BASE, rows: 4 }
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    expect(impact.removedSeats).toBe(8)
    expect(impact.entries.some((e) => e.code === 'fixed' && e.worse)).toBe(true)
  })

  it('多周变化按学生+约束合并周次', () => {
    const cls = clsWith(
      BASE,
      [student({ id: 's1', name: '甲', special: ['mobility'] })],
      [{ r2c3: 's1' }, { r0c3: 's1' }],
    )
    const layout = { ...BASE, aisles: [] }
    const impact = hardConstraintImpact(cls, layout, buildSeats(layout, cls.seats))
    const e = impact.entries.find((x) => x.studentId === 's1' && x.code === 'aisle')!
    expect(e.weeks).toEqual([1, 2])
  })
})
