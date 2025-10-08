import { z, type ZodError } from 'zod'

import { extractTimezoneOffsetMinutes } from '@/utils/time'

// 予約作成リクエストを検証するモジュール。
// - Zod スキーマで API 入力を網羅的に検証し、内部コマンド形式へ変換する
// - 予約ロジックが前提とする制約（15分刻み、タイムゾーン統一、重複禁止など）を集中的にチェックする
// - バリデーション失敗時は ReservationValidationError を投げ、呼び出し側で 422 レスポンスに変換可能にする

const SLOT_INTERVAL_MINUTES = 15
const BUFFER_MAX_MINUTES = 30

// 機材リクエスト: SKU と数量のペア
const equipmentRequestSchema = z.object({
  equipmentId: z.string().min(1, 'equipmentId is required'),
  quantity: z.number().int().min(1, 'quantity must be at least 1'),
})

// バッファ上書き: 0〜30分の範囲で許容
const bufferOverrideSchema = z.object({
  beforeMin: z.number().int().min(0).max(BUFFER_MAX_MINUTES),
  afterMin: z.number().int().min(0).max(BUFFER_MAX_MINUTES),
})

// API から受け取るリクエストボディを表す Zod スキーマ
// - 文字列のトリムやデフォルト値の補完はここで実施
// - superRefine で複数フィールドを跨ぐ検証をまとめて行う
const reservationCreateSchema = z
  .object({
    tenantId: z.string().min(1, 'tenantId is required'),
    serviceId: z.string().min(1).optional(),
    roomId: z.string().min(1, 'roomId is required'),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    bufferOverride: bufferOverrideSchema.optional(),
    equipmentRequests: z.array(equipmentRequestSchema).max(20).default([]),
    staffIds: z.array(z.string().min(1)).max(20).default([]),
    customerId: z.string().min(1).optional(),
    notes: z.string().trim().max(2000, 'notes must be 2000 characters or less').optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const start = new Date(data.startAt)
    const end = new Date(data.endAt)

    // 1) 開始 < 終了になっているか
    if (start.getTime() >= end.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'endAt must be later than startAt',
      })
    }

    // 2) 15 分刻みに揃っているか
    if (!isAlignedToSlot(start)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startAt'],
        message: `startAt must align to ${SLOT_INTERVAL_MINUTES}-minute increments`,
      })
    }
    if (!isAlignedToSlot(end)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: `endAt must align to ${SLOT_INTERVAL_MINUTES}-minute increments`,
      })
    }

    // 3) タイムゾーンが揃っているか（揃ってないと営業時間計算が破綻するため NG）
    const startOffset = extractTimezoneOffsetMinutes(data.startAt)
    const endOffset = extractTimezoneOffsetMinutes(data.endAt)
    if (startOffset !== endOffset) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'startAt and endAt must share the same timezone offset',
      })
    }

    // 4) 機材IDの重複禁止
    const seenEq = new Set<string>()
    data.equipmentRequests.forEach((r, i) => {
      if (seenEq.has(r.equipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['equipmentRequests', i, 'equipmentId'],
          message: 'Duplicate equipmentId detected',
        })
      }
      seenEq.add(r.equipmentId)
    })

    // 5) スタッフIDの重複禁止
    const seenStaff = new Set<string>()
    data.staffIds.forEach((id, i) => {
      if (seenStaff.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['staffIds', i],
          message: 'staffIds contains duplicates',
        })
      }
      seenStaff.add(id)
    })
  })

export type ReservationCreateInput = z.input<typeof reservationCreateSchema>
export type ReservationCreateData = z.output<typeof reservationCreateSchema>

export type ReservationCreatePayload = {
  tenantId: string
  serviceId?: string
  roomId: string
  startAt: string
  endAt: string
  timezoneOffsetMinutes: number
  bufferOverride?: {
    beforeMin: number
    afterMin: number
  }
  equipmentRequests: Array<{
    equipmentId: string
    quantity: number
  }>
  staffIds: string[]
  customerId?: string
  notes?: string
}

export type ValidationIssue = {
  path: string
  message: string
}

export class ReservationValidationError extends Error {
  readonly code = 'RESERVATIONS_VALIDATION_FAILED'
  readonly status = 422
  constructor(public readonly issues: ValidationIssue[]) {
    super('Reservation validation failed')
    this.name = 'ReservationValidationError'
  }
}

// バリデーションのエントリーポイント。成功した場合は後続ロジックで扱いやすい正規化済みペイロードを返す。
export function validateReservationInput(input: unknown): ReservationCreatePayload {
  const result = reservationCreateSchema.safeParse(input)
  if (!result.success) {
    throw new ReservationValidationError(formatIssues(result.error))
  }

  const data = result.data
  // startAt / endAt の TZ は一致する前提だが、ここで改めて抽出してコマンドに含める
  const timezoneOffsetMinutes = extractTimezoneOffsetMinutes(data.startAt)
  const notes = data.notes && data.notes.length > 0 ? data.notes : undefined

  return {
    tenantId: data.tenantId,
    serviceId: data.serviceId,
    roomId: data.roomId,
    startAt: data.startAt,
    endAt: data.endAt,
    timezoneOffsetMinutes,
    bufferOverride: data.bufferOverride,
    equipmentRequests: data.equipmentRequests,
    staffIds: data.staffIds,
    customerId: data.customerId,
    notes,
  }
}

// 時刻が15分刻みに揃っているか判定するユーティリティ
function isAlignedToSlot(date: Date): boolean {
  if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    return false
  }
  const totalMinutes = Math.floor(date.getTime() / 60_000)
  return totalMinutes % SLOT_INTERVAL_MINUTES === 0
}

// Zod のエラー情報を API レスポンスで扱いやすい形式に変換
function formatIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }))
}
