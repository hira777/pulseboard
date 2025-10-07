import { buildCalendarContext, parsePgRange } from '@/features/reservations/calendar'
import type { CalendarExceptionRecord, Interval } from '@/features/reservations/calendar'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { extractTimezoneOffsetMinutes, minutesToMs } from '@/utils/time'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ZodError } from 'zod'

import { listAvailabilityInputSchema } from './schema'
import type {
  ISODateTime,
  ListAvailabilityInput,
  ListAvailabilityResult,
  WantedEquipment,
} from './types'

// 可用枠APIのサーバー側ロジック。Supabaseのデータを集約し、予約可能なスロット候補を算出する。

export class InvalidAvailabilityInputError extends Error {
  readonly status = 422
  readonly code = 'INVALID_INPUT'

  constructor(public readonly issues: { path: string; message: string }[]) {
    super('Invalid listAvailability input')
    this.name = 'InvalidAvailabilityInputError'
  }
}

export class AvailabilityResourceNotFoundError extends Error {
  readonly status = 404
  readonly code = 'AVAILABILITY_RESOURCE_NOT_FOUND'

  constructor(resource: string) {
    super(`${resource} not found`)
    this.name = 'AvailabilityResourceNotFoundError'
  }
}

export class AvailabilityQueryError extends Error {
  readonly status = 500
  readonly code = 'AVAILABILITY_QUERY_FAILED'

  constructor(resource: string, public readonly details?: unknown) {
    super(`Failed to fetch ${resource}`)
    this.name = 'AvailabilityQueryError'
  }
}

function toValidationIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}

// 可用枠は標準15分刻みで生成し、曜日判定にも利用する
const SLOT_INTERVAL_MINUTES = 15
const SLOT_INTERVAL_MS = SLOT_INTERVAL_MINUTES * 60_000
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// Zod入力からデフォルト値を補完した内部表現
export type NormalizedAvailabilityInput = Omit<
  ListAvailabilityInput,
  'pageSize' | 'wantedEquipments'
> & {
  pageSize: number
  wantedEquipments: WantedEquipment[]
}

// roomId とバッファ込みの占有範囲を持つ候補スロット
type CandidateSlot = {
  roomId: string
  start: number
  end: number
  occupiedStart: number
  occupiedEnd: number
}

type ServiceRecord = {
  id: string
  duration_min: number
  buffer_before_min: number
  buffer_after_min: number
}

type RoomRecord = {
  id: string
  open_hours: unknown
  active: boolean
}

type ReservationRecord = {
  room_id: string | null
  staff_id: string | null
  time_range: string | null
}

type EquipmentRecord = {
  id: string
  track_serial: boolean
  stock: number
  active: boolean
}

type EquipmentItemRecord = {
  id: string
  equipment_id: string
  status: 'available' | 'repair' | 'lost'
}

type ReservationEquipmentItemRecord = {
  equipment_item_id: string
  reservation_time_range: string | null
}

// rooms.open_hours を曜日→時間リストにマッピングした型
type RoomOpenHours = Partial<
  Record<
    (typeof WEEKDAY_KEYS)[number],
    Array<{
      start: string
      end: string
    }>
  >
>

// 機材在庫チェックで再利用する情報のまとまり
type EquipmentAvailabilityContext = {
  equipmentById: Map<string, EquipmentRecord>
  availableItemsByEquipmentId: Map<string, EquipmentItemRecord[]>
  equipmentUsageByEquipmentId: Map<string, Interval[]>
  equipmentUsageByItemId: Map<string, Interval[]>
  equipmentExceptionsById: Map<string, Interval[]>
}

/**
 * Supabase から取得した可用枠判定用のデータ一式。
 */
type AvailabilityData = {
  service: ServiceRecord
  rooms: RoomRecord[]
  reservations: ReservationRecord[]
  calendarExceptions: CalendarExceptionRecord[]
}

/**
 * 予約データを整理したコンテキスト。
 */
type ReservationContext = {
  roomReservationIntervals: Map<string, Interval[]>
  staffReservationIntervals: Interval[]
}

/**
 * スロット絞り込み時に利用するパラメータ。
 */
type FinalizeSlotsParams = {
  candidateSlots: CandidateSlot[]
  pageSize: number
  timezoneOffsetMinutes: number
  wantedEquipments: WantedEquipment[]
  staffId?: string
  staffReservationIntervals: Interval[]
  staffExceptionsById: Map<string, Interval[]>
  equipmentContext: EquipmentAvailabilityContext
}

