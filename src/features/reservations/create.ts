'use server'

import { requireUser } from '@/features/auth/server'
import {
  buildCalendarContext,
  assertReservationOpen,
  ReservationClosedScopeError,
  type CalendarExceptionRecord,
} from '@/features/reservations/calendar'
import {
  buildRoomReservationMap,
  buildStaffReservationList,
  buildEquipmentAvailabilityContext,
  createEmptyEquipmentContext,
  checkEquipmentAvailability,
  hasAnyOverlap,
  ConflictQueryError,
  type EquipmentAvailabilityContext,
  type ReservationScheduleRecord,
  type EquipmentRequirement,
} from '@/features/reservations/conflicts'
import {
  insertReservationWithEquipment,
  ReservationPersistenceError,
} from '@/features/reservations/persistence'
import {
  ReservationConflictDetectedError,
  ReservationDomainError,
  ReservationInternalError,
  ReservationResourceUnavailableError,
} from '@/features/reservations/errors'
import {
  ReservationValidationError,
  validateReservationInput,
} from '@/features/reservations/validation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ReservationCreateSuccess = {
  success: true
  data: ReservationCreateResponse
}

export type ReservationCreateFailure = {
  success: false
  error: {
    status: number
    code: string
    message: string
    details?: unknown
  }
}

export type ReservationCreateResult = ReservationCreateSuccess | ReservationCreateFailure

export type ReservationCreateResponse = {
  id: string
  status: 'confirmed' | 'in_use' | 'completed' | 'no_show' | 'canceled'
  roomId: string
  startAt: string
  endAt: string
  buffer: {
    beforeMin: number
    afterMin: number
  }
  equipmentItems: Array<{
    equipmentItemId: string
    equipmentId: string
  }>
  staffIds: string[]
  customerId?: string
}

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'in_use'] as const

export async function createReservationAction(input: unknown): Promise<ReservationCreateResult> {
  const supabase = await createSupabaseServerClient()
  const user = await requireUser()

  try {
    const payload = validateReservationInput(input)

    if (payload.staffIds.length > 1) {
      throw new ReservationValidationError([
        {
          path: 'staffIds',
          message: '複数スタッフの割り当ては現在サポートされていません',
        },
      ])
    }

    const service = payload.serviceId
      ? await fetchService(supabase, payload.tenantId, payload.serviceId)
      : null

    const room = await fetchRoom(supabase, payload.tenantId, payload.roomId)
    if (!room) {
      throw new ReservationResourceUnavailableError('部屋')
    }
    if (!room.active) {
      throw new ReservationResourceUnavailableError('部屋', { disabled: true })
    }

    const startMs = Date.parse(payload.startAt)
    const endMs = Date.parse(payload.endAt)

    const bufferBeforeMin = payload.bufferOverride?.beforeMin ?? service?.buffer_before_min ?? 0
    const bufferAfterMin = payload.bufferOverride?.afterMin ?? service?.buffer_after_min ?? 0
    const occupiedStartMs = startMs - bufferBeforeMin * 60_000
    const occupiedEndMs = endMs + bufferAfterMin * 60_000

    if (occupiedStartMs >= occupiedEndMs) {
      throw new ReservationValidationError([
        {
          path: '(root)',
          message: '開始・終了・バッファの組み合わせが不正です',
        },
      ])
    }

    if (payload.customerId) {
      await ensureCustomerExists(supabase, payload.tenantId, payload.customerId)
    }

    const staffId = payload.staffIds[0]
    if (staffId) {
      const staff = await fetchStaff(supabase, payload.tenantId, staffId)
      if (!staff) {
        throw new ReservationResourceUnavailableError('スタッフ')
      }
      if (!staff.active) {
        throw new ReservationResourceUnavailableError('スタッフ', { disabled: true })
      }
    }

    const rangeLiteral = buildRangeLiteral(
      toIsoString(occupiedStartMs),
      toIsoString(occupiedEndMs),
    )

    const calendarExceptions = await fetchCalendarExceptions(
      supabase,
      payload.tenantId,
      rangeLiteral,
    )
    const calendarContext = buildCalendarContext(calendarExceptions)

    assertReservationOpen({
      context: calendarContext,
      roomId: payload.roomId,
      interval: {
        start: startMs,
        end: endMs,
      },
      equipmentIds: payload.equipmentRequests.map((req) => req.equipmentId),
      staffIds: payload.staffIds,
    })

    const reservations = await fetchActiveReservations(
      supabase,
      payload.tenantId,
      rangeLiteral,
    )
    const roomReservationIntervals = buildRoomReservationMap(reservations)
    if (
      hasAnyOverlap(
        roomReservationIntervals.get(payload.roomId) ?? [],
        occupiedStartMs,
        occupiedEndMs,
      )
    ) {
      throw new ReservationConflictDetectedError('部屋が既存予約と重複しています', {
        roomId: payload.roomId,
      })
    }

    if (staffId) {
      const staffIntervals = buildStaffReservationList(reservations, staffId)
      if (hasAnyOverlap(staffIntervals, occupiedStartMs, occupiedEndMs)) {
        throw new ReservationConflictDetectedError('スタッフが既存予約と重複しています', {
          staffIds: [staffId],
        })
      }
    }

    const equipmentRequirements: EquipmentRequirement[] = payload.equipmentRequests.map(
      (req) => ({
        equipmentId: req.equipmentId,
        qty: req.quantity,
      }),
    )

    const equipmentContext = await buildEquipmentContext({
      supabase,
      tenantId: payload.tenantId,
      equipmentRequirements,
      rangeLiteral,
      calendarContext,
    })

    const equipmentCheckPassed = checkEquipmentAvailability(
      equipmentRequirements,
      {
        occupiedStart: occupiedStartMs,
        occupiedEnd: occupiedEndMs,
      },
      equipmentContext,
    )
    if (!equipmentCheckPassed) {
      throw new ReservationConflictDetectedError('機材が既存予約と重複しています', {
        equipmentIds: equipmentRequirements.map((item) => item.equipmentId),
      })
    }

    const equipmentItems = allocateEquipmentItems(
      equipmentRequirements,
      {
        occupiedStart: occupiedStartMs,
        occupiedEnd: occupiedEndMs,
      },
      equipmentContext,
    )

    const { reservation } = await insertReservationWithEquipment({
      supabase,
      command: {
        tenantId: payload.tenantId,
        serviceId: payload.serviceId,
        roomId: payload.roomId,
        staffId,
        customerId: payload.customerId,
        startAtUtc: toIsoString(startMs),
        endAtUtc: toIsoString(endMs),
        bufferBeforeMin,
        bufferAfterMin,
        notes: payload.notes,
        createdBy: user.id,
        equipmentItems,
      },
    })

    return {
      success: true,
      data: {
        id: reservation.id,
        status: reservation.status,
        roomId: reservation.roomId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        buffer: {
          beforeMin: reservation.bufferBeforeMin,
          afterMin: reservation.bufferAfterMin,
        },
        equipmentItems: equipmentItems.map((item) => ({
          equipmentItemId: item.equipmentItemId,
          equipmentId: item.equipmentId,
        })),
        staffIds: reservation.staffId ? [reservation.staffId] : [],
        customerId: reservation.customerId ?? undefined,
      },
    }
  } catch (error) {
    return handleCreateError(error)
  }
}

