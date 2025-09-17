# equipment_items テーブル定義書

## 概要
- **テーブル名**: `public.equipment_items`
- **目的**: 機材の個体（シリアル）を管理。SKU と対で一意。
- **主な利用画面/API**: 整備・貸出管理、在庫詳細確認。
- **関連（ER）**:
  - `equipments(1) ─ (N) equipment_items`
  - `equipment_items(1) ─ (N) reservation_equipment_items`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 個体ID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `equipment_id` | `uuid` | ✔︎ |  | 紐づくSKU | `references equipments(id) on delete cascade` |
| `serial` | `text` |  |  | 個体シリアル | `unique(tenant_id, equipment_id, serial)` |
| `status` | `text` | ✔︎ | `'available'` | 状態 | `check (status in ('available','repair','lost'))` |

---

## インデックス
- 既定（PK, unique）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: メンバー（`app_is_tenant_member(tenant_id)`）
  - `insert/update/delete`: 管理者（`app_is_tenant_admin(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

---

## 補足
- `status <> 'available'` の個体は UI で予約候補から除外し、既存割当がある場合は警告を表示する想定。
- 個体の予約割当は `reservation_equipment_items` テーブルで管理し、DB の EXCLUDE 制約が二重予約を防ぐ。
