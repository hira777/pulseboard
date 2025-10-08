import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

export type ReservationInsertCommand = {
  tenantId: string
  serviceId?: string
  roomId: string
  staffId?: string
  customerId?: string
  startAtUtc: string
  endAtUtc: string
  bufferBeforeMin: number
  bufferAfterMin: number
  notes?: string
  createdBy?: string
  status?: 'confirmed' | 'in_use' | 'completed' | 'no_show' | 'canceled'
  equipmentItems: Array<{
    equipmentItemId: string
    equipmentId: string
  }>
}

export type ReservationInsertResult = {
  id: string
  status: 'confirmed' | 'in_use' | 'completed' | 'no_show' | 'canceled'
  roomId: string
  staffId?: string | null
  customerId?: string | null
  serviceId?: string | null
  startAt: string
  endAt: string
  bufferBeforeMin: number
  bufferAfterMin: number
}

export class ReservationPersistenceError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(message: string, options: { status: number; code: string; details?: unknown }) {
    super(message)
    this.name = 'ReservationPersistenceError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

export class ReservationPersistenceConflictError extends ReservationPersistenceError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 409, code: 'RESERVATIONS_CONFLICT', details })
    this.name = 'ReservationPersistenceConflictError'
  }
}

export class ReservationPersistenceForeignKeyError extends ReservationPersistenceError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 422, code: 'RESERVATIONS_VALIDATION_FAILED', details })
    this.name = 'ReservationPersistenceForeignKeyError'
  }
}

export class ReservationPersistenceUnknownError extends ReservationPersistenceError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 500, code: 'RESERVATIONS_INTERNAL_ERROR', details })
    this.name = 'ReservationPersistenceUnknownError'
  }
}

export async function insertReservationWithEquipment({
  supabase,
  command,
}: {
  supabase: SupabaseClient
  command: ReservationInsertCommand
}): Promise<{ reservation: ReservationInsertResult }> {
  const status = command.status ?? 'confirmed'
  const { data: reservationRow, error: reservationError } = await supabase
    .from('reservations')
    .insert({
      tenant_id: command.tenantId,
      service_id: command.serviceId ?? null,
      room_id: command.roomId,
      staff_id: command.staffId ?? null,
      customer_id: command.customerId ?? null,
      start_at: command.startAtUtc,
      end_at: command.endAtUtc,
      buffer_before_min: command.bufferBeforeMin,
      buffer_after_min: command.bufferAfterMin,
      note: command.notes ?? null,
      created_by: command.createdBy ?? null,
      status,
    })
    .select(
      'id,status,room_id,staff_id,customer_id,service_id,start_at,end_at,buffer_before_min,buffer_after_min',
    )
    .single()

  if (reservationError) {
    throw mapPostgrestError(reservationError)
  }

  const reservationId = reservationRow.id as string

  if (command.equipmentItems.length) {
    const { error: equipmentError } = await supabase
      .from('reservation_equipment_items')
      .insert(
        command.equipmentItems.map((item) => ({
          reservation_id: reservationId,
          tenant_id: command.tenantId,
          equipment_item_id: item.equipmentItemId,
        })),
      )

    if (equipmentError) {
      await supabase
        .from('reservations')
        .delete()
        .eq('id', reservationId)
        .eq('tenant_id', command.tenantId)
      throw mapPostgrestError(equipmentError)
    }
  }

  return {
    reservation: {
      id: reservationRow.id,
      status: reservationRow.status,
      roomId: reservationRow.room_id,
      staffId: reservationRow.staff_id,
      customerId: reservationRow.customer_id,
      serviceId: reservationRow.service_id,
      startAt: reservationRow.start_at,
      endAt: reservationRow.end_at,
      bufferBeforeMin: reservationRow.buffer_before_min,
      bufferAfterMin: reservationRow.buffer_after_min,
    },
  }
}

function mapPostgrestError(error: PostgrestError): ReservationPersistenceError {
  if (error.code === '23505' || error.code === '23P01' || error.code === '23P02') {
    return new ReservationPersistenceConflictError('予約が既存レコードと重複しました', error)
  }
  if (error.code === '23503') {
    return new ReservationPersistenceForeignKeyError('関連リソースが見つかりません', error)
  }
  return new ReservationPersistenceUnknownError('予約の保存中にエラーが発生しました', error)
}
