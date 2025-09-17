import { Client } from 'pg'

import { connect, impersonateTxLocal } from '../utils/db'

const d = process.env
let c: Client

describe('予約機材個体割当の整合性のテスト', () => {
  let sp = 0
  let tenant_id: string

  beforeAll(async () => {
    c = await connect()
    await c.query('begin')
    const tenants = await c.query(`select * from public.tenants where id=$1`, [
      d.TENANT_ID_STUDIO_A!,
    ])
    tenant_id = tenants.rows[0].id
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

  test('reservation_equipment_items: INSERT 時に reservation_time_range が親予約と同期される', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)

    const rooms = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    const room_id = rooms.rows[0].id
    const reservation = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status, buffer_before_min, buffer_after_min)
         values ($1,$2,'2025-09-10T10:00:00+09:00','2025-09-10T11:00:00+09:00','confirmed',15,15)
         returning id`,
      [tenant_id, room_id],
    )
    const reservationId = reservation.rows[0].id
    const equipmentItems = await c.query(
      `select id from public.equipment_items where tenant_id = $1 order by serial limit 1`,
      [tenant_id],
    )
    expect(equipmentItems.rowCount).toBeGreaterThan(0)
    const equipmentItemId = equipmentItems.rows[0].id

    await c.query(
      `insert into public.reservation_equipment_items(reservation_id, equipment_item_id) values ($1,$2)`,
      [reservationId, equipmentItemId],
    )

    const syncResult = await c.query(
      `select
         rei.reservation_time_range = r.time_range as is_equal,
         rei.reservation_time_range = make_occupy_tstzrange(
           r.start_at, r.end_at, r.buffer_before_min, r.buffer_after_min, r.status
         ) as matches_generated
         from public.reservation_equipment_items rei
         join public.reservations r on r.id = rei.reservation_id
         where rei.reservation_id = $1`,
      [reservationId],
    )

    expect(syncResult.rowCount).toBe(1)
    expect(syncResult.rows[0].is_equal).toBe(true)
    expect(syncResult.rows[0].matches_generated).toBe(true)
  })

  test('reservation_equipment_items: 予約の更新・キャンセルで reservation_time_range が追従する', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)

    const rooms = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    const room_id = rooms.rows[0].id
    const reservation = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status, buffer_before_min, buffer_after_min)
         values ($1,$2,'2025-09-10T10:00:00+09:00','2025-09-10T11:00:00+09:00','confirmed',15,15)
         returning id`,
      [tenant_id, room_id],
    )
    const reservationId = reservation.rows[0].id
    const equipmentItems = await c.query(
      `select id from public.equipment_items where tenant_id = $1 order by serial limit 1`,
      [tenant_id],
    )
    expect(equipmentItems.rowCount).toBeGreaterThan(0)
    const equipmentItemId = equipmentItems.rows[0].id

    await c.query(
      `insert into public.reservation_equipment_items(reservation_id, equipment_item_id) values ($1,$2)`,
      [reservationId, equipmentItemId],
    )

    // 予約を更新する
    await c.query(
      `update public.reservations
         set start_at='2025-09-15T12:30:00+09:00', end_at='2025-09-15T14:00:00+09:00', buffer_before_min=5, buffer_after_min=20
         where id=$1`,
      [reservationId],
    )

    const syncResultAfterUpdate = await c.query(
      `select
         rei.reservation_time_range = r.time_range as is_equal,
         lower(rei.reservation_time_range) = lower(
           make_occupy_tstzrange(r.start_at, r.end_at, r.buffer_before_min, r.buffer_after_min, r.status)
         ) as lower_matches,
         upper(rei.reservation_time_range) = upper(
           make_occupy_tstzrange(r.start_at, r.end_at, r.buffer_before_min, r.buffer_after_min, r.status)
         ) as upper_matches
         from public.reservation_equipment_items rei
         join public.reservations r on r.id = rei.reservation_id
         where rei.reservation_id = $1`,
      [reservationId],
    )

    expect(syncResultAfterUpdate.rowCount).toBe(1)
    expect(syncResultAfterUpdate.rows[0].is_equal).toBe(true)
    expect(syncResultAfterUpdate.rows[0].lower_matches).toBe(true)
    expect(syncResultAfterUpdate.rows[0].upper_matches).toBe(true)

    // 予約をキャンセルする
    await c.query(`update public.reservations set status='canceled' where id=$1`, [reservationId])

    const syncResultAfterCancel = await c.query(
      `select rei.reservation_time_range, r.time_range
         from public.reservation_equipment_items rei
         join public.reservations r on r.id = rei.reservation_id
         where rei.reservation_id = $1`,
      [reservationId],
    )

    expect(syncResultAfterCancel.rowCount).toBe(1)
    expect(syncResultAfterCancel.rows[0].reservation_time_range).toBeNull()
    expect(syncResultAfterCancel.rows[0].time_range).toBeNull()

    const newReservation = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status)
         values ($1,$2,'2025-09-15T12:30:00+09:00','2025-09-15T13:30:00+09:00','confirmed')
         returning id`,
      [tenant_id, room_id],
    )
    const newReservationId = newReservation.rows[0].id
    await c.query(
      `insert into public.reservation_equipment_items(reservation_id, equipment_item_id) values ($1,$2)`,
      [newReservationId, equipmentItemId],
    )
  })

  test('reservation_equipment_items: 同一個体でも終端が接する予約は許可され、重複は排他される', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)

    const rooms = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    const roomAId = rooms.rows[0].id
    const roomBId = rooms.rows[1].id

    const equipmentItems = await c.query(
      `select id from public.equipment_items where tenant_id=$1 order by serial limit 1`,
      [tenant_id],
    )
    expect(equipmentItems.rowCount).toBeGreaterThan(0)
    const equipmentItemId = equipmentItems.rows[0].id

    // 予約A: 10:00〜11:00 に部屋A予約
    const reservationA = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status)
         values ($1,$2,$3,$4,'confirmed')
         returning id`,
      [tenant_id, roomAId, '2025-09-16T10:00:00+09:00', '2025-09-16T11:00:00+09:00'],
    )
    const reservationAId = reservationA.rows[0].id
    // 予約Aに機材個体を割り当て
    await c.query(
      `insert into public.reservation_equipment_items(reservation_id, equipment_item_id)
         values ($1,$2)`,
      [reservationAId, equipmentItemId],
    )

    // 予約B: 予約Aの終端と接する 11:00〜12:00 に部屋A予約
    const reservationB = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status)
         values ($1,$2,$3,$4,'confirmed')
         returning id`,
      [tenant_id, roomAId, '2025-09-16T11:00:00+09:00', '2025-09-16T12:00:00+09:00'],
    )
    const reservationBId = reservationB.rows[0].id
    // 予約Bにも同じ機材個体を割り当て（終端が接しているのでOK）
    await c.query(
      `insert into public.reservation_equipment_items(reservation_id, equipment_item_id)
       values ($1,$2)`,
      [reservationBId, equipmentItemId],
    )

    // 予約C: 10:00〜11:00 に部屋B予約
    const reservationC = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status)
         values ($1,$2,$3,$4,'confirmed')
         returning id`,
      [tenant_id, roomBId, '2025-09-16T10:00:00+09:00', '2025-09-16T11:00:00+09:00'],
    )
    const reservationCId = reservationC.rows[0].id
    await c.query('savepoint sp_fail_1')
    // 予約Cに機材個体を割り当て。予約Aと時間帯が重複している機材なのでNG
    await expect(
      c.query(
        `insert into public.reservation_equipment_items(reservation_id, equipment_item_id)
         values ($1,$2)`,
        [reservationCId, equipmentItemId],
      ),
    ).rejects.toThrow(/exclusion|overlap|conflicting key value/i)
    await c.query('rollback to savepoint sp_fail_1')

    // 予約D: 10:30〜11:30 に部屋A予約。予約Aと重複する時間帯なのでNG
    await expect(
      c.query(
        `insert into public.reservations
           (tenant_id, room_id, start_at, end_at, status)
           values ($1,$2,$3,$4,'confirmed')
           returning id`,
        [tenant_id, roomAId, '2025-09-16T10:30:00+09:00', '2025-09-16T11:30:00+09:00'],
      ),
    ).rejects.toThrow(/exclusion|overlap|conflicting key value/i)
  })
})
