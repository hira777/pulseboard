import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  // ログイン中のユーザーを取得
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

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

      <form action={logout} style={{ marginTop: 16 }}>
        <button type="submit">ログアウト</button>
      </form>
    </main>
  )
}

async function logout() {
  'use server'
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
