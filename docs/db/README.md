# DB 設計メモ

本ドキュメントは [schema.md](./schema.md) の補足として、DB 設計上の方針や検討事項をまとめる。

## 1. 正規化方針

- 基本は **第 3 正規形** を採用する。
  - `reservations` テーブルは「部屋・サービス・顧客・スタッフ」を外部キーで参照。
  - `reservation_equipment_items` によって予約と機材個体の多対多を表現。
- 冗長な情報は極力排除するが、**性能確保のための非正規化/生成列** は許容する。
  - 例: `reservations.time_range` (生成列, `tstzrange(start_at, end_at)`)
  - 例: `reservations.version` (楽観ロック用整数)

## 2. RLS (Row Level Security) 方針

- **全テーブル**に `tenant_id` を必須カラムとして持たせる。
- 全テーブルで **RLS を有効化**する。

### RLS ポリシー例

```sql
-- 全ユーザーは自分の所属するテナントのみ参照可能
create policy reservations_select on public.reservations
for select
using (app_is_tenant_member(tenant_id));

-- admin は編集可能
create policy reservations_admin_write on public.reservations
for all
using (app_is_tenant_admin(tenant_id))
with check (app_is_tenant_admin(tenant_id));
```

### 補助関数

```sql
create or replace function app_is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tenant_users tu
    where tu.tenant_id = target_tenant
      and tu.profile_id = auth.uid()
  );
$$;
```

## 3. インデックス設計

### 予約テーブル (`reservations`)

- **時間競合検索**

  ```sql
  create index reservations_time_range_idx
    on reservations using gist (time_range);
  ```

  → 可用枠検索・重複予約チェックに利用。

- **高速検索用**

  ```sql
  create index reservations_tenant_room_start_idx
    on reservations (tenant_id, room_id, start_at);
  ```

- **楽観ロック用**
  ```sql
  create unique index reservations_id_version_idx
    on reservations (id, version);
  ```

### 機材 (`equipments`, `equipment_items`, `reservation_equipment_items`)

- **SKU の一意制約**

  ```sql
  create unique index equipments_tenant_sku_idx
    on equipments (tenant_id, sku);
  ```

- **個体管理**
  ```sql
  create index equipment_items_tenant_status_idx
    on equipment_items (tenant_id, status);
  ```

- **個体割当の検索**
  ```sql
  create index reservation_equipment_items_reservation_idx
    on reservation_equipment_items (reservation_id);

  create index reservation_equipment_items_equipment_item_idx
    on reservation_equipment_items (equipment_item_id);
  ```

### 顧客 (`customers`)

- **重複判定**

  ```sql
  create unique index customers_tenant_email_idx
    on customers (tenant_id, email) where email is not null;

  create unique index customers_tenant_phone_idx
    on customers (tenant_id, phone) where phone is not null;
  ```

### 監査ログ (`audit_logs`)

- **時系列検索**
  ```sql
  create index audit_logs_tenant_created_idx
    on audit_logs (tenant_id, created_at desc);
  ```

## 4. 制約設計

- **予約の重複防止**: `EXCLUDE` 制約

  ```sql
  alter table reservations add constraint reservations_no_overlap
    exclude using gist (
      room_id with =,
      time_range with &&
    );
  ```

- **機材個体の重複防止**

  ```sql
  alter table reservation_equipment_items add constraint reservation_equipment_items_no_overlap
    exclude using gist (
      equipment_item_id with =,
      reservation_time_range with &&
    );
  ```

- **外部キー**: テナント整合性を保つため `on delete cascade` または `restrict` を適切に設定。
  - 例: `room_id` → `on delete restrict`
  - 例: `customer_id` → `on delete set null`

## 5. パフォーマンスチューニングの考慮点

- **予約検索**: `time_range` に対して GiST インデックスを活用し、重複検知を効率化。
- **大規模データ**（10 万件以上）に備え、必ず **ページング (limit/offset or cursor)** を導入。
- **頻出クエリ**は EXPLAIN/ANALYZE でボトルネックを確認する。

## 6. 将来検討メモ

- **スキーマ戦略**: 現状は 1 スキーマ + RLS、将来は「テナントごとスキーマ分離」を検討。
- **アーカイブ戦略**: 1 年以上前の予約を `reservations_archive` に移動し、運用データを軽量化。
- **シャーディング**: 大規模テナント向けに DB シャード分割も検討余地あり。
- **全文検索**: 顧客名・メモ検索に pg_trgm / tsvector を導入可能。
