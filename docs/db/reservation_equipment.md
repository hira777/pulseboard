# reservation_equipment テーブル定義書

## 概要
- **テーブル名**: `public.reservation_equipment`
- **目的**: 予約と機材 SKU の多対多（数量付）を表現。
- **主な利用画面/API**: 予約詳細、準備品目一覧。
- **関連（ER）**:
  - `reservations(1) ─ (N) reservation_equipment`
  - `equipments(1) ─ (N) reservation_equipment`

---

## カラム定義

| カラム名 | 型 | 必須 | デフォルト | 説明 | 制約 |
| --- | --- | :-: | --- | --- | --- |
| `reservation_id` | `uuid` | ✔︎ |  | 親予約 | `references reservations(id) on delete cascade` |
| `equipment_id` | `uuid` | ✔︎ |  | SKU | `references equipments(id) on delete restrict` |
| `qty` | `int` | ✔︎ |  | 必要数量 | `check (qty > 0)` |
| （PK） |  |  |  | `(reservation_id, equipment_id)` | `primary key` |

---

## インデックス
- 既定（複合PK）。

---

## セキュリティ（RLS/ポリシー）
- **RLS**: 有効
- **ポリシー**:
  - `select/insert/update/delete`: 親予約のテナント メンバー
    - 条件: `exists (select 1 from reservations r where r.id = reservation_equipment.reservation_id and app_is_tenant_member(r.tenant_id))`

---

## 作成 SQL（参照）
- `supabase/migrations/0002_core.sql` を参照。