function handleCreateError(error: unknown): ReservationCreateFailure {
  if (error instanceof ReservationValidationError) {
    return {
      success: false,
      error: {
        status: error.status,
        code: error.code,
        message: '入力内容が正しくありません',
        details: error.issues,
      },
    }
  }

  if (error instanceof ReservationClosedScopeError) {
    return {
      success: false,
      error: {
        status: 409,
        code: 'RESERVATIONS_CLOSED_SCOPE',
        message: '指定時間帯は利用できません',
        details: error.reason,
      },
    }
  }

  if (error instanceof ReservationDomainError) {
    return {
      success: false,
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }
  }

  if (error instanceof ReservationPersistenceError) {
    return {
      success: false,
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }
  }

  console.error('createReservationAction unexpected error', error)

  return {
    success: false,
    error: {
      status: 500,
      code: 'RESERVATIONS_INTERNAL_ERROR',
      message: '予約の作成に失敗しました',
    },
  }
}

async function fetchService(
  supabase: SupabaseClient,
  tenantId: string,
  serviceId: string,
) {
  const { data, error } = await supabase
    .from('services')
    .select('id,duration_min,buffer_before_min,buffer_after_min')
    .eq('tenant_id', tenantId)
    .eq('id', serviceId)
    .maybeSingle()

  if (error) {
    throw new ReservationInternalError('サービス情報の取得に失敗しました', error)
  }

  if (!data) {
    throw new ReservationResourceUnavailableError('サービス')
  }

  return data as {
    id: string
    duration_min: number
    buffer_before_min: number
    buffer_after_min: number
  }
}

async function fetchRoom(supabase: SupabaseClient, tenantId: string, roomId: string) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id,active')
    .eq('tenant_id', tenantId)
    .eq('id', roomId)
    .maybeSingle()

  if (error) {
    throw new ReservationInternalError('部屋情報の取得に失敗しました', error)
  }

  return data as { id: string; active: boolean } | null
}

