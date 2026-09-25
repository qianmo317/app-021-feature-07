import { describe, expect, it } from 'vitest'
import {
  AUTO_TAGS,
  buildSeatIndex,
  buildSeats,
  middleColSet,
  positionScore,
  tagSourceOf,
  withSeatManualTag,
} from '../src/lib/layout'
import type { LayoutConfig } from '../src/types'

const layout: LayoutConfig = { rows: 3, cols: 6, aisles: [2], mode: 'rows', doorSide: 'right' }

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

  it('布局重算：换门方向后 door/window 标记互换', () => {
    const seats = buildSeats(layout)
    const flipped: LayoutConfig = { ...layout, doorSide: 'left' }
    const rebuilt = buildSeats(flipped, seats)
    const r0c0 = rebuilt.find((s) => s.id === 'r0c0')!
    expect(r0c0.tags).toContain('door')
    expect(r0c0.tags).not.toContain('window')
    const r0c5 = rebuilt.find((s) => s.id === 'r0c5')!
    expect(r0c5.tags).toContain('window')
    expect(r0c5.tags).not.toContain('door')
  })

  it('布局重算：新增过道后紧邻座位立即带上 aisle，移除过道后 aisle 消失', () => {
    const noAisle: LayoutConfig = { rows: 3, cols: 4, aisles: [], mode: 'rows', doorSide: 'right' }
    let seats = buildSeats(noAisle)
    expect(seats.every((s) => !s.tags.includes('aisle'))).toBe(true)
    const withAisle: LayoutConfig = { ...noAisle, aisles: [1] }
    seats = buildSeats(withAisle, seats)
    expect(seats.find((s) => s.id === 'r1c1')!.tags).toContain('aisle')
    expect(seats.find((s) => s.id === 'r1c2')!.tags).toContain('aisle')
    expect(seats.find((s) => s.id === 'r1c0')!.tags).not.toContain('aisle')
    // 过道再移走，aisle 自动标记应消失
    seats = buildSeats(noAisle, seats)
    expect(seats.find((s) => s.id === 'r1c1')!.tags).not.toContain('aisle')
  })

  it('布局重算：行数变化后 front/middle/back 重新划分', () => {
    const seats = buildSeats(layout) // 3 排：front / middle / back
    const tall: LayoutConfig = { ...layout, rows: 6 }
    const rebuilt = buildSeats(tall, seats)
    // 前 2 排 front（ceil(6/3)=2），原来 r2 是 middle 现在仍是 middle
    expect(rebuilt.find((s) => s.id === 'r0c0')!.tags).toContain('front')
    expect(rebuilt.find((s) => s.id === 'r1c0')!.tags).toContain('front')
    expect(rebuilt.find((s) => s.id === 'r2c0')!.tags).toContain('middle')
    expect(rebuilt.find((s) => s.id === 'r5c0')!.tags).toContain('back')
  })

  it('手工补标：stage_side 可补，重算后保留并标来源为手工', () => {
    let seats = buildSeats(layout)
    const target = seats.find((s) => s.id === 'r2c4')!
    const tagged = withSeatManualTag(target, layout, 'stage_side', true)
    expect(tagged.tags).toContain('stage_side')
    expect(tagged.manualTags).toContain('stage_side')
    expect(tagSourceOf(tagged, 'stage_side')).toBe('manual')
    seats = seats.map((s) => (s.id === target.id ? tagged : s))
    // 门方向翻转 + 过道调整后，手工标记仍在
    const rebuilt = buildSeats({ ...layout, doorSide: 'left', aisles: [0] }, seats)
    const after = rebuilt.find((s) => s.id === 'r2c4')!
    expect(after.tags).toContain('stage_side')
    expect(after.manualTags).toContain('stage_side')
    expect(tagSourceOf(after, 'stage_side')).toBe('manual')
    // 自动标记也被刷新（r2c4 新过道 [0] 下不是 aisle）
    expect(after.tags).not.toContain('aisle')
  })

  it('手工补标：给自动已有的 aisle 再补标，来源记为手工；取消后恢复自动', () => {
    let seat = buildSeats(layout).find((s) => s.id === 'r1c2')! // 自动 aisle
    expect(tagSourceOf(seat, 'aisle')).toBe('auto')
    seat = withSeatManualTag(seat, layout, 'aisle', true)
    expect(tagSourceOf(seat, 'aisle')).toBe('manual')
    // 过道移走后，自动 aisle 没了，但手工补标仍让它保留 aisle
    const noAisle = { ...layout, aisles: [] }
    const rebuiltSeat = buildSeats(noAisle, [seat]).find((s) => s.id === seat.id)!
    expect(rebuiltSeat.tags).toContain('aisle')
    expect(tagSourceOf(rebuiltSeat, 'aisle')).toBe('manual')
    // 取消手工，aisle 彻底消失
    const cleared = withSeatManualTag(rebuiltSeat, noAisle, 'aisle', false)
    expect(cleared.tags).not.toContain('aisle')
    expect(cleared.manualTags ?? []).not.toContain('aisle')
  })

  it('buildSeats 无补标时不写 manualTags，与旧数据兼容', () => {
    const seats = buildSeats(layout)
    expect(seats.every((s) => s.manualTags === undefined)).toBe(true)
    expect(AUTO_TAGS).toEqual(['front', 'middle', 'back', 'aisle', 'window', 'door'])
  })
})
