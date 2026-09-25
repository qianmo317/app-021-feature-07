import type { ClassEntity, SeatTag } from '../types'

// ============ 按标记查座位：点一个标记 → 高亮全部带该标记的座位，并显示剩余空位 ============

export interface TagFilterOption {
  tag: SeatTag
  label: string
  title?: string
}

export const TAG_FILTER_OPTIONS: TagFilterOption[] = [
  { tag: 'front', label: '前排' },
  { tag: 'middle', label: '中排' },
  { tag: 'back', label: '后排' },
  { tag: 'aisle', label: '靠过道' },
  { tag: 'window', label: '靠窗' },
  { tag: 'door', label: '靠门' },
  { tag: 'stage_side', label: '讲台侧', title: '讲台侧为老师手工补标' },
]

interface TagFilterBarProps {
  cls: ClassEntity
  active: SeatTag | null
  onSelect: (tag: SeatTag | null) => void
  // 本周已占座位（轮换页按周传入；配置页不传，全部视为空位）
  occupiedIds?: Set<string>
  testid?: string
}

export function TagFilterBar({ cls, active, onSelect, occupiedIds, testid = 'tag-filter' }: TagFilterBarProps) {
  const countOf = (tag: SeatTag) => {
    const matched = cls.seats.filter((s) => s.tags.includes(tag))
    const empty = occupiedIds ? matched.filter((s) => !occupiedIds.has(s.id)).length : matched.length
    return { total: matched.length, empty }
  }
  const activeCount = active ? countOf(active) : null

  return (
    <div className="tag-filter" data-testid={testid}>
      <span className="tag-filter-label">按标记查座位：</span>
      {TAG_FILTER_OPTIONS.map(({ tag, label, title }) => {
        const { total, empty } = countOf(tag)
        if (total === 0) return null
        return (
          <button
            key={tag}
            type="button"
            className={`tag-chip ${active === tag ? 'tag-chip-active' : ''}`}
            data-testid={`tag-chip-${tag}`}
            data-active={active === tag}
            title={title ?? `${label}座位 ${total} 个，剩余空位 ${empty} 个`}
            aria-pressed={active === tag}
            onClick={() => onSelect(active === tag ? null : tag)}
          >
            {label}
            <span className="tag-chip-count" data-testid={`tag-chip-empty-${tag}`}>
              空位 {empty}/{total}
            </span>
          </button>
        )
      })}
      {active && activeCount && (
        <span className="tag-filter-summary" data-testid="tag-filter-summary">
          已高亮全部「{TAG_FILTER_OPTIONS.find((o) => o.tag === active)?.label}」座位：共 {activeCount.total} 个，还剩{' '}
          <b>{activeCount.empty}</b> 个空位
          <button type="button" className="link-btn" data-testid="tag-filter-clear" onClick={() => onSelect(null)}>
            取消高亮
          </button>
        </span>
      )}
    </div>
  )
}