/**
 * 指定条件から予約可能なスロットを探索し、最大 pageSize 件返す。
 * @param input フロントエンドから受け取る検索条件。
 * @param options.supabase テスト時などに差し替える Supabase クライアント。省略時はサーバー側で生成。
 * @returns 予約候補スロット一覧と、次ページを取得するための nextCursor（必要な場合）。
 * listAvailability の流れ
 * 大まかな流れは「入力の正規化 → 必要データの取得 → 例外・予約の整理 → 候補スロット生成 → スタッフ＆機材での絞り込み → ページング付き結果返却」。
 * 以下は詳細な流れ。
 * - 1. フロントから渡された条件を Zod で検証し、不正な場合は 422 エラー
 * - 2. tenantId や range, serviceId, pageSize, wantedEquipments などを正規化し、以降の処理で使いやすい形に整える
 * - 3. Supabase から必要データを一括取得
 * - 指定サービスの所要時間とバッファ、利用可能な部屋一覧（任意で特定部屋のみ）、対象期間中の予約、カレンダー例外を同時に取得する。
 * - 取得に失敗・未存在のときは 404 か 500 系の独自エラーを投げる。
 * - 4. 例外・予約の整理
 * - カレンダー例外をテナント全体・部屋・スタッフ・機材ごとにマップ化し、後の除外判定に使えるよう整形する。
 * - 予約レコードから「部屋ごとの占有区間」と「指定スタッフの占有区間」をそれぞれまとめる
 * - 5. 機材在庫の事前読み込み
 * - 機材条件がある場合のみ、SKU 情報／個体在庫／既存の貸出時間を集約したコンテキストを作成する。
 * - 条件に挙がった機材が存在しない・非アクティブな場合は 404 エラー。
 * - 機材条件が無い場合は、例外マップを保持した空コンテキストを作成する。
 * - 6. 部屋ごとの候補スロット生成
 * - 部屋の営業時間から開始し、テナント例外→部屋例外→既存予約の順に時間帯を差し引いて「本当に空いている区間」を作る。
 * - 空き区間ごとに所要時間＋前後バッファを加味した候補スロットを 15 分刻みで生成し、開始時刻が早い順に並べる。
 * - 7. スタッフ・機材条件とページングの最終判定
 * - 候補を先頭から走査し、指定スタッフの既存予約や例外時間とかぶるものを除外する。
 * - 機材在庫コンテキストを用いて、各候補で要求数量を確保できるかをチェックする（個体在庫があれば個体単位、なければ SKU の在庫＋使用数で判断）。
 * - 条件を満たしたスロットを pageSize 件まで取り込み、もしさらに候補があれば次ページ用のnextCursor（次に検査すべき開始時刻）を生成する。
 * - 8. 結果返却
 * - スロットが 0 件なら空配列を返す。
 * - スロットがある場合は { slots, nextCursor? } の形で返し、フロント側がページングや表示に利用できるようにする。
 */
export async function listAvailability(
  input: ListAvailabilityInput,
  options: { supabase?: SupabaseClient } = {},
): Promise<ListAvailabilityResult> {
  // 1. フロントから渡された条件を Zod で検証し、不正な場合は 422 エラー
  const parsed = listAvailabilityInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new InvalidAvailabilityInputError(toValidationIssues(parsed.error))
  }

  // 2. tenantId や range, serviceId, pageSize, wantedEquipments などを正規化し、以降の処理で使いやすい形に整える
  const normalizedInput: NormalizedAvailabilityInput = {
    ...parsed.data,
    pageSize: parsed.data.pageSize ?? 50,
    wantedEquipments: parsed.data.wantedEquipments ?? [],
  }

  // Supabase クライアントを準備（テストでは差し替え可能）
  const supabase = options.supabase ?? (await createSupabaseServerClient())

  // Supabaseのoverlaps演算に渡すための Postgres range 文字列を作成
  const rangeLiteral = buildPostgresRangeLiteral(
    normalizedInput.range.from,
    normalizedInput.range.to,
  )
  // API入力のISO文字列をエポックに変換。以降はミリ秒で統一して扱う
  const rangeStartMs = Date.parse(normalizedInput.range.from)
  const rangeEndMs = Date.parse(normalizedInput.range.to)
  // スロットの表示用に、入力のタイムゾーンを保持しておく
  const timezoneOffsetMinutes = extractTimezoneOffsetMinutes(normalizedInput.range.from)

  // 3.Supabase から必要データを一括取得
  // - 指定サービスの所要時間とバッファ、利用可能な部屋一覧（任意で特定部屋のみ）、対象期間中の予約、カレンダー例外を同時に取得する。
  // - 取得に失敗・未存在のときは 404 か 500 系の独自エラーを投げる。
  const availabilityData = await fetchAvailabilityData({
    supabase,
    input: normalizedInput,
    rangeLiteral,
  })

  // 4. 例外・予約の整理
  // - カレンダー例外をテナント全体・部屋・スタッフ・機材ごとにマップ化し、後の除外判定に使えるよう整形する。
  const calendarContext = buildCalendarContext(availabilityData.calendarExceptions)
  const reservationContext = buildReservationContext(
    availabilityData.reservations,
    normalizedInput.staffId,
  )

  const serviceDurationMs = minutesToMs(availabilityData.service.duration_min)
  const bufferBeforeMs = minutesToMs(availabilityData.service.buffer_before_min)
  const bufferAfterMs = minutesToMs(availabilityData.service.buffer_after_min)

  // 5. 機材在庫の事前読み込み
  // - 機材条件がある場合のみ、SKU 情報／個体在庫／既存の貸出時間を集約したコンテキストを作成する。
  // - 条件に挙がった機材が存在しない・非アクティブな場合は 404 エラー。
  // - 機材条件が無い場合は、例外マップを保持した空コンテキストを作成する。
  const equipmentContext = normalizedInput.wantedEquipments.length
    ? await buildEquipmentAvailabilityContext({
        supabase,
        tenantId: normalizedInput.tenantId,
        equipmentIds: normalizedInput.wantedEquipments.map((item) => item.equipmentId),
        rangeLiteral,
        equipmentExceptionsById: calendarContext.equipmentExceptionsById,
      })
    : createEmptyEquipmentContext(calendarContext.equipmentExceptionsById)

  validateEquipmentAvailability(normalizedInput.wantedEquipments, equipmentContext.equipmentById)

  // 6. 部屋ごとの候補スロット生成
  // - 部屋の営業時間から開始し、テナント例外→部屋例外→既存予約の順に時間帯を差し引いて「本当に空いている区間」を作る。
  // - 空き区間ごとに所要時間＋前後バッファを加味した候補スロットを 15 分刻みで生成し、開始時刻が早い順に並べる。
  const candidateSlots = buildCandidateSlotsForRooms({
    rooms: availabilityData.rooms,
    tenantExceptions: calendarContext.tenantExceptions,
    roomExceptionsById: calendarContext.roomExceptionsById,
    roomReservationIntervals: reservationContext.roomReservationIntervals,
    serviceDurationMs,
    bufferBeforeMs,
    bufferAfterMs,
    rangeStartMs,
    rangeEndMs,
    timezoneOffsetMinutes,
  })

  if (!candidateSlots.length) {
    return { slots: [] }
  }

  // 7. スタッフ・機材条件とページングの最終判定
  // - 候補を先頭から走査し、指定スタッフの既存予約や例外時間とかぶるものを除外する。
  // - 機材在庫コンテキストを用いて、各候補で要求数量を確保できるかをチェックする（個体在庫があれば個体単位、なければ SKU の在庫＋使用数で判断）。
  // - 条件を満たしたスロットを pageSize 件まで取り込み、もしさらに候補があれば次ページ用のnextCursor（次に検査すべき開始時刻）を生成する。
  return finalizeSlots({
    candidateSlots,
    pageSize: normalizedInput.pageSize,
    timezoneOffsetMinutes,
    wantedEquipments: normalizedInput.wantedEquipments,
    staffId: normalizedInput.staffId,
    staffReservationIntervals: reservationContext.staffReservationIntervals,
    staffExceptionsById: calendarContext.staffExceptionsById,
    equipmentContext,
  })
}

