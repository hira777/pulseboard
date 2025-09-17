# audit_logs テーブル定義書

## 概要
- **テーブル名**: `public.audit_logs`
- **目的**: 監査ログを管理（だれが/なにを/いつ）。
- **主な利用画面/API**: 管理コンソール、運用監査。
- **関連（ER）**:
  - `tenants(1) ─ (N) audit_logs`
  - `auth.users(1) ─ (N) audit_logs`（actor 任意）

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 監査ログID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `actor` | `uuid` |  |  | 実行者 | `references auth.users(id) on delete set null` |
| `action` | `text` | ✔︎ |  | 動作名（例: `reservation.update`） |  |
| `target_type` | `text` | ✔︎ |  | 対象タイプ（例: `reservation`） |  |
| `target_id` | `uuid` |  |  | 対象ID |  |
| `diff` | `jsonb` |  |  | 変更差分 |  |
| `at` | `timestamptz` | ✔︎ | `now()` | 記録時刻 |  |

---

## インデックス
- 既定（PK のみ）。用途に応じ `tenant_id, at` などの索引を検討。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: 管理者のみ（`app_is_tenant_admin(tenant_id)`）
  - `insert`: メンバー可（`app_is_tenant_member(tenant_id)`）
  - `update/delete`: なし（原則不可）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

