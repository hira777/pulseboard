import { cookies } from 'next/headers'

/**
 * フラッシュメッセージの種類
 * - success: 成功通知
 * - error: エラー通知
 * - info: 情報通知
 * - warning: 警告通知
 */
export type FlashLevel = 'success' | 'error' | 'info' | 'warning'

/**
 * フラッシュメッセージの中身
 * - message: 実際に表示するテキスト
 * - level: 表示の種類（表示の出しわけに利用）
 * - ts: 保存時刻（任意。デバッグや多重書き込み回避に使える）
 */
export type FlashPayload = { message: string; level: FlashLevel; ts: number }

/**
 * フラッシュメッセージを Cookie に保存する関数
 *
 * - Server Action などサーバー側処理で呼び出す
 * - 保存された Cookie は次のリクエストで読み出され、1度だけ表示される
 */
export async function setFlash(message: string, level: FlashLevel = 'info') {
  const store = await cookies()
  const payload: FlashPayload = { message, level, ts: Date.now() }
  store.set('flash', JSON.stringify(payload), {
    path: '/', // サイト全体で利用可能
    httpOnly: false, // クライアントから消せるようにする
  })
}

/**
 * フラッシュメッセージを Cookie から取得し、その場で削除する関数
 *
 * - ページ（Server Component）で呼び出す
 * - 返り値が null の場合は表示するフラッシュがないことを意味する
 */
export async function readFlash(): Promise<FlashPayload | null> {
  const store = await cookies()
  const raw = store.get('flash')?.value
  if (!raw) return null
  try {
    return JSON.parse(raw) as FlashPayload
  } catch {
    return null
  }
}
