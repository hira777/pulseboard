import type { SupabaseClient } from '@supabase/supabase-js'

import {
  AvailabilityResourceNotFoundError,
  InvalidAvailabilityInputError,
  listAvailability,
} from '@/features/availability/server'

const baseInput = {
  tenantId: 'tenant-1',
  range: {
    from: '2025-10-01T09:00:00+09:00',
    to: '2025-10-01T13:00:00+09:00',
  },
  serviceId: 'service-1',
} as const

type TableResponse = { data: unknown; error: unknown }
type Responses = Record<string, TableResponse | TableResponse[]>

type QueryBuilderStub = {
  select: jest.MockedFunction<(columns: string) => QueryBuilderStub>
  eq: jest.MockedFunction<(column: string, value: unknown) => QueryBuilderStub>
  in: jest.MockedFunction<(column: string, values: unknown[]) => QueryBuilderStub>
  overlaps: jest.MockedFunction<(column: string, range: string) => QueryBuilderStub>
  not: jest.MockedFunction<(column: string, operator: string, value: unknown) => QueryBuilderStub>
  maybeSingle: jest.MockedFunction<() => Promise<TableResponse>>
  then: Promise<TableResponse>['then']
}

function success<T>(data: T): TableResponse {
  return { data, error: null }
}

function createQueryBuilder(response: TableResponse): QueryBuilderStub {
  const promise = Promise.resolve(response)
  const builder: QueryBuilderStub = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    overlaps: jest.fn(() => builder),
    not: jest.fn(() => builder),
    maybeSingle: jest.fn(() => promise),
    then: promise.then.bind(promise),
  }
  return builder
}

function cloneResponse(response: TableResponse | TableResponse[]): TableResponse | TableResponse[] {
  if (Array.isArray(response)) {
    return response.map((item) => cloneSingle(item))
  }
  return cloneSingle(response)
}

function cloneSingle(response: TableResponse): TableResponse {
  const data =
    response.data === null || response.data === undefined
      ? response.data
      : JSON.parse(JSON.stringify(response.data))
  return { data, error: response.error }
}

function createSupabaseStub(responses: Responses): SupabaseClient {
  const queues = new Map<string, TableResponse[]>()
  for (const [table, response] of Object.entries(responses)) {
    const list = Array.isArray(response) ? response.slice() : [response]
    queues.set(table, list.map((item) => ({ ...item })))
  }

  return {
    from: jest.fn((table: string) => {
      const queue = queues.get(table)
      if (!queue || queue.length === 0) {
        throw new Error(`No stubbed response for table: ${table}`)
      }
      const response = queue.length === 1 ? queue[0] : queue.shift()!
      return createQueryBuilder(response)
    }),
  } as unknown as SupabaseClient
}

const baseResponses: Responses = {
  services: success({
    id: 'service-1',
    duration_min: 60,
    buffer_before_min: 0,
    buffer_after_min: 0,
  }),
  rooms: success([
    {
      id: 'room-1',
      open_hours: {
        wed: [
          { start: '09:00', end: '18:00' },
        ],
      },
      active: true,
    },
  ]),
  reservations: success([]),
  calendar_exceptions: success([]),
  equipments: success([]),
  equipment_items: success([]),
  reservation_equipment_items: success([]),
}

function buildResponses(overrides: Partial<Responses> = {}): Responses {
  const merged: Responses = {}
  for (const [table, response] of Object.entries(baseResponses)) {
    merged[table] = cloneResponse(response)
  }
  for (const [table, response] of Object.entries(overrides)) {
    merged[table] = cloneResponse(response)
  }
  return merged
}

describe('listAvailability の入力チェック', () => {
  it('pageSize が 50 を超えると InvalidAvailabilityInputError', async () => {
    const supabase = createSupabaseStub(buildResponses())
    await expect(
      listAvailability(
        {
          ...baseInput,
          pageSize: 100,
        },
        { supabase },
      ),
    ).rejects.toBeInstanceOf(InvalidAvailabilityInputError)
  })

  it('ISO 文字列が不正だと 422 を返す', async () => {
    const supabase = createSupabaseStub(buildResponses())
    await expect(
      listAvailability(
        {
          ...baseInput,
          range: {
            from: 'invalid',
            to: baseInput.range.to,
          },
        },
        { supabase },
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_INPUT',
    })
  })
})

