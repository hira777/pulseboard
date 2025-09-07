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
