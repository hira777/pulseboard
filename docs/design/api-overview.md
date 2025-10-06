# Pulseboard API Overview

このドキュメントは、撮影スタジオ向け予約ダッシュボード（Pulseboard）のサーバー API を俯瞰し、主要ユースケースと紐づけて整理したものです。`docs/requirements.md` や `docs/roadmap.md` で述べられている機能フェーズを踏まえ、実装前にエンドポイントの役割・優先度を明確化することを目的とします。

- バックエンド: Next.js 15 + Supabase (PostgreSQL / RLS) / Node.js 22
- すべてのエンドポイントは `/t/{tenantId}/...` または `/t/{tenantSlug}/...` を前提とし、テナント境界を強制

---

## 1. 認証・テナント選択

| API                               | 概要                                    | 主なユースケース                      | 備考                                       |
| --------------------------------- | --------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `POST /sessions`                  | メール + パスワードでサインイン         | フェーズ 2: `/t/:slug` への誘導の起点 | Supabase Auth を利用（Server Action 経由） |
| `GET /tenants`                    | 所属テナント一覧の取得                  | ログイン直後のテナント選択ダイアログ  | 権限: メンバー以上                         |
| `POST /tenants/{tenantId}/select` | アクティブテナントの選択（Cookie 更新） | 直リンク時の `/t/:slug` リダイレクト  | 既存 middleware ロジックと連携             |

---

## 2. マスタ参照系（Rooms / Services / Equipments / Staff）

| API                            | 概要                                  | ユースケース                         | 備考                               |
| ------------------------------ | ------------------------------------- | ------------------------------------ | ---------------------------------- |
| `GET /t/{tenantId}/rooms`      | 部屋一覧 + 営業時間・カラー等         | 予約作成フォーム、カレンダー初期表示 | `open_hours` JSON で営業時間を返す |
| `GET /t/{tenantId}/services`   | サービス一覧 + 所要時間・前後バッファ | 予約メニュー選択、スロット長の算出   | フェーズ 3 で利用                  |
| `GET /t/{tenantId}/equipments` | SKU 在庫・個体管理フラグ              | 機材追加ダイアログ、予約可能枠条件   | `track_serial` / `stock` を返却    |
| `GET /t/{tenantId}/staff`      | スタッフ一覧 + スキルタグ             | スタッフ割当、フィルタリング         | 将来の技能マッチングにも対応       |

---

## 3. 予約可能枠 API（Availability）

| API                                    | 概要                                                         | ユースケース                                   | 備考                                         |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
| `POST /t/{tenantId}/availability:list` | `listAvailability`。指定条件から予約可能なスロット候補を返す | 予約作成ウィザード、カレンダーの「空き枠検索」 | フェーズ 3 のコア。最大 50 件 + `nextCursor` |

- 入力例
  ```json
  {
    "range": { "from": "2025-10-01T09:00:00+09:00", "to": "2025-10-01T15:00:00+09:00" },
    "serviceId": "svc-123",
    "roomId": "room-1", // 任意
    "wantedEquipments": [{ "equipmentId": "camera-1", "qty": 2 }],
    "staffId": "staff-1", // 任意
    "pageSize": 20
  }
  ```
- 返却例
  ```json
  {
    "slots": [
      {
        "roomId": "room-1",
        "start": "2025-10-01T09:00:00+09:00",
        "end": "2025-10-01T10:00:00+09:00",
        "feasibleEquipmentSets": [{ "items": [{ "equipmentId": "camera-1", "qty": 2 }] }]
      }
    ],
    "nextCursor": "2025-10-01T11:00:00+09:00"
  }
  ```

---

## 4. 予約 CRUD

| API                                      | 概要                                          | ユースケース            | 備考                             |
| ---------------------------------------- | --------------------------------------------- | ----------------------- | -------------------------------- |
| `POST /t/{tenantId}/reservations`        | 新規予約作成（部屋 + 機材 + スタッフ + 顧客） | UC-1 予約作成           | idempotency-key + 409 対応を想定 |
| `PATCH /t/{tenantId}/reservations/{id}`  | 予約日時・割当変更                            | UC-2 リスケ             | `If-Match` ヘッダー、差分返却    |
| `DELETE /t/{tenantId}/reservations/{id}` | キャンセル（ステータス制御）                  | UC-3 キャンセル         | `status='canceled'` に更新       |
| `GET /t/{tenantId}/reservations`         | 期間・部屋・ステータスで検索                  | カレンダー / リスト表示 | 分割ページング or カーソル       |
| `GET /t/{tenantId}/reservations/{id}`    | 予約詳細                                      | 予約ドロワー、履歴表示  | 機材・スタッフ・顧客情報を含む   |

