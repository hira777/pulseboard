# staff テーブル定義書

## 概要
- **テーブル名**: `public.staff`
- **目的**: スタッフ情報を管理。任意で `auth.users` と紐付け可能。
- **主な利用画面/API**: スタッフ管理、予約アサイン。
- **関連（ER）**:
  - `tenants(1) ─ (N) staff`
  - `staff(1) ─ (N) reservations`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | スタッフID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `profile_id` | `uuid` |  |  | `auth.users` 参照（任意） | `references auth.users(id) on delete set null` |
| `name` | `text` | ✔︎ |  | 表示名 |  |
| `skills` | `jsonb` |  |  | スキル情報 |  |
| `active` | `boolean` | ✔︎ | `true` | 在籍/稼働中 |  |

---

## インデックス
- 既定（PK のみ）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: メンバー（`app_is_tenant_member(tenant_id)`）
  - `insert/update/delete`: 管理者（`app_is_tenant_admin(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

