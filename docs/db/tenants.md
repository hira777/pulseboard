# tenants テーブル定義書

## 概要
- **テーブル名**: `public.tenants`
- **目的**: テナント（組織）を管理する。名称・slug 等の基本情報を保持。
- **主な利用画面/API**: 今後の管理画面、入居先切替、権限判定の基点。
- **関連（ER）**:
  - `tenants(1) ─ (N) tenant_users`
  - `tenants(1) ─ (N) rooms/services/equipments/customers/staff/reservations/...`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | テナントID | `primary key` |
| `name` | `text` | ✔︎ |  | テナント表示名 |  |
| `slug` | `text` |  |  | 人間可読ID | `unique` |
| `created_at` | `timestamptz` | ✔︎ | `now()` | 作成時刻 |  |

---

## インデックス
- 既定（PK のみ）。運用で `slug` を参照キーにする場合はユニークインデックスで十分。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **関数**: `app_is_tenant_member(id)`, `app_is_tenant_admin(id)`
- **ポリシー**:
  - `select`: メンバーのみ（`app_is_tenant_member(id)`）
  - `insert/update/delete`: 管理者のみ（`app_is_tenant_admin(id)`）

---

## 補足
- `slug` は任意。URL や UI での識別に利用可能。

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

