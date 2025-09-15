import { notFound } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/features/auth/server'

export type TenantRole = 'admin' | 'member'
export type TenantMembership = { role: TenantRole }
export type TenantRef = { id: string; slug: string }

async function supabaseWithSession() {
  await requireUser()
  return createSupabaseServerClient()
}

/**
 * テナント参照（UUID or slug）から {id, slug} を解決。
 * RLSにより、所属していないテナントは取得できません（その場合 null）。
 */
export async function getTenantById(id: string): Promise<TenantRef | null> {
  const supabase = await supabaseWithSession()
  const { data } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return { id: data.id as string, slug: data.slug as string }
}

export async function getTenantBySlug(slug: string): Promise<TenantRef | null> {
  const supabase = await supabaseWithSession()
  const { data } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('slug', slug.toLowerCase())
    .maybeSingle()
  if (!data) return null
  return { id: data.id as string, slug: data.slug as string }
}

/**
 * ページ/SSR用: 指定したテナントでの所属/ロールを取得（未所属なら null）。
 * 未ログイン時は requireUser() が /login にリダイレクト。
 */
export async function getTenantMembership(tenantId: string): Promise<TenantMembership | null> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('tenant_users')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!data) return null
  return { role: data.role as TenantRole }
}

/**
 * ページ用: テナントユーザーを取得する
 * テナント未所属は 404（秘匿）
 */
export async function requireTenantMember(tenantId: string): Promise<TenantMembership> {
  const member = await getTenantMembership(tenantId)
  if (!member) notFound()
  return member!
}

/**
 * ページ用: admin のテナントユーザーを取得する
 * admin以外のユーザーは 404（秘匿）
 */
export async function requireTenantAdmin(tenantId: string): Promise<TenantMembership> {
  const member = await requireTenantMember(tenantId)
  if (member.role !== 'admin') notFound()
  return member
}

/**
 * 指定したテナントに対してユーザーが必要なロールを持っているか確認する
 * 未ログイン / ロール不足の場合は 403
 * API/Server Action など「操作系」の入口でテナント所属/ロール不足を
 * 403 として弾きたい時に利用する
 */
export async function assertTenantRoleForApi(tenantId: string, required: TenantRole) {
  const supabase = await createSupabaseServerClient()
  const { data: userRes } = await supabase.auth.getUser()
  const user = userRes?.user

  if (!user) {
    const err: any = new Error('Forbidden')
    err.status = 403
    throw err
  }

  const { data } = await supabase
    .from('tenant_users')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('profile_id', user.id)
    .maybeSingle()

  const role = data?.role as TenantRole | undefined
  const ok = role && (required === 'member' || role === 'admin')
  if (!ok) {
    const err: any = new Error('Forbidden')
    err.status = 403
    throw err
  }
}
