# customers テーブル定義書

## 概要
- **テーブル名**: `public.customers`
- **目的**: テナントの顧客情報を管理。
- **主な利用画面/API**: 予約顧客選択、顧客管理。
- **関連（ER）**:
  - `tenants(1) ─ (N) customers`
  - `customers(1) ─ (N) reservations`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `id` | `uuid` | ✔︎ | `gen_random_uuid()` | 顧客ID | `primary key` |
| `tenant_id` | `uuid` | ✔︎ |  | 所属テナント | `references tenants(id) on delete cascade` |
| `name` | `text` | ✔︎ |  | 顧客名 |  |
| `email` | `text` | ✔︎ |  | メール |  |
| `phone` | `text` | ✔︎ |  | 電話番号 |  |
| `note` | `text` |  |  | 備考 |  |
| `created_at` | `timestamptz` | ✔︎ | `now()` | 登録時刻 |  |

---

## インデックス/制約
- UNIQUE 制約: `(tenant_id, id)`（テナントとIDの組合せを外部参照で利用）
- 必要に応じて `email/phone` の索引を検討。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select/insert/update/delete`: メンバー（`app_is_tenant_member(tenant_id)`）

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。
