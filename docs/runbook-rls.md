# ローカル Supabase での RLS/制約 実証手順

以下はローカル Supabase 環境で、RLS（Row Level Security）と主要制約を実証するための手順書です。
必要に応じて Supabase Studio または psql いずれでも実行できます。

---

## 前提

- Supabase CLI と Docker を利用可能であること（未導入なら `brew install supabase/tap/supabase`）。
- psql または Supabase Studio の SQL Editor を利用可能であること。

---

## 1) 環境起動とマイグレーション適用

プロジェクト直下で以下を実行します。

```bash
supabase start
supabase db reset   # ローカルDBを初期化し supabase/migrations を全適用
```

接続情報の確認:

```bash
supabase status  # DB URL 例: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

---

## 2) テストユーザー作成（admin/member）

Supabase Studio → Auth → Users → “Add user” を 2 件作成します（メール/パスワード、Confirm email を有効化）。
作成した 2 ユーザーの `id`（UUID）を控えます（後続の SQL で使用）。

---

## 3) 最小データの投入（SQL）

psql で接続し、以下を順に実行します（メール/UUID は実値に置換してください）。

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

```sql
-- テナント作成
insert into public.tenants(name, slug)
values ('Acme Studio','acme')
returning id;  -- => tenant_id を控える

-- テナント所属とロール
insert into public.tenant_users(tenant_id, profile_id, role)
values ('<tenant_id>','<admin_user_id>','admin'),
       ('<tenant_id>','<member_user_id>','member');

-- マスタ最低限
insert into public.rooms(tenant_id,name,capacity)
values ('<tenant_id>','Studio A',8)
returning id;  -- => room_id

insert into public.services(tenant_id,name,duration_min,buffer_before_min,buffer_after_min,color)
values ('<tenant_id>','Standard',60,15,15,'#2e7');

insert into public.equipments(tenant_id,sku,name,track_serial,stock,active)
values ('<tenant_id>','CAM-001','Camera A',true,0,true)
returning id;  -- => equipment_id
```

---

## 4) RLS の基本挙動テスト

JWT クレームを切り替えて RLS を確認します。

```sql
-- member として実行
set role authenticated;
set session request.jwt.claims = '{"sub":"<member_user_id>","role":"authenticated"}';

-- 読めること
select * from public.rooms;  -- 期待: OK

-- 書けないこと（admin 専用）
insert into public.rooms(tenant_id,name) values ('<tenant_id>','Studio B');
-- 期待: RLS で拒否
```

```sql
-- admin として実行
set session request.jwt.claims = '{"sub":"<admin_user_id>","role":"authenticated"}';

-- 書けること
insert into public.rooms(tenant_id,name) values ('<tenant_id>','Studio B');
-- 期待: 成功
```

---

## 5) 予約の重複排他（EXCLUDE 制約）テスト

前提: `room_id` は Studio A の ID。
同テナントの admin または member で実行します。

```sql
-- 予約A（確定＋バッファ15/15）
insert into public.reservations(
  tenant_id,room_id,start_at,end_at,status,buffer_before_min,buffer_after_min
) values (
  '<tenant_id>','<room_id>',
  '2025-09-10T10:00:00+09:00','2025-09-10T11:00:00+09:00',
  'confirmed',15,15
) returning id;  -- => res_a

-- 予約B（重複ありの例: 10:30〜11:00）
insert into public.reservations(tenant_id,room_id,start_at,end_at,status)
values (
  '<tenant_id>','<room_id>',
  '2025-09-10T10:30:00+09:00','2025-09-10T11:00:00+09:00','confirmed'
);
-- 期待: reservations_no_overlap_per_room の排他制約でエラー

-- 予約C（canceled は重複対象外）
insert into public.reservations(tenant_id,room_id,start_at,end_at,status)
values (
  '<tenant_id>','<room_id>',
  '2025-09-10T10:30:00+09:00','2025-09-10T11:00:00+09:00','canceled'
);
-- 期待: 成功
```

---

## 6) 機材予約の RLS（予約にぶら下がる子テーブル）

同テナント member として、先ほどの `res_a` と `equipment_id` を使用します。

```sql
-- member で JWT をセット
set session request.jwt.claims = '{"sub":"<member_user_id>","role":"authenticated"}';

-- 子テーブルへの書き込み（同テナント）
insert into public.reservation_equipment(reservation_id,equipment_id,qty)
values ('<res_a>','<equipment_id>',1);
-- 期待: 成功
```

別ユーザー（テナント未所属 UUID で疑似）

```sql
set session request.jwt.claims = '{"sub":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","role":"authenticated"}';

insert into public.reservation_equipment(reservation_id,equipment_id,qty)
values ('<res_a>','<equipment_id>',1);
-- 期待: RLS 拒否
```

---

## 7) 例外日 / 監査の権限

calendar_exceptions（例外日）

```sql
-- member: 書き込み NG（admin のみ）
insert into public.calendar_exceptions(tenant_id,scope,range,type)
values ('<tenant_id>','tenant',tstzrange('2025-09-11 00:00+09','2025-09-11 23:59+09'),'holiday');
-- 期待: RLS 拒否

-- admin: 同 SQL
-- 期待: 成功
```

audit_logs（監査）

```sql
-- member: 挿入 OK（参照は NG）
insert into public.audit_logs(tenant_id,actor,action,target_type,diff)
values ('<tenant_id>','<member_user_id>','reservation.update','reservation','{"k":"v"}');

-- member: 参照 NG
select * from public.audit_logs where tenant_id = '<tenant_id>';
-- 期待: RLS 拒否

-- admin: 参照 OK
select * from public.audit_logs where tenant_id = '<tenant_id>';
-- 期待: 成功
```

---

## 8) 期待結果チェックリスト

- member でマスタ書込 NG／参照 OK、admin で書込 OK
- 同一部屋・重複時間帯は排他制約で NG
- `canceled` は重複対象外で OK
- `reservation_equipment` は同テナント member で OK／他テナントで NG
- `calendar_exceptions` は admin のみ書込 OK
- `audit_logs` は admin のみ参照 OK／member も挿入 OK

---

## 9) よくある詰まり

- JWT クレーム未設定: `auth.uid()` が NULL になり RLS で拒否されます。毎回 `set role authenticated; set session request.jwt.claims = '{...}'` を実行してください。
- タイムゾーン: 例では `+09:00` を明記。環境 TZ に依存しないよう ISO8601 で指定してください。
- `supabase db reset` はローカル DB を初期化します。既存データがある場合はご注意ください。

---

## 10) 次の一歩（完了後）

`/t/:tenantId` ルーティング導入へ進みます。

- 追加: `src/app/t/[tenantId]/layout.tsx`, `src/app/t/[tenantId]/dashboard/page.tsx`, `src/app/t/[tenantId]/reservations/page.tsx`
- middleware で Cookie `tenant_id` を見て `/t/:tenantId` へ誘導。未認可は 404 秘匿。
