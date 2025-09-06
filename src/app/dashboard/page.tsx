import { requireUser, signOutAction } from '@/features/auth/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, role')
    .eq('id', user.id)
    .single()

  return (
    <main style={{ padding: 24 }}>
      <h2>Dashboard</h2>
      <section>
        <h3>ログイン中のユーザー</h3>
        <ul>
          <li>
            <b>User ID:</b> {user.id}
          </li>
          <li>
            <b>Email:</b> {user.email}
          </li>
          <li>
            <b>Last sign-in:</b> {user.last_sign_in_at ?? '-'}
          </li>
          <li>
            <b>Role (profiles):</b> {profile?.role ?? '(member?)'}
          </li>
          <li>
            <b>Display Name:</b> {profile?.display_name ?? '-'}
          </li>
        </ul>
      </section>

      <form action={signOutAction} style={{ marginTop: 16 }}>
        <button type="submit">ログアウト</button>
      </form>
    </main>
  )
}
