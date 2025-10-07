import { parsePgRange, type Interval } from '@/features/reservations/calendar'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ReservationScheduleRecord = {
  room_id: string | null
  staff_id: string | null
  time_range: string | null
}

export type EquipmentRecord = {
  id: string
  track_serial: boolean
  stock: number
  active: boolean
}

export type EquipmentItemRecord = {
  id: string
  equipment_id: string
  status: 'available' | 'repair' | 'lost'
}

export type ReservationEquipmentItemRecord = {
  equipment_item_id: string
  reservation_time_range: string | null
}

export type EquipmentAvailabilityContext = {
  equipmentById: Map<string, EquipmentRecord>
  availableItemsByEquipmentId: Map<string, EquipmentItemRecord[]>
  equipmentUsageByEquipmentId: Map<string, Interval[]>
  equipmentUsageByItemId: Map<string, Interval[]>
  equipmentExceptionsById: Map<string, Interval[]>
}

export type ReservationContext = {
  roomReservationIntervals: Map<string, Interval[]>
  staffReservationIntervals: Interval[]
}

export type EquipmentRequirement = {
  equipmentId: string
  qty: number
}

export type OccupiedInterval = {
  occupiedStart: number
  occupiedEnd: number
}

/**
 * Supabase からの取得に失敗した際に投げるエラーです。
 */
export class ConflictQueryError extends Error {
  readonly status = 500
  readonly code = 'RESERVATIONS_QUERY_FAILED'

  constructor(public readonly resource: string, public readonly details?: unknown) {
    super(`Failed to fetch ${resource}`)
    this.name = 'ConflictQueryError'
  }
}

/**
 * 予約レコードを部屋・スタッフごとの占有区間に整理します。
 * @param reservations Supabase から取得した予約レコード配列。
 * @param staffId 重複確認に利用するスタッフ ID。省略時はスタッフの占有は空配列となります。
 * @returns 部屋とスタッフの占有区間をまとめたコンテキスト。
 */
export function buildReservationContext(
  reservations: ReservationScheduleRecord[],
  staffId?: string,
): ReservationContext {
  return {
    roomReservationIntervals: buildRoomReservationMap(reservations),
    staffReservationIntervals: buildStaffReservationList(reservations, staffId),
  }
}

/**
 * 部屋ごとの占有区間マップを生成します。
 * @param records 対象期間の予約レコード配列。
 * @returns room_id をキーにしたソート済み区間マップ。
 */
export function buildRoomReservationMap(
  records: ReservationScheduleRecord[],
): Map<string, Interval[]> {
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
 * 指定スタッフの占有区間リストを作成します。
 * @param records 対象期間の予約レコード配列。
 * @param staffId 判定対象のスタッフ ID。未指定の場合は空配列を返します。
 * @returns スタッフが占有している時間帯のソート済みリスト。
 */
export function buildStaffReservationList(
  records: ReservationScheduleRecord[],
  staffId?: string,
): Interval[] {
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
 * 区間群と指定した開始・終了時刻に重複があるかを調べます。
 * @param intervals 判定対象の区間配列。
 * @param start 判定開始時刻（ミリ秒）。
 * @param end 判定終了時刻（ミリ秒）。
 * @returns 重複がある場合は true。
 */
export function hasAnyOverlap(intervals: Interval[], start: number, end: number): boolean {
  for (const interval of intervals) {
    if (interval.start < end && start < interval.end) {
      return true
    }
  }
  return false
}

export type BuildEquipmentAvailabilityContextParams = {
  supabase: SupabaseClient
  tenantId: string
  equipmentIds: string[]
  rangeLiteral: string
  equipmentExceptionsById: Map<string, Interval[]>
}

/**
 * 機材の在庫・利用状況を集約したコンテキストを構築します。
 * @param params.supabase 取得に使用する Supabase クライアント。
 * @param params.tenantId 対象テナント ID。
 * @param params.equipmentIds 判定対象の機材 ID 配列。
 * @param params.rangeLiteral 期間フィルタに利用する tstzrange 文字列。
 * @param params.equipmentExceptionsById 機材ごとの例外区間マップ。
 * @returns 機材判定に必要な情報をまとめたコンテキスト。
 * @throws ConflictQueryError Supabase からの取得に失敗した場合。
 */
export async function buildEquipmentAvailabilityContext({
  supabase,
  tenantId,
  equipmentIds,
  rangeLiteral,
  equipmentExceptionsById,
}: BuildEquipmentAvailabilityContextParams): Promise<EquipmentAvailabilityContext> {
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
    throw new ConflictQueryError('equipments', equipmentsResult.error)
  }
  if (equipmentItemsResult.error) {
    throw new ConflictQueryError('equipment_items', equipmentItemsResult.error)
  }
  if (equipmentUsageResult.error) {
    throw new ConflictQueryError('reservation_equipment_items', equipmentUsageResult.error)
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
 * 機材条件が無い場合に利用する空のコンテキストを生成します。
 * @param equipmentExceptionsById 機材ごとの例外区間マップ。
 * @returns 空のコンテキスト。
 */
export function createEmptyEquipmentContext(
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
 * 候補区間で要求数量の機材を確保できるか判定します。
 * @param wantedEquipments ユーザーが要求した機材条件一覧。
 * @param candidate バッファ込みの占有開始・終了時刻。
 * @param context 機材在庫判定に必要な情報をまとめたコンテキスト。
 * @returns すべての要求を満たせる場合は true。
 */
export function checkEquipmentAvailability(
  wantedEquipments: ReadonlyArray<EquipmentRequirement>,
  candidate: OccupiedInterval,
  context: EquipmentAvailabilityContext,
): boolean {
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

