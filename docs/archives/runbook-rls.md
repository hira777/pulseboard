<!--
NOTE: このドキュメントは 2025-09 Jest での自動化導入に伴い、
      手動の RLS テスト手順書としては不要になりました。
      参考用に archives に移動しています。
-->

# NOTE⚠️: このドキュメントは 2025-09 Jest での自動化導入に伴い、手動の RLS テスト手順書としては不要になりました。参考用に archives に移動しています。

# ローカル Supabase での RLS/制約 実証手順

以下はローカル Supabase 環境で、RLS（Row Level Security）と主要制約を実証するための手順書です。
必要に応じて Supabase Studio（ローカル）または psql いずれでも実行できます。

---

## 前提

- Supabase CLI と Docker を利用可能であること。
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
supabase status
# 以下のような出力がされる
# DB URL 例: postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Studio URL 例: http://127.0.0.1:54323
```

---

## 2) テストユーザー作成（admin/member）

1. [http://127.0.0.1:54323/project/default/auth/users](Authentication)の「Add user」 でテストユーザーを 2 件作成します（メール/パスワード、Confirm email を有効化）。
1. 作成した 2 ユーザーの`id`（UUID）を控えます（後続の SQL で使用）。
1. [http://127.0.0.1:54323/project/default/database/tables](Database Tables)の「profiles」テーブルを編集します。片方のユーザーの`role`を admin に変更してください。

---

## 3) 最小データの投入（SQL）

以下のように psql で接続するか、

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Supabase Studio の SQL Editor で以下を順に実行します。メール/UUID などは順次作成したものに置換してください。

例えば先ほど作成した`role`が`admin`のユーザーの`id`が`'a612029e-3286-4b94-912d-f93329c35429'`の場合`'<admin_user_id>'`は`'a612029e-3286-4b94-912d-f93329c35429'`に置換して実行してください。

```sql
-- テナント作成
insert into
  public.tenants (name, slug)
values
  ('Acme Studio', 'acme') returning id;
-- => tenant_id を控える
```

```sql
-- tenant_id のテナントに属するテナントユーザーを作成
insert into
  public.tenant_users (tenant_id, profile_id, role)
values
  ('<tenant_id>', '<admin_user_id>', 'admin'),
  ('<tenant_id>', '<member_user_id>', 'member');

-- 最低限のマスタを作成
-- tenant_id のテナントに属する部屋を作成
insert into
  public.rooms (tenant_id, name, capacity)
values
  ('<tenant_id>', 'Studio A', 8) returning id;

-- => room_id
-- tenant_id のテナントに属する提供メニューを作成
insert into
  public.services (
    tenant_id,
    name,
    duration_min,
    buffer_before_min,
    buffer_after_min,
    color
  )
values
  ('<tenant_id>', 'Standard', 60, 15, 15, '#2e7');

-- tenant_id のテナントに属する機器を作成
insert into
  public.equipments (tenant_id, sku, name, track_serial, stock, active)
values
  (
    '<tenant_id>',
    'CAM-001',
    'Camera A',
    true,
    0,
    true
  ) returning id;

-- => equipment_id
```

---

## 4) RLS の基本挙動テスト

RLS は「現在のリクエストに含まれる JWT クレーム（`sub`や`role`など）」をもとに動作します。

Supabase の認証を経由せずに psql / SQL Editor 上で確認する場合は、自分でセッション変数 `request.jwt.claims`を設定して「認証済みユーザーとしての状態」を再現する必要があります。

以下では member ユーザー と admin ユーザー の 2 つの JWT を切り替えて、それぞれの権限で RLS が正しく効いているかをテストします。

```sql
-- member ユーザーを再現
-- JWT クレームに member_user_id を設定
set
  role authenticated;

set
  session request.jwt.claims = '{"sub":"<member_user_id>","role":"authenticated"}';

-- rooms を参照
-- 期待: データが取得できる（member でも参照は許可されている）
select
  *
from
  public.rooms;

-- rooms に新規レコードを追加
-- 期待: RLS で拒否(書き込みは admin 専用なので NG)
-- エラー例: new row violates row-level security policy for table "rooms"
insert into
  public.rooms (tenant_id, name)
values
  ('<tenant_id>', 'Studio B');
```

```sql
-- admin ユーザーを再現
-- JWT クレームに admin_user_id を設定
set
  session request.jwt.claims = '{"sub":"<admin_user_id>","role":"authenticated"}';

-- rooms に新規レコードを追加してみる
-- 期待: 成功（rooms テーブルに Studio B が追加される）
insert into
  public.rooms (tenant_id, name)
values
  ('<tenant_id>', 'Studio B');
