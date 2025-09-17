# messages テーブル定義書

## 概要
- **テーブル名**: `public.messages`
- **目的**: 予約に紐づく内部メッセージ（運用メモ）を管理。
- **主な利用画面/API**: 予約詳細・運用コンソール。
- **関連（ER）**:
  - `reservations(1) ─ (N) messages`
  - `auth.users(1) ─ (N) messages`（送信者）

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | メッセージID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `reservation_id` | `uuid` | ✔︎ |  | 紐づく予約 | `references reservations(id) on delete cascade` |
| `sender_profile_id` | `uuid` | ✔︎ |  | 送信者 | `references auth.users(id) on delete cascade` |
| `body` | `text` | ✔︎ |  | 本文 |  |
| `created_at` | `timestamptz` | ✔︎ | `now()` | 送信時刻 |  |

---

## インデックス
- 既定（PK のみ）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select/insert/update/delete`: メンバー（`app_is_tenant_member(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

