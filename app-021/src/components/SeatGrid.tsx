import type { Assignment, ClassEntity, Seat, SeatTag, Student } from '../types'
import { useMemo, useRef, useState } from 'react'
import { Glasses, Focus, Ear, Accessibility, Pin, GraduationCap } from 'lucide-react'
import { TAG_LABELS, tagSourceOf } from '../lib/layout'

// ============ 座位图（共用组件）：Rotations 拖拽模式 / Print 打印模式 ============

interface SeatGridProps {
  cls: ClassEntity
  assignment?: Assignment
  draggable?: boolean
  onSwapPreview?: (from: string, to: string | null) => void
  onDropSwap?: (from: string, to: string) => void
  compact?: boolean
  /** 按标记查座位：显示筛选条，点亮该标记的全部座位 */
  tagFilter?: boolean
  /** 座位可点击（Setup 页用于手工补标） */
  onSeatClick?: (seat: Seat) => void
}

// 可筛选/高亮的标记（前中后排算一组，组号是内部标记不暴露）
const FILTER_TAGS: SeatTag[] = ['front', 'middle', 'back', 'aisle', 'window', 'door', 'stage_side']

interface GridMeta {
  template: string
  vCol: (col: number) => number
  spacerCols: number[]
}

function gridMeta(cls: ClassEntity): GridMeta {
  const { cols, aisles } = cls.layout
  const spacerCols = aisles.map((a) => a + 2) // 1-based 网格线位置
  const parts: string[] = []
  for (let c = 0; c < cols; c++) {
    if (aisles.includes(c - 1)) parts.push('14px')
    parts.push(c === cols - 1 ? '1.1fr' : '1fr')
  }
  return {
    template: parts.join(' '),
    vCol: (col: number) => col + 1 + aisles.filter((a) => a < col).length,
    spacerCols,
  }
}

