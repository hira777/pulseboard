/**
 * Supabase ローカル環境用のユーザー初期データ投入スクリプト。
 *
 * 背景:
 * - `supabase db reset` を実行すると seed.sql が流れるが、
 *   `auth.users` に直接 INSERT してもパスワードが無いためログインできない。
 * - そこで本スクリプトでは Supabase の Admin API (service role) を利用して
 *   正しく「ログイン可能なユーザー」を作成し、
 *   そのユーザーIDを public.profiles / public.tenant_users にひも付ける。
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: `.env.local` })
dotenv.config({ path: '.env.test', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL! // 例: http://localhost:54321
const serviceKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey)

/**
 * 登録したいユーザーの定義リスト
 * - email / password: ログインに使用
 * - profileRole: profiles テーブルの role 列に保存
 * - tenants: 所属するテナントとロール
 */
const USERS = [
  {
    email: 'auth-admin-acme@example.com',
    password: '1111',
    profileRole: 'admin',
    tenants: [
      { tenant_id: process.env.TENANT_ID_STUDIO_A, role: 'admin' }, // Acme Studio
    ],
  },
  {
    email: 'auth-member-acme@example.com',
    password: '1111',
    profileRole: 'member',
    tenants: [
      { tenant_id: process.env.TENANT_ID_STUDIO_A, role: 'member' }, // Acme Studio
    ],
  },
  {
    email: 'auth-admin-apex@example.com',
    password: '1111',
    profileRole: 'admin',
    tenants: [
      { tenant_id: process.env.TENANT_ID_STUDIO_B, role: 'admin' }, // Apex Studio
    ],
  },
  {
    email: 'auth-member-apex@example.com',
    password: '1111',
    profileRole: 'member',
    tenants: [
      { tenant_id: process.env.TENANT_ID_STUDIO_B, role: 'member' }, // Apex Studio
    ],
  },
]

/**
 * ユーザーを Auth に作成する
 */
async function ensureAuthUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // 確認済み扱いにして即ログイン可能
  })
  if (error) throw error

  return data.user.id
}

/**
 * profiles テーブルにユーザー情報を upsert する
 */
async function upsertProfile(userId: string, role: 'admin' | 'member') {
  const { error } = await admin.from('profiles').upsert({ id: userId, role })
  if (error) throw error
}

/**
 * tenant_users テーブルにユーザーとテナントの関連を upsert する
 */
async function upsertTenantMembership(userId: string, tenantId: string, role: 'admin' | 'member') {
  const { error } = await admin.from('tenant_users').upsert({
    tenant_id: tenantId,
    profile_id: userId,
    role,
  })
  if (error) throw error
}

/**
 * メイン処理:
 * 1. USERS 配列を順番に処理
 * 2. Auth にユーザーを作成
 * 3. profiles に upsert
 * 4. tenant_users に upsert
 */
async function main() {
  for (const u of USERS) {
    const userId = await ensureAuthUser(u.email, u.password)
    await upsertProfile(userId, u.profileRole as 'admin' | 'member')
    for (const t of u.tenants) {
      await upsertTenantMembership(userId, t.tenant_id!, t.role as 'admin' | 'member')
    }
    console.log(`✔ linked: ${u.email} -> ${userId}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
