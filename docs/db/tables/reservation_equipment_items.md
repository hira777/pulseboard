# reservation_equipment_items テーブル定義書

## 概要
- **テーブル名**: `public.reservation_equipment_items`
- **目的**: 予約と機材個体（equipment_items）の割当を記録し、二重貸出を DB レベルで防ぐ。
- **主な利用画面/API**: 予約作成・編集（機材割当）、当日準備リスト、在庫異常検知。
- **関連（ER）**:
  - `reservations(1) ─ (N) reservation_equipment_items`
  - `equipment_items(1) ─ (N) reservation_equipment_items`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 割当 ID | `primary key` |
| `reservation_id` | `uuid` | ✔︎ |  | 親予約 | `references reservations(id) on delete cascade` |
| `equipment_item_id` | `uuid` | ✔︎ |  | 割り当てた機材個体 | `references equipment_items(id) on delete restrict` |
| `reservation_time_range` | `tstzrange` |  |  | 親予約の占有時間帯（`confirmed` / `in_use` のときのみ値あり） | トリガで自動同期、NULL は EXCLUDE 対象外 |
| `created_at` | `timestamptz` | ✔︎ | `now()` | 割当日時 |  |

- ユニーク制約: `(reservation_id, equipment_item_id)`

---

## インデックス / 制約
- `idx_reservation_equipment_items_reservation (reservation_id)`
- `idx_reservation_equipment_items_equipment_item (equipment_item_id)`
- EXCLUDE 制約: `exclude using gist (equipment_item_id with =, reservation_time_range with &&)`（個体×時間帯の重複防止）

---

## トリガ
- `reservation_equipment_items_set_time_range`（BEFORE INSERT/UPDATE）: 親予約の `time_range` をコピー。
- `reservations_sync_equipment_items_time_range`（AFTER UPDATE）: 予約の開始/終了/バッファ/ステータス変更時に関連行の `reservation_time_range` を同期。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select/insert/update/delete`: 親予約が属するテナントのメンバー。
    - 条件: `exists (select 1 from reservations r where r.id = reservation_equipment_items.reservation_id and app_is_tenant_member(r.tenant_id))`

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

