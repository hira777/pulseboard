import { requireUser, signOutAction } from '@/features/auth/server'
import { updateDisplayNameAction } from '@/features/profile/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FlashMessage } from '@/shared/ui/FlashMessage'
import { readFlash } from '@/shared/server/flash'

export default async function DashboardPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, role')
    .eq('id', user.id)
    .single()

  const flash = await readFlash()

  return (
    <main style={{ padding: 24 }}>
      <h2>Dashboard</h2>

      {flash && (
        <FlashMessage>
          <p
            style={{
              padding: 8,
              borderRadius: 4,
              background: flash.level === 'success' ? '#e6ffed' : '#ffecec',
              color: flash.level === 'success' ? '#056d2e' : '#8a1f1f',
            }}
          >
            {flash.message}
          </p>
        </FlashMessage>
      )}
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

      <section style={{ marginTop: 16 }}>
        <form action={updateDisplayNameAction} style={{ display: 'grid', gap: 12 }}>
          <label>
            表示名（display_name）
            <input name="display_name" defaultValue={profile?.display_name ?? ''} />
          </label>
          <button type="submit">保存</button>
        </form>
      </section>

      <form action={signOutAction} style={{ marginTop: 16 }}>
        <button type="submit">ログアウト</button>
      </form>
    </main>
  )
}
