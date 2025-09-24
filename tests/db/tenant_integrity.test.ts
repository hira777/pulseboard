import { Client } from 'pg'

import { connect, impersonateTxLocal, PG_ERROR_CODES } from '../utils/db'

const d = process.env

async function getRoomId(c: Client, tenantId: string) {
  const rooms = await c.query<{ id: string }>(
    `select id from public.rooms where tenant_id = $1 order by name limit 1`,
    [tenantId],
  )
  return rooms.rows[0].id
}

async function getCustomerId(c: Client, tenantId: string) {
  const customers = await c.query<{ id: string }>(
    `select id from public.customers where tenant_id = $1 order by created_at limit 1`,
    [tenantId],
  )
  return customers.rows[0].id
}

async function getServiceId(c: Client, tenantId: string) {
  const services = await c.query<{ id: string }>(
    `select id from public.services where tenant_id = $1 order by name limit 1`,
    [tenantId],
  )
  return services.rows[0].id
}

async function getStaffId(c: Client, tenantId: string) {
  const staff = await c.query<{ id: string }>(
    `select id from public.staff where tenant_id = $1 order by name limit 1`,
    [tenantId],
  )
  return staff.rows[0].id
}

async function getEquipmentId(c: Client, tenantId: string) {
  const equipments = await c.query<{ id: string }>(
    `select id from public.equipments where tenant_id = $1 order by name limit 1`,
    [tenantId],
  )
  return equipments.rows[0].id
}

async function getEquipmentItemId(c: Client, tenantId: string) {
  const equipment_items = await c.query<{ id: string }>(
    `select id from public.equipment_items where tenant_id = $1 order by serial limit 1`,
    [tenantId],
  )
  return equipment_items.rows[0].id
}

type ReservationParams = {
  tenantId: string
  roomId: string
  customerId?: string | null
  serviceId?: string | null
  staffId?: string | null
  startAt?: string
  endAt?: string
  status?: string
}

type ReservationRow = {
  id: string
  tenant_id: string
  customer_id: string | null
  service_id: string | null
  staff_id: string | null
  room_id: string
}

async function insertReservation(c: Client, params: ReservationParams): Promise<ReservationRow> {
  const start = params.startAt ?? '2025-09-15T10:00:00+09:00'
  const end = params.endAt ?? '2025-09-15T11:00:00+09:00'
  const status = params.status ?? 'confirmed'
  const reservation = await c.query<ReservationRow>(
    `insert into public.reservations
       (tenant_id, room_id, customer_id, service_id, staff_id, start_at, end_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, tenant_id, customer_id, service_id, staff_id, room_id`,
    [
      params.tenantId,
      params.roomId,
      params.customerId ?? null,
      params.serviceId ?? null,
      params.staffId ?? null,
      start,
      end,
      status,
    ],
  )
  return reservation.rows[0]
}

