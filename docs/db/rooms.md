# rooms テーブル定義書

## 概要
- **テーブル名**: `public.rooms`
- **目的**: テナント内の部屋（スタジオ等）情報を管理。
- **主な利用画面/API**: 予約作成/一覧、空き状況照会。
- **関連（ER）**:
  - `tenants(1) ─ (N) rooms`
  - `rooms(1) ─ (N) reservations`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 部屋ID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `name` | `text` | ✔︎ |  | 部屋名 |  |
| `capacity` | `int` |  |  | 収容人数目安 |  |
| `color` | `text` |  |  | UI 色 |  |
| `open_hours` | `jsonb` |  |  | 営業時間スロット（曜日別） |  |
| `active` | `boolean` | ✔︎ | `true` | 有効/無効 |  |

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

