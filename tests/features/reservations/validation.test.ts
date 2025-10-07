import {
  ReservationValidationError,
  validateReservationInput,
} from '@/features/reservations/validation'

describe('validateReservationInput のバリデーション', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    roomId: 'room-1',
    startAt: '2025-10-05T10:00:00+09:00',
    endAt: '2025-10-05T11:00:00+09:00',
  }

  it('正常な入力なら正規化されたコマンドを返す', () => {
    const result = validateReservationInput({
      ...baseInput,
      serviceId: 'service-1',
      notes: '  撮影あり  ',
    })

    expect(result).toEqual({
      tenantId: 'tenant-1',
      roomId: 'room-1',
      serviceId: 'service-1',
      startAt: '2025-10-05T10:00:00+09:00',
      endAt: '2025-10-05T11:00:00+09:00',
      timezoneOffsetMinutes: 540,
      equipmentRequests: [],
      staffIds: [],
      bufferOverride: undefined,
      customerId: undefined,
      notes: '撮影あり',
    })
  })

  it('終了時刻が開始時刻以前ならエラーを投げる', () => {
    expect(() =>
      validateReservationInput({
        ...baseInput,
        endAt: '2025-10-05T09:00:00+09:00',
      }),
    ).toThrow(ReservationValidationError)
  })

  it('15分刻みに揃っていなければエラーを投げる', () => {
    expect(() =>
      validateReservationInput({
        ...baseInput,
        startAt: '2025-10-05T10:07:00+09:00',
      }),
    ).toThrow(ReservationValidationError)
  })

  it('機材リクエストに重複があればエラーを投げる', () => {
    expect(() =>
      validateReservationInput({
        ...baseInput,
        equipmentRequests: [
          { equipmentId: 'cam-a', quantity: 1 },
          { equipmentId: 'cam-a', quantity: 2 },
        ],
      }),
    ).toThrow(ReservationValidationError)
  })

  it('スタッフIDに重複があればエラーを投げる', () => {
    expect(() =>
      validateReservationInput({
        ...baseInput,
        staffIds: ['staff-1', 'staff-1'],
      }),
    ).toThrow(ReservationValidationError)
  })

  it('タイムゾーンが一致しなければエラーを投げる', () => {
    expect(() =>
      validateReservationInput({
        ...baseInput,
        endAt: '2025-10-05T11:00:00+08:00',
      }),
    ).toThrow()
  })
})
