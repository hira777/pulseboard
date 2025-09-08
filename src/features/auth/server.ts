import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * サーバーコンポーネント/Server Action で利用する認証関連ユーティリティ
 */

/**
 * 現在のログインユーザーを返す（未ログインなら null）
 * - Supabase のセッション Cookie を読み取り
 * - セッションがあれば JWT を検証し User オブジェクトを返す
 * - 失効/未ログインなら null を返す
 */
export async function getUser() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user ?? null
}

/**
 * ログイン必須の処理で利用
 * - 未ログインなら /login にリダイレクト
 * - ログイン済みなら User オブジェクトを返す
 */
export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

/**
 * ログアウト処理
 * - Supabase 側でセッションを破棄
 * - Cookie もクリアされる
 * - 完了後は /login にリダイレクト
 */
export async function signOutAction() {
  'use server' // ← Server Action として動作させる宣言
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/**
 * 管理者（admin）権限を要求するヘルパー
 * - 未ログイン時は requireUser() が /login にリダイレクト
 * - ログイン済みで admin でない場合は 403 相当のエラーを投げる
 *   - Server Action から呼ぶことを想定。呼び出し元でキャッチしてフラッシュ表示などに使えるよう
 *     error.status = 403 を付与する。
 *
 * 返り値: 認証済みユーザー（admin のみ）
 */
export async function requireAdmin() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin') {
    const err: any = new Error('Forbidden: admin only')
    err.status = 403
    throw err
  }

  return user
}