export function SeatGrid({
  cls,
  assignment,
  draggable,
  onSwapPreview,
  onDropSwap,
  compact,
  tagFilter,
  onSeatClick,
}: SeatGridProps) {
  const meta = useMemo(() => gridMeta(cls), [cls])
  const studentById = useMemo(() => new Map(cls.students.map((s) => [s.id, s])), [cls.students])
  const [activeTag, setActiveTag] = useState<SeatTag | null>(null)
  // 拖拽源座位：dragover 阶段 dataTransfer.getData() 受 protected mode 限制（返回空串），
  // 必须用组件内 ref 记录来源，否则实时预览永远不出现
  const dragFrom = useRef<string | null>(null)
  const map = assignment?.map ?? {}
  const occupantOf = (seat: Seat): Student | undefined => {
    const id = map[seat.id]
    return id ? studentById.get(id) : undefined
  }

  // 各标记的座位数 / 剩余空位数（按当前周占用计算；Setup 无 assignment 即全部为空）
  const tagStats = useMemo(() => {
    const stats = new Map<SeatTag, { total: number; empty: number }>()
    for (const t of FILTER_TAGS) stats.set(t, { total: 0, empty: 0 })
    for (const seat of cls.seats) {
      const occupied = !!map[seat.id]
      for (const t of FILTER_TAGS) {
        if (!seat.tags.includes(t)) continue
        const s = stats.get(t)!
        s.total++
        if (!occupied) s.empty++
      }
    }
    return stats
  }, [cls.seats, map])

  const handleDragStart = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    dragFrom.current = seat.id
    e.dataTransfer.setData('text/plain', seat.id)
    e.dataTransfer.effectAllowed = 'move'
    onSwapPreview?.(seat.id, null)
  }

  const handleDragOver = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    const from = dragFrom.current
    if (!from || from === seat.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    onSwapPreview?.(from, seat.id)
  }

  const handleDrop = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    e.preventDefault()
    const from = dragFrom.current ?? e.dataTransfer.getData('text/plain')
    dragFrom.current = null
    onSwapPreview?.(from || '', null)
    if (!from || from === seat.id) return
    onDropSwap?.(from, seat.id)
  }

  const { rows } = cls.layout

  return (
    <div className={compact ? 'seatmap seatmap-print' : 'seatmap'} data-testid="seat-grid">
      {tagFilter && (
        <div className="tag-filter" data-testid="tag-filter">
          <span className="tag-filter-label">按标记查座位：</span>
          {FILTER_TAGS.map((t) => {
            const s = tagStats.get(t)!
            return (
              <button
                key={t}
                type="button"
                className={`tag-chip ${activeTag === t ? 'tag-chip-active' : ''}`}
                data-testid={`tag-chip-${t}`}
                aria-pressed={activeTag === t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                title={`共 ${s.total} 个，空位 ${s.empty} 个`}
              >
                {TAG_LABELS[t]}
                <em className="tag-chip-count">{s.empty}</em>
              </button>
            )
          })}
          {activeTag && (
            <span className="tag-filter-hint" data-testid="tag-filter-hint">
              「{TAG_LABELS[activeTag]}」共 {tagStats.get(activeTag)!.total} 个座位，还剩{' '}
              <b>{tagStats.get(activeTag)!.empty}</b> 个空位（再次点击取消高亮）
            </span>
          )}
        </div>
      )}
      <div className="stage-bar" aria-label="讲台方向">
        <span>▲ 讲台</span>
      </div>
      <div className="seat-canvas" style={{ gridTemplateColumns: meta.template, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {meta.spacerCols.map((c) => (
          <div key={`sp-${c}`} className="aisle-spacer" style={{ gridColumn: c, gridRow: `1 / span ${rows}` }} />
        ))}
        {cls.seats.map((seat) => {
          const st = occupantOf(seat)
          const tags = seat.tags
          const dimmed = !!activeTag && !tags.includes(activeTag)
          const cls2 = [
            'seat',
            st ? 'seat-occupied' : 'seat-empty',
            tags.includes('front') ? 'tag-front' : tags.includes('back') ? 'tag-back' : 'tag-middle',
            tags.includes('window') ? 'tag-window' : '',
            tags.includes('door') ? 'tag-door' : '',
            tags.includes('aisle') ? 'tag-aisle' : '',
            tags.includes('stage_side') ? 'tag-stage' : '',
            activeTag && tags.includes(activeTag) ? 'seat-highlight' : '',
            dimmed ? 'seat-dimmed' : '',
            onSeatClick ? 'seat-clickable' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const manualMarks = tags.filter((t) => tagSourceOf(seat, t) === 'manual')
          const titleLines = [
            `第 ${seat.row + 1} 排第 ${seat.col + 1} 列`,
            st ? `${st.name}${st.heightCm ? ` · ${st.heightCm}cm` : ''}` : '空位',
            tags.length ? `标记：${tags.map((t) => TAG_LABELS[t]).join('、')}` : '',
            manualMarks.length ? `手工补标：${manualMarks.map((t) => TAG_LABELS[t]).join('、')}` : '',
            onSeatClick ? '点击可手工补标' : '',
          ].filter(Boolean)
          return (
            <div
              key={seat.id}
              className={cls2}
              style={{ gridColumn: meta.vCol(seat.col), gridRow: seat.row + 1 }}
              data-seat-id={seat.id}
              data-row={seat.row}
              data-col={seat.col}
              data-student={st?.name ?? ''}
              data-tags={tags.join(' ')}
              draggable={draggable && !!st}
              onDragStart={(e) => handleDragStart(e, seat)}
              onDragEnter={(e) => handleDragOver(e, seat)}
              onDragOver={(e) => handleDragOver(e, seat)}
              onDrop={(e) => handleDrop(e, seat)}
              onClick={() => onSeatClick?.(seat)}
              onDragLeave={(e) => {
                // 移到本座位的子元素（姓名/徽章）上时 relatedTarget 仍在座位内，不算离开
                const next = e.relatedTarget as Node | null
                if (next && e.currentTarget.contains(next)) return
                onSwapPreview?.('', null)
              }}
              title={titleLines.join('\n')}
            >
              {manualMarks.length > 0 && (
                <span className="seat-manual-dot" title={`手工补标：${manualMarks.map((t) => TAG_LABELS[t]).join('、')}`}>
                  ✎
                </span>
              )}
              {st ? (
                <>
                  <span className="seat-name">{st.name}</span>
                  <span className="seat-badges">
                    {st.vision === 'front_required' && (
                      <em className="badge badge-vision-front" title="近视·需前排">
                        <Glasses size={compact ? 10 : 12} /> 前排
                      </em>
                    )}
                    {st.vision === 'middle_required' && (
                      <em className="badge badge-vision-middle" title="视力需中间">
                        <Focus size={compact ? 10 : 12} /> 中间
                      </em>
                    )}
                    {st.special?.includes('hearing') && (
                      <em className="badge badge-hearing" title="听力需前排">
                        <Ear size={compact ? 10 : 12} /> 听力
                      </em>
                    )}
                    {st.special?.includes('mobility') && (
                      <em className="badge badge-mobility" title="行动不便需靠过道">
                        <Accessibility size={compact ? 10 : 12} /> 过道
                      </em>
                    )}
                    {st.tier && (
                      <em className="badge badge-tier" title={`学习分层 T${st.tier}`}>
                        <GraduationCap size={compact ? 10 : 12} /> T{st.tier}
                      </em>
                    )}
                    {st.fixedSeatId === seat.id && (
                      <em className="badge badge-fixed" title="固定座位">
                        <Pin size={compact ? 10 : 12} />
                      </em>
                    )}
                  </span>
                </>
              ) : (
                <span className="seat-name seat-name-empty">空</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="seatmap-footer">
        <span>
          第 1 排在最上方（讲台侧）· 左侧为{cls.layout.doorSide === 'right' ? '靠窗' : '靠门'}侧 · ✎ 表示老师手工补标
        </span>
      </div>
    </div>
  )
}
