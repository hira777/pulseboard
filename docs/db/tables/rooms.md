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
| `open_hours` | `jsonb` |  |  | 営業時間スロット（曜日別配列）。例: `{ "mon": [{"start":"09:00","end":"18:00"}] }` |  |
| `active` | `boolean` | ✔︎ | `true` | 有効/無効 |  |

---

## インデックス/制
- UNIQUE 制約: `(tenant_id, id)`（テナントとIDの組合せを外部参照で利用）
- UNIQUE 制約: `(tenant_id, name)`（同一テナント内で部屋名(name)の重複を禁止）

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

## `open_hours` の仕様メモ

- 曜日キー（`mon`〜`sun`）ごとに 0 個以上の枠を配列で保持する。
- 各枠は `{ "start": "HH:MM", "end": "HH:MM" }` の文字列で表現する（24 時制）。
- `end` が `start` より小さい場合は翌日に跨ぐ営業（例: `{"start":"23:00","end":"02:00"}` は 23:00〜翌 02:00）。判定時はこの条件を考慮する。
- 24 時間営業は `{ "start": "00:00", "end": "24:00" }` の 1 枠で表現し、全日営業と判定する。
- 祝日や臨時変更など定常外の営業は `calendar_exceptions` で管理し、`open_hours` は基準となるパターンのみを持つ。