/**
 * Supabase から可用枠計算に必要なデータ一式を取得する。
 * @param params.supabase 利用する Supabase クライアント。
 * @param params.input 正規化済みの可用枠検索パラメータ。
 * @param params.rangeLiteral 重なり判定に利用する tstzrange 文字列。
 * @returns サービス・部屋・予約・カレンダー例外のデータまとめ。
 */
async function fetchAvailabilityData({
  supabase,
  input,
  rangeLiteral,
}: {
  supabase: SupabaseClient
  input: NormalizedAvailabilityInput
  rangeLiteral: string
}): Promise<AvailabilityData> {
  const dataResults = await Promise.all([
    supabase
      .from('services')
      .select('id,duration_min,buffer_before_min,buffer_after_min')
      .eq('tenant_id', input.tenantId)
      .eq('id', input.serviceId)
      .maybeSingle(),
    (() => {
      const query = supabase
        .from('rooms')
        .select('id,open_hours,active')
        .eq('tenant_id', input.tenantId)
        .eq('active', true)
      if (input.roomId) {
        query.eq('id', input.roomId)
      }
      return query
    })(),
    supabase
      .from('reservations')
      .select('room_id,staff_id,time_range,status')
      .eq('tenant_id', input.tenantId)
      .in('status', ['confirmed', 'in_use'])
      .not('time_range', 'is', null)
      .overlaps('time_range', rangeLiteral),
    supabase
      .from('calendar_exceptions')
      .select('scope,target_id,range')
      .eq('tenant_id', input.tenantId)
      .overlaps('range', rangeLiteral),
  ])

  const [serviceResult, roomsResult, reservationsResult, calendarExceptionsResult] = dataResults

  if (serviceResult.error) {
    throw new AvailabilityQueryError('service', serviceResult.error)
  }
  const service = serviceResult.data as ServiceRecord | null
  if (!service) {
    throw new AvailabilityResourceNotFoundError('service')
  }

  if (roomsResult.error) {
    throw new AvailabilityQueryError('rooms', roomsResult.error)
  }
  const roomsData = (roomsResult.data ?? []) as RoomRecord[]
  const rooms = roomsData.filter((room) => room.active)
  if (input.roomId && rooms.length === 0) {
    throw new AvailabilityResourceNotFoundError('room')
  }

  if (reservationsResult.error) {
    throw new AvailabilityQueryError('reservations', reservationsResult.error)
  }
  if (calendarExceptionsResult.error) {
    throw new AvailabilityQueryError('calendar_exceptions', calendarExceptionsResult.error)
  }

  const reservations = (reservationsResult.data ?? []) as ReservationRecord[]
  const calendarExceptions = (calendarExceptionsResult.data ?? []) as CalendarExceptionRecord[]

  return {
    service,
    rooms,
    reservations,
    calendarExceptions,
  }
}


