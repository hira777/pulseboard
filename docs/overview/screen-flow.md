# 画面遷移概要

本ページは主要画面と遷移の俯瞰図を提供します。

UI 実装は Next.js App Router（/t/:tenantId 配下）を前提とします。

## 0. ポリシー

- 直リンク可能: すべての画面は `/t/:tenantId/...` で直リンク/リロード可能
- 認可: ページは未権限=404（秘匿）、API/Actions は未権限=403（要件 2 章, 9.1.1）
- テナント切替: ヘッダーのスイッチャーで Cookie とパスを同期（`/t/:tenantId` へ）

## 1. 主要画面（案）

- `/login`（未認証時）
- `/t/:tenantId` ダッシュボード
- `/t/:tenantId/reservations` 予約一覧
- `/t/:tenantId/reservations/calendar` カレンダー（`?view=week|day`）
- `/t/:tenantId/reservations/new` 予約作成（モーダル/ドロワーでも可）
- `/t/:tenantId/reservations/:id` 予約詳細（TBD: ドロワー連携、要件 15.1）
- `/t/:tenantId/availability` 可用枠検索（条件パネル＋結果）
- `/t/:tenantId/inventory` 機材（SKU 一覧）
- `/t/:tenantId/inventory/:sku` SKU 詳細（個体割当は返却時）
- `/t/:tenantId/rooms` 部屋一覧
- `/t/:tenantId/services` サービス一覧
- `/t/:tenantId/staff` スタッフ一覧
- `/t/:tenantId/blackouts` 例外日管理
- `/t/:tenantId/settings` 設定（営業時間/色/バッファ等）

## 2. 遷移図（stateDiagram）

```mermaid
stateDiagram-v2
  [*] --> Login
  Login --> Dashboard: 認証成功
  Dashboard --> Calendar
  Dashboard --> Reservations
  Dashboard --> Availability
  Dashboard --> Inventory
  Dashboard --> Rooms
  Dashboard --> Services
  Dashboard --> Staff
  Dashboard --> Blackouts
  Dashboard --> Settings

  Calendar --> Reservations
  Reservations --> Calendar

  Calendar --> ReservationNew: 新規作成
  Reservations --> ReservationDetail: 行選択
  ReservationDetail --> ReservationEdit: 編集
  ReservationEdit --> Calendar: 保存
  ReservationEdit --> Reservations: 保存

  Inventory --> SkuDetail
  Rooms --> RoomDetail
  Services --> ServiceDetail
  Staff --> StaffDetail

  note right of Calendar
    未権限はページ=404
    API/Actions=403
  end note
```

補足:

- 予約詳細 URL とドロワーの整合は `docs/requirements.md` 15.1 の検討事項。
- 深いリンク（例: `/t/abc/reservations/calendar?reservationId=...`）は表示上の連携に留め、参照不可能な ID は 404 秘匿で扱う。

---

## 3. トレーサビリティ

- 要件 2 章（ロール/RBAC）、7 章（競合/可用枠）、9.1.1（認証・権限の HTTP 規約）
- E2E（S1）カバー対象: 予約 CRUD、可用枠検索、ロール別アクセス
