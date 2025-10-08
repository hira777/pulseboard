export class ReservationDomainError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(message: string, options: { status: number; code: string; details?: unknown }) {
    super(message)
    this.name = 'ReservationDomainError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

export class ReservationConflictDetectedError extends ReservationDomainError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 409, code: 'RESERVATIONS_CONFLICT', details })
    this.name = 'ReservationConflictDetectedError'
  }
}

export class ReservationResourceUnavailableError extends ReservationDomainError {
  constructor(resource: string, options?: { disabled?: boolean }) {
    const code = 'RESERVATIONS_DISABLED_RESOURCE'
    const message = options?.disabled
      ? `${resource} は現在利用できません`
      : `${resource} が見つかりません`
    super(message, { status: options?.disabled ? 400 : 404, code })
    this.name = 'ReservationResourceUnavailableError'
  }
}

export class ReservationNoSlotsError extends ReservationDomainError {
  constructor(details?: unknown) {
    super('指定条件に予約可能枠がありません', {
      status: 422,
      code: 'RESERVATIONS_NO_SLOTS',
      details,
    })
    this.name = 'ReservationNoSlotsError'
  }
}

export class ReservationInternalError extends ReservationDomainError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 500, code: 'RESERVATIONS_INTERNAL_ERROR', details })
    this.name = 'ReservationInternalError'
  }
}
