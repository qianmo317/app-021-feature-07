import { expect, test, type Page } from '@playwright/test'

// 座位标记随布局维护：重算、手工补标保留、按标记查座位

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function createClass(page: Page, name: string) {
  await page.getByTestId('new-class-name').fill(name)
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} · 配置`)
}

test('布局一改，自动标记立即重算：换门方向 door/window 互换', async ({ page }) => {
  await createClass(page, 'E2E 标记重算班')
  // 默认 6 排 7 列，门在右
  const c0 = page.locator('[data-seat-id="r0c0"]')
  const c6 = page.locator('[data-seat-id="r0c6"]')
  await expect(c0).toHaveClass(/tag-window/)
  await expect(c0).not.toHaveClass(/tag-door/)
  await expect(c6).toHaveClass(/tag-door/)
  // 门改到左边
  await page.locator('[data-testid="layout-editor"] select').first().selectOption('left')
  await expect(c0).toHaveClass(/tag-door/)
  await expect(c0).not.toHaveClass(/tag-window/)
  await expect(c6).toHaveClass(/tag-window/)
})

test('加过道后靠过道座位立即被标出', async ({ page }) => {
  await createClass(page, 'E2E 过道重算班')
  // 默认 aisle [3]：c3、c4 靠过道；勾选 1|2 列之间后 c1、c2 也应标出
  const c1 = page.locator('[data-seat-id="r1c1"]')
  await expect(c1).not.toHaveClass(/tag-aisle/)
  await page.getByText('1 | 2 列').click()
  await expect(c1).toHaveClass(/tag-aisle/)
  // 取消 1|2 后消失
  await page.getByText('1 | 2 列').click()
  await expect(c1).not.toHaveClass(/tag-aisle/)
})

test('手工补标 stage_side：重算后保留且带来源标记 ✎', async ({ page }) => {
  await createClass(page, 'E2E 手工补标班')
  const seat = page.locator('[data-seat-id="r2c2"]')
  await seat.click()
  const modal = page.getByTestId('seat-tag-modal')
  await expect(modal).toBeVisible()
  await modal.locator('input[data-tag="stage_side"]').check()
  await page.getByTestId('seat-tag-save').click()
  await expect(modal).toBeHidden()
  await expect(seat).toHaveClass(/tag-stage/)
  await expect(seat.locator('.seat-manual-dot')).toBeVisible()

  // 改门方向触发自动标记重算：手工标记仍在
  await page.locator('[data-testid="layout-editor"] select').first().selectOption('left')
  await expect(seat).toHaveClass(/tag-stage/)
  await expect(seat.locator('.seat-manual-dot')).toBeVisible()

  // 再次打开弹窗可取消
  await seat.click()
  await page.getByTestId('seat-tag-modal').locator('input[data-tag="stage_side"]').uncheck()
  await page.getByTestId('seat-tag-save').click()
  await expect(seat).not.toHaveClass(/tag-stage/)
})

test('按标记查座位：点「靠过道」高亮并显示剩余空位数', async ({ page }) => {
  await createClass(page, 'E2E 标记筛选班')
  await page.getByTestId('tag-chip-aisle').click()
  await expect(page.getByTestId('tag-filter-hint')).toContainText('「靠过道」')
  // 默认 6×7、过道 [3]：12 个靠过道座位，全部为空
  await expect(page.getByTestId('tag-filter-hint')).toContainText('共 12 个座位')
  await expect(page.getByTestId('tag-filter-hint')).toContainText('还剩')
  await expect(page.locator('.seat-highlight')).toHaveCount(12)
  await expect(page.locator('.seat-dimmed')).toHaveCount(42 - 12)
  // 再点一次取消
  await page.getByTestId('tag-chip-aisle').click()
  await expect(page.locator('.seat-highlight')).toHaveCount(0)
})

test('布局变更提示受影响学生的硬约束', async ({ page }) => {
  await createClass(page, 'E2E 影响提示班')
  // 加一名行动不便学生
  await page.getByTestId('add-student').click()
  const modal = page.getByTestId('student-modal')
  await modal.getByTestId('student-name').fill('小车')
  await modal.getByText('行动不便（需靠过道）').click()
  await modal.getByTestId('student-save').click()

  // 先生成 1 周（行动不便学生会被排到靠过道位置）
  await page.getByRole('link', { name: '轮换结果' }).click()
  await page.getByTestId('weeks-input').fill('1')
  await page.getByTestId('gen-all').click()
  await expect(page.getByTestId('week-tab-1')).toBeVisible()

  // 回配置页移除全部过道 → 弹确认框并列出受影响学生
  await page.getByRole('link', { name: '座位与学生' }).click()
  const aisleChecks = page.locator('[data-testid="layout-editor"] .aisle-row input[type="checkbox"]')
  const n = await aisleChecks.count()
  for (let i = 0; i < n; i++) {
    const box = aisleChecks.nth(i)
    if (await box.isChecked()) await box.click() // 会先弹模态；先处理第一个
    break
  }
  const confirmModal = page.getByTestId('layout-confirm')
  await expect(confirmModal).toBeVisible()
  await expect(confirmModal).toContainText('小车')
  await page.getByTestId('layout-confirm-ok').click()
  await expect(confirmModal).toBeHidden()
  // 轮换已被清空
  await expect(page.getByRole('link', { name: '轮换结果' })).toBeVisible()
  await page.getByRole('link', { name: '轮换结果' }).click()
  await expect(page.getByTestId('no-plan-hint')).toBeVisible()
})
