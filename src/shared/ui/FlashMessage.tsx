'use client'

import { useEffect, ReactNode } from 'react'

/**
 * フラッシュメッセージ表示用のラッパ
 *
 * - 初回マウント時に flash Cookie を削除する（再表示防止）
 * - UI は children に任せる（汎用的に利用可能）
 *
 * 使い方例:
 * <FlashMessage>
 *   <p style={{ color: 'green' }}>プロフィールを更新しました</p>
 * </FlashMessage>
 */
export function FlashMessage({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 再表示防止のため Cookie を即削除
    document.cookie = 'flash=; path=/; max-age=0'
  }, [])

  return <>{children}</>
}