---

## 5. 予約メッセージ・監査

| API                                              | 概要                   | ユースケース               | 備考             |
| ------------------------------------------------ | ---------------------- | -------------------------- | ---------------- |
| `GET /t/{tenantId}/reservations/{id}/messages`   | メッセージ一覧         | 運用コメント閲覧           | 権限: メンバー   |
| `POST /t/{tenantId}/reservations/{id}/messages`  | メッセージ追加         | スタッフ間メモ             | フェーズ 5 UI S1 |
| `GET /t/{tenantId}/reservations/{id}/audit-logs` | 重要操作の監査ログ取得 | フェーズ 8 エラー規約/監査 | 権限: Admin      |

---

## 6. カレンダー例外管理

| API                                             | 概要                | ユースケース                   | 備考                               |
| ----------------------------------------------- | ------------------- | ------------------------------ | ---------------------------------- |
| `GET /t/{tenantId}/calendar-exceptions`         | 休業/メンテ情報参照 | カレンダー描画、予約可能枠除外 | scope: tenant/room/equipment/staff |
| `POST /t/{tenantId}/calendar-exceptions`        | 例外追加            | 管理画面で稼働調整             | フェーズ 6 管理画面 S1             |
| `DELETE /t/{tenantId}/calendar-exceptions/{id}` | 例外削除            | 管理画面                       | 権限: Admin                        |

---

## 7. 顧客・補助マスタ（Optional 初期）

| API                            | 概要     | ユースケース                 | 備考                  |
| ------------------------------ | -------- | ---------------------------- | --------------------- |
| `GET /t/{tenantId}/customers`  | 顧客一覧 | 予約フォームで既存顧客紐付け | 将来の CRM 連携を想定 |
| `POST /t/{tenantId}/customers` | 顧客登録 | 新規予約時の顧客作成         | メール/電話は重複許容 |

---

## 8. リアルタイム・通知（フェーズ 7 以降）

| API                                 | 概要                            | ユースケース            | 備考                                  |
| ----------------------------------- | ------------------------------- | ----------------------- | ------------------------------------- |
| `GET /t/{tenantId}/events` (SSE/WS) | `reservations.updated` 等を配信 | 複数端末の同時更新      | Supabase Realtime/Edge Functions 想定 |
| `POST /t/{tenantId}/notifications`  | アプリ内トースト通知キュー登録  | UI の ACK/rollback 通知 | 最小実装はサーバ側のみ                |

---

## 9. 管理系 CRUD（フェーズ 6+）

| API                                                | 概要               | ユースケース           | 備考                              |
| -------------------------------------------------- | ------------------ | ---------------------- | --------------------------------- |
| `POST /t/{tenantId}/rooms` / `PATCH` / `DELETE`    | 部屋情報の管理     | 管理画面 S1            | Admin 権限必須                    |
| `POST /t/{tenantId}/services` / `PATCH` / `DELETE` | サービス管理       | メニュー更新           | バッファ/価格等も対象             |
| `POST /t/{tenantId}/equipments` / `PATCH`          | 機材 SKU／在庫更新 | 在庫調整、個体状態変更 | `track_serial` 切替時の扱いを定義 |
| `POST /t/{tenantId}/staff` / `PATCH`               | スタッフ管理       | 稼働設定・技能タグ調整 | `tenant_users` との同期が必要     |

---

## 今後詰めるべき事項

1. **エラー規約の統一**: すべての API で `code/message/details` 形式を徹底（フェーズ 8）。
2. **ページング設計**: `listAvailability` は `nextCursor`、予約一覧は cursor か offset かを決定する。
3. **認可ポリシー**: Admin と Member の操作範囲を API ごとに明文化（`docs/db/schema.md` の RLS 方針と整合）。
4. **Idempotency**: 変更系 API（予約作成/更新/キャンセル）は idempotency-key を標準化する。
5. **Schema バージョン管理**: エンドポイントの入出力を Zod スキーマで管理し、エラーも型で表現する。

本ドキュメントは `listAvailability` 実装に着手する前の API 定義見直しに役立てる想定です。個別 API の詳細仕様（パラメータ型・レスポンススキーマ）は別途設計ドキュメントを追加してください。