/**
 * 予約レコードから重複判定用のコンテキストを生成する。
 * @param reservations 対象期間の予約レコード。
 * @param staffId スタッフ重複判定で利用するスタッフ ID。
 * @returns 部屋・スタッフ用の占有レンジをまとめたコンテキスト。
 * @example
 * const context = buildReservationContext([
 *   { room_id: 'room-1', staff_id: 'staff-1', time_range: '[2025-10-01 09:00:00+09:00,2025-10-01 10:00:00+09:00)' },
 *   { room_id: 'room-1', staff_id: null, time_range: '[2025-10-01 11:00:00+09:00,2025-10-01 12:00:00+09:00)' },
 * ], 'staff-1')
 * 返却値の例:
 * {
 *   roomReservationIntervals: Map { 'room-1' => [
 *     { start: 2025-10-01T00:00:00.000Z, end: 2025-10-01T01:00:00.000Z },
 *     { start: 2025-10-01T02:00:00.000Z, end: 2025-10-01T03:00:00.000Z },
 *   ] },
 *   staffReservationIntervals: [
 *     { start: 2025-10-01T00:00:00.000Z, end: 2025-10-01T01:00:00.000Z }
 *   ]
 * }
 */
function buildReservationContext(
  reservations: ReservationRecord[],
  staffId?: string,
): ReservationContext {
  return {
    roomReservationIntervals: buildRoomReservationMap(reservations),
    staffReservationIntervals: buildStaffReservationList(reservations, staffId),
  }
}

/**
 * 各部屋の営業時間・例外・既存予約を考慮した候補スロットを生成する。
 * @param params.rooms 可用対象となる部屋一覧。
 * @param params.tenantExceptions テナント全体に適用される例外区間。
 * @param params.roomExceptionsById 部屋ごとの例外区間。
 * @param params.roomReservationIntervals 部屋ごとの既存予約区間。
 * @param params.serviceDurationMs サービス所要時間（ミリ秒）。
 * @param params.bufferBeforeMs 前バッファ時間（ミリ秒）。
 * @param params.bufferAfterMs 後バッファ時間（ミリ秒）。
 * @param params.rangeStartMs 検索開始時刻（ミリ秒）。
 * @param params.rangeEndMs 検索終了時刻（ミリ秒）。
 * @param params.timezoneOffsetMinutes 店舗タイムゾーンの分オフセット。
 * @returns ソート済みの候補スロット一覧。
 * @example
 */
function buildCandidateSlotsForRooms({
  rooms,
  tenantExceptions,
  roomExceptionsById,
  roomReservationIntervals,
  serviceDurationMs,
  bufferBeforeMs,
  bufferAfterMs,
  rangeStartMs,
  rangeEndMs,
  timezoneOffsetMinutes,
}: {
  rooms: RoomRecord[]
  tenantExceptions: Interval[]
  roomExceptionsById: Map<string, Interval[]>
  roomReservationIntervals: Map<string, Interval[]>
  serviceDurationMs: number
  bufferBeforeMs: number
  bufferAfterMs: number
  rangeStartMs: number
  rangeEndMs: number
  timezoneOffsetMinutes: number
}): CandidateSlot[] {
  const candidateSlots: CandidateSlot[] = []
  const slotIntervalMs = Math.max(SLOT_INTERVAL_MS, serviceDurationMs)

  for (const room of rooms) {
    const openHours = parseRoomOpenHours(room.open_hours)
    const openIntervals = buildRoomOpenIntervals({
      openHours,
      rangeStartMs,
      rangeEndMs,
      timezoneOffsetMinutes,
    })

    const tenantAdjusted = subtractIntervals(openIntervals, tenantExceptions)
    const roomAdjusted = subtractIntervals(tenantAdjusted, roomExceptionsById.get(room.id) ?? [])
    const freeIntervals = subtractIntervals(
      roomAdjusted,
      roomReservationIntervals.get(room.id) ?? [],
    )

    if (!freeIntervals.length) {
      continue
    }

    const roomCandidates = generateCandidateSlots({
      intervals: freeIntervals,
      serviceDurationMs,
      bufferBeforeMs,
      bufferAfterMs,
      rangeStartMs,
      rangeEndMs,
      roomId: room.id,
      slotIntervalMs,
    })

    candidateSlots.push(...roomCandidates)
  }

  candidateSlots.sort((a, b) => a.start - b.start)
  return candidateSlots
}

/**
 * 機材条件が無い場合に利用する空のコンテキストを生成する。
 * @param equipmentExceptionsById 機材ごとの例外区間マップ。
 * @returns 空の機材コンテキスト。
 */
function createEmptyEquipmentContext(
  equipmentExceptionsById: Map<string, Interval[]>,
): EquipmentAvailabilityContext {
  return {
    equipmentById: new Map(),
    availableItemsByEquipmentId: new Map(),
    equipmentUsageByEquipmentId: new Map(),
    equipmentUsageByItemId: new Map(),
    equipmentExceptionsById,
  }
}

