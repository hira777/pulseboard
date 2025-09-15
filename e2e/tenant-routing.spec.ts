import { test, expect, Page } from '@playwright/test'

const TENANT_ASSIGNED_ID = process.env.TENANT_ID_STUDIO_A! // Acme Studio (uuid)
const TENANT_ASSIGNED_SLUG = process.env.TENANT_SLUG_STUDIO_A!
const TENANT_UNASSIGNED_SLUG = process.env.TENANT_SLUG_STUDIO_B!
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /ログイン/i }).click()
  await page.waitForURL(/\/(t\/select|t\/[^/]+|dashboard)$/)
}

test.describe('テナントルーティング基盤', () => {
  test('未ログインで /t/:slug → /login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto(`/t/${TENANT_ASSIGNED_SLUG}`)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('member の未所属テナント直打ち（/t/:slug）→ 404', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto(`/t/${TENANT_UNASSIGNED_SLUG}`)
    expect(response?.status()).toBe(404)
  })

  test('Cookie 既定テナントで / → /t/:slug に誘導（ログイン済み）', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    // Cookie は uuid を保持（middleware で slug を解決）
    await page
      .context()
      .addCookies([{ name: 'tenant_id', value: TENANT_ASSIGNED_ID, url: BASE_URL }])
    await page.goto('/')
    const re = new RegExp(`/t/${TENANT_ASSIGNED_SLUG}$`)
    await expect(page).toHaveURL(re)
  })

  test('所属テナント直リンク（/t/:slug）→ 200 かつダッシュボード骨組み表示', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto(`/t/${TENANT_ASSIGNED_SLUG}`)
    expect(response?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Tenant Dashboard/i)
  })
})
