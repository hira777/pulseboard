# calendar_exceptions テーブル定義書

## 概要
- **テーブル名**: `public.calendar_exceptions`
- **目的**: 休業日/メンテ/私用などの例外時間帯を管理。
- **主な利用画面/API**: カレンダー表示、予約作成時の候補制御。
- **関連（ER）**:
  - `tenants(1) ─ (N) calendar_exceptions`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 例外ID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `scope` | `text` | ✔︎ |  | 適用範囲 | `check (scope in ('tenant','room','equipment','staff'))` |
| `target_id` | `uuid` |  |  | 対象ID（scopeごと） |  |
| `range` | `tstzrange` | ✔︎ |  | 時間範囲 |  |
| `type` | `text` | ✔︎ |  | 種別 | `check (type in ('holiday','maintenance','ooh','busy'))` |
| `note` | `text` |  |  | 備考 |  |

---

## インデックス
- 既定（PK のみ）。範囲検索が多い場合は `gist(range)` 検討（現状は不要）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: メンバー（`app_is_tenant_member(tenant_id)`）
  - `insert/update/delete`: 管理者（`app_is_tenant_admin(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

