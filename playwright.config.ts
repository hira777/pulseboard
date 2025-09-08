import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
// Playwright 設定ファイル
// 環境変数:
//   - E2E_BASE_URL: テスト対象のベースURL（既定: http://localhost:3000）
//   - E2E_WEB_SERVER_CMD: 起動コマンド（例: "pnpm dev" / "pnpm start"）
//   - CI: CI 実行時にリトライやレポーターを切り替え

export default defineConfig({
  // テストファイルの配置ディレクトリ
  testDir: 'e2e',
  // 可能な限り並列実行（テスト時間短縮）
  fullyParallel: true,
  // CI では 2 回までリトライ、ローカルは 0
  retries: process.env.CI ? 2 : 0,
  // 各テストのデフォルトタイムアウト（ms）
  timeout: 30_000,
  // expect系の待機タイムアウト（ms）
  expect: { timeout: 5_000 },
  use: {
    // Next.js アプリへのベースURL
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    // 失敗テストの最初のリトライ時のみトレース取得
    trace: 'on-first-retry',
  },
  // 必要に応じて Firefox/WebKit を追加可能
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // CI とローカルでレポーターを切り替え
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // ローカル実行時にアプリを起動
  webServer: {
    // 本番ビルドを対象にしたい場合は E2E_WEB_SERVER_CMD="pnpm start" に変更
    command: process.env.E2E_WEB_SERVER_CMD || 'pnpm dev',
    url: process.env.E2E_BASE_URL || 'http://localhost:3000',
    // 既に起動済みの開発サーバがある場合は再利用（CIでは毎回起動）
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
