import { useMemo, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import type { ClassEntity, LayoutConfig, ManualSeatTag, Seat, SeatTag, Student } from '../types'
import {
  layoutConstraintImpacts,
  recalcSeats,
  specialLabel,
  tagSource,
  toggleManualTag,
  visionLabel,
  type ConstraintImpact,
} from '../lib/layout'
import { validateClass } from '../lib/validate'
import { uid } from '../lib/id'
import { SeatGrid } from '../components/SeatGrid'
import { TagFilterBar } from '../components/TagFilterBar'
import {
  AlertTriangle,
  ArrowLeft,
  Eraser,
  Rows3,
  Settings2,
  Sparkles,
  Table2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

const MANUAL_TAG_LABEL: Record<ManualSeatTag, string> = {
  aisle: '靠过道',
  window: '靠窗',
  door: '靠门',
  stage_side: '讲台侧',
}

export function Setup({ classId }: { classId: string }) {
  const { getClass, updateSetup } = useStore()
  const cls = getClass(classId)
  const [editing, setEditing] = useState<Student | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  // 最近一次布局改动对硬约束的影响（老师确认后展示，直到手动关闭）
  const [impacts, setImpacts] = useState<ConstraintImpact[] | null>(null)
  const [tagSeatId, setTagSeatId] = useState<string | null>(null)
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)

  if (!cls) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }

  const errors = validateClass(cls)
  const hasPlan = cls.assignments.length > 0

  const save = (next: ClassEntity, configChanged = false, newImpacts?: ConstraintImpact[]) => {
    if (configChanged && hasPlan) {
      const who =
        newImpacts && newImpacts.length > 0
          ? `\n\n以下 ${newImpacts.length} 名学生的硬约束座位范围随之变化：${newImpacts
              .map((i) => i.student.name)
              .join('、')}`
          : ''
      const ok = window.confirm(`配置已变更，将清空已生成的轮换结果。继续？${who}`)
      if (!ok) return
    }
    updateSetup(next, configChanged)
    if (newImpacts) setImpacts(newImpacts)
  }

  return (
    <div className="page">
      <div className="page-head">
        <Link className="back" to="/">
          <ArrowLeft size={16} /> 班级列表
        </Link>
        <h1>{cls.name} · 配置</h1>
        <nav className="tabs">
          <span className="tab tab-active">座位与学生</span>
          <Link className="tab" to={`/class/${cls.id}/rotations`}>
            轮换结果
          </Link>
          <Link className="tab" to={`/class/${cls.id}/fairness`}>
            公平性报告
          </Link>
          <Link className="tab" to={`/class/${cls.id}/print`}>
            打印
          </Link>
        </nav>
      </div>

      {errors.length > 0 && (
        <div className="card error-card" data-testid="validation-errors">
          <h3>
            <AlertTriangle size={16} /> 配置问题（生成前需解决）
          </h3>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {impacts && (
        <div className="card impact-card" data-testid="layout-impacts">
          <h3>
            <AlertTriangle size={16} /> 布局已重算：座位标记全部更新
            <button
              type="button"
              className="link-btn impact-close"
              data-testid="layout-impacts-close"
              onClick={() => setImpacts(null)}
            >
              <X size={14} /> 知道了
            </button>
          </h3>
          {impacts.length === 0 ? (
            <p className="muted small">本次改动不影响任何学生的硬约束座位范围。</p>
          ) : (
            <>
              <p className="muted small">
                以下 <b>{impacts.length}</b> 名学生的硬约束可选座位发生变化（已生成的轮换结果已清空，需重新生成）：
              </p>
              <ul className="impact-list">
                {impacts.map(({ student, reasons }) => (
                  <li key={student.id} data-testid="impact-student" data-name={student.name}>
                    <b>{student.name}</b>
                    <span className="muted small">：{reasons.join('；')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <LayoutEditor
        cls={cls}
        onSave={save}
        selectedSeatId={selectedSeatId}
        onEditSeatTags={(seat) => {
          setSelectedSeatId(seat.id)
          setTagSeatId(seat.id)
        }}
      />
      <ConstraintEditor cls={cls} onSave={save} />
      <StudentTable cls={cls} onSave={save} onEdit={(s) => setEditing(s)} onBulk={() => setBulkOpen(true)} />

      {tagSeatId && (
        <SeatTagModal
          // 每次手动补标都会保存并产生新的 cls，这里按 id 取最新座位（弹窗可连续勾选）
          seat={cls.seats.find((s) => s.id === tagSeatId)!}
          onClose={() => {
            setTagSeatId(null)
            setSelectedSeatId(null)
          }}
          onToggle={(tag) => {
            const seats = toggleManualTag(cls.layout, cls.seats, tagSeatId, tag)
            save({ ...cls, seats }, true)
          }}
        />
      )}

      {editing && (
        <StudentModal
          cls={cls}
          student={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            const students = editing.id
              ? cls.students.map((s) => (s.id === editing.id ? next : s))
              : [...cls.students, next]
            save({ ...cls, students }, true)
            setEditing(null)
          }}
          onDelete={
            editing.id
              ? () => {
                  save(
                    {
                      ...cls,
                      students: cls.students
                        .filter((s) => s.id !== editing.id)
                        .map((s) => ({
                          ...s,
                          mustApartFrom: s.mustApartFrom.filter((id) => id !== editing.id),
                        })),
                    },
                    true,
                  )
                  setEditing(null)
                }
              : undefined
          }
        />
      )}
      {bulkOpen && (
        <BulkModal
          cls={cls}
          onClose={() => setBulkOpen(false)}
          onAdd={(list) => {
            save({ ...cls, students: [...cls.students, ...list] }, true)
            setBulkOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ---------- 座位布局 ----------
function LayoutEditor({
  cls,
  onSave,
  onEditSeatTags,
  selectedSeatId,
}: {
  cls: ClassEntity
  onSave: (c: ClassEntity, changed: boolean, impacts?: ConstraintImpact[]) => void
  onEditSeatTags: (seat: Seat) => void
  selectedSeatId: string | null
}) {
  const [highlight, setHighlight] = useState<SeatTag | null>(null)

  const patch = (p: Partial<LayoutConfig>) => {
    const oldLayout = cls.layout
    const layout = { ...oldLayout, ...p }
    // 输入框重输相同值时不触发「清空轮换/影响提示」
    if (JSON.stringify(layout) === JSON.stringify(oldLayout)) return
    // 布局一改：全部座位的 front/middle/back 与 aisle/window/door 按新布局重算，
    // 老师手动补标（manualTags）按行列位置保留；同时算出哪些学生的硬约束受影响
    const seats = recalcSeats(cls.seats, layout)
    const impacts = layoutConstraintImpacts(
      oldLayout,
      layout,
      cls.seats,
      seats,
      cls.students,
      cls.constraints.frontRows,
    )
    // 失效的固定座位引用清除
    const seatIds = new Set(seats.map((s) => s.id))
    const students = cls.students.map((s) =>
      s.fixedSeatId && !seatIds.has(s.fixedSeatId) ? { ...s, fixedSeatId: undefined } : s,
    )
    onSave({ ...cls, layout, seats, students }, true, impacts)
  }
  return (
    <section className="card" data-testid="layout-editor">
      <h2>
        <Table2 size={18} /> 座位布局
      </h2>
      <div className="form-grid">
        <label>
          行数（排）
          <input
            type="number"
            min={2}
            max={12}
            value={cls.layout.rows}
            onChange={(e) => patch({ rows: clamp(Number(e.target.value), 2, 12) })}
          />
        </label>
        <label>
          列数
          <input
            type="number"
            min={2}
            max={12}
            value={cls.layout.cols}
            onChange={(e) => patch({ cols: clamp(Number(e.target.value), 2, 12) })}
          />
        </label>
        <label>
          门的位置
          <select value={cls.layout.doorSide} onChange={(e) => patch({ doorSide: e.target.value as 'left' | 'right' })}>
            <option value="right">右（门在右，窗在左）</option>
            <option value="left">左（门在左，窗在右）</option>
          </select>
        </label>
        <label>
          布局模式
          <select value={cls.layout.mode} onChange={(e) => patch({ mode: e.target.value as 'rows' | 'groups' })}>
            <option value="rows">行列排座（同桌 = 左右相邻）</option>
            <option value="groups">小组围坐（4 人一组，同组互为同桌）</option>
          </select>
        </label>
      </div>
      {cls.layout.mode === 'rows' && (
        <div className="aisle-row">
          <Rows3 size={16} />
          <span className="muted">过道位置（勾选表示该两列之间是过道）：</span>
          {Array.from({ length: cls.layout.cols - 1 }, (_, i) => (
            <label key={i} className="checkbox">
              <input
                type="checkbox"
                checked={cls.layout.aisles.includes(i)}
                onChange={(e) => {
                  const aisles = e.target.checked
                    ? [...cls.layout.aisles, i].sort((a, b) => a - b)
                    : cls.layout.aisles.filter((a) => a !== i)
                  patch({ aisles })
                }}
              />
              {i + 1} | {i + 2} 列
            </label>
          ))}
        </div>
      )}
      <div className="setup-preview">
        <TagFilterBar cls={cls} active={highlight} onSelect={setHighlight} testid="setup-tag-filter" />
        <SeatGrid
          cls={cls}
          compact
          highlightTag={highlight}
          selectable
          selectedSeatId={selectedSeatId}
          onSeatClick={(seat) => {
            onEditSeatTags(seat)
          }}
        />
        <div className="muted small">
          自动标注：<b>前排/中排/后排</b>（按 1/3 行）、<b>靠窗</b>、<b>靠门</b>、<b>靠过道</b>，布局一改即全部重算；
          ✦ 为老师手动补标（如「讲台侧」），重算时保留并在座位角标出来源。
          <b>点击任意座位</b>可手工补标 / 取消补标。前排座位数 = 前 {cls.constraints.frontRows} 排 ×{' '}
          {cls.layout.cols} 列 = {Math.min(cls.constraints.frontRows, cls.layout.rows) * cls.layout.cols} 个。
        </div>
      </div>
    </section>
  )
}

// ---------- 座位标记编辑弹窗（手动补标，重算保留） ----------
function SeatTagModal({
  seat,
  onClose,
  onToggle,
}: {
  seat: Seat
  onClose: () => void
  onToggle: (tag: ManualSeatTag) => void
}) {
  const options: { tag: ManualSeatTag; hint: string }[] = [
    { tag: 'aisle', hint: '行动不便学生的硬约束依据' },
    { tag: 'window', hint: '靠窗一侧' },
    { tag: 'door', hint: '靠门一侧' },
    { tag: 'stage_side', hint: '讲台侧特殊座位（如电教位）' },
  ]
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="seat-tag-modal">
        <h2>
          座位标记 · 第 {seat.row + 1} 排第 {seat.col + 1} 列
        </h2>
        <p className="muted small">
          勾选 = 手动补标（<Sparkles size={11} /> 手动，布局重算时保留）；不勾的标记若由布局自动推出则显示「自动」。
          前排/中排/后排由行数自动决定，不能手动覆盖。
        </p>
        <div className="tag-edit-list">
          {options.map(({ tag, hint }) => {
            const present = seat.tags.includes(tag)
            const source = present ? tagSource(seat, tag) : null
            return (
              <label key={tag} className={`tag-edit-row ${source === 'manual' ? 'is-manual' : ''}`}>
                <input
                  type="checkbox"
                  data-testid={`manual-tag-${tag}`}
                  checked={source === 'manual'}
                  onChange={() => onToggle(tag)}
                />
                <span className="tag-edit-name">{MANUAL_TAG_LABEL[tag]}</span>
                <span className="tag-edit-source" data-testid={`tag-source-${tag}`}>
                  {source === 'manual' ? (
                    <b className="src-manual">✦ 手动补标（重算保留）</b>
                  ) : present ? (
                    <span className="src-auto">自动（布局推导）</span>
                  ) : (
                    <span className="muted">未标记</span>
                  )}
                </span>
                <span className="muted small tag-edit-hint">{hint}</span>
              </label>
            )
          })}
        </div>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- 约束配置 ----------
function ConstraintEditor({ cls, onSave }: { cls: ClassEntity; onSave: (c: ClassEntity, changed: boolean) => void }) {
  return (
    <section className="card" data-testid="constraint-editor">
      <h2>
        <Settings2 size={18} /> 硬性约束
      </h2>
      <div className="form-grid">
        <label>
          视力需求学生必须在前 N 排
          <input
            type="number"
            min={1}
            max={cls.layout.rows}
            value={cls.constraints.frontRows}
            onChange={(e) =>
              onSave(
                { ...cls, constraints: { ...cls.constraints, frontRows: clamp(Number(e.target.value), 1, cls.layout.rows) } },
                true,
              )
            }
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={cls.constraints.heightRule}
            onChange={(e) => onSave({ ...cls, constraints: { ...cls.constraints, heightRule: e.target.checked } }, true)}
          />
          身高排序规则（高个靠后，前排优先矮个）
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={cls.constraints.mixTiers}
            onChange={(e) => onSave({ ...cls, constraints: { ...cls.constraints, mixTiers: e.target.checked } }, true)}
          />
          同桌分层搭配（学习好的带一般的，避免同层凑一起）
        </label>
      </div>
      <p className="muted small">
        「必须分开」「固定座位」在每位学生条目中设置。硬约束在生成与手工微调时都会强制满足（违反数为 0）。
      </p>
    </section>
  )
}

// ---------- 学生名单 ----------
function StudentTable({
  cls,
  onSave,
  onEdit,
  onBulk,
}: {
  cls: ClassEntity
  onSave: (c: ClassEntity, changed: boolean) => void
  onEdit: (s: Student) => void
  onBulk: () => void
}) {
  const nameOf = useMemo(() => new Map(cls.students.map((s) => [s.id, s.name])), [cls.students])
  const seatLabel = (id?: string) => {
    if (!id) return ''
    const m = id.match(/r(\d+)c(\d+)/)
    return m ? `第 ${Number(m[1]) + 1} 排第 ${Number(m[2]) + 1} 列` : id
  }
  return (
    <section className="card" data-testid="student-table">
      <h2 className="with-action">
        <Users size={18} /> 学生名单（{cls.students.length} 人）
        <span className="spacer" />
        <button className="btn" onClick={onBulk}>
          批量粘贴
        </button>
        <button
          className="btn btn-primary"
          data-testid="add-student"
          onClick={() =>
            onEdit({ id: '', name: '', vision: 'none', mustApartFrom: [] })
          }
        >
          <UserPlus size={16} /> 添加学生
        </button>
      </h2>
      {cls.students.length === 0 ? (
        <p className="muted">还没有学生。逐个添加或用「批量粘贴」一次导入。</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>身高(cm)</th>
                <th>视力</th>
                <th>特殊</th>
                <th>分层</th>
                <th>必须分开</th>
                <th>固定座位</th>
                <th>备注</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cls.students.map((s) => (
                <tr key={s.id} data-testid="student-row" data-name={s.name}>
                  <td>{s.name}</td>
                  <td>{s.heightCm ?? '—'}</td>
                  <td>{visionLabel(s.vision) || '—'}</td>
                  <td>{specialLabel(s.special) || '—'}</td>
                  <td>{s.tier ? `T${s.tier}` : '—'}</td>
                  <td>{s.mustApartFrom.map((id) => nameOf.get(id)).filter(Boolean).join('、') || '—'}</td>
                  <td>{seatLabel(s.fixedSeatId) || '—'}</td>
                  <td className="muted">{s.note ?? ''}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => onEdit(s)}>
                      编辑
                    </button>
                    <button
                      className="icon-btn"
                      title="删除"
                      onClick={() =>
                        onSave(
                          {
                            ...cls,
                            students: cls.students
                              .filter((x) => x.id !== s.id)
                              .map((x) => ({ ...x, mustApartFrom: x.mustApartFrom.filter((id) => id !== s.id) })),
                          },
                          true,
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------- 学生编辑弹窗 ----------
function StudentModal({
  cls,
  student,
  onClose,
  onSave,
  onDelete,
}: {
  cls: ClassEntity
  student: Student
  onClose: () => void
  onSave: (s: Student) => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState<Student>({ ...student, mustApartFrom: [...student.mustApartFrom] })
  const [nameError, setNameError] = useState('')
  const others = cls.students.filter((s) => s.id !== student.id)
  const seatOptions = cls.seats

  const submit = () => {
    const name = draft.name.trim()
    if (!name) {
      setNameError('姓名必填')
      return
    }
    if (!student.id && cls.students.some((s) => s.name === name)) {
      setNameError('已存在同名学生')
      return
    }
    onSave({ ...draft, name, id: draft.id || uid() })
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="student-modal">
        <h2>{student.id ? '编辑学生' : '添加学生'}</h2>
        <div className="form-grid">
          <label>
            姓名 *
            <input
              autoFocus
              value={draft.name}
              data-testid="student-name"
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value })
                setNameError('')
              }}
            />
            {nameError && <span className="error-text">{nameError}</span>}
          </label>
          <label>
            身高 (cm，可选)
            <input
              type="number"
              min={90}
              max={220}
              value={draft.heightCm ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, heightCm: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label>
            视力状况
            <select
              value={draft.vision}
              onChange={(e) => setDraft({ ...draft, vision: e.target.value as Student['vision'] })}
            >
              <option value="none">正常</option>
              <option value="front_required">近视 · 需前排</option>
              <option value="middle_required">需中间（不坐边列）</option>
            </select>
          </label>
          <label>
            学习分层（可选）
            <select
              value={draft.tier ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, tier: e.target.value === '' ? undefined : (Number(e.target.value) as 1 | 2 | 3) })
              }
            >
              <option value="">不参与搭配</option>
              <option value="1">T1 · 学有余力</option>
              <option value="2">T2 · 一般</option>
              <option value="3">T3 · 需帮扶</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <span className="label">特殊需求：</span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!draft.special?.includes('hearing')}
              onChange={(e) => {
                const set = new Set(draft.special ?? [])
                e.target.checked ? set.add('hearing') : set.delete('hearing')
                setDraft({ ...draft, special: [...set] as Student['special'] })
              }}
            />
            听力（需前一半排）
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!draft.special?.includes('mobility')}
              onChange={(e) => {
                const set = new Set(draft.special ?? [])
                e.target.checked ? set.add('mobility') : set.delete('mobility')
                setDraft({ ...draft, special: [...set] as Student['special'] })
              }}
            />
            行动不便（需靠过道）
          </label>
        </div>
        <fieldset className="fieldset">
          <legend>必须分开（爱说话 / 有矛盾，最多选若干）</legend>
          <div className="chip-list">
            {others.length === 0 && <span className="muted">暂无其他学生</span>}
            {others.map((o) => (
              <label key={o.id} className="checkbox chip">
                <input
                  type="checkbox"
                  checked={draft.mustApartFrom.includes(o.id)}
                  onChange={(e) => {
                    const set = new Set(draft.mustApartFrom)
                    e.target.checked ? set.add(o.id) : set.delete(o.id)
                    setDraft({ ...draft, mustApartFrom: [...set] })
                  }}
                />
                {o.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          固定座位（可选）
          <select
            value={draft.fixedSeatId ?? ''}
            onChange={(e) => setDraft({ ...draft, fixedSeatId: e.target.value || undefined })}
          >
            <option value="">不固定</option>
            {seatOptions.map((s) => (
              <option key={s.id} value={s.id}>
                第 {s.row + 1} 排第 {s.col + 1} 列
                {s.tags.includes('aisle') ? ' · 靠过道' : ''}
                {s.tags.includes('window') ? ' · 靠窗' : ''}
                {s.tags.includes('door') ? ' · 靠门' : ''}
                {s.tags.includes('stage_side') ? ' · 讲台侧' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          备注（可选）
          <input
            value={draft.note ?? ''}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </label>
        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              删除
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" data-testid="student-save" onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- 批量粘贴 ----------
function BulkModal({
  cls,
  onClose,
  onAdd,
}: {
  cls: ClassEntity
  onClose: () => void
  onAdd: (list: Student[]) => void
}) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, h, note] = line.split(/[,，\t]/).map((s) => s.trim())
        const height = h && /^\d+(\.\d+)?$/.test(h) ? Number(h) : undefined
        return { name, heightCm: height, note }
      })
  }, [text])
  const dupes = parsed.filter((p) => cls.students.some((s) => s.name === p.name)).map((p) => p.name)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>批量添加学生</h2>
        <p className="muted small">每行一个学生，可用逗号附加身高与备注：`张三,152,戴眼镜`</p>
        <textarea
          className="textarea"
          rows={10}
          value={text}
          data-testid="bulk-text"
          placeholder={'张三,152\n李四,148,视力需关注\n王五'}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="muted small">
          解析到 {parsed.length} 名学生{dupes.length > 0 && <>；与现有名单重名：{dupes.join('、')}（重名将跳过）</>}
        </p>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            data-testid="bulk-add"
            disabled={parsed.length === 0}
            onClick={() =>
              onAdd(
                parsed
                  .filter((p) => p.name && !cls.students.some((s) => s.name === p.name))
                  .map((p) => ({ id: uid(), name: p.name, heightCm: p.heightCm, vision: 'none', mustApartFrom: [], note: p.note }) as Student),
              )
            }
          >
            <Eraser size={14} style={{ display: 'none' }} /> 添加 {parsed.length} 人
          </button>
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min
  return Math.max(min, Math.min(max, v))
}
