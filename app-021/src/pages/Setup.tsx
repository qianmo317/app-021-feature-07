import { useMemo, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import type { ClassEntity, LayoutConfig, Seat, SeatTag, Student } from '../types'
import {
  AUTO_TAGS,
  MANUAL_TAGS,
  TAG_LABELS,
  buildSeats,
  specialLabel,
  tagSourceOf,
  visionLabel,
  withSeatManualTag,
} from '../lib/layout'
import { hardConstraintImpact, type LayoutImpact } from '../lib/fairness'
import { validateClass } from '../lib/validate'
import { uid } from '../lib/id'
import { SeatGrid } from '../components/SeatGrid'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eraser,
  Info,
  Pin,
  Rows3,
  Settings2,
  Table2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

export function Setup({ classId }: { classId: string }) {
  const { getClass, updateSetup } = useStore()
  const cls = getClass(classId)
  const [editing, setEditing] = useState<Student | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [tagSeat, setTagSeat] = useState<Seat | null>(null)

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

  const save = (next: ClassEntity, configChanged = false, skipConfirm = false) => {
    if (configChanged && hasPlan && !skipConfirm) {
      const ok = window.confirm('配置已变更，将清空已生成的轮换结果。继续？')
      if (!ok) return false
    }
    updateSetup(next, configChanged)
    return true
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

      <LayoutEditor cls={cls} onSave={save} onSeatTag={(seat) => setTagSeat(seat)} />
      <ConstraintEditor cls={cls} onSave={save} />
      <StudentTable cls={cls} onSave={save} onEdit={(s) => setEditing(s)} onBulk={() => setBulkOpen(true)} />

      {tagSeat && (
        <SeatTagModal
          cls={cls}
          seat={tagSeat}
          onClose={() => setTagSeat(null)}
          onSave={(seat) => {
            // 手工补标不改布局、不清空已生成轮换（仅放宽/标注座位属性）
            save({ ...cls, seats: cls.seats.map((s) => (s.id === seat.id ? seat : s)) }, false)
            setTagSeat(null)
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
  onSeatTag,
}: {
  cls: ClassEntity
  onSave: (c: ClassEntity, changed: boolean, skipConfirm?: boolean) => void
  onSeatTag: (seat: Seat) => void
}) {
  const [impact, setImpact] = useState<LayoutImpact | null>(null)
  const [pending, setPending] = useState<{ cls: ClassEntity; impact: LayoutImpact } | null>(null)

  // 布局参数变更：全部座位标记按新布局重算（自动标记刷新，手工补标保留），
  // 并评估硬约束受影响的学生；已生成轮换时弹确认框（确认后清空轮换）。
  const patch = (p: Partial<LayoutConfig>) => {
    const layout = { ...cls.layout, ...p }
    const seats = buildSeats(layout, cls.seats)
    const next = withClearedFixedSeats({ ...cls, layout, seats })
    const imp = hardConstraintImpact(cls, layout, seats)
    if (cls.assignments.length > 0) {
      setPending({ cls: next, impact: imp })
      return
    }
    setImpact(imp)
    onSave(next, false)
  }

  const confirmPending = () => {
    if (pending) {
      onSave(pending.cls, true, true) // 自定义确认框已确认，跳过浏览器 confirm
      setImpact(pending.impact)
    }
    setPending(null)
  }

  const manualSeatCount = cls.seats.filter((s) => (s.manualTags?.length ?? 0) > 0).length

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

      {impact && impact.changedCount > 0 && (
        <div
          className={`card impact-banner ${impact.worseCount > 0 ? 'impact-warn' : 'impact-ok'}`}
          data-testid="layout-impact"
        >
          <button className="icon-btn impact-close" title="关闭" onClick={() => setImpact(null)}>
            <X size={14} />
          </button>
          <h3>
            {impact.worseCount > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            标记已按新布局全部重算
            {(impact.addedSeats > 0 || impact.removedSeats > 0) && (
              <>
                （{impact.removedSeats > 0 && `删除 ${impact.removedSeats} 个座位`}
                {impact.removedSeats > 0 && impact.addedSeats > 0 && '、'}
                {impact.addedSeats > 0 && `新增 ${impact.addedSeats} 个座位`}）
              </>
            )}
          </h3>
          {impact.worseCount > 0 ? (
            <p>
              以下 <b>{impact.worseCount}</b> 名学生的硬约束在已有座位表中不再满足，需要重新生成轮换：
            </p>
          ) : (
            <p>没有学生的硬约束因本次调整变为违反；以下变化仅供参考：</p>
          )}
          <ul className="impact-list" data-testid="impact-list">
            {impact.entries.map((e, i) => (
              <li key={i} className={e.worse ? 'impact-item-worse' : 'impact-item-better'}>
                {e.worse ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                <b>{e.name}</b>：{e.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="setup-preview">
        <SeatGrid cls={cls} compact tagFilter onSeatClick={onSeatTag} />
        <div className="muted small">
          <Info size={13} style={{ verticalAlign: -2 }} /> 自动标注：<b>前排/中排/后排</b>（按 1/3 行）、
          <b>靠窗</b>、<b>靠门</b>、<b>靠过道</b>；布局（行列数 / 过道 / 门方向）一改，全部自动标记立即重算。
          可<b>点击座位手工补标</b>（如「讲台侧」），补标在重算时保留并用 ✎ 标出来源；当前有 {manualSeatCount}{' '}
          个座位带手工补标。也可用上方标记按钮按标记查座位、查看剩余空位。前排座位数 = 前{' '}
          {cls.constraints.frontRows} 排 × {cls.layout.cols} 列 ={' '}
          {Math.min(cls.constraints.frontRows, cls.layout.rows) * cls.layout.cols} 个。
        </div>
      </div>

      {pending && (
        <div className="modal-mask" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="layout-confirm">
            <h2>布局已变更</h2>
            <p className="muted">座位标记已按新布局全部重算（手工补标保留）。继续将清空已生成的轮换结果。</p>
            {pending.impact.changedCount > 0 && (
              <div className={pending.impact.worseCount > 0 ? 'impact-warn' : 'impact-ok'}>
                <p>
                  {pending.impact.worseCount > 0
                    ? `以下 ${pending.impact.worseCount} 名学生的硬约束会在已有座位表中不再满足：`
                    : '没有学生因本次调整变为违反硬约束。受影响变化：'}
                </p>
                <ul className="impact-list">
                  {pending.impact.entries.map((e, i) => (
                    <li key={i} className={e.worse ? 'impact-item-worse' : 'impact-item-better'}>
                      <b>{e.name}</b>：{e.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <span className="spacer" />
              <button className="btn" onClick={() => setPending(null)}>
                取消
              </button>
              <button className="btn btn-primary" data-testid="layout-confirm-ok" onClick={confirmPending}>
                继续并重算标记
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// 布局缩小后失效的固定座位引用清除
function withClearedFixedSeats(next: ClassEntity): ClassEntity {
  const seatIds = new Set(next.seats.map((s) => s.id))
  const students = next.students.map((s) =>
    s.fixedSeatId && !seatIds.has(s.fixedSeatId) ? { ...s, fixedSeatId: undefined } : s,
  )
  return { ...next, students }
}

// ---------- 座位手工补标弹窗 ----------
function SeatTagModal({
  cls,
  seat,
  onClose,
  onSave,
}: {
  cls: ClassEntity
  seat: Seat
  onClose: () => void
  onSave: (seat: Seat) => void
}) {
  const [draft, setDraft] = useState<Seat>(seat)
  const toggle = (tag: SeatTag, on: boolean) => {
    setDraft(withSeatManualTag(draft, cls.layout, tag, on))
  }
  const autoTags = AUTO_TAGS.filter((t) => draft.tags.includes(t))
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="seat-tag-modal">
        <h2>
          <Pin size={16} /> 第 {seat.row + 1} 排第 {seat.col + 1} 列 · 座位标记
        </h2>
        <div className="tag-source-block">
          <span className="label">布局自动推导（随布局重算，不可手工取消）：</span>
          <div className="chip-list">
            {autoTags.length === 0 && <span className="muted">无</span>}
            {autoTags.map((t) => (
              <span key={t} className="tag-source-chip tag-source-auto" title="自动标记：布局变更时重算">
                {TAG_LABELS[t]} · 自动
              </span>
            ))}
          </div>
        </div>
        <div className="tag-source-block">
          <span className="label">老师手工补标（布局重算时保留）：</span>
          <div className="chip-list">
            {MANUAL_TAGS.map((t) => {
              const checked = draft.manualTags?.includes(t) ?? false
              const isAuto = tagSourceOf(draft, t) === 'auto'
              return (
                <label key={t} className="checkbox chip">
                  <input type="checkbox" checked={checked} data-tag={t} onChange={(e) => toggle(t, e.target.checked)} />
                  {TAG_LABELS[t]}
                  {isAuto && !checked && <em className="muted">（自动已有；勾选后来源记为手工）</em>}
                </label>
              )
            })}
          </div>
        </div>
        <p className="muted small">
          保存后该座位将带 ✎ 标出手工来源；之后调整行列数、过道或门方向时，自动标记重算、手工补标保留。
        </p>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" data-testid="seat-tag-save" onClick={() => onSave(draft)}>
            保存
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
