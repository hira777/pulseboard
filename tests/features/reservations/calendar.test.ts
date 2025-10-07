import {
  ReservationClosedScopeError,
  assertReservationOpen,
  buildCalendarContext,
  findClosedScope,
  type CalendarExceptionRecord,
  type Interval,
} from '@/features/reservations/calendar'

function toRange(start: string, end: string): string {
  return `[${start},${end})`
}

function toInterval(start: string, end: string): Interval {
  return {
    start: Date.parse(start),
    end: Date.parse(end),
  }
}

describe('カレンダーコンテキストのユーティリティ', () => {
  const records: CalendarExceptionRecord[] = [
    {
      scope: 'tenant',
      target_id: null,
      range: toRange('2025-10-01T00:00:00+09:00', '2025-10-01T02:00:00+09:00'),
    },
    {
      scope: 'room',
      target_id: 'room-1',
      range: toRange('2025-10-01T05:00:00+09:00', '2025-10-01T06:00:00+09:00'),
    },
    {
      scope: 'equipment',
      target_id: null,
      range: toRange('2025-10-01T03:00:00+09:00', '2025-10-01T04:00:00+09:00'),
    },
    {
      scope: 'equipment',
      target_id: 'cam-a',
      range: toRange('2025-10-01T07:00:00+09:00', '2025-10-01T08:30:00+09:00'),
    },
    {
      scope: 'staff',
      target_id: null,
      range: toRange('2025-10-01T09:00:00+09:00', '2025-10-01T10:00:00+09:00'),
    },
    {
      scope: 'staff',
      target_id: 'staff-1',
      range: toRange('2025-10-01T10:00:00+09:00', '2025-10-01T11:00:00+09:00'),
    },
  ]

  const context = buildCalendarContext(records)

  it('buildCalendarContext は例外をスコープごとにまとめる', () => {
    expect(context.tenantExceptions).toHaveLength(1)
    expect(context.roomExceptionsById.get('room-1')).toHaveLength(1)
    expect(context.equipmentGlobalExceptions).toHaveLength(1)
    expect(context.equipmentExceptionsById.get('cam-a')).toHaveLength(1)
    expect(context.staffGlobalExceptions).toHaveLength(1)
    expect(context.staffExceptionsById.get('staff-1')).toHaveLength(1)
  })

  it('findClosedScope はテナント全体のクローズを検知する', () => {
    const reason = findClosedScope({
      context,
      roomId: 'room-1',
      interval: toInterval('2025-10-01T00:30:00+09:00', '2025-10-01T01:00:00+09:00'),
      equipmentIds: [],
      staffIds: [],
    })
    expect(reason).not.toBeNull()
    expect(reason!.scope).toBe('tenant')
  })

  it('findClosedScope はルームのクローズを検知する', () => {
    const reason = findClosedScope({
      context,
      roomId: 'room-1',
      interval: toInterval('2025-10-01T05:10:00+09:00', '2025-10-01T05:40:00+09:00'),
      equipmentIds: [],
      staffIds: [],
    })
    expect(reason).not.toBeNull()
    expect(reason!.scope).toBe('room')
    expect(reason!.targetId).toBe('room-1')
  })

  it('findClosedScope は機材のクローズを検知する', () => {
    const reason = findClosedScope({
      context,
      roomId: 'room-1',
      interval: toInterval('2025-10-01T07:10:00+09:00', '2025-10-01T07:40:00+09:00'),
      equipmentIds: ['cam-a'],
      staffIds: [],
    })
    expect(reason).not.toBeNull()
    expect(reason!.scope).toBe('equipment')
    expect(reason!.targetId).toBe('cam-a')
  })

  it('findClosedScope はスタッフのクローズを検知する', () => {
    const reason = findClosedScope({
      context,
      roomId: 'room-1',
      interval: toInterval('2025-10-01T10:10:00+09:00', '2025-10-01T10:40:00+09:00'),
      equipmentIds: [],
      staffIds: ['staff-1'],
    })
    expect(reason).not.toBeNull()
    expect(reason!.scope).toBe('staff')
    expect(reason!.targetId).toBe('staff-1')
  })

  it('assertReservationOpen は閉鎖理由があると例外を投げる', () => {
    expect(() =>
      assertReservationOpen({
        context,
        roomId: 'room-1',
        interval: toInterval('2025-10-01T03:10:00+09:00', '2025-10-01T03:40:00+09:00'),
        equipmentIds: ['cam-a'],
        staffIds: [],
      }),
    ).toThrow(ReservationClosedScopeError)
  })
})
