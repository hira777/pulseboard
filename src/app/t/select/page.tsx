import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { assertTenantRoleForApi, getTenantMembership, getTenantById } from '@/features/auth/tenant'
import { requireUser } from '@/features/auth/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function SelectTenantPage() {
  await requireUser()

  const cookieStore = await cookies()
  const cookieTenant = cookieStore.get('tenant_id')?.value
  if (cookieTenant) {
    const mem = await getTenantMembership(cookieTenant)
    if (mem) {
      const resolved = await getTenantById(cookieTenant)
      if (resolved) redirect(`/t/${resolved.slug}`)
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .order('name', { ascending: true })

  async function selectTenantAction(formData: FormData) {
    'use server'
    const tenantId = String(formData.get('tenantId') || '')
    await assertTenantRoleForApi(tenantId, 'member')
    const c = await cookies()
    c.set('tenant_id', tenantId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 60, // 60日
    })
    const resolved = await getTenantById(tenantId)
    redirect(`/t/${resolved?.slug ?? tenantId}`)
  }

  return (
    <main style={{ padding: 16 }}>
      <h2>テナントを選択</h2>
      {!tenants?.length && <p>所属テナントがありません。管理者に招待を依頼してください。</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tenants?.map((t) => (
          <li key={t.id} style={{ margin: '8px 0' }}>
            <form action={selectTenantAction}>
              <input type="hidden" name="tenantId" value={t.id} />
              <button type="submit" style={{ padding: '6px 10px' }}>
                {t.name}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
