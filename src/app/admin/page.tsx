import { requireUser } from '@/features/auth/server'

export const metadata = { title: 'Admin' }

export default async function AdminPage() {
  // 未ログインは /login へ（middleware でも保護中だが二重に守る）
  await requireUser()

  return (
    <main style={{ padding: 24 }}>
      <h2>Admin</h2>
      <p>ようこそ、管理コンソールへ。</p>
      <ul>
        <li>ユーザー管理（今後追加）</li>
        <li>システムメトリクス（今後追加）</li>
      </ul>
    </main>
  )
}