describe('listAvailability のロジック', () => {
  it('営業時間内のスロットを返し、pageSize 超過時に nextCursor を返す', async () => {
    const supabase = createSupabaseStub(buildResponses())

    const result = await listAvailability(
      {
        ...baseInput,
        pageSize: 2,
      },
      { supabase },
    )

    expect(result.slots).toEqual([
      {
        roomId: 'room-1',
        start: '2025-10-01T09:00:00+09:00',
        end: '2025-10-01T10:00:00+09:00',
      },
      {
        roomId: 'room-1',
        start: '2025-10-01T10:00:00+09:00',
        end: '2025-10-01T11:00:00+09:00',
      },
    ])
    expect(result.nextCursor).toBe('2025-10-01T11:00:00+09:00')
  })

  it('部屋・スタッフの競合とスタッフ例外を除外する', async () => {
    const reservations = [
      {
        room_id: 'room-1',
        staff_id: 'staff-1',
        time_range: '[2025-10-01 10:00:00+09:00,2025-10-01 11:00:00+09:00)',
      },
      {
        room_id: null,
        staff_id: 'staff-1',
        time_range: '[2025-10-01 11:00:00+09:00,2025-10-01 12:00:00+09:00)',
      },
    ]

    const calendarExceptions = [
      {
        scope: 'staff',
        target_id: 'staff-1',
        range: '[2025-10-01 12:00:00+09:00,2025-10-01 13:00:00+09:00)',
      },
    ]

    const supabase = createSupabaseStub(
      buildResponses({
        reservations: success(reservations),
        calendar_exceptions: success(calendarExceptions),
      }),
    )

    const result = await listAvailability(
      {
        ...baseInput,
        range: {
          from: '2025-10-01T09:00:00+09:00',
          to: '2025-10-01T12:00:00+09:00',
        },
        staffId: 'staff-1',
      },
      { supabase },
    )

    expect(result.slots).toEqual([
      {
        roomId: 'room-1',
        start: '2025-10-01T09:00:00+09:00',
        end: '2025-10-01T10:00:00+09:00',
      },
    ])
    expect(result.nextCursor).toBeUndefined()
  })

  it('機材の在庫と予約状況を考慮する', async () => {
    const supabase = createSupabaseStub(
      buildResponses({
        equipments: success([
          { id: 'equip-1', track_serial: true, stock: 2, active: true },
        ]),
        equipment_items: success([
          { id: 'item-a', equipment_id: 'equip-1', status: 'available' },
          { id: 'item-b', equipment_id: 'equip-1', status: 'available' },
          { id: 'item-c', equipment_id: 'equip-1', status: 'repair' },
        ]),
        reservation_equipment_items: success([
          {
            equipment_item_id: 'item-a',
            reservation_time_range:
              '[2025-10-01 09:00:00+09:00,2025-10-01 10:00:00+09:00)',
          },
        ]),
      }),
    )

    const result = await listAvailability(
      {
        ...baseInput,
        wantedEquipments: [{ equipmentId: 'equip-1', qty: 2 }],
      },
      { supabase },
    )

    expect(result.slots).toEqual([
      {
        roomId: 'room-1',
        start: '2025-10-01T10:00:00+09:00',
        end: '2025-10-01T11:00:00+09:00',
        feasibleEquipmentSets: [
          {
            items: [{ equipmentId: 'equip-1', qty: 2 }],
          },
        ],
      },
      {
        roomId: 'room-1',
        start: '2025-10-01T11:00:00+09:00',
        end: '2025-10-01T12:00:00+09:00',
        feasibleEquipmentSets: [
          {
            items: [{ equipmentId: 'equip-1', qty: 2 }],
          },
        ],
      },
      {
        roomId: 'room-1',
        start: '2025-10-01T12:00:00+09:00',
        end: '2025-10-01T13:00:00+09:00',
        feasibleEquipmentSets: [
          {
            items: [{ equipmentId: 'equip-1', qty: 2 }],
          },
        ],
      },
    ])
    expect(result.nextCursor).toBeUndefined()
  })

  it('未登録の機材を要求すると 404 エラー', async () => {
    const supabase = createSupabaseStub(buildResponses())

    await expect(
      listAvailability(
        {
          ...baseInput,
          wantedEquipments: [{ equipmentId: 'missing-equipment', qty: 1 }],
        },
        { supabase },
      ),
    ).rejects.toBeInstanceOf(AvailabilityResourceNotFoundError)
  })
})