/**
 * 候補スロットにスタッフ・機材条件を適用し、ページングを行う。
 * @param params.candidateSlots チェック対象の候補スロット。
 * @param params.pageSize 返却する最大件数。
 * @param params.timezoneOffsetMinutes スロット表示用のタイムゾーンオフセット。
 * @param params.wantedEquipments 希望された機材条件。
 * @param params.staffId スタッフ重複判定で利用するスタッフ ID。
 * @param params.staffReservationIntervals スタッフが既に占有している時間帯。
 * @param params.staffExceptionsById スタッフごとの例外時間帯。
 * @param params.equipmentContext 機材在庫判定コンテキスト。
 * @returns ListAvailabilityResult と同型の結果。
 */
function finalizeSlots({
  candidateSlots,
  pageSize,
  timezoneOffsetMinutes,
  wantedEquipments,
  staffId,
  staffReservationIntervals,
  staffExceptionsById,
  equipmentContext,
}: FinalizeSlotsParams): ListAvailabilityResult {
  const slots: ListAvailabilityResult['slots'] = []
  let nextCursor: string | undefined

  const staffExceptions = staffId ? staffExceptionsById.get(staffId) ?? [] : []

  for (const candidate of candidateSlots) {
    if (
      staffId &&
      (hasAnyOverlap(staffReservationIntervals, candidate.occupiedStart, candidate.occupiedEnd) ||
        hasAnyOverlap(staffExceptions, candidate.occupiedStart, candidate.occupiedEnd))
    ) {
      continue
    }

    if (!checkEquipmentAvailability(wantedEquipments, candidate, equipmentContext)) {
      continue
    }

    const slot = {
      roomId: candidate.roomId,
      start: formatIsoWithOffset(candidate.start, timezoneOffsetMinutes),
      end: formatIsoWithOffset(candidate.end, timezoneOffsetMinutes),
    }

    if (wantedEquipments.length) {
      slot.feasibleEquipmentSets = [
        {
          items: wantedEquipments.map((item) => ({ ...item })),
        },
      ]
    }

    if (slots.length < pageSize) {
      slots.push(slot)
    } else if (!nextCursor) {
      nextCursor = formatIsoWithOffset(candidate.start, timezoneOffsetMinutes)
      break
    }
  }

  if (nextCursor) {
    return { slots, nextCursor }
  }

  return { slots }
}

/**
 * Supabase の range overlap 条件に渡すための文字列表現を生成する。
 * @param from 期間開始（ISO 8601 文字列）。
 * @param to 期間終了（ISO 8601 文字列）。
 * @returns PostgreSQL の tstzrange 文字列。
 */
function buildPostgresRangeLiteral(from: ISODateTime, to: ISODateTime) {
  return `[${from},${to})`
}

/**
 * rooms.open_hours(JSON) を曜日ごとの時間帯リストに正規化する。
 * @param data Supabase から取得した rooms.open_hours の JSON 値。
 * @returns 曜日→時間帯配列へ変換したオブジェクト。
 */
function parseRoomOpenHours(data: unknown): RoomOpenHours {
  if (!data || typeof data !== 'object') {
    return {}
  }
  const result: RoomOpenHours = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!isWeekdayKey(key) || !Array.isArray(value)) {
      continue
    }
    const segments = value
      .map((segment) => {
        if (!segment || typeof segment !== 'object') {
          return null
        }
        const { start, end } = segment as { start?: unknown; end?: unknown }
        if (typeof start !== 'string' || typeof end !== 'string') {
          return null
        }
        return { start, end }
      })
      .filter(Boolean) as Array<{ start: string; end: string }>
    if (segments.length) {
      result[key] = segments
    }
  }
  return result
}

/**
 * 文字列が WEEKDAY_KEYS に含まれる曜日キーかを判定する。
 * @param value 判定対象の文字列。
 * @returns 対象が曜日キーの場合は true。
 */
function isWeekdayKey(value: string): value is (typeof WEEKDAY_KEYS)[number] {
  return (WEEKDAY_KEYS as readonly string[]).includes(value)
}

/**
 * 指定期間を日に分割し、営業時間設定に沿った利用可能区間(UTC)を生成する。
 * @param params.openHours 部屋の営業時間設定。
 * @param params.rangeStartMs 検索開始時刻（ミリ秒）。
 * @param params.rangeEndMs 検索終了時刻（ミリ秒）。
 * @param params.timezoneOffsetMinutes 店舗タイムゾーンの分オフセット。
 * @returns 利用可能区間の配列。
 */
function buildRoomOpenIntervals({
  openHours,
  rangeStartMs,
  rangeEndMs,
  timezoneOffsetMinutes,
}: {
  openHours: RoomOpenHours
  rangeStartMs: number
  rangeEndMs: number
  timezoneOffsetMinutes: number
}): Interval[] {
  if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs)) {
    return []
  }

  const hasDefinedOpenHours = Object.keys(openHours).length > 0
  const intervals: Interval[] = []
  let currentDayStartUtc = getLocalDayStartUtc(rangeStartMs, timezoneOffsetMinutes)

  while (currentDayStartUtc < rangeEndMs) {
    const dayKey = getWeekdayKey(currentDayStartUtc, timezoneOffsetMinutes)
    const segments = openHours[dayKey] ?? []
    for (const segment of segments) {
      const segmentStartMinutes = parseTimeToMinutes(segment.start)
      const segmentEndMinutes = parseTimeToMinutes(segment.end)
      if (segmentEndMinutes <= segmentStartMinutes) {
        continue
      }
      const segmentStartUtc = currentDayStartUtc + segmentStartMinutes * 60_000
      const segmentEndUtc = currentDayStartUtc + segmentEndMinutes * 60_000
      const start = Math.max(segmentStartUtc, rangeStartMs)
      const end = Math.min(segmentEndUtc, rangeEndMs)
      if (start < end) {
        intervals.push({ start, end })
      }
    }
    currentDayStartUtc += 24 * 60 * 60_000
  }

  if (!intervals.length) {
    return hasDefinedOpenHours ? [] : [{ start: rangeStartMs, end: rangeEndMs }]
  }

  return intervals
}

