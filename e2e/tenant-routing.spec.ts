import { test, expect, Page } from '@playwright/test'

const TENANT_ASSIGNED = process.env.TENANT_ID_STUDIO_A! // Acme Studio
const TENANT_UNASSIGNED = process.env.TENANT_ID_STUDIO_B! // Apex Studio
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /ログイン/i }).click()
  await page.waitForURL(/\/(t\/select|t\/[^/]+|dashboard)$/)
}

test.describe('テナントルーティング基盤', () => {
  test('未ログインで /t/:tenantId → /login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto(`/t/${TENANT_ASSIGNED}`)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('member の未所属テナント直打ち → 404', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto(`/t/${TENANT_UNASSIGNED}`)
    expect(response?.status()).toBe(404)
  })

  test('Cookie 既定テナントで / → /t/:tenantId に誘導（ログイン済み）', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    await page.context().addCookies([{ name: 'tenant_id', value: TENANT_ASSIGNED, url: BASE_URL }])
    await page.goto('/')
    const re = new RegExp(`/t/${TENANT_ASSIGNED.replace(/-/g, '\\-')}$`)
    await expect(page).toHaveURL(re)
  })

  test('所属テナント直リンク → 200 かつダッシュボード骨組み表示', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto(`/t/${TENANT_ASSIGNED}`)
    expect(response?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Tenant Dashboard/i)
  })
})
