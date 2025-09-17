# tenant_users テーブル定義書

## 概要
- **テーブル名**: `public.tenant_users`
- **目的**: ユーザーのテナント所属とロール（`admin`/`member`）を管理。
- **主な利用画面/API**: 権限付与、参加/離脱管理、管理画面。
- **関連（ER）**:
  - `tenants(1) ─ (N) tenant_users`
  - `auth.users(1) ─ (N) tenant_users`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `profile_id` | `uuid` | ✔︎ |  | `auth.users.id` | `references auth.users(id) on delete cascade` |
| `role` | `text` | ✔︎ | `'member'` | ロール | `check (role in ('admin','member'))` |
| `created_at` | `timestamptz` | ✔︎ | `now()` | 追加時刻 |  |
| （PK） |  |  |  | `(tenant_id, profile_id)` | `primary key` |

---

## インデックス
- 既定（複合PK）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: 管理者、または本人行（`profile_id = auth.uid()`）
  - `insert/update/delete`: 管理者のみ（`app_is_tenant_admin(tenant_id)`）

---

## 補足
- 1ユーザーは複数テナントに所属可能。

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

