import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ZodError } from 'zod'

import { listAvailabilityInputSchema } from './schema'
import type { ListAvailabilityInput, ListAvailabilityResult, ISODateTime } from './types'

export class InvalidAvailabilityInputError extends Error {
  readonly status = 422
  readonly code = 'INVALID_INPUT'

  constructor(public readonly issues: { path: string; message: string }[]) {
    super('Invalid listAvailability input')
    this.name = 'InvalidAvailabilityInputError'
  }
}

function toValidationIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}

/**
 * listAvailability (v1 IF)
 *
 * 目的:
 * - 指定期間・サービス・（任意）部屋/スタッフ/機材条件に対し、
 *   予約可能な候補スロットを返す。
 * - v1 はIF確定のみ。探索ロジックは後続で実装する。
 */
export async function listAvailability(
  input: ListAvailabilityInput,
): Promise<ListAvailabilityResult> {
  const parsed = listAvailabilityInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new InvalidAvailabilityInputError(toValidationIssues(parsed.error))
  }

  const normalizedInput: ListAvailabilityInput = {
    ...parsed.data,
    pageSize: parsed.data.pageSize ?? 50,
  }

  const { pageSize = 50 } = normalizedInput
  // NOTE: 実装準備段階。探索ロジック追加時に normalizedInput と pageSize を使用する。
  void normalizedInput
  void pageSize

  // NOTE: ここではIF確定のため空配列を返す。
  // 実装方針（後続）：
  // 1) 営業時間/例外の除外ウィンドウ生成
  // 2) 予約重複（部屋）を除外（reservations.time_range）
  // 3) 機材在庫（SKU合計 <= stock）でフィルタ
  // 4) （任意）スタッフの重複除外
  // 5) 上記を満たす開始時刻刻みでスロット生成 → pageSize 件返却

  // ひとまず Supabase クライアントを初期化（将来の実装で利用）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const supabase = await createSupabaseServerClient()

  const result: ListAvailabilityResult = { slots: [] }
  return result
}

// 予約確定時のユーティリティ（v1 IF、実装は後続）
export type CreateReservationPayload = {
  tenantId: string
  customerId?: string
  serviceId: string
  roomId: string
  staffId?: string
  start: ISODateTime
  end: ISODateTime
  bufferBeforeMin?: number
  bufferAfterMin?: number
  equipments?: { equipmentId: string; qty: number }[]
  note?: string
}

export async function createReservation(/* payload: CreateReservationPayload */) {
  // TODO: 実装（サーバ最終判定：部屋重複・機材在庫・例外日）
  throw new Error('Not implemented')
}