```

---

## 5) 予約の重複排他（EXCLUDE 制約）テスト

同じ部屋で時間が重なる予約を登録できないようにするための排他制約（EXCLUDE 制約）が正しく動作するかを確認します。

具体的には以下をテストします。

- 重複する予約は登録できず、制約違反エラーになること
- `canceled`ステータスの予約は重複チェックの対象外となり、登録できること
- バッファ時間（前後の余白）も含めて重複判定が行われること

前提: `room_id` は Studio A の ID。
同テナントの admin または member で実行します。

```sql
-- 予約Aを登録（10:00〜11:00、バッファ前後15分つき）
insert into
  public.reservations (
    tenant_id,
    room_id,
    start_at,
    end_at,
    status,
    buffer_before_min,
    buffer_after_min
  )
values
  (
    '<tenant_id>',
    '<room_id>',
    '2025-09-10T10:00:00+09:00',
    '2025-09-10T11:00:00+09:00',
    'confirmed',
    15,
    15
  ) returning id;

-- => res_a(「予約A」で作成したレコードの UUID。後続テストで参照する)
-- 重複する予約Bを登録（10:30〜11:00）
-- 予約Aの時間帯と重なるため NG
-- 期待: reservations_no_overlap_per_room の排他制約によりエラーになる
-- エラー例: conflicting key value violates exclusion constraint "reservations_no_overlap_per_room"
insert into
  public.reservations (tenant_id, room_id, start_at, end_at, status)
values
  (
    '<tenant_id>',
    '<room_id>',
    '2025-09-10T10:30:00+09:00',
    '2025-09-10T11:00:00+09:00',
    'confirmed'
  );

-- 重複する予約Cを登録（10:30〜11:00, status=canceled）
-- 時間帯は重なるが、canceled は重複判定の対象外
-- 期待: 正常に登録できる
insert into
  public.reservations (tenant_id, room_id, start_at, end_at, status)
values
  (
    '<tenant_id>',
    '<room_id>',
    '2025-09-10T10:30:00+09:00',
    '2025-09-10T11:00:00+09:00',
    'canceled'
  );
```

---

## 6) 機材予約の RLS のテスト（親予約にアクセスできるユーザーなら、その予約に紐づく機材レコードも操作できる」）

同テナント member として、先ほどの `res_a` と `equipment_id` を使用します。

```sql
-- member ユーザーを再現
-- JWT クレームに member_user_id を設定
set
  role authenticated;

set
  session request.jwt.claims = '{"sub":"<member_user_id>","role":"authenticated"}';

-- 予約に紐づく機材の追加（reservation_equipment）
-- 前提: 親の予約 <res_a> が「自分のテナント」に属している
-- → 所属テナントのメンバーなら INSERT が許可される
-- 期待: 成功（同じテナントの予約なので RLS により許可）
insert into
  public.reservation_equipment (reservation_id, equipment_id, qty)
values
  ('<res_a>', '<equipment_id>', 1);
```

別ユーザー（テナント未所属 UUID で疑似）

```sql
set
  role authenticated;

set
  session request.jwt.claims = '{"sub":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","role":"authenticated"}';

-- 期待: RLS で拒否
-- エラー例: new row violates row-level security policy for table  "reservation_equipment"
insert into
  public.reservation_equipment (reservation_id, equipment_id, qty)
values
  ('<res_a>', '<equipment_id>', 1);
```

---

## 7) 例外日 / 監査の権限

calendar_exceptions（例外日）

```sql
-- member: 書き込み NG（admin のみ）
insert into
  public.calendar_exceptions (tenant_id, scope, range, type)
values
  (
    '<tenant_id>',
    'tenant',
    tstzrange ('2025-09-11 00:00+09', '2025-09-11 23:59+09'),
    'holiday'
  );

-- 期待: RLS 拒否
-- admin: 同 SQL
-- 期待: 成功
```

audit_logs（監査）

```sql
-- member: 挿入 OK（参照は NG）
insert into
  public.audit_logs (tenant_id, actor, action, target_type, diff)
values
  (
    '<tenant_id>',
    '<member_user_id>',
    'reservation.update',
    'reservation',
    '{"k":"v"}'
  );

-- member: 参照 NG
select
  *
from
  public.audit_logs
where
  tenant_id = '<tenant_id>';

-- 期待: RLS 拒否
-- admin: 参照 OK
select
  *
from
  public.audit_logs
where
  tenant_id = '<tenant_id>';

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

## 9) よくあるつまずきポイント

- JWT クレーム未設定: `auth.uid()` が NULL になり RLS で拒否されます。毎回 `set role authenticated; set session request.jwt.claims = '{...}'` を実行してください。
- タイムゾーン: 例では `+09:00` を明記。環境 TZ に依存しないよう ISO8601 で指定してください。
- `supabase db reset` はローカル DB を初期化します。既存データがある場合はご注意ください。

---

## 10) 次の一歩（完了後）

`/t/:tenantId` ルーティング導入へ進みます。

- 追加: `src/app/t/[tenantId]/layout.tsx`, `src/app/t/[tenantId]/dashboard/page.tsx`, `src/app/t/[tenantId]/reservations/page.tsx`
- middleware で Cookie `tenant_id` を見て `/t/:tenantId` へ誘導。未認可は 404 秘匿。
