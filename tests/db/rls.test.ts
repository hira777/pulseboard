import { Client } from 'pg'

import { connect, impersonateTxLocal } from '../utils/db'

const d = process.env
let c: Client

describe('RLS/制約のテスト', () => {
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

  test('rooms: member は SELECT できるが INSERT はできない', async () => {
    await impersonateTxLocal(c, d.MEMBER_ID_STUDIO_A!)
    //     // SELECT OK
    const { rows } = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    expect(rows.length).toBeGreaterThan(0)
    //     // INSERT NG (RLS)
    await expect(
      c.query(`insert into public.rooms(tenant_id,name) values ($1,'Studio B (NG for member)')`, [
        tenant_id,
      ]),
    ).rejects.toThrow(/row-level security|permission|policy/i)
  })

  test('rooms: admin は INSERT できる', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    await c.query(
      `insert into public.rooms(tenant_id,name)
         values ($1,'Studio B')
         on conflict (tenant_id,name) do nothing`,
      [tenant_id],
    )
  })

  test('reservations: 重複予約は失敗(EXCLUDE 制約)、canceled は重複しても成功', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)

    const rooms = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    const room_id = rooms.rows[0].id

    // 予約Aを作成（10:00〜11:00, バッファ±15分）
    await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status, buffer_before_min, buffer_after_min)
         values ($1,$2,'2025-09-10T10:00:00+09:00','2025-09-10T11:00:00+09:00','confirmed',15,15)
         returning id`,
      [tenant_id, room_id],
    )

    // 予約C（10:30〜11:00, canceled）は OK
    await c.query(
      `insert into public.reservations(tenant_id,room_id,start_at,end_at,status)
         values ($1,$2,'2025-09-10T10:30:00+09:00','2025-09-10T11:00:00+09:00','canceled')`,
      [tenant_id, room_id],
    )

    // 予約B（10:30〜11:00, confirmed）は重複なので制約違反で NG
    await expect(
      c.query(
        `insert into public.reservations(tenant_id,room_id,start_at,end_at,status)
           values ($1,$2,'2025-09-10T10:30:00+09:00','2025-09-10T11:00:00+09:00','confirmed')`,
        [tenant_id, room_id],
      ),
    ).rejects.toThrow(/exclusion|overlap|conflicting key value/i)
  })

  test('reservation_equipment_items: 同テナント member は INSERTできる / 別テナントはできない', async () => {
    // 同じテナントの member
    await impersonateTxLocal(c, d.MEMBER_ID_STUDIO_A!)
    const rooms = await c.query(`select * from public.rooms where tenant_id=$1`, [tenant_id])
    const room_id = rooms.rows[0].id
    const reservations = await c.query(
      `insert into public.reservations
         (tenant_id, room_id, start_at, end_at, status, buffer_before_min, buffer_after_min)
         values ($1,$2,'2025-09-10T10:00:00+09:00','2025-09-10T11:00:00+09:00','confirmed',15,15)
         returning id`,
      [tenant_id, room_id],
    )
    const reservationId = reservations.rows[0].id
    const equipmentItems = await c.query(
      `select id from public.equipment_items where tenant_id = $1 order by serial limit 1`,
      [tenant_id],
    )
    expect(equipmentItems.rowCount).toBeGreaterThan(0)
    const equipment_item_id = equipmentItems.rows[0].id
    await c.query(
      `insert into public.reservation_equipment_items(reservation_id,equipment_item_id) values ($1,$2)`,
      [reservationId, equipment_item_id],
    )

    // 別テナントのmember
    await impersonateTxLocal(c, d.MEMBER_ID_STUDIO_B!)
    await expect(
      c.query(
        `insert into public.reservation_equipment_items(reservation_id,equipment_item_id) values ($1,$2)`,
        [reservationId, equipment_item_id],
      ),
    ).rejects.toThrow(/row-level security|permission|policy/i)
  })

  test('calendar_exceptions: member は SELECT できるが INSERT はできない', async () => {
    await impersonateTxLocal(c, d.MEMBER_ID_STUDIO_A!)

    const { rows } = await c.query(`select * from public.calendar_exceptions where tenant_id=$1`, [
      tenant_id,
    ])
    expect(rows.length).toBeGreaterThan(0)

    await expect(
      c.query(
        `insert into public.calendar_exceptions(tenant_id,scope,range,type)
           values ($1,'tenant',tstzrange('2025-09-12 00:00+09','2025-09-12 23:59+09','[)'),'holiday')`,
        [tenant_id],
      ),
    ).rejects.toThrow(/row-level security|permission|policy/i)
  })

  test('calendar_exceptions: admin INSERT できる', async () => {
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    // member の場合 → 失敗するはず
    c.query(
      `insert into public.calendar_exceptions(tenant_id,scope,range,type)
           values ($1,'tenant',tstzrange('2025-09-12 00:00+09','2025-09-12 23:59+09','[)'),'holiday')`,
      [tenant_id],
    )
  })

  test('audit_logs: member は INSERT できるが SELECT はできない / admin は SELECT できる', async () => {
    await impersonateTxLocal(c, d.MEMBER_ID_STUDIO_A!)

    await c.query(
      `insert into public.audit_logs(tenant_id,actor,action,target_type,diff)
         values ($1,$2,'reservation.update','reservation','{"k":"v"}')`,
      [tenant_id, d.MEMBER_ID_STUDIO_A],
    )

    const audit_logs = await c.query(`select * from public.audit_logs where tenant_id=$1`, [
      tenant_id,
    ])
    expect(audit_logs.rowCount).toBe(0)

    // // admin: SELECT は成功するはず
    await impersonateTxLocal(c, d.ADMIN_ID_STUDIO_A!)
    const audit_logs2 = await c.query(`select * from public.audit_logs where tenant_id=$1`, [
      tenant_id,
    ])
    expect(audit_logs2.rowCount).toBeGreaterThan(0)
  })
})