/**
 * ローカルタイムでの日付開始時刻を UTC ミリ秒で求める。
 * @param epochMs 対象時刻（UTC ミリ秒）。
 * @param offsetMinutes タイムゾーンの分オフセット。
 * @returns ローカル日付の 00:00 を UTC ミリ秒で表した値。
 */
function getLocalDayStartUtc(epochMs: number, offsetMinutes: number) {
  const offsetMs = offsetMinutes * 60_000
  const localEpoch = epochMs + offsetMs
  const date = new Date(localEpoch)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const utcMidnight = Date.UTC(year, month, day)
  return utcMidnight - offsetMs
}

/**
 * 指定時刻のローカル曜日キー(sun〜sat)を取得する。
 * @param epochMs 対象時刻（UTC ミリ秒）。
 * @param offsetMinutes タイムゾーンの分オフセット。
 * @returns WEEKDAY_KEYS のいずれか。
 */
function getWeekdayKey(epochMs: number, offsetMinutes: number): (typeof WEEKDAY_KEYS)[number] {
  const offsetMs = offsetMinutes * 60_000
  const localEpoch = epochMs + offsetMs
  const date = new Date(localEpoch)
  return WEEKDAY_KEYS[date.getUTCDay()]
}

/**
 * HH:MM 形式の文字列を分単位の数値に変換する。
 * @param value 変換対象の文字列。
 * @returns 分数。フォーマット不正時は 0。
 */
function parseTimeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) {
    return 0
  }
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  return hours * 60 + minutes
}

/**
 * 与えられた区間集合から例外や予約の区間を差し引く。
 * @param intervals 元となる利用可能区間のリスト。
 * @param subtractors 引き算する区間のリスト。
 * @returns 差し引き後の区間リスト。
 */
function subtractIntervals(intervals: Interval[], subtractors: Interval[]): Interval[] {
  if (!intervals.length || !subtractors.length) {
    return intervals.slice()
  }
  const sortedSubtractors = [...subtractors].sort((a, b) => a.start - b.start)
  let result = intervals.slice()
  for (const subtractor of sortedSubtractors) {
    const next: Interval[] = []
    for (const interval of result) {
      next.push(...subtractInterval(interval, subtractor))
    }
    result = next
    if (!result.length) {
      break
    }
  }
  return result
}

/**
 * 1 つの区間から別の区間を差し引き、残りを返す。
 * @param interval 元となる区間。
 * @param subtractor 差し引く区間。
 * @returns 差分として残る区間（0〜2 個）。
 */
function subtractInterval(interval: Interval, subtractor: Interval): Interval[] {
  if (subtractor.end <= interval.start || subtractor.start >= interval.end) {
    return [interval]
  }

  const segments: Interval[] = []
  const start = interval.start
  const end = interval.end

  if (subtractor.start > start) {
    const leftEnd = Math.min(subtractor.start, end)
    if (start < leftEnd) {
      segments.push({ start, end: leftEnd })
    }
  }

  if (subtractor.end < end) {
    const rightStart = Math.max(subtractor.end, start)
    if (rightStart < end) {
      segments.push({ start: rightStart, end })
    }
  }

  return segments
}

/**
 * 空き区間からサービス時間とバッファを考慮した候補スロットを作成する。
 * @param params.intervals 空き区間のリスト。
 * @param params.serviceDurationMs サービス所要時間（ミリ秒）。
 * @param params.bufferBeforeMs 前バッファ時間（ミリ秒）。
 * @param params.bufferAfterMs 後バッファ時間（ミリ秒）。
 * @param params.rangeStartMs 検索開始時刻（ミリ秒）。
 * @param params.rangeEndMs 検索終了時刻（ミリ秒）。
 * @param params.roomId スロットの対象部屋 ID。
 * @param params.slotIntervalMs スロット開始時刻の増分（ミリ秒）。
 * @returns 候補スロットの配列。
 */
function generateCandidateSlots({
  intervals,
  serviceDurationMs,
  bufferBeforeMs,
  bufferAfterMs,
  rangeStartMs,
  rangeEndMs,
  roomId,
  slotIntervalMs,
}: {
  intervals: Interval[]
  serviceDurationMs: number
  bufferBeforeMs: number
  bufferAfterMs: number
  rangeStartMs: number
  rangeEndMs: number
  roomId: string
  slotIntervalMs: number
}): CandidateSlot[] {
  const candidates: CandidateSlot[] = []
  for (const interval of intervals) {
    const earliestStart = Math.max(interval.start, rangeStartMs)
    const stepMs = Math.max(slotIntervalMs, SLOT_INTERVAL_MS)
    let currentStart = alignToInterval(earliestStart, SLOT_INTERVAL_MS)
    while (currentStart + serviceDurationMs <= interval.end) {
      const start = currentStart
      const end = start + serviceDurationMs
      if (end > rangeEndMs) {
        break
      }
      const occupiedStart = start - bufferBeforeMs
      const occupiedEnd = end + bufferAfterMs
      candidates.push({
        roomId,
        start,
        end,
        occupiedStart,
        occupiedEnd,
      })
      currentStart += stepMs
    }
  }
  return candidates
}

