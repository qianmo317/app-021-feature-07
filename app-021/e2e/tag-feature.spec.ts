import { expect, test, type Page } from '@playwright/test'
import { addStudent, bulkAdd } from './helpers'

// 场景三：座位标记随布局维护 + 手动补标保留 + 按标记查座位

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function createClass(page: Page, name: string) {
  await page.getByTestId('new-class-name').fill(name)
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} · 配置`)
}

test('门向翻转后 door/window 标记重算到另一侧', async ({ page }) => {
  await createClass(page, 'E2E 标记重算班')
  // 默认 6×7、门在右：r0c6 靠门，r0c0 靠窗
  await expect(page.locator('[data-seat-id="r0c6"]')).toHaveClass(/tag-door/)
  await expect(page.locator('[data-seat-id="r0c0"]')).toHaveClass(/tag-window/)
  await expect(page.locator('[data-seat-id="r0c6"]')).not.toHaveClass(/tag-window/)

  // 门改到左
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('layout-editor').locator('select').first().selectOption('left')

  await expect(page.locator('[data-seat-id="r0c0"]')).toHaveClass(/tag-door/)
  await expect(page.locator('[data-seat-id="r0c0"]')).not.toHaveClass(/tag-window/)
  await expect(page.locator('[data-seat-id="r0c6"]')).toHaveClass(/tag-window/)
  await expect(page.locator('[data-seat-id="r0c6"]')).not.toHaveClass(/tag-door/)
})

test('加过道后影响行动不便学生：提示名单，且新过道座位被标 aisle', async ({ page }) => {
  await createClass(page, 'E2E 过道影响班')
  await addStudent(page, { name: '柯动动', mobility: true })
  await bulkAdd(page, '普通甲\n普通乙')

  // 默认过道在 3|4 列之间；点选 1|2 列之间新增过道
  // 用 click 而非 check：勾选会触发整图重渲染，check 的状态校验会与节点替换竞争
  page.once('dialog', (d) => d.accept())
  const aisleCheckbox = page
    .getByTestId('layout-editor')
    .locator('.aisle-row label', { hasText: '1 | 2 列' })
    .locator('input')
  await aisleCheckbox.click()

  // r1c1 紧临新过道 → aisle（以下游真实结果为准）
  await expect(page.locator('[data-seat-id="r1c1"]')).toHaveClass(/tag-aisle/)

  // 影响提示卡出现，点名柯动动
  const card = page.getByTestId('layout-impacts')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-testid="impact-student"][data-name="柯动动"]')).toBeVisible()
  await expect(card).toContainText('行动不便需靠过道')
  // 撤销勾选过道后名单可为空（关闭提示）
  await page.getByTestId('layout-impacts-close').click()
  await expect(card).toBeHidden()
})

test('按标记查座位：点「靠过道」高亮并显示剩余空位', async ({ page }) => {
  await createClass(page, 'E2E 标记筛选班')
  await bulkAdd(page, '赵一\n钱二')

  // 配置页（无本周分配）：靠过道座位 = 默认过道 3|4 两侧列(3,4) × 6 行 = 12，全部为空
  await page.getByTestId('tag-chip-aisle').click()
  await expect(page.getByTestId('tag-filter-summary')).toContainText('共 12 个')
  await expect(page.getByTestId('tag-filter-summary')).toContainText('12 个空位')
  await expect(page.locator('[data-seat-id="r1c3"]')).toHaveAttribute('data-highlight', 'true')
  await expect(page.locator('[data-seat-id="r1c0"]')).toHaveAttribute('data-highlight', 'false')
  await expect(page.locator('[data-seat-id="r1c3"]')).toHaveClass(/seat-highlight/)
  await expect(page.locator('[data-seat-id="r1c0"]')).toHaveClass(/seat-dim/)
  await page.getByTestId('tag-filter-clear').click()
  await expect(page.locator('[data-seat-id="r1c3"]')).not.toHaveClass(/seat-highlight/)

  // 轮换结果页（尚未生成时）也有按标记查座位入口
  await page.getByRole('link', { name: '轮换结果' }).click()
  await expect(page.getByTestId('rotations-tag-filter')).toBeVisible()
  await page.getByTestId('tag-chip-door').click()
  await expect(page.getByTestId('tag-filter-summary')).toContainText('还剩')
  await expect(page.locator('[data-seat-id="r0c6"]')).toHaveClass(/seat-highlight/)
})

test('手动补标讲台侧：弹窗显示来源，布局重算后保留', async ({ page }) => {
  await createClass(page, 'E2E 手动补标班')

  // 点击 r2c3 打开标记弹窗
  await page.locator('[data-seat-id="r2c3"]').click()
  const modal = page.getByTestId('seat-tag-modal')
  await expect(modal).toBeVisible()
  // aisle 在默认布局对 c3 是自动标记
  await expect(page.locator('[data-testid="tag-source-aisle"]')).toContainText('自动')
  // 讲台侧未标记 → 勾选（click：每次勾选都会保存并重渲染，check 会与节点替换竞争）
  await page.locator('[data-testid="manual-tag-stage_side"]').click()
  await expect(page.locator('[data-testid="tag-source-stage_side"]')).toContainText('手动补标')
  await modal.getByRole('button', { name: '完成' }).click()

  // 座位带上讲台侧样式与手动角标
  const seat = page.locator('[data-seat-id="r2c3"]')
  await expect(seat).toHaveClass(/tag-stage/)
  await expect(seat.locator('.manual-mark')).toContainText('台')
  await expect(seat).toHaveAttribute('data-manual-tags', 'stage_side')

  // 讲台侧可在筛选条查到
  await page.getByTestId('tag-chip-stage_side').click()
  await expect(page.getByTestId('tag-filter-summary')).toContainText('共 1 个')
  await page.getByTestId('tag-filter-clear').click()

  // 门向翻转（布局重算）后手动讲台侧仍在
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('layout-editor').locator('select').first().selectOption('left')
  await expect(page.locator('[data-seat-id="r2c3"]')).toHaveClass(/tag-stage/)
  await expect(page.locator('[data-seat-id="r2c3"]')).toHaveAttribute('data-manual-tags', 'stage_side')
})