async function ensureCustomerExists(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
) {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    throw new ReservationInternalError('顧客情報の取得に失敗しました', error)
  }

  if (!data) {
    throw new ReservationResourceUnavailableError('顧客')
  }
}

async function fetchStaff(supabase: SupabaseClient, tenantId: string, staffId: string) {
  const { data, error } = await supabase
    .from('staff')
    .select('id,active')
    .eq('tenant_id', tenantId)
    .eq('id', staffId)
    .maybeSingle()

  if (error) {
    throw new ReservationInternalError('スタッフ情報の取得に失敗しました', error)
  }

  return data as { id: string; active: boolean } | null
}

async function fetchCalendarExceptions(
  supabase: SupabaseClient,
  tenantId: string,
  rangeLiteral: string,
) {
  const { data, error } = await supabase
    .from('calendar_exceptions')
    .select('scope,target_id,range')
    .eq('tenant_id', tenantId)
    .overlaps('range', rangeLiteral)

  if (error) {
    throw new ReservationInternalError('カレンダー例外の取得に失敗しました', error)
  }

  return (data ?? []) as CalendarExceptionRecord[]
}

async function fetchActiveReservations(
  supabase: SupabaseClient,
  tenantId: string,
  rangeLiteral: string,
) {
  const { data, error } = await supabase
    .from('reservations')
    .select('room_id,staff_id,time_range')
    .eq('tenant_id', tenantId)
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .not('time_range', 'is', null)
    .overlaps('time_range', rangeLiteral)

  if (error) {
    throw new ReservationInternalError('既存予約の取得に失敗しました', error)
  }

  return (data ?? []) as ReservationScheduleRecord[]
}

async function buildEquipmentContext({
  supabase,
  tenantId,
  equipmentRequirements,
  rangeLiteral,
  calendarContext,
}: {
  supabase: SupabaseClient
  tenantId: string
  equipmentRequirements: EquipmentRequirement[]
  rangeLiteral: string
  calendarContext: ReturnType<typeof buildCalendarContext>
}) {
  if (!equipmentRequirements.length) {
    return createEmptyEquipmentContext(calendarContext.equipmentExceptionsById)
  }

  try {
    const context = await buildEquipmentAvailabilityContext({
      supabase,
      tenantId,
      equipmentIds: equipmentRequirements.map((item) => item.equipmentId),
      rangeLiteral,
      equipmentExceptionsById: calendarContext.equipmentExceptionsById,
    })

    validateEquipmentResources(equipmentRequirements, context)

    return context
  } catch (error) {
    if (error instanceof ConflictQueryError) {
      throw new ReservationInternalError('機材情報の取得に失敗しました', error)
    }
    throw error
  }
}

function validateEquipmentResources(
  requirements: EquipmentRequirement[],
  context: EquipmentAvailabilityContext,
) {
  for (const requirement of requirements) {
    const equipment = context.equipmentById.get(requirement.equipmentId)
    if (!equipment) {
      throw new ReservationResourceUnavailableError('機材')
    }
    if (!equipment.active) {
      throw new ReservationResourceUnavailableError('機材', { disabled: true })
    }
  }
}

function allocateEquipmentItems(
  requirements: EquipmentRequirement[],
  candidate: { occupiedStart: number; occupiedEnd: number },
  context: EquipmentAvailabilityContext,
) {
  const assignments: Array<{ equipmentItemId: string; equipmentId: string }> = []

  for (const requirement of requirements) {
    const equipment = context.equipmentById.get(requirement.equipmentId)
    if (!equipment || !equipment.track_serial) {
      continue
    }

    const availableItems = context.availableItemsByEquipmentId.get(requirement.equipmentId) ?? []
    const selected: string[] = []

    for (const item of availableItems) {
      const usage = context.equipmentUsageByItemId.get(item.id) ?? []
      if (usage.some((interval) => interval.start < candidate.occupiedEnd && candidate.occupiedStart < interval.end)) {
        continue
      }
      selected.push(item.id)
      assignments.push({ equipmentItemId: item.id, equipmentId: requirement.equipmentId })
      if (selected.length === requirement.qty) {
        break
      }
    }

    if (selected.length < requirement.qty) {
      throw new ReservationConflictDetectedError('機材個体の空きが不足しています', {
        equipmentId: requirement.equipmentId,
      })
    }
  }

  return assignments
}

function buildRangeLiteral(fromIso: string, toIso: string) {
  return `[${fromIso},${toIso})`
}

function toIsoString(epochMs: number) {
  return new Date(epochMs).toISOString()
}
