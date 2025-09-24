# equipments テーブル定義書

## 概要
- **テーブル名**: `public.equipments`
- **目的**: 機材 SKU（型番）を管理。必要に応じて個体管理へ接続。
- **主な利用画面/API**: 在庫設定、予約時の機材選択。
- **関連（ER）**:
  - `tenants(1) ─ (N) equipments`
  - `equipments(1) ─ (N) equipment_items`
  - `equipment_items(1) ─ (N) reservation_equipment_items`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 機材SKU ID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `sku` | `text` | ✔︎ |  | 型番（テナント内一意） | `unique(tenant_id, sku)` |
| `name` | `text` | ✔︎ |  | 機材名 |  |
| `track_serial` | `boolean` | ✔︎ | `false` | 個体管理するか |  |
| `stock` | `int` | ✔︎ | `0` | SKU在庫数（個体管理しない場合） |  |
| `active` | `boolean` | ✔︎ | `true` | 取り扱い中 |  |

---

## インデックス/制約
- UNIQUE 制約: `(tenant_id, id)`（テナントとIDの組合せを外部参照で利用）
- UNIQUE 制約: `(tenant_id, sku)`（テナント内でSKUを一意に保つ）

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: メンバー（`app_is_tenant_member(tenant_id)`）
  - `insert/update/delete`: 管理者（`app_is_tenant_admin(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。
