# services テーブル定義書

## 概要
- **テーブル名**: `public.services`
- **目的**: 提供メニュー（サービス）を管理。所要時間と前後バッファを保持。
- **主な利用画面/API**: 予約作成、メニュー設定。
- **関連（ER）**:
  - `tenants(1) ─ (N) services`
  - `services(1) ─ (N) reservations`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | サービスID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `name` | `text` | ✔︎ |  | サービス名 |  |
| `duration_min` | `int` | ✔︎ |  | 所要時間（分） |  |
| `buffer_before_min` | `int` | ✔︎ | `0` | 前バッファ（分） |  |
| `buffer_after_min` | `int` | ✔︎ | `0` | 後バッファ（分） |  |
| `color` | `text` |  |  | UI 色 |  |

---

## インデックス/制約
- UNIQUE 制約: `(tenant_id, id)`（テナントとIDの組合せを外部参照で利用）

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select`: メンバー（`app_is_tenant_member(tenant_id)`）
  - `insert/update/delete`: 管理者（`app_is_tenant_admin(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。
