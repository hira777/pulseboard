import { z } from 'zod'

/**
 * ISO 8601 形式の日時文字列（タイムゾーン必須）を検証するスキーマ。
 *
 * 許容例:
 *   - "2025-10-01T12:00:00Z"         （UTC）
 *   - "2025-10-01T12:00:00+09:00"    （オフセット付き）
 *
 * 不許可例:
 *   - "2025-10-01 12:00:00"          （T区切りなし）
 *   - "2025-10-01T12:00:00"          （オフセットなし → offset: true のためNG）
 *   - "2025/10/01 12:00:00"          （スラッシュ形式）
 *
 * 備考:
 * - タイムゾーンを必須化することで、API サーバー側での「どのタイムゾーン想定か」
 *   の誤解を防ぐ（ログの相関やDBの一意制御にも有利）。
 */
export const isoDateTimeSchema = z.iso.datetime({
  message: 'Invalid ISO 8601 datetime',
  // タイムゾーンオフセット必須（例: 2025-10-01T12:00:00+09:00）
  offset: true,
})

/**
 * 希望機材の入力を検証するスキーマ
 */
export const wantedEquipmentSchema = z.object({
  // 機材ID（空文字不可）
  equipmentId: z.string().min(1, 'equipmentId is required'),
  // 必ず1以上の整数（0や小数はNG）
  qty: z.number().int().positive('qty must be a positive integer'),
})

/**
 * 日時範囲を検証するスキーマ
 */
export const dateRangeSchema = z
  .object({
    // 期間の開始
    from: isoDateTimeSchema,
    // 期間の終了
    to: isoDateTimeSchema,
  })
  // from < to を実行時に保証（同時刻や逆転はNG）
  .refine(
    ({ from, to }) => new Date(from).getTime() < new Date(to).getTime(),
    'range.from must be earlier than range.to',
  )

/**
 * 可用枠 API の入力を検証するスキーマ
 */
export const listAvailabilityInputSchema = z
  .object({
    // 対象テナントID（必須）
    tenantId: z.string().min(1, 'tenantId is required'),
    // 検索する日時範囲（from < to を保証）
    range: dateRangeSchema,
    // 対象サービスID（必須）
    serviceId: z.string().min(1, 'serviceId is required'),
    // 希望機材の配列（任意・空配列許容）。
    wantedEquipments: z.array(wantedEquipmentSchema).optional(),
    // 部屋ID（任意・指定時は空文字NG）
    roomId: z.string().min(1).optional(),
    // スタッフID（任意・指定時は空文字NG）
    staffId: z.string().min(1).optional(),
    // 1〜50 の整数（任意）。指定なし時は実装側のデフォルトを利用
    pageSize: z.number().int().min(1).max(50).optional(),
  })
  // 未定義のキーを受け取った場合は実行時エラーにする（入力の取りこぼし/スペルミス検出に有効）。
  .strict()

/**
 * 実現可能な(候補を満たす)機材の組み合わせを検証するスキーマ
 */
const feasibleEquipmentSetSchema = z.object({
  items: z.array(wantedEquipmentSchema),
})

/**
 * 1件の空きスロットを検証するスキーマ
 */
export const slotSchema = z
  .object({
    // スロットの開始時間
    start: isoDateTimeSchema,
    // スロットの終了時間
    end: isoDateTimeSchema,
    // 対象の部屋ID（必須）
    roomId: z.string().min(1, 'roomId is required'),
    // 実現可能な(候補を満たす)機材の組み合わせ一覧（任意）
    feasibleEquipmentSets: z.array(feasibleEquipmentSetSchema).optional(),
  })
  .strict()

/**
 * 可用枠 API のレスポンススキーマ
 */
export const listAvailabilityResultSchema = z
  .object({
    slots: z.array(slotSchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict()

export type ListAvailabilityInputSchema = typeof listAvailabilityInputSchema
export type ListAvailabilityResultSchema = typeof listAvailabilityResultSchema