/**
 * 値を指定刻みの次の境界に丸める。
 * @param value 丸めたいミリ秒値。
 * @param step 刻み幅（ミリ秒）。
 * @returns 刻みに揃えたミリ秒値。
 */
function alignToInterval(value: number, step: number) {
  if (value % step === 0) {
    return value
  }
  return Math.ceil(value / step) * step
}

/**
 * エポックとタイムゾーンオフセットから ISO 8601 文字列を生成する。
 * @param epochMs UTC 基準のミリ秒値。
 * @param offsetMinutes タイムゾーンの分オフセット。
 * @returns タイムゾーン付きの ISO 8601 文字列。
 */
function formatIsoWithOffset(epochMs: number, offsetMinutes: number): ISODateTime {
  const offsetMs = offsetMinutes * 60_000
  const localMs = epochMs + offsetMs
  const date = new Date(localMs)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const seconds = date.getUTCSeconds()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absOffset / 60)
  const offsetMins = absOffset % 60
  const pad = (num: number) => num.toString().padStart(2, '0')
  return (
    `${year.toString().padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(
      minutes,
    )}:${pad(seconds)}` + `${sign}${pad(offsetHours)}:${pad(offsetMins)}`
  )
}



/**
 * 部屋ごとの予約占有区間をマッピングし、重複判定に使いやすくする。
 * @param records 対象期間と状態で取得した予約レコード。
 * @returns room_id ごとの占有区間リスト。
 */
function buildRoomReservationMap(records: ReservationRecord[]) {
  const map = new Map<string, Interval[]>()
  for (const record of records) {
    if (!record.room_id || !record.time_range) {
      continue
    }
    const interval = parsePgRange(record.time_range)
    if (!interval) {
      continue
    }
    const list = map.get(record.room_id) ?? []
    list.push(interval)
    map.set(record.room_id, list)
  }
  map.forEach((intervals, key) => {
    intervals.sort((a, b) => a.start - b.start)
    map.set(key, intervals)
  })
  return map
}

/**
 * 指定スタッフの占有レンジ一覧を作成し、重複チェックに利用する。
 * @param records 対象期間の予約レコード。
 * @param staffId チェック対象のスタッフ ID。未指定なら空配列を返す。
 * @returns スタッフが占有している時間帯のリスト。
 */
function buildStaffReservationList(records: ReservationRecord[], staffId?: string): Interval[] {
  if (!staffId) {
    return []
  }
  const intervals: Interval[] = []
  for (const record of records) {
    if (record.staff_id !== staffId || !record.time_range) {
      continue
    }
    const interval = parsePgRange(record.time_range)
    if (interval) {
      intervals.push(interval)
    }
  }
  intervals.sort((a, b) => a.start - b.start)
  return intervals
}

/**
 * 与えられた区間群のいずれかと衝突するかを判定する。
 * @param intervals 判定対象の区間配列。
 * @param start 判定したい開始時刻（ミリ秒）。
 * @param end 判定したい終了時刻（ミリ秒）。
 * @returns 重なりがあれば true。
 */
function hasAnyOverlap(intervals: Interval[], start: number, end: number): boolean {
  for (const interval of intervals) {
    if (interval.start < end && start < interval.end) {
      return true
    }
  }
  return false
}

/**
 * 機材 SKU と個体の利用状況を取得し、在庫判定用コンテキストを構築する。
 * @param params.supabase 取得に使用する Supabase クライアント。
 * @param params.tenantId 対象テナント ID。
 * @param params.equipmentIds 希望された機材 ID の配列。
 * @param params.rangeLiteral 可用枠検索期間の tstzrange 文字列。
 * @param params.equipmentExceptionsById SKU ごとの例外区間マップ。
 * @returns 機材在庫判定に必要な情報をまとめたコンテキスト。
 */
