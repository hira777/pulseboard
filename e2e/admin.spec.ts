import { test, expect, Page } from '@playwright/test'

/**
 * /admin の認可フロー E2E テスト
 *
 * 前提:
 * - Playwright の baseURL は playwright.config.ts の `use.baseURL` で指定
 * - 未ログイン → /login にリダイレクト（middleware）
 * - ログイン済みかつ profiles.role !== 'admin' → HTTP 404（存在秘匿ポリシー）
 * - admin → 200 OK でページ表示
 *
 * 環境変数（任意・ある場合のみ該当テストを実行）:
 * - E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD : role=member のユーザー資格情報
 * - E2E_ADMIN_EMAIL  / E2E_ADMIN_PASSWORD  : role=admin  のユーザー資格情報
 */

// UI 経由でログイン（メール/パスワード）
async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /ログイン/i }).click()
  // ログイン後の遷移は middleware により /t/select もしくは /t/:tenantId にリダイレクトされる
  await page.waitForURL(/\/(t\/select|t\/[^/]+|dashboard)$/)
}

test.describe('/admin 認可', () => {
  test('未ログイン -> /login へリダイレクト', async ({ page }) => {
    // セッション破棄して未ログイン状態から検証
    await page.context().clearCookies()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('member ユーザー -> 404', async ({ page }) => {
    const email = process.env.E2E_MEMBER_EMAIL
    const password = process.env.E2E_MEMBER_PASSWORD
    // 資格情報が無ければスキップ（テスト環境に依存させない）
    test.skip(!email || !password, 'E2E_MEMBER_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto('/admin')
    // middleware が HTTP 404 を返すことを確認（存在を秘匿）
    expect(response?.status()).toBe(404)
  })

  test('admin ユーザー -> 200 で表示', async ({ page }) => {
    const email = process.env.E2E_ADMIN_EMAIL
    const password = process.env.E2E_ADMIN_PASSWORD
    test.skip(!email || !password, 'E2E_ADMIN_EMAIL/PASSWORD が未設定のためスキップ')

    await loginViaUI(page, String(email), String(password))
    const response = await page.goto('/admin')
    expect(response?.ok()).toBeTruthy()
    // ページヘッダが "Admin" であること
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Admin/i)
  })
})