describe('テナント整合性のテスト', () => {
  let c: Client
  let sp = 0

  const tenantA = d.TENANT_ID_STUDIO_A!
  const tenantB = d.TENANT_ID_STUDIO_B!

  beforeAll(async () => {
    c = await connect()
    await c.query('begin')
  })

  beforeEach(async () => {
    sp += 1
    await c.query(`savepoint sp_${sp}`)
  })

  afterEach(async () => {
    await c.query(`rollback to savepoint sp_${sp}`)
  })

  afterAll(async () => {
    await c.query('rollback')
    await c.end()
  })

  test('customer_id は同一テナントのみ紐付け可能', async () => {
    const roomId = await getRoomId(c, tenantA)
    const customerId = await getCustomerId(c, tenantA)
    const foreignCustomerId = await getCustomerId(c, tenantB)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
        customerId,
      }),
    ).resolves.toMatchObject({
      tenant_id: tenantA,
      customer_id: customerId,
    })

    // テナントBの customer_id をテナントAの予約に紐づけようとするとエラー
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
        customerId: foreignCustomerId,
        startAt: '2025-09-15T12:00:00+09:00',
        endAt: '2025-09-15T13:00:00+09:00',
      }),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('room_id は同一テナントのみ紐付け可能', async () => {
    const roomId = await getRoomId(c, tenantA)
    const foreignRoomId = await getRoomId(c, tenantB)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
      }),
    ).resolves.toMatchObject({ tenant_id: tenantA, room_id: roomId })

    // テナントBの room_id をテナントAの予約に紐づけようとするとエラー
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId: foreignRoomId,
        startAt: '2025-09-15T12:00:00+09:00',
        endAt: '2025-09-15T13:00:00+09:00',
      }),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('service_id は同一テナントのみ紐付け可能', async () => {
    const roomId = await getRoomId(c, tenantA)
    const serviceId = await getServiceId(c, tenantA)
    const foreignServiceId = await getServiceId(c, tenantB)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
        serviceId,
      }),
    ).resolves.toMatchObject({
      tenant_id: tenantA,
      service_id: serviceId,
    })

    // テナントBの service_id をテナントAの予約に紐づけようとするとエラー
    await await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId: roomId,
        serviceId: foreignServiceId,
        startAt: '2025-09-15T12:00:00+09:00',
        endAt: '2025-09-15T13:00:00+09:00',
      }),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('staff_id は同一テナントのみ紐付け可能', async () => {
    const roomId = await getRoomId(c, tenantA)
    const staffId = await getStaffId(c, tenantA)
    const foreignStaffId = await getStaffId(c, tenantB)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
        staffId,
      }),
    ).resolves.toMatchObject({
      tenant_id: tenantA,
      staff_id: staffId,
    })

    // テナントBの staff_id をテナントAの予約に紐づけようとするとエラー
    await expect(
      insertReservation(c, {
        tenantId: tenantA,
        roomId,
        staffId: foreignStaffId,
        startAt: '2025-09-15T12:00:00+09:00',
        endAt: '2025-09-15T13:00:00+09:00',
      }),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('reservation_equipment_items には同一テナントの機材のみ登録可能', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    const roomId = await getRoomId(c, tenantA)
    const reservation = await insertReservation(c, {
      tenantId: tenantA,
      roomId,
    })
    const equipmentItemIdA = await getEquipmentItemId(c, tenantA)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_B!)
    const equipmentItemIdB = await getEquipmentItemId(c, tenantB)

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    // テナントAの予約にテナントAの機材を割り当てる
    await expect(
      c.query(
        `insert into public.reservation_equipment_items (reservation_id, equipment_item_id)
         values ($1, $2)
         returning reservation_id, equipment_item_id`,
        [reservation.id, equipmentItemIdA],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          reservation_id: reservation.id,
          equipment_item_id: equipmentItemIdA,
        },
      ],
    })

    // テナントAの予約にテナントBの機材を割り当てようとするとエラー
    await expect(
      c.query(
        `insert into public.reservation_equipment_items (reservation_id, equipment_item_id)
         values ($1, $2)
         returning reservation_id, equipment_item_id`,
        [reservation.id, equipmentItemIdB],
      ),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('equipment_items には同一テナントの機材のみ登録可能', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    const equipmentAId = await getEquipmentId(c, tenantA)
    const serial = 'CAM-001-ITEM-003'
    await expect(
      c.query(
        `insert into public.equipment_items (tenant_id, equipment_id, serial, status)
           values ($1, $2, $3, 'available')
           returning tenant_id, equipment_id`,
        [tenantA, equipmentAId, serial],
      ),
    ).resolves.toMatchObject({
      rows: [{ tenant_id: tenantA, equipment_id: equipmentAId }],
    })

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_B!)
    // テナントAの機材をテナントBの機材リストに登録しようとするとエラー
    await expect(
      c.query(
        `insert into public.equipment_items (tenant_id, equipment_id, serial, status)
           values ($1, $2, $3, 'available')
           returning tenant_id, equipment_id`,
        [tenantB, equipmentAId, 'serial'],
      ),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })

  test('messages は同一テナントの予約にのみ追加可能', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    const roomIdA = await getRoomId(c, tenantA)
    const reservation = await insertReservation(c, {
      tenantId: tenantA,
      roomId: roomIdA,
    })

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_B!)
    const roomIdB = await getRoomId(c, tenantB)
    const foreignReservation = await insertReservation(c, {
      tenantId: tenantB,
      roomId: roomIdB,
    })

    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await expect(
      c.query<{ tenant_id: string; reservation_id: string }>(
        `insert into public.messages (tenant_id, reservation_id, sender_profile_id, body)
         values ($1, $2, $3, 'same tenant message')
         returning tenant_id, reservation_id`,
        [tenantA, reservation.id, d.ADMIN_ID_STUDIO_A!],
      ),
    ).resolves.toMatchObject({
      rows: [{ tenant_id: tenantA, reservation_id: reservation.id }],
    })

    await expect(
      c.query(
        `insert into public.messages (tenant_id, reservation_id, sender_profile_id, body)
           values ($1, $2, $3, 'cross tenant test message')
           returning tenant_id, reservation_id`,
        [tenantA, foreignReservation.id, d.ADMIN_ID_STUDIO_A!],
      ),
    ).rejects.toMatchObject({
      code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    })
  })
})