async function buildEquipmentAvailabilityContext({
  supabase,
  tenantId,
  equipmentIds,
  rangeLiteral,
  equipmentExceptionsById,
}: {
  supabase: SupabaseClient
  tenantId: string
  equipmentIds: string[]
  rangeLiteral: string
  equipmentExceptionsById: Map<string, Interval[]>
}): Promise<EquipmentAvailabilityContext> {
  const [equipmentsResult, equipmentItemsResult, equipmentUsageResult] = await Promise.all([
    supabase
      .from('equipments')
      .select('id,track_serial,stock,active')
      .eq('tenant_id', tenantId)
      .in('id', equipmentIds),
    supabase
      .from('equipment_items')
      .select('id,equipment_id,status')
      .eq('tenant_id', tenantId)
      .in('equipment_id', equipmentIds),
    supabase
      .from('reservation_equipment_items')
      .select('equipment_item_id,reservation_time_range')
      .eq('tenant_id', tenantId)
      .not('reservation_time_range', 'is', null)
      .overlaps('reservation_time_range', rangeLiteral),
  ])

  if (equipmentsResult.error) {
    throw new AvailabilityQueryError('equipments', equipmentsResult.error)
  }
  if (equipmentItemsResult.error) {
    throw new AvailabilityQueryError('equipment_items', equipmentItemsResult.error)
  }
  if (equipmentUsageResult.error) {
    throw new AvailabilityQueryError('reservation_equipment_items', equipmentUsageResult.error)
  }

  const equipmentById = new Map<string, EquipmentRecord>()
  const equipmentData = (equipmentsResult.data ?? []) as EquipmentRecord[]
  for (const equipment of equipmentData) {
    equipmentById.set(equipment.id, equipment)
  }

  const availableItemsByEquipmentId = new Map<string, EquipmentItemRecord[]>()
  const equipmentItemById = new Map<string, EquipmentItemRecord>()
  const equipmentItemsData = (equipmentItemsResult.data ?? []) as EquipmentItemRecord[]
  for (const item of equipmentItemsData) {
    equipmentItemById.set(item.id, item)
    if (item.status !== 'available') {
      continue
    }
    const list = availableItemsByEquipmentId.get(item.equipment_id) ?? []
    list.push(item)
    availableItemsByEquipmentId.set(item.equipment_id, list)
  }

  const equipmentUsageByItemId = new Map<string, Interval[]>()
  const equipmentUsageByEquipmentId = new Map<string, Interval[]>()

  const equipmentUsageData = (equipmentUsageResult.data ?? []) as ReservationEquipmentItemRecord[]
  for (const record of equipmentUsageData) {
    const item = equipmentItemById.get(record.equipment_item_id)
    if (!item) {
      continue
    }
    const interval = record.reservation_time_range
      ? parsePgRange(record.reservation_time_range)
      : null
    if (!interval) {
      continue
    }
    const itemList = equipmentUsageByItemId.get(item.id) ?? []
    itemList.push(interval)
    equipmentUsageByItemId.set(item.id, itemList)

    const equipmentList = equipmentUsageByEquipmentId.get(item.equipment_id) ?? []
    equipmentList.push(interval)
    equipmentUsageByEquipmentId.set(item.equipment_id, equipmentList)
  }

  return {
    equipmentById,
    availableItemsByEquipmentId,
    equipmentUsageByEquipmentId,
    equipmentUsageByItemId,
    equipmentExceptionsById,
  }
}

/**
 * 希望機材が存在し、アクティブであるかを事前に確認する。
 * @param wantedEquipments ユーザーが要求した機材条件。
 * @param equipmentById Supabase から取得した機材情報のマップ。
 */
function validateEquipmentAvailability(
  wantedEquipments: WantedEquipment[],
  equipmentById: Map<string, EquipmentRecord>,
) {
  for (const wanted of wantedEquipments) {
    const equipment = equipmentById.get(wanted.equipmentId)
    if (!equipment || !equipment.active) {
      throw new AvailabilityResourceNotFoundError('equipment')
    }
  }
}

/**
 * 候補スロットで要求数量の機材を確保できるか判定する。
 * @param wantedEquipments ユーザーが要求した機材条件。
 * @param candidate 判定対象の候補スロット。
 * @param context 在庫・利用状況を格納したコンテキスト。
 * @returns 要求数を満たせる場合は true。
 */
function checkEquipmentAvailability(
  wantedEquipments: WantedEquipment[],
  candidate: CandidateSlot,
  context: EquipmentAvailabilityContext,
) {
  if (!wantedEquipments.length) {
    return true
  }

  for (const wanted of wantedEquipments) {
    const equipment = context.equipmentById.get(wanted.equipmentId)
    if (!equipment) {
      return false
    }

    const exceptions = context.equipmentExceptionsById.get(wanted.equipmentId) ?? []
    if (hasAnyOverlap(exceptions, candidate.occupiedStart, candidate.occupiedEnd)) {
      return false
    }

    const availableItems = context.availableItemsByEquipmentId.get(wanted.equipmentId) ?? []
    const capacityFromItems = availableItems.length
    const capacityFromStock = equipment.stock ?? 0
    const capacity = Math.max(capacityFromItems, capacityFromStock)

    if (capacity === 0) {
      return false
    }

    let busyCount = 0
    if (availableItems.length) {
      for (const item of availableItems) {
        const usage = context.equipmentUsageByItemId.get(item.id) ?? []
        if (
          usage.some(
            (interval) =>
              interval.start < candidate.occupiedEnd && candidate.occupiedStart < interval.end,
          )
        ) {
          busyCount += 1
        }
      }
    } else {
      const usage = context.equipmentUsageByEquipmentId.get(wanted.equipmentId) ?? []
      busyCount = usage.filter(
        (interval) =>
          interval.start < candidate.occupiedEnd && candidate.occupiedStart < interval.end,
      ).length
    }

    const availableUnits = capacity - busyCount
    if (availableUnits < wanted.qty) {
      return false
    }
  }

  return true
}
